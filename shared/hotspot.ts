// Hotspot Market shared constants
// Keep store names and roles consistent across the entire app.

export const STORES = [
  "Hotspot Market 11",
  "Hotspot Market 13",
  "Hotspot Market 14",
  "Hotspot Travel Center",
] as const;

export type Store = (typeof STORES)[number];

export const ROLES = [
  "Manager",
  "Assistant Manager",
  "Cashier",
  "Kitchen Manager",
  "Cook",
  "Janitorial",
] as const;

export type EmployeeRole = (typeof ROLES)[number];

// Approximate tax withholding rates (estimates only - for CEO planning view).
// Federal: simplified flat estimate covering FICA (7.65%) + federal income tax estimate.
// State: a conservative state income tax estimate (configurable).
export const FEDERAL_TAX_RATE = 0.18; // 18% federal estimate (FIT + FICA combined approx.)
export const STATE_TAX_RATE = 0.05; // 5% state estimate

/**
 * Gross pay = hours worked × pay rate. Overtime is not applied; the business
 * tracks every hour at the employee's standard rate.
 */
export function computeGrossPay(hoursWorked: number, payRate: number) {
  const grossPay = hoursWorked * payRate;
  return {
    regularHours: hoursWorked,
    regularPay: grossPay,
    grossPay,
  };
}

export function estimateWithholding(grossPay: number) {
  const federal = grossPay * FEDERAL_TAX_RATE;
  const state = grossPay * STATE_TAX_RATE;
  return {
    federal,
    state,
    totalTax: federal + state,
    netPay: grossPay - federal - state,
  };
}

/**
 * Hotspot pay period runs Thursday – Wednesday.
 * getWeekStart returns the Thursday on or before the given date, at 00:00 UTC.
 */
export const PAY_WEEK_START_DAY = 4; // Thursday (Sun=0..Sat=6)

export function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day - PAY_WEEK_START_DAY + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * The pay period that should be open for entry / payable right now.
 * Payroll for a week is settled AFTER it closes on Wednesday, so the
 * "current" payable period is the most recent week that ended Wednesday.
 *
 * Example: on Thu May 14, 2026 (the first day of a new period) this returns
 * the prior Thursday (May 7), so the UI shows the May 7–13 week that just
 * closed — which is the week the manager is actually paying.
 */
export function getCurrentPayPeriodStart(now: Date = new Date()): Date {
  const todayWeekStart = getWeekStart(now);
  const prior = new Date(todayWeekStart);
  prior.setUTCDate(prior.getUTCDate() - 7);
  return prior;
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} – ${fmt(end)}`;
}

/** The 7 calendar days (00:00 UTC) of a Thursday-anchored pay week, in order. */
export function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Resolve a day reference from a parsed schedule ("Mon", "monday",
 * "2026-05-11", "5/11") to the matching calendar day within the pay week.
 * Returns null when the reference can't be resolved.
 */
export function resolveScheduleDay(weekStart: Date, ref: string): Date | null {
  const days = getWeekDays(weekStart);
  const clean = ref.trim().toLowerCase();
  if (!clean) return null;

  // Full ISO or US-style date → match by month/day inside the week window.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  const us = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/.exec(clean);
  if (iso || us) {
    const month = iso ? Number(iso[2]) : Number(us![1]);
    const day = iso ? Number(iso[3]) : Number(us![2]);
    const hit = days.find(
      (d) => d.getUTCMonth() + 1 === month && d.getUTCDate() === day,
    );
    if (hit) return hit;
  }

  // Day-of-week name or abbreviation ("thu", "thurs", "thursday").
  const idx = DAY_NAMES.findIndex(
    (name) => name === clean || (clean.length >= 3 && name.startsWith(clean.slice(0, 3))),
  );
  if (idx >= 0) {
    return days.find((d) => d.getUTCDay() === idx) ?? null;
  }
  return null;
}

/** Short label ("Thu 5/7") for a schedule day, UTC-based. */
export function formatScheduleDay(day: Date): string {
  const wd = day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${day.getUTCMonth() + 1}/${day.getUTCDate()}`;
}

/**
 * Hours over schedule beyond this threshold count as "over-clocked".
 * Keeps a few minutes of clock drift from flagging every shift.
 */
export const OVERCLOCK_THRESHOLD_HOURS = 0.25;
