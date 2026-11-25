/**
 * Which days each pay week's payroll pays — the server side of
 * `payPeriodOf` in shared/hotspot.ts.
 *
 * Early ends are rows in app_settings (`payend:<Thursday>` → last day paid),
 * read straight from the database on every request rather than cached: they
 * decide how many hours people are paid, so a second server instance must
 * never price a week with a stale answer.
 *
 * Everything that PAYS a week uses these days: the timesheet's clock hours,
 * the autopilot, the ledger under it and the exports. Everything that is
 * about the calendar week as it happens — the live dashboard, the kiosk,
 * schedule-vs-worked checks — stays on Thursday → Wednesday, because the
 * schedule is written for those days.
 */
import {
  PAY_END_PREFIX,
  payEndKey,
  payPeriodKeyWeeks,
  payPeriodOf,
  type PayPeriod,
} from "@shared/hotspot";
import { getAppSettings } from "./db";

/** The early ends that decide these weeks' days, keyed by week ("YYYY-MM-DD"). */
async function endsFor(weeks: Date[]): Promise<Map<string, string>> {
  const keys = Array.from(new Set(weeks.flatMap((w) => payPeriodKeyWeeks(w).map(payEndKey))));
  const rows = await getAppSettings(keys);
  const ends = new Map<string, string>();
  rows.forEach((value, key) => ends.set(key.slice(PAY_END_PREFIX.length), value));
  return ends;
}

/** The days a pay week's payroll pays, and the instants that bound them. */
export async function payPeriodFor(weekStart: Date): Promise<PayPeriod> {
  return payPeriodOf(weekStart, await endsFor([weekStart]));
}

