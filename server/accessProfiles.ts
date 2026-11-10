/**
 * Sign-in profiles ("who can log in, with which PIN, to what").
 *
 * Every login is a row in `access_profiles`: a name, an access level
 * (CEO / CFO / Manager), the stores a manager may use, and its own PIN.
 * The PIN hash lives in `pin_codes` under the profile's `pinScope`, which is
 * also the identity written to the audit log — so PIN rotation, session
 * revocation and the activity log all keep working unchanged.
 *
 * The site used to have exactly seven fixed logins (CEO, CFO and one PIN
 * per store). Those carry over as the first seven profiles, keeping their
 * PINs and scope keys, so nobody is signed out by the switch.
 */
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  accessProfiles,
  pinCodes,
  type AccessProfile,
} from "../drizzle/schema";
import { STORES, type Store } from "../shared/hotspot";
import { getDb } from "./db";

export const PROFILE_ROLES = ["admin", "cfo", "manager"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

/** What a session needs to know about the profile behind it. */
export type SessionProfile = {
  /** null for a legacy login resolved without the profiles table. */
  id: number | null;
  name: string;
  role: ProfileRole;
  /** Assigned stores — managers only; [] for CEO and CFO. */
  stores: Store[];
  pinScope: string;
};

/** The seven logins that existed before profiles. */
export const LEGACY_SCOPES: readonly string[] = ["ceo", "cfo", ...STORES];

/** "Hotspot Market 11" → "HM 11"; "Hotspot Travel Center" → "Travel Center". */
export function storeShortName(store: string): string {
  const m = /^Hotspot Market (\d+)$/.exec(store);
  if (m) return `HM ${m[1]}`;
  return store.replace(/^Hotspot /, "");
}

/**
 * The profile a legacy scope carries over as: same PIN, same reach.
 * Returns null for anything that isn't one of the seven legacy scopes.
 */
export function legacyProfileFor(scope: string): SessionProfile | null {
  if (scope === "ceo") {
    return {
      id: null,
      name: "CEO",
      role: "admin",
      stores: [],
      pinScope: scope,
    };
  }
  if (scope === "cfo") {
    return { id: null, name: "CFO", role: "cfo", stores: [], pinScope: scope };
  }
  if ((STORES as readonly string[]).includes(scope)) {
    return {
      id: null,
      name: `${storeShortName(scope)} Manager`,
      role: "manager",
      stores: [scope as Store],
      pinScope: scope,
    };
  }
  return null;
}

/**
 * Clean a store list: known stores only, no repeats, in the app's usual
 * store order (so "HM 11, HM 13" never shows up as "HM 13, HM 11").
 */
export function normalizeStores(list: readonly string[]): Store[] {
  const wanted = new Set(list);
  return STORES.filter(s => wanted.has(s));
}

/** Parse the stored JSON store list; anything unreadable is "no stores". */
export function parseStores(raw: string | null | undefined): Store[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? normalizeStores(value.filter((v): v is string => typeof v === "string"))
      : [];
  } catch {
    return [];
  }
}

/** Only managers carry stores; CEO and CFO reach is decided by role. */
export function storesForRole(
  role: ProfileRole,
  stores: readonly string[]
): Store[] {
  return role === "manager" ? normalizeStores(stores) : [];
}

export function toSessionProfile(row: AccessProfile): SessionProfile {
  const role = row.role as ProfileRole;
  return {
    id: row.id,
    name: row.name,
    role,
    stores: storesForRole(role, parseStores(row.stores)),
    pinScope: row.pinScope,
  };
}

/** Can this row sign in right now? */
export function isLiveProfile(row: AccessProfile): boolean {
  if (row.deletedAt || row.active !== 1) return false;
  // A manager with no stores would land on an empty site: treat as off.
  return row.role !== "manager" || parseStores(row.stores).length > 0;
}

/** A fresh, never-reused PIN scope for a new profile. */
export function newProfileScope(): string {
  return `profile:${crypto.randomBytes(8).toString("hex")}`;
}

