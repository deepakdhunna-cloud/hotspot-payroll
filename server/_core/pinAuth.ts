import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ONE_YEAR_MS, PIN_COOKIE_NAME } from "@shared/const";
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
 * The CEO can change any of these from the Settings panel.
 */
const DEFAULT_PINS: Record<PinScope, string> = {
  ceo: "9999",
  "Hotspot Market 11": "1111",
  "Hotspot Market 13": "1313",
  "Hotspot Market 14": "1414",
  "Hotspot Travel Center": "7777",
};

export const ALL_SCOPES: PinScope[] = ["ceo", ...STORES];

function hashPin(pin: string, scope: PinScope) {
  const salt = ENV.cookieSecret || "hotspot-fallback-salt";
  return crypto.createHash("sha256").update(`${scope}:${pin}:${salt}`).digest("hex");
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
      pinHash: hashPin(DEFAULT_PINS[scope], scope),
    });
  }
  console.log("[PinAuth] Default PINs ensured");
}

/** Verify a submitted PIN against any scope. Returns the matched scope, or null. */
export async function verifyPin(pin: string): Promise<PinScope | null> {
  const clean = normalizePin(pin);
  if (!isValidPin(clean)) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pinCodes);
  for (const row of rows) {
    if (row.pinHash === hashPin(clean, row.scope as PinScope)) {
      return row.scope as PinScope;
    }
  }
  return null;
}

/** Update (or create) the PIN for a given scope. CEO-only operation. */
export async function setPin(scope: PinScope, newPin: string): Promise<void> {
  const clean = normalizePin(newPin);
  if (!isValidPin(clean)) throw new Error("PIN must be 4-8 digits");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const hash = hashPin(clean, scope);
  // Ensure all scopes can collide; one row per scope is enforced via unique key.
  const existing = await db.select().from(pinCodes).where(eq(pinCodes.scope, scope)).limit(1);
  if (existing[0]) {
    await db.update(pinCodes).set({ pinHash: hash }).where(eq(pinCodes.scope, scope));
  } else {
    await db.insert(pinCodes).values({ scope, pinHash: hash });
  }
}

function getSecret() {
  return new TextEncoder().encode(ENV.cookieSecret || "hotspot-fallback-secret");
}

export async function signPinSession(scope: PinScope): Promise<string> {
  const isCeo = scope === "ceo";
  const exp = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
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
    return {
      scope,
      role,
      store,
      issuedAt: Number(payload.iat ?? 0) * 1000,
    };
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
