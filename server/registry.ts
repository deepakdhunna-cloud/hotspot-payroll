/**
 * The things the CEO can change without a developer:
 *
 *  - STORES — the built-in stores plus any added from the command center.
 *  - ROLES  — the built-in roles plus any added from the command center.
 *  - RULES  — a few operating numbers: the withholding estimate rates and
 *             how long a shift runs before it is flagged.
 *
 * Built-in stores and roles live in shared/hotspot.ts and can never be
 * removed here; additions are rows in app_settings (`store:<name>`,
 * `role:<name>`, `rule:<key>`), so nothing needs a migration or a deploy.
 *
 * Everything is held in memory and read synchronously — validation and
 * every request use it — and reloaded from the database at boot, after each
 * change, and once a minute (so a second server instance catches up). With
 * no database (tests, local dev) it is simply the built-ins and defaults.
 *
 * A store's NAME is its identity: employees, punches, payroll, schedules and
 * the store's PIN are all filed under it. That is why stores can be added
 * but not renamed or removed from here.
 */
import { like } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import { getDb, setAppSetting } from "./db";
import {
  FEDERAL_TAX_RATE,
  ROLES,
  STATE_TAX_RATE,
  STORES,
} from "@shared/hotspot";

const STORE_PREFIX = "store:";
const ROLE_PREFIX = "role:";
const RULE_PREFIX = "rule:";

export type StoreInfo = {
  name: string;
  /** Short label for chips and tight places, e.g. "HM 17". */
  short: string;
  /** Built into the app (cannot be removed) vs added from the command center. */
  builtIn: boolean;
};

export type Rules = {
  /** Estimated federal withholding as a share of gross (planning only). */
  estFederalRate: number;
  /** Estimated state withholding as a share of gross (planning only). */
  estStateRate: number;
  /** A shift running longer than this many hours is flagged for review. */
  longShiftHours: number;
};

export const DEFAULT_RULES: Rules = {
  estFederalRate: FEDERAL_TAX_RATE,
  estStateRate: STATE_TAX_RATE,
  longShiftHours: 12,
};

/** Limits, shared by validation and the UI copy. */
export const RULE_LIMITS = {
  estFederalPct: { min: 0, max: 60 },
  estStatePct: { min: 0, max: 30 },
  longShiftHours: { min: 6, max: 24 },
} as const;

const BUILT_IN_SHORT: Record<string, string> = {
  "Hotspot Market 11": "HM 11",
  "Hotspot Market 13": "HM 13",
  "Hotspot Market 14": "HM 14",
  "Hotspot Market 17": "HM 17",
  "Hotspot Travel Center": "Travel",
};

/** A sensible short label for a store that was not given one. */
export function defaultShortName(name: string): string {
  if (BUILT_IN_SHORT[name]) return BUILT_IN_SHORT[name];
  const market = /^Hotspot Market\s+(.+)$/i.exec(name);
  if (market) return `HM ${market[1]}`.slice(0, 12);
  const rest = name.replace(/^Hotspot\s+/i, "").trim();
  return (rest.split(/\s+/)[0] || name).slice(0, 12);
}

const builtInStores = (): StoreInfo[] =>
  STORES.map((name) => ({ name, short: defaultShortName(name), builtIn: true }));

let stores: StoreInfo[] = builtInStores();
let roles: string[] = [...ROLES];
let rules: Rules = { ...DEFAULT_RULES };

export const getStoreInfo = (): StoreInfo[] => stores;
export const getStores = (): string[] => stores.map((s) => s.name);
export const isStore = (name: unknown): name is string =>
  typeof name === "string" && stores.some((s) => s.name === name);
export const getRoles = (): string[] => roles;
export const isRole = (name: unknown): name is string =>
  typeof name === "string" && roles.includes(name);
export const getRules = (): Rules => rules;