/* ----------------------------- DB helpers ----------------------------- */

export async function listProfiles(
  opts: { includeDeleted?: boolean } = {}
): Promise<AccessProfile[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = opts.includeDeleted
    ? await db.select().from(accessProfiles)
    : await db
        .select()
        .from(accessProfiles)
        .where(isNull(accessProfiles.deletedAt));
  return rows.sort((a, b) => a.id - b.id);
}

export async function getProfileById(
  id: number
): Promise<AccessProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(accessProfiles)
    .where(and(eq(accessProfiles.id, id), isNull(accessProfiles.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getProfileByScope(
  scope: string
): Promise<AccessProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.pinScope, scope))
    .limit(1);
  return rows[0] ?? null;
}

export async function hasAnyProfile(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: accessProfiles.id })
    .from(accessProfiles)
    .limit(1);
  return rows.length > 0;
}

/**
 * Create a profile and its PIN row together — never one without the other.
 * `pinHash` must already be hashed for `pinScope`.
 */
export async function createProfileWithPin(input: {
  name: string;
  role: ProfileRole;
  stores: Store[];
  pinScope: string;
  pinHash: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    await tx
      .insert(pinCodes)
      .values({ scope: input.pinScope, pinHash: input.pinHash });
    const result = await tx.insert(accessProfiles).values({
      name: input.name,
      role: input.role,
      stores: JSON.stringify(input.stores),
      pinScope: input.pinScope,
      active: 1,
    });
    return Number(
      (result as any)[0]?.insertId ?? (result as any).insertId ?? 0
    );
  });
}

export async function updateProfile(
  id: number,
  patch: Partial<{
    name: string;
    role: ProfileRole;
    stores: Store[];
    active: boolean;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const set: Partial<typeof accessProfiles.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.stores !== undefined) set.stores = JSON.stringify(patch.stores);
  if (patch.active !== undefined) set.active = patch.active ? 1 : 0;
  if (Object.keys(set).length === 0) return;
  await db.update(accessProfiles).set(set).where(eq(accessProfiles.id, id));
}

/**
 * Remove a login: the profile is kept (marked deleted) so the activity log
 * can still name it, and its PIN row is dropped so the PIN stops working
 * immediately and can be given to someone else.
 */
export async function softDeleteProfile(row: AccessProfile): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async tx => {
    await tx
      .update(accessProfiles)
      .set({ deletedAt: new Date(), active: 0 })
      .where(eq(accessProfiles.id, row.id));
    await tx.delete(pinCodes).where(eq(pinCodes.scope, row.pinScope));
  });
}

/**
 * First boot with profiles: turn each existing login into a profile so every
 * PIN in use keeps working. On a brand-new database the seven default PINs
 * are created first (same defaults as before). Runs once — as soon as any
 * profile exists it never seeds again, so a removed login stays removed.
 */
export async function ensureAccessProfiles(
  defaultPinHash: (scope: string) => Promise<string>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (await hasAnyProfile()) return;

  const existing = await db.select().from(pinCodes);
  const haveScopes = new Set(existing.map(r => r.scope));
  for (const scope of LEGACY_SCOPES) {
    const legacy = legacyProfileFor(scope)!;
    try {
      if (!haveScopes.has(scope)) {
        await db
          .insert(pinCodes)
          .values({ scope, pinHash: await defaultPinHash(scope) });
      }
      await db.insert(accessProfiles).values({
        name: legacy.name,
        role: legacy.role,
        stores: JSON.stringify(legacy.stores),
        pinScope: scope,
        active: 1,
      });
    } catch (error) {
      // Another instance booting at the same moment may have won the race
      // (pinScope is unique) — that's fine, the row exists either way.
      console.warn(
        `[Profiles] Seeding ${scope} skipped:`,
        (error as Error)?.message
      );
    }
  }
  console.log("[Profiles] Sign-in profiles created from the existing PINs");
}
