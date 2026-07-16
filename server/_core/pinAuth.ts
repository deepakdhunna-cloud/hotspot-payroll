import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { PIN_COOKIE_NAME, PIN_SESSION_TTL_MS } from "@shared/const";
import { pinCodes } from "../../drizzle/schema";
import { STORES, type Store } from "../../shared/hotspot";
import { getDb } from "../db";
import { ENV } from "./env";

export type PinScope = "ceo" | Store;
export type PinSession = {
  scope: PinScope;
  role: "admin" | "manager";
  store: Store | null; // null = all stores (CEO)
  issuedAt: number;
};

/**
 * Default PINs created on first boot if the table is empty.
 * The CEO can change any of these from the Settings panel — and should:
 * rotating a PIN also revokes every session issued before the rotation.
 */
const DEFAULT_PINS: Record<PinScope, string> = {
  ceo: "9999",
  "Hotspot Market 11": "1111",
  "Hotspot Market 13": "1313",
  "Hotspot Market 14": "1414",
  "Hotspot Travel Center": "7777",
};

export const ALL_SCOPES: PinScope[] = ["ceo", ...STORES];

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

/** Create default PIN rows on first run; idempotent. */
export async function ensureDefaultPins(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(pinCodes);
  if (existing.length >= ALL_SCOPES.length) return;
  const haveScopes = new Set(existing.map((r) => r.scope));
  for (const scope of ALL_SCOPES) {
    if (haveScopes.has(scope)) continue;
    await db.insert(pinCodes).values({
      scope,
      pinHash: await hashPinScrypt(DEFAULT_PINS[scope], scope),
    });
  }
  console.log("[PinAuth] Default PINs ensured");
}

/**
 * Verify a submitted PIN against any scope. Returns the matched scope, or null.
 * Legacy sha256 rows are upgraded to scrypt in place after a successful match.
 */
export async function verifyPin(pin: string): Promise<PinScope | null> {
  const clean = normalizePin(pin);
  if (!isValidPin(clean)) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pinCodes);
  for (const row of rows) {
    const scope = row.scope as PinScope;
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
    return scope;
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

export async function signPinSession(scope: PinScope): Promise<string> {
  const isCeo = scope === "ceo";
  const exp = Math.floor((Date.now() + PIN_SESSION_TTL_MS) / 1000);
  return new SignJWT({
    scope,
    role: isCeo ? "admin" : "manager",
    store: isCeo ? null : scope,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(getSecret());
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
    const role = payload.role as "admin" | "manager" | undefined;
    const store = (payload.store as Store | null | undefined) ?? null;
    if (!scope || !role) return null;
    const issuedAt = Number(payload.iat ?? 0) * 1000;

    const rotatedAt = await pinRotatedAt(scope);
    // 5s of tolerance covers the login that immediately follows a rotation.
    if (rotatedAt !== null && issuedAt + 5_000 < rotatedAt) return null;

    return { scope, role, store, issuedAt };
  } catch {
    return null;
  }
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
