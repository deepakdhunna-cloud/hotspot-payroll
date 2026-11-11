/**
 * The payroll row math — ONE implementation, used by the weekly timesheet
 * (pages/payroll/HoursAndPayTab) and by the command center's autopilot.
 *
 * A "row" is one person in one pay week. This module turns what the server
 * knows (their saved entry, their rate, their standing set pay) and what the
 * time clock says into the values a row opens with, the pay those values
 * come to, and the exact request that saves them. Because both screens use
 * these same functions, the autopilot can only ever save what the timesheet
 * would have saved for an untouched row.
 */
import { computeGrossPay } from "@shared/hotspot";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export type WeekRow =
  inferRouterOutputs<AppRouter>["payroll"]["week"]["employees"][number];

/** Limits that match the server's validation, stated in plain words. */
export const HOURS_MAX = 168;
export const RATE_MAX = 1000;
export const SET_PAY_MAX = 100_000;
/** Hours this far past the schedule get flagged (15 minutes of slack). */
export const OVER_SCHEDULE_SLACK = 0.25;
/** Saved vs clock differences under 3 minutes are rounding, not a change. */
export const CLOCK_MATCH_SLACK = 0.05;

/** What the manager sees and types for one row. `fixed` null = hourly. */
export type RowEdit = { hours: string; rate: string; fixed: string | null; manual: boolean };
/** The last saved (or prefilled) values; a row is "Edited" when it differs. */
export type RowBaseline = { hours: string; rate: string; fixed: string | null };

/* ---------------------------- value helpers ---------------------------- */

/** null = empty, NaN = not a number. */
export function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Same value for dirtiness — "15" and "15.00" are the same rate. */
export function sameValue(a: string, b: string): boolean {
  const x = parseNum(a);
  const y = parseNum(b);
  if (x === null || y === null) return x === y;
  if (Number.isNaN(x) || Number.isNaN(y)) return a.trim() === b.trim();
  return Math.abs(x - y) < 0.005;
}

export function sameFixed(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return sameValue(a, b);
}

export function isDirty(e: RowEdit, b: RowBaseline): boolean {
  return !sameValue(e.hours, b.hours) || !sameValue(e.rate, b.rate) || !sameFixed(e.fixed, b.fixed);
}

/** Tidy a typed number to two decimals once the field loses focus. */
export function tidy2(raw: string): string {
  const n = parseNum(raw);
  return n === null || Number.isNaN(n) || n < 0 ? raw : n.toFixed(2);
}

/**
 * A payroll entry that only exists to carry scheduled hours (created by a
 * schedule import/commit) — the manager never entered hours on it. Legacy
 * rows from before the "schedule-only" marker are detected by their saved
 * 0 hours alongside real clock punches.
 */
export function isScheduleOnlyEntry(entry: WeekRow["entry"], clockH: number | undefined): boolean {
  if (!entry) return false;
  if (entry.notes === "schedule-only") return true;
  return (
    entry.notes !== "fixed-pay" &&
    Number(entry.hoursWorked) === 0 &&
    clockH !== undefined &&
    clockH > 0
  );
}

/** The values a row opens with when nobody is editing it. */
export function freshRow(row: WeekRow, clockH: number | undefined): { edit: RowEdit; base: RowBaseline } {
  const saved = row.entry && !isScheduleOnlyEntry(row.entry, clockH) ? row.entry : null;
  let hours = "";
  let manual = false;
  if (saved) {
    const n = Number(saved.hoursWorked);
    hours = n.toFixed(2);
    // Saved hours that no longer match the clock open as typed hours, with
    // the current clock figure offered next to them.
    if (clockH !== undefined && Math.abs(n - clockH) > CLOCK_MATCH_SLACK) manual = true;
  } else if (clockH !== undefined && clockH > 0) {
    hours = clockH.toFixed(2);
  }
  // Set pay: a week SAVED as set pay reopens with its amount. A standing
  // weekly amount on the profile only fills weeks that aren't saved yet —
  // a week deliberately saved hourly stays hourly.
  const standing = Number(row.employee.weeklyPay ?? 0);
  let fixed: string | null = null;
  if (saved?.notes === "fixed-pay") fixed = Number(saved.grossPay).toFixed(2);
  else if (!saved && standing > 0) fixed = standing.toFixed(2);
  // A saved week keeps the rate it was paid at; anything else uses today's
  // profile rate.
  const rate = Number(saved?.payRateSnapshot ?? row.employee.payRate ?? 0).toFixed(2);
  return { edit: { hours, rate, fixed, manual }, base: { hours, rate, fixed } };
}

export type RowCalc = {
  /** Parsed hours: null when empty, NaN when not a number. */
  hours: number | null;
  rate: number | null;
  isFixed: boolean;
  fixed: number | null;
  /** Hours that count (0 when empty or invalid). */
  hoursOk: number;
  /** Rate that counts (0 when empty or invalid). */
  rateOk: number;
  /** The ONE gross used by the row, the totals, the role breakdown and the export. */
  gross: number;
  errors: { hours?: string; rate?: string; fixed?: string };
};

