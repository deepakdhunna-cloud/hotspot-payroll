/**
 * Live portal relay — the website is the system of record and PUSHES its
 * snapshot to the portal. (The portal can also PULL /api/portal-feed; both
 * carry the exact same payload from buildPortalFeed().)
 *
 * Design rules, in order:
 *  - The portal can never hurt operations: every push is fire-and-forget
 *    with a hard timeout, failures only mark status, and nothing here runs
 *    unless PORTAL_SYNC_URL is set.
 *  - "Live" means change-driven: any successful mutation nudges a debounced
 *    push, so the portal is seconds behind a punch — the interval push is
 *    only the safety net for missed nudges and portal downtime.
 *  - Silence must be diagnosable: every attempt lands in an in-memory
 *    status (surfaced to the CEO under Executive view → Live portal), and
 *    the status never contains the token or the URL's query string.
 */
import { buildPortalFeed, PORTAL_FEED_SCHEMA_VERSION } from "./portalFeed";

export const PORTAL_SYNC_DEBOUNCE_MS = 3_000;
export const PORTAL_SYNC_TIMEOUT_MS = 20_000;
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 15;
const MAX_INTERVAL_SECONDS = 3600;

export type PortalSyncReason = "boot" | "change" | "interval" | "manual";

export type PortalSyncConfig = {
  url: string;
  /** Sent as `Authorization: Bearer …` when present. */
  token?: string;
  intervalMs: number;
};

export type PortalPushResult = {
  ok: boolean;
  at: string;
  durationMs: number;
  error?: string;
  counts?: Record<string, number>;
};

export type PortalSyncStatus = {
  /** PORTAL_SYNC_URL is present and a valid http(s) URL. */
  configured: boolean;
  /** Why `configured` is false when a URL WAS provided (e.g. malformed). */
  configError?: string;
  /** Redacted destination — origin + path only, never query or credentials. */
  target?: string;
  hasToken: boolean;
  intervalSeconds: number;
  /** The pull side: whether /api/portal-feed would accept a caller at all. */
  pullFeedTokenSet: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastDurationMs?: number;
  /** Failure message of the most recent attempt; cleared by a success. */
  lastError?: string;
  lastReason?: PortalSyncReason;
  /** Record counts included in the last successful push. */
  lastCounts?: Record<string, number>;
  consecutiveFailures: number;
  totalSuccesses: number;
  inFlight: boolean;
  /** A debounced change-push is waiting to fire. */
  pendingChange: boolean;
  startedAt: string;
};

type SyncDeps = {
  fetchImpl: typeof fetch;
  buildFeed: typeof buildPortalFeed;
};

const defaultDeps: SyncDeps = {
  fetchImpl: (...args) => fetch(...args),
  buildFeed: buildPortalFeed,
};

let deps: SyncDeps = defaultDeps;

type SyncState = {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastDurationMs?: number;
  lastError?: string;
  lastReason?: PortalSyncReason;
  lastCounts?: Record<string, number>;
  consecutiveFailures: number;
  totalSuccesses: number;
  inFlightPromise: Promise<PortalPushResult> | null;
  /** A push arrived while one was running — run once more when it ends. */
  queuedReason: PortalSyncReason | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  intervalTimer: ReturnType<typeof setInterval> | null;
  startedAt: string;
};

const freshState = (): SyncState => ({
  consecutiveFailures: 0,
  totalSuccesses: 0,
  inFlightPromise: null,
  queuedReason: null,
  debounceTimer: null,
  intervalTimer: null,
  startedAt: new Date().toISOString(),
});

let state: SyncState = freshState();

/** Origin + path only: query strings and userinfo can carry secrets. */
export function redactPortalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

/**
 * null = relay off (no URL configured). A malformed URL also returns null
 * but is reported through getPortalSyncStatus().configError so the CEO
 * page can say WHY nothing is being sent.
 */
export function getPortalSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
): PortalSyncConfig | null {
  const raw = env.PORTAL_SYNC_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const intervalRaw = Number(env.PORTAL_SYNC_INTERVAL_SECONDS);
  const seconds = Number.isFinite(intervalRaw)
    ? Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.trunc(intervalRaw)))
    : DEFAULT_INTERVAL_SECONDS;

  return {
    url: raw,
    token: env.PORTAL_SYNC_TOKEN?.trim() || undefined,
    intervalMs: seconds * 1000,
  };
}

function configErrorFor(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.PORTAL_SYNC_URL?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "PORTAL_SYNC_URL must start with http:// or https://";
    }
  } catch {
    return "PORTAL_SYNC_URL is not a valid URL";
  }
  return undefined;
}

