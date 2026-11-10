import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { PIN_COOKIE_NAME, PIN_SESSION_TTL_MS } from "@shared/const";
import { pinCodes } from "../../drizzle/schema";
import { STORES, type Store } from "../../shared/hotspot";
import { getDb } from "../db";
import {
  LEGACY_SCOPES,
  ensureAccessProfiles as seedAccessProfiles,
  getProfileByScope,
  hasAnyProfile,
  isLiveProfile,
  legacyProfileFor,
  listProfiles,
  normalizeStores,
  toSessionProfile,
  type ProfileRole,
  type SessionProfile,
} from "../accessProfiles";
import { ENV } from "./env";

/**
 * A PIN scope is the key of one row in pin_codes: "ceo", "cfo" or a store
 * name for the seven logins that predate profiles, "profile:<hex>" for every
 * profile created since. It is also the identity written to the audit log.
 */
export type PinScope = string;
export type PinSession = {
  scope: PinScope;
  /** The sign-in profile behind this session (null only without a DB). */
  profileId: number | null;
  /** The profile's display name ("CEO", "Raj", "HM 11 Manager"…). */
  name: string | null;
  /**
   * admin = CEO (everything) · manager = operations for `stores` ·
   * cfo = READ-ONLY company-wide financials (the CFO portal). The cfo
   * role owns no stores, so every store-scoped mutation check fails for
   * it by construction.
   */
  role: ProfileRole;
  /** The stores a manager may use; [] for CEO and CFO. */
  stores: Store[];
  /** The one store of a single-store manager, else null (all / several). */
  store: Store | null;
  issuedAt: number;
};

/**
 * Default PINs for the seven original logins, created only on a brand-new
 * database. The CEO can change any of these from Executive → Profiles — and
 * should: changing a PIN also revokes every session issued before it.
 */
const DEFAULT_PINS: Record<string, string> = {
  ceo: "9999",
  cfo: "8888",
  "Hotspot Market 11": "1111",
  "Hotspot Market 13": "1313",
  "Hotspot Market 14": "1414",
  "Hotspot Market 17": "1717",
  "Hotspot Travel Center": "7777",
};

/** The seven original logins (CEO, CFO and one per store). */
export const ALL_SCOPES: PinScope[] = [...LEGACY_SCOPES];

// Fail fast in production if the signing secret is missing: falling back to a
// public string would let anyone forge an admin session cookie.
if (!ENV.cookieSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "[PinAuth] JWT_SECRET is not configured. Refusing to start with a guessable session secret.",
  );
}

function getSalt() {
  return ENV.cookieSecret || "hotspot-fallback-salt";
}

/**
 * Legacy hash format (v7 and earlier): a single fast sha256 pass.
 * Kept only so PINs stored before the scrypt upgrade keep working; rows are
 * transparently re-hashed to scrypt on the next successful verification.
 */
