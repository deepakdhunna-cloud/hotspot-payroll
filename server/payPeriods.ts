/**
 * Which days each pay week's payroll pays — the server side of
 * `payPeriodOf` in shared/hotspot.ts.
 *
 * A week can end early for every store (`payend:<Thursday>`, set by the CEO
 * for all stores) or for one store (`payend:<Thursday>:<store>`, set by that
 * store's manager or by the CEO for that store). A store's own setting wins
 * over the all-stores one — including the Wednesday, which keeps that store
 * on its normal week when the others end early.
 *
 * They are rows in app_settings, read straight from the database on every
 * request rather than cached: they decide how many hours people are paid, so
 * a second server instance must never price a week with a stale answer.
 *
 * Everything that PAYS a week uses these days: the timesheet's clock hours,
 * the autopilot, the ledger under it and the exports. Everything that is
 * about the calendar week as it happens — the live dashboard, the kiosk,
 * schedule-vs-worked checks — stays on Thursday → Wednesday, because the
 * schedule is written for those days.
 */
import { createHash } from "node:crypto";
import {
  dayKey,
  payEndKey,
  payPeriodKeyWeeks,
  payPeriodOf,
  spanOfPeriods,
  type PayPeriod,
  type ScopePeriod,
} from "@shared/hotspot";
import { getAppSettings, hoursWorkedForWeekBulk } from "./db";

/** app_settings keys are at most 64 characters. */
const KEY_MAX = 64;

/** The app_settings key for one store's early end in a week. */
export function storePayEndKey(weekStart: Date, store: string): string {
  const base = `${payEndKey(weekStart)}:`;
  if (base.length + store.length <= KEY_MAX) return `${base}${store}`;
  // A long store name: a stable short fingerprint of it instead.
  return `${base}#${createHash("sha1").update(store).digest("hex").slice(0, 16)}`;
}

/** The days each of these stores' payrolls pay for a week. */
export async function storePeriods(
  weekStart: Date,
  stores: readonly string[]
): Promise<Map<string, PayPeriod>> {
  const weeks = payPeriodKeyWeeks(weekStart);
  const keys = weeks.flatMap((w) => [payEndKey(w), ...stores.map((s) => storePayEndKey(w, s))]);
  const rows = await getAppSettings(Array.from(new Set(keys)));
  const out = new Map<string, PayPeriod>();
  for (const store of stores) {
    const ends = new Map<string, string>();
    for (const w of weeks) {
      const value = rows.get(storePayEndKey(w, store)) ?? rows.get(payEndKey(w));
      if (value) ends.set(dayKey(w), value);
    }
    out.set(store, payPeriodOf(weekStart, ends));
  }
  return out;
}

/** The days one store's payroll pays for a week. */
export async function payPeriodFor(weekStart: Date, store: string): Promise<PayPeriod> {
  return (await storePeriods(weekStart, [store])).get(store)!;
}

/** The recorded early ends for a week: the all-stores one and each store's own. */
export async function recordedEnds(
  weekStart: Date,
  stores: readonly string[]
): Promise<{ all: string | null; byStore: Map<string, string> }> {
  const keys = [payEndKey(weekStart), ...stores.map((s) => storePayEndKey(weekStart, s))];
  const rows = await getAppSettings(keys);
  const byStore = new Map<string, string>();
  for (const s of stores) {
    const v = rows.get(storePayEndKey(weekStart, s));
    if (v) byStore.set(s, v);
  }
  return { all: rows.get(payEndKey(weekStart)) ?? null, byStore };
}

/**
 * The days for every store on a screen: each store's own, and the span
 * covering them all (what the screen as a whole is labelled and gated by).
 */
export async function scopePeriods(
  weekStart: Date,
  stores: readonly string[]
): Promise<{
  byStore: Map<string, PayPeriod>;
  period: ScopePeriod;
  periods: { store: string; period: PayPeriod }[];
}> {
  const byStore = await storePeriods(weekStart, stores);
  const periods = stores.map((store) => ({ store, period: byStore.get(store)! }));
  return { byStore, period: spanOfPeriods(weekStart, periods.map((p) => p.period)), periods };
}

/**
 * Clock hours per employee for a week, each store's punches counted over
 * THAT store's days — stores that share their days are read together.
 */
export async function hoursForPeriods(
  byStore: Map<string, PayPeriod>
): Promise<Map<number, number>> {
  const groups = new Map<string, { start: Date; end: Date; stores: string[] }>();
  byStore.forEach((p, store) => {
    const key = `${p.start.getTime()}|${p.end.getTime()}`;
    const g = groups.get(key) ?? { start: p.start, end: p.end, stores: [] };
    g.stores.push(store);
    groups.set(key, g);
  });
  const total = new Map<number, number>();
  const maps = await Promise.all(
    Array.from(groups.values()).map((g) => hoursWorkedForWeekBulk(g.start, g.end, g.stores))
  );
  for (const m of maps) m.forEach((h, id) => total.set(id, (total.get(id) ?? 0) + h));
  return total;
}
