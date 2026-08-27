import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_SYNC_DEBOUNCE_MS,
  _resetPortalSyncForTest,
  getPortalSyncConfig,
  getPortalSyncStatus,
  pushPortalSnapshot,
  redactPortalUrl,
  schedulePortalPush,
} from "./portalSync";

const FEED = {
  schemaVersion: "1.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  employees: [{ id: 1 }, { id: 2 }],
  payrollEntries: [{ id: 10 }],
  timePunches: [{ id: 20 }, { id: 21 }, { id: 22 }],
  scheduleShifts: [],
} as any;

const okResponse = () => new Response("ok", { status: 200 });

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    PORTAL_SYNC_URL: process.env.PORTAL_SYNC_URL,
    PORTAL_SYNC_TOKEN: process.env.PORTAL_SYNC_TOKEN,
    PORTAL_SYNC_INTERVAL_SECONDS: process.env.PORTAL_SYNC_INTERVAL_SECONDS,
    PORTAL_FEED_TOKEN: process.env.PORTAL_FEED_TOKEN,
  };
  delete process.env.PORTAL_SYNC_URL;
  delete process.env.PORTAL_SYNC_TOKEN;
  delete process.env.PORTAL_SYNC_INTERVAL_SECONDS;
  delete process.env.PORTAL_FEED_TOKEN;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetPortalSyncForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("portal sync configuration", () => {
  it("is off when PORTAL_SYNC_URL is unset", () => {
    _resetPortalSyncForTest();
    expect(getPortalSyncConfig()).toBeNull();
    const status = getPortalSyncStatus();
    expect(status.configured).toBe(false);
    expect(status.configError).toBeUndefined();
  });

  it("rejects malformed URLs and says why in the status", () => {
    process.env.PORTAL_SYNC_URL = "not a url";
    _resetPortalSyncForTest();
    expect(getPortalSyncConfig()).toBeNull();
    expect(getPortalSyncStatus().configError).toMatch(/not a valid URL/);
  });

  it("rejects non-http(s) protocols", () => {
    process.env.PORTAL_SYNC_URL = "ftp://portal.example.com/ingest";
    _resetPortalSyncForTest();
    expect(getPortalSyncConfig()).toBeNull();
    expect(getPortalSyncStatus().configError).toMatch(/http/);
  });

  it("clamps the interval and defaults to 60s", () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    _resetPortalSyncForTest();
    expect(getPortalSyncConfig()?.intervalMs).toBe(60_000);
    process.env.PORTAL_SYNC_INTERVAL_SECONDS = "5";
    expect(getPortalSyncConfig()?.intervalMs).toBe(15_000);
    process.env.PORTAL_SYNC_INTERVAL_SECONDS = "120";
    expect(getPortalSyncConfig()?.intervalMs).toBe(120_000);
    process.env.PORTAL_SYNC_INTERVAL_SECONDS = "garbage";
    expect(getPortalSyncConfig()?.intervalMs).toBe(60_000);
  });

  it("never exposes the query string or token in the status", () => {
    process.env.PORTAL_SYNC_URL =
      "https://portal.example.com/ingest?key=SUPER-SECRET";
    process.env.PORTAL_SYNC_TOKEN = "ALSO-SECRET";
    _resetPortalSyncForTest();
    const status = getPortalSyncStatus();
    expect(status.target).toBe("https://portal.example.com/ingest");
    expect(JSON.stringify(status)).not.toContain("SECRET");
    expect(status.hasToken).toBe(true);
  });

  it("redacts credentials embedded in the URL", () => {
    expect(redactPortalUrl("https://user:pass@portal.example.com/x?t=1")).toBe(
      "https://portal.example.com/x",
    );
    expect(redactPortalUrl("garbage")).toBe("(invalid URL)");
  });
});