export function getPortalSyncStatus(
  env: NodeJS.ProcessEnv = process.env,
): PortalSyncStatus {
  const config = getPortalSyncConfig(env);
  return {
    configured: !!config,
    configError: configErrorFor(env),
    target: config ? redactPortalUrl(config.url) : undefined,
    hasToken: !!config?.token,
    intervalSeconds: config
      ? Math.round(config.intervalMs / 1000)
      : DEFAULT_INTERVAL_SECONDS,
    pullFeedTokenSet: !!env.PORTAL_FEED_TOKEN?.trim(),
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
    lastReason: state.lastReason,
    lastCounts: state.lastCounts,
    consecutiveFailures: state.consecutiveFailures,
    totalSuccesses: state.totalSuccesses,
    inFlight: !!state.inFlightPromise,
    pendingChange: !!state.debounceTimer,
    startedAt: state.startedAt,
  };
}

async function runPush(
  config: PortalSyncConfig,
  reason: PortalSyncReason,
): Promise<PortalPushResult> {
  const startedAt = new Date();
  state.lastAttemptAt = startedAt.toISOString();
  state.lastReason = reason;

  const fail = (message: string): PortalPushResult => {
    const durationMs = Date.now() - startedAt.getTime();
    state.lastDurationMs = durationMs;
    state.lastError = message;
    state.consecutiveFailures += 1;
    console.error(
      `[PortalSync] Push failed (${reason}, attempt ${state.consecutiveFailures}): ${message}`,
    );
    return { ok: false, at: startedAt.toISOString(), durationMs, error: message };
  };

  let body: string;
  let counts: Record<string, number>;
  try {
    const feed = await deps.buildFeed();
    counts = {
      employees: feed.employees.length,
      payrollEntries: feed.payrollEntries.length,
      timePunches: feed.timePunches.length,
      scheduleShifts: feed.scheduleShifts.length,
    };
    body = JSON.stringify(feed);
  } catch (error) {
    return fail(
      `Could not build the snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PORTAL_SYNC_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Hotspot-Schema-Version": PORTAL_FEED_SCHEMA_VERSION,
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const res = await deps.fetchImpl(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200).trim();
      } catch {
        /* body unreadable — status alone is the diagnosis */
      }
      return fail(
        `Portal responded HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const durationMs = Date.now() - startedAt.getTime();
    const recovered = state.consecutiveFailures > 0;
    state.lastDurationMs = durationMs;
    state.lastError = undefined;
    state.lastCounts = counts;
    state.consecutiveFailures = 0;
    state.totalSuccesses += 1;
    state.lastSuccessAt = startedAt.toISOString();
    if (recovered) console.log("[PortalSync] Push succeeded — relay recovered");
    return { ok: true, at: startedAt.toISOString(), durationMs, counts };
  } catch (error) {
    if (controller.signal.aborted) {
      return fail(`Portal did not answer within ${PORTAL_SYNC_TIMEOUT_MS / 1000}s`);
    }
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Push one snapshot now. Single-flight: a call while a push is running
 * returns the running push's result and queues exactly one follow-up so
 * the newer data still goes out.
 */
export function pushPortalSnapshot(
  reason: PortalSyncReason,
): Promise<PortalPushResult> {
  const config = getPortalSyncConfig();
  if (!config) {
    return Promise.resolve({
      ok: false,
      at: new Date().toISOString(),
      durationMs: 0,
      error:
        configErrorFor(process.env) ??
        "Relay is off — PORTAL_SYNC_URL is not set in the site's environment",
    });
  }

  if (state.inFlightPromise) {
    state.queuedReason = reason;
    return state.inFlightPromise;
  }

  const promise = runPush(config, reason).finally(() => {
    state.inFlightPromise = null;
    if (state.queuedReason) {
      const queued = state.queuedReason;
      state.queuedReason = null;
      schedulePortalPush(queued);
    }
  });
  state.inFlightPromise = promise;
  return promise;
}

/**
 * Nudge the relay after a data change. Debounced so a burst of mutations
 * (bulk saves, schedule commits) becomes one push. No-op when the relay
 * is not configured.
 */
export function schedulePortalPush(reason: PortalSyncReason): void {
  if (!getPortalSyncConfig()) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void pushPortalSnapshot(reason);
  }, PORTAL_SYNC_DEBOUNCE_MS);
  state.debounceTimer.unref?.();
}

/**
 * Boot entry point: one immediate push plus the safety-net interval.
 * Returns whether the relay is on so the caller can log it.
 */
export function startPortalSync(): boolean {
  const config = getPortalSyncConfig();
  if (!config) {
    const why = configErrorFor(process.env);
    console.log(
      why
        ? `[PortalSync] Relay OFF — ${why}`
        : "[PortalSync] Relay off (set PORTAL_SYNC_URL to push live data to the portal)",
    );
    return false;
  }
  console.log(
    `[PortalSync] Live relay ON → ${redactPortalUrl(config.url)} (every ${Math.round(config.intervalMs / 1000)}s + on every change)`,
  );
  void pushPortalSnapshot("boot");
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  state.intervalTimer = setInterval(() => {
    void pushPortalSnapshot("interval");
  }, config.intervalMs);
  state.intervalTimer.unref?.();
  return true;
}

/** Test-only: swap fetch/feed builders and wipe module state. */
export function _resetPortalSyncForTest(overrides?: Partial<SyncDeps>): void {
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  state = freshState();
  deps = { ...defaultDeps, ...overrides };
}