function parseRule(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Reload stores, roles and rules from the database. Safe to call often. */
export async function loadRegistry(): Promise<void> {
  const db = await getDb();
  if (!db) return; // no database: built-ins and defaults
  const [storeRows, roleRows, ruleRows] = await Promise.all([
    db.select().from(appSettings).where(like(appSettings.key, `${STORE_PREFIX}%`)),
    db.select().from(appSettings).where(like(appSettings.key, `${ROLE_PREFIX}%`)),
    db.select().from(appSettings).where(like(appSettings.key, `${RULE_PREFIX}%`)),
  ]);

  const nextStores = builtInStores();
  for (const row of storeRows.sort((a, b) => a.id - b.id)) {
    const name = row.key.slice(STORE_PREFIX.length);
    if (!name || nextStores.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    nextStores.push({ name, short: row.value || defaultShortName(name), builtIn: false });
  }
  const nextRoles: string[] = [...ROLES];
  for (const row of roleRows.sort((a, b) => a.id - b.id)) {
    const name = row.key.slice(ROLE_PREFIX.length);
    if (!name || nextRoles.some((r) => r.toLowerCase() === name.toLowerCase())) continue;
    nextRoles.push(name);
  }
  const byKey = new Map(ruleRows.map((r) => [r.key.slice(RULE_PREFIX.length), r.value]));
  const fed = parseRule(byKey.get("est_federal_pct"), RULE_LIMITS.estFederalPct.min, RULE_LIMITS.estFederalPct.max);
  const st = parseRule(byKey.get("est_state_pct"), RULE_LIMITS.estStatePct.min, RULE_LIMITS.estStatePct.max);
  const long = parseRule(byKey.get("long_shift_hours"), RULE_LIMITS.longShiftHours.min, RULE_LIMITS.longShiftHours.max);

  stores = nextStores;
  roles = nextRoles;
  rules = {
    estFederalRate: fed === null ? DEFAULT_RULES.estFederalRate : fed / 100,
    estStateRate: st === null ? DEFAULT_RULES.estStateRate : st / 100,
    longShiftHours: long === null ? DEFAULT_RULES.longShiftHours : Math.round(long),
  };
}

/** Names that would collide with a sign-in scope or a filter value. */
// "system" and "anonymous" are who the activity log names for automatic
// actions and unknown devices.
const RESERVED = new Set(["ceo", "cfo", "all", "kiosk", "system", "anonymous"]);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .&'#\-]*$/;

/** Why a store name can't be used, or null when it can. */
export function storeNameProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 3) return "Give the store a name of at least 3 characters.";
  if (name.length > 56) return "Keep the store name to 56 characters or fewer.";
  if (!NAME_RE.test(name)) return "Use letters, numbers, spaces and . & ' # - only.";
  if (RESERVED.has(name.toLowerCase())) return "That name is reserved. Choose another.";
  if (stores.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return "A store with that name already exists.";
  }
  return null;
}

/** Why a role name can't be used, or null when it can. */
export function roleNameProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return "Give the role a name of at least 2 characters.";
  if (name.length > 40) return "Keep the role name to 40 characters or fewer.";
  if (!NAME_RE.test(name)) return "Use letters, numbers, spaces and . & ' # - only.";
  if (roles.some((r) => r.toLowerCase() === name.toLowerCase())) {
    return "That role already exists.";
  }
  return null;
}

const tidy = (raw: string) => raw.trim().replace(/\s+/g, " ");

/** Add a store. The caller has already checked `storeNameProblem`. */
export async function addStore(
  input: { name: string; short?: string },
  by: string,
): Promise<StoreInfo> {
  const name = tidy(input.name);
  const short = tidy(input.short ?? "").slice(0, 12) || defaultShortName(name);
  await setAppSetting(`${STORE_PREFIX}${name}`, short, by);
  await loadRegistry();
  return { name, short, builtIn: false };
}

/** Add a role. The caller has already checked `roleNameProblem`. */
export async function addRole(rawName: string, by: string): Promise<string> {
  const name = tidy(rawName);
  await setAppSetting(`${ROLE_PREFIX}${name}`, "1", by);
  await loadRegistry();
  return name;
}

/** Change operating rules. Values are whole or decimal percents / hours. */
export async function setRules(
  patch: { estFederalPct?: number; estStatePct?: number; longShiftHours?: number },
  by: string,
): Promise<Rules> {
  if (patch.estFederalPct !== undefined) {
    await setAppSetting(`${RULE_PREFIX}est_federal_pct`, String(patch.estFederalPct), by);
  }
  if (patch.estStatePct !== undefined) {
    await setAppSetting(`${RULE_PREFIX}est_state_pct`, String(patch.estStatePct), by);
  }
  if (patch.longShiftHours !== undefined) {
    await setAppSetting(`${RULE_PREFIX}long_shift_hours`, String(patch.longShiftHours), by);
  }
  await loadRegistry();
  return rules;
}

/** Test hook: back to built-ins and defaults. */
export function resetRegistryForTests(): void {
  stores = builtInStores();
  roles = [...ROLES];
  rules = { ...DEFAULT_RULES };
}