describe("pushing a snapshot", () => {
  it("reports a helpful error when the relay is not configured", async () => {
    _resetPortalSyncForTest();
    const result = await pushPortalSnapshot("manual");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PORTAL_SYNC_URL/);
  });

  it("POSTs the snapshot with bearer auth and records success", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    process.env.PORTAL_SYNC_TOKEN = "relay-token";
    const fetchImpl = vi.fn(async () => okResponse());
    _resetPortalSyncForTest({
      fetchImpl: fetchImpl as any,
      buildFeed: async () => FEED,
    });

    const result = await pushPortalSnapshot("manual");
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({
      employees: 2,
      payrollEntries: 1,
      timePunches: 3,
      scheduleShifts: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://portal.example.com/ingest");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer relay-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Hotspot-Schema-Version"]).toBe("1.0");
    expect(JSON.parse(init.body as string).employees).toHaveLength(2);

    const status = getPortalSyncStatus();
    expect(status.lastSuccessAt).toBeTruthy();
    expect(status.lastError).toBeUndefined();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.totalSuccesses).toBe(1);
  });

  it("omits the Authorization header when no token is configured", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    const fetchImpl = vi.fn(async () => okResponse());
    _resetPortalSyncForTest({
      fetchImpl: fetchImpl as any,
      buildFeed: async () => FEED,
    });
    await pushPortalSnapshot("manual");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("records the portal's HTTP status and body on rejection", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    _resetPortalSyncForTest({
      fetchImpl: (async () =>
        new Response("bad token", { status: 401 })) as any,
      buildFeed: async () => FEED,
    });

    const result = await pushPortalSnapshot("interval");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 401");
    expect(result.error).toContain("bad token");

    const status = getPortalSyncStatus();
    expect(status.consecutiveFailures).toBe(1);
    expect(status.lastError).toContain("HTTP 401");
    expect(status.lastSuccessAt).toBeUndefined();
  });

  it("counts consecutive network failures, then clears on recovery", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    let fail = true;
    _resetPortalSyncForTest({
      fetchImpl: (async () => {
        if (fail) throw new Error("getaddrinfo ENOTFOUND portal.example.com");
        return okResponse();
      }) as any,
      buildFeed: async () => FEED,
    });

    await pushPortalSnapshot("interval");
    await pushPortalSnapshot("interval");
    expect(getPortalSyncStatus().consecutiveFailures).toBe(2);
    expect(getPortalSyncStatus().lastError).toContain("ENOTFOUND");

    fail = false;
    const result = await pushPortalSnapshot("interval");
    expect(result.ok).toBe(true);
    const status = getPortalSyncStatus();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastError).toBeUndefined();
  });

  it("fails cleanly when the snapshot itself cannot be built", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    const fetchImpl = vi.fn(async () => okResponse());
    _resetPortalSyncForTest({
      fetchImpl: fetchImpl as any,
      buildFeed: async () => {
        throw new Error("Database unavailable");
      },
    });
    const result = await pushPortalSnapshot("boot");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Database unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs pushes single-flight: a concurrent call rides the running push and queues one follow-up", async () => {
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return okResponse();
    });
    _resetPortalSyncForTest({
      fetchImpl: fetchImpl as any,
      buildFeed: async () => FEED,
    });

    const first = pushPortalSnapshot("change");
    const second = pushPortalSnapshot("change");
    expect(getPortalSyncStatus().inFlight).toBe(true);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(r2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The queued follow-up lands as a debounced push, not a concurrent one.
    expect(getPortalSyncStatus().pendingChange).toBe(true);
  });
});

describe("change-triggered debounce", () => {
  it("coalesces a burst of nudges into one push", async () => {
    vi.useFakeTimers();
    process.env.PORTAL_SYNC_URL = "https://portal.example.com/ingest";
    const fetchImpl = vi.fn(async () => okResponse());
    _resetPortalSyncForTest({
      fetchImpl: fetchImpl as any,
      buildFeed: async () => FEED,
    });

    schedulePortalPush("change");
    schedulePortalPush("change");
    schedulePortalPush("change");
    expect(getPortalSyncStatus().pendingChange).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PORTAL_SYNC_DEBOUNCE_MS + 10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getPortalSyncStatus().pendingChange).toBe(false);
  });

  it("does nothing when the relay is off", () => {
    vi.useFakeTimers();
    _resetPortalSyncForTest();
    schedulePortalPush("change");
    expect(getPortalSyncStatus().pendingChange).toBe(false);
  });
});