export function hashPinLegacy(pin: string, scope: PinScope) {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${pin}:${getSalt()}`)
    .digest("hex");
}

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 } as const;

// Async scrypt runs on the libuv threadpool: PIN checks must never block the
// event loop, or a burst of failed logins would stall kiosk punches app-wide.
const scryptAsync = (password: string, salt: Buffer, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, SCRYPT_OPTS, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });

/** Current hash format: scrypt with a random per-record salt. */
export async function hashPinScrypt(
  pin: string,
  scope: PinScope,
  saltHex?: string,
): Promise<string> {
  const salt = saltHex ?? crypto.randomBytes(16).toString("hex");
  const derived = (
    await scryptAsync(`${scope}:${pin}:${getSalt()}`, Buffer.from(salt, "hex"), SCRYPT_KEYLEN)
  ).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Check a raw PIN against a stored hash of either format. */
export async function checkPinHash(
  pin: string,
  scope: PinScope,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, salt, digest] = stored.split("$");
    if (!salt || !digest) return false;
    try {
      const candidate = (await hashPinScrypt(pin, scope, salt)).split("$")[2]!;
      return timingSafeHexEqual(candidate, digest);
    } catch {
      return false;
    }
  }
  return timingSafeHexEqual(hashPinLegacy(pin, scope), stored);
}

export function normalizePin(raw: string) {
  return (raw || "").replace(/\D/g, "");
}

export function isValidPin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

/**
 * First-boot setup: make sure every login is a profile (carrying over the
 * original seven PINs, or creating them with their defaults on a fresh
 * database). Idempotent and runs once; see accessProfiles.ts.
 */
export async function ensureAccessProfiles(): Promise<void> {
  await seedAccessProfiles(scope => hashPinScrypt(DEFAULT_PINS[scope]!, scope));
  invalidateProfileCache();
}

/** MySQL "table doesn't exist" — drizzle may wrap the driver error. */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "ER_NO_SUCH_TABLE" || e?.cause?.code === "ER_NO_SUCH_TABLE";
}

/**
 * The profiles that may sign in right now, keyed by PIN scope. Until the
 * profiles table exists and is populated (a failed migration, or the
 * moments before the first-boot seed) the original seven logins keep
 * working exactly as they always did.
 */
async function liveProfilesByScope(): Promise<Map<string, SessionProfile>> {
  const legacy = () =>
    new Map(LEGACY_SCOPES.map(scope => [scope, legacyProfileFor(scope)!] as const));
  let rows;
  try {
    rows = await listProfiles({ includeDeleted: true });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    console.warn("[PinAuth] No profiles table yet; using the original logins");
    return legacy();
  }
  if (rows.length === 0) return legacy();
  return new Map(
    rows.filter(isLiveProfile).map(row => [row.pinScope, toSessionProfile(row)] as const),
  );
}

/**
 * Verify a submitted PIN against every profile that may sign in. Returns the
 * matched profile, or null. PINs of turned-off or removed profiles never
 * match. Legacy sha256 rows are upgraded to scrypt in place after a match.
 */
export async function verifyPin(pin: string): Promise<SessionProfile | null> {
  const clean = normalizePin(pin);
  if (!isValidPin(clean)) return null;
  const db = await getDb();
  if (!db) return null;
  const [rows, live] = await Promise.all([db.select().from(pinCodes), liveProfilesByScope()]);
  for (const row of rows) {
    const profile = live.get(row.scope);
    if (!profile) continue;
    const scope = row.scope;
    if (!(await checkPinHash(clean, scope, row.pinHash))) continue;
    if (!row.pinHash.startsWith(SCRYPT_PREFIX)) {
      // Upgrade the stored hash without touching updatedAt-based revocation:
      // this is the same PIN, so existing sessions must stay valid.
      try {
        await db
          .update(pinCodes)
          .set({ pinHash: await hashPinScrypt(clean, scope), updatedAt: row.updatedAt })
          .where(eq(pinCodes.scope, scope));
      } catch (error) {
        console.warn("[PinAuth] Hash upgrade failed (non-fatal):", error);
      }
    }
    return profile;
  }
  return null;
}

/** Update (or create) the PIN for a given scope. CEO-only operation. */
export async function setPin(scope: PinScope, newPin: string): Promise<void> {
  const clean = normalizePin(newPin);
  if (!isValidPin(clean)) throw new Error("PIN must be 4-8 digits");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const hash = await hashPinScrypt(clean, scope);
  const existing = await db.select().from(pinCodes).where(eq(pinCodes.scope, scope)).limit(1);
  if (existing[0]) {
    await db.update(pinCodes).set({ pinHash: hash }).where(eq(pinCodes.scope, scope));
  } else {
    await db.insert(pinCodes).values({ scope, pinHash: hash });
  }
  invalidateRotationCache(scope);
}

function getSecret() {
  return new TextEncoder().encode(ENV.cookieSecret || "hotspot-fallback-secret");
}

export async function signPinSession(profile: SessionProfile): Promise<string> {
  const exp = Math.floor((Date.now() + PIN_SESSION_TTL_MS) / 1000);
  // Role, stores and name ride along only as a fallback for when the
  // database can't be reached; normally every request re-reads the profile,
  // so a change the CEO makes applies on the very next click.
  return new SignJWT({
    scope: profile.pinScope,
    pid: profile.id,
    name: profile.name,
    role: profile.role,
    stores: profile.stores,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(getSecret());
}

/**
 * Who is behind a PIN scope right now. `undefined` = the database can't be
 * reached (dev/test), so the caller falls back to the token's own claims;
 * `null` = this login was turned off or removed. Cached briefly, and
 * dropped the moment the CEO edits a profile.
 */
const PROFILE_CACHE_TTL_MS = 15_000;
const profileCache = new Map<
  string,
  { profile: SessionProfile | null; fetchedAt: number }
>();

export function invalidateProfileCache(scope?: PinScope) {
  if (scope) profileCache.delete(scope);
  else profileCache.clear();
}

async function profileForScope(scope: PinScope): Promise<SessionProfile | null | undefined> {
  const cached = profileCache.get(scope);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }
  const db = await getDb();
  if (!db) return undefined;
  let profile: SessionProfile | null;
  try {
    const row = await getProfileByScope(scope);
    if (row) {
      profile = isLiveProfile(row) ? toSessionProfile(row) : null;
    } else {
      // Not a profile: only one of the original logins, and only while the
      // profiles table is still empty (see liveProfilesByScope).
      profile = (await hasAnyProfile()) ? null : legacyProfileFor(scope);
    }
  } catch (error) {
    if (!isMissingTable(error)) {
      // Unknown failure: refuse this request, but don't cache the refusal.
      console.warn("[PinAuth] Profile lookup failed:", error);
      return null;
    }
    profile = legacyProfileFor(scope);
  }
  profileCache.set(scope, { profile, fetchedAt: Date.now() });
  return profile;
}

/** Session claims from a token alone (no database to ask). */
function profileFromClaims(scope: PinScope, payload: Record<string, unknown>): SessionProfile | null {
  const role = payload.role as ProfileRole | undefined;
  if (role !== "admin" && role !== "cfo" && role !== "manager") return null;
  const claimed = Array.isArray(payload.stores)
    ? (payload.stores as unknown[]).filter((s): s is string => typeof s === "string")
    : typeof payload.store === "string"
      ? [payload.store]
      : [];
  return {
    id: typeof payload.pid === "number" ? payload.pid : null,
    name:
      typeof payload.name === "string" ? payload.name : (legacyProfileFor(scope)?.name ?? ""),
    role,
    stores: role === "manager" ? normalizeStores(claimed) : [],
    pinScope: scope,
  };
}

/**
 * PIN-rotation revocation: a session is only valid if it was issued after the
 * scope's PIN was last changed. Lookups are cached briefly so session checks
 * do not add a query to every request.
 */
const ROTATION_CACHE_TTL_MS = 60_000;
const rotationCache = new Map<string, { rotatedAt: number | null; fetchedAt: number }>();

function invalidateRotationCache(scope: PinScope) {
  rotationCache.delete(scope);
}

async function pinRotatedAt(scope: PinScope): Promise<number | null> {
  const cached = rotationCache.get(scope);
  if (cached && Date.now() - cached.fetchedAt < ROTATION_CACHE_TTL_MS) {
    return cached.rotatedAt;
  }
  const db = await getDb();
  // Fail open when the DB is unavailable (dev/test) — the JWT signature and
  // expiry still gate access.
  if (!db) return null;
  const rows = await db.select().from(pinCodes).where(eq(pinCodes.scope, scope)).limit(1);
  const rotatedAt = rows[0]?.updatedAt ? new Date(rows[0].updatedAt).getTime() : null;
  rotationCache.set(scope, { rotatedAt, fetchedAt: Date.now() });
  return rotatedAt;
}

export async function verifyPinSession(req: Request): Promise<PinSession | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[PIN_COOKIE_NAME];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    const scope = payload.scope as PinScope | undefined;
    if (!scope || typeof scope !== "string") return null;
    const issuedAt = Number(payload.iat ?? 0) * 1000;

    const rotatedAt = await pinRotatedAt(scope);
    // 5s of tolerance covers the login that immediately follows a rotation.
    if (rotatedAt !== null && issuedAt + 5_000 < rotatedAt) return null;

    const resolved = await profileForScope(scope);
    const profile =
      resolved === undefined
        ? profileFromClaims(scope, payload as Record<string, unknown>)
        : resolved;
    if (!profile) return null;
    // A manager with no stores has nothing to work on — never a live session.
    if (profile.role === "manager" && profile.stores.length === 0) return null;

    return sessionFromProfile(profile, issuedAt);
  } catch {
    return null;
  }
}

export function sessionFromProfile(profile: SessionProfile, issuedAt: number): PinSession {
  const stores = profile.role === "manager" ? profile.stores : [];
  return {
    scope: profile.pinScope,
    profileId: profile.id,
    name: profile.name || null,
    role: profile.role,
    stores,
    store: stores.length === 1 ? stores[0] : null,
    issuedAt,
  };
}

/**
 * The stores a session may work in. CEO: every store. CFO: none (its reads
 * are explicitly company-wide). Manager: the profile's stores. Sessions
 * built by hand without `stores` (older tests) fall back to `store`.
 */
export function sessionStores(session: Pick<PinSession, "role" | "store"> & { stores?: Store[] }): Store[] {
  if (session.role === "admin") return [...STORES];
  if (session.role !== "manager") return [];
  if (session.stores) return session.stores;
  return session.store ? [session.store] : [];
}

/** Public helper for read-only summary of which scopes have PINs set (no hashes returned). */
export async function listPinScopes() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(pinCodes);
  return rows.map((r) => ({ scope: r.scope as PinScope, updatedAt: r.updatedAt }));
}

/**
 * Server-internal: scopes with their stored hashes, used to detect PIN
 * collisions across scopes before a rotation. Never expose to the client.
 */
export async function listPinScopesWithHashes() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(pinCodes);
  return rows.map((r) => ({ scope: r.scope as PinScope, pinHash: r.pinHash }));
}