export function calcRow(e: RowEdit): RowCalc {
  const errors: RowCalc["errors"] = {};
  const hours = parseNum(e.hours);
  if (hours !== null) {
    if (Number.isNaN(hours) || hours < 0) errors.hours = "Enter hours as a number, like 38.5.";
    else if (hours > HOURS_MAX) errors.hours = `A week has at most ${HOURS_MAX} hours.`;
  }
  const rate = parseNum(e.rate);
  const isFixed = e.fixed !== null;
  if (rate === null) {
    if (!isFixed) errors.rate = "Enter an hourly rate.";
  } else if (Number.isNaN(rate) || rate < 0) {
    errors.rate = "Enter the rate as a number, like 15.50.";
  } else if (rate > RATE_MAX) {
    errors.rate = "The rate can't be over $1,000 an hour.";
  }
  let fixed: number | null = null;
  if (isFixed) {
    const f = parseNum(e.fixed ?? "");
    if (f === null || Number.isNaN(f) || f < 0) errors.fixed = "Enter the set pay amount.";
    else if (f > SET_PAY_MAX) errors.fixed = "Set pay can't be over $100,000.";
    else fixed = f;
  }
  const hoursOk = hours !== null && !errors.hours ? hours : 0;
  const rateOk = rate !== null && !Number.isNaN(rate) && !errors.rate ? rate : 0;
  // Cents, rounded exactly the way the server rounds what it saves, so the
  // grid, its totals and the saved payroll can never be a cent apart.
  const gross = Number(
    (isFixed ? (fixed ?? 0) : computeGrossPay(hoursOk, rateOk).grossPay).toFixed(2),
  );
  return { hours, rate, isFixed, fixed, hoursOk, rateOk, gross, errors };
}

/* ------------------------------- saving ------------------------------- */

export type SaveHoursInput = inferRouterInputs<AppRouter>["payroll"]["saveHours"];

/**
 * The request that saves a row, or why it can't be saved yet.
 *
 * `rateChanged` — the rate on screen differs from the row's baseline. The
 * rate is only sent when it was changed, or for weeks older than the last
 * closed one (which always keep their own rate): re-saving a past week must
 * never roll the profile rate back.
 */
export function saveInputFor(args: {
  employeeId: number;
  weekStart: Date;
  scheduled: number;
  calc: RowCalc;
  rateChanged: boolean;
  olderWeek: boolean;
}): { ok: true; input: SaveHoursInput } | { ok: false; message: string } {
  const c = args.calc;
  if (c.errors.hours) return { ok: false, message: c.errors.hours };
  if (c.isFixed && c.errors.fixed) return { ok: false, message: c.errors.fixed };
  if (!c.isFixed && c.hours === null) {
    return { ok: false, message: "Enter hours (use 0 if they didn't work)." };
  }
  if (c.errors.rate) return { ok: false, message: c.errors.rate };
  const validRate = c.rate !== null && !Number.isNaN(c.rate) ? c.rate : null;
  const sendRate = validRate !== null && (args.rateChanged || args.olderWeek);
  return {
    ok: true,
    input: {
      employeeId: args.employeeId,
      weekStart: args.weekStart,
      hoursWorked: c.hoursOk,
      scheduledHours: args.scheduled,
      ...(sendRate && validRate !== null ? { payRateOverride: validRate } : {}),
      ...(c.isFixed && c.fixed !== null ? { fixedGross: c.fixed } : {}),
    },
  };
}

/* --------------------- an untouched row, start to end --------------------- */

/** A row exactly as the timesheet would open it, before anyone edits it. */
export type FreshView = {
  row: WeekRow;
  id: number;
  name: string;
  former: boolean;
  edit: RowEdit;
  calc: RowCalc;
  scheduled: number;
  clock: number | undefined;
  hasClock: boolean;
  /** Saved to payroll already (a schedule-only placeholder doesn't count). */
  isSaved: boolean;
  /** Has something to pay: hours, set pay, or time on the clock. */
  hasWork: boolean;
  status: "saved" | "unsaved" | "empty";
};

export function freshView(row: WeekRow, clock: number | undefined): FreshView {
  const { edit } = freshRow(row, clock);
  const calc = calcRow(edit);
  const hasClock = clock !== undefined && clock > 0;
  const isSaved = !!row.entry && !isScheduleOnlyEntry(row.entry, clock);
  const hasWork = calc.hoursOk > 0 || calc.isFixed || hasClock;
  return {
    row,
    id: row.employee.id,
    name: row.employee.fullName,
    former: Number(row.employee.active) === 0,
    edit,
    calc,
    scheduled: Number(row.entry?.scheduledHours ?? 0),
    clock,
    hasClock,
    isSaved,
    hasWork,
    status: isSaved ? "saved" : hasWork ? "unsaved" : "empty",
  };
}
