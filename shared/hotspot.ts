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

/**
 * Single source of truth for over-clock math, used by the manager dashboard,
 * the CEO view and the kiosk so all three surfaces always agree.
 * `scheduled` of 0 means "no schedule known" — never flags.
 */
export function overclockStatus(workedHours: number, scheduledHours: number) {
  const overClockedBy =
    scheduledHours > 0 ? Math.max(0, workedHours - scheduledHours) : 0;
  return {
    overClocked: overClockedBy > OVERCLOCK_THRESHOLD_HOURS,
    overClockedBy,
  };
}

/**
 * The stores' local timezone. Weeks and days are STORED as UTC dates, but
 * "what day is it right now?" (kiosk summaries, e.g. an 11pm punch) must be
 * answered in store-local time or evening punches land on the next day.
 * Change this once if the business ever moves timezones.
 */
export const BUSINESS_TIME_ZONE = "America/Chicago";

/**
 * The calendar day (00:00 UTC marker) that `now` falls on in store-local
 * time. Example: Wed 21:30 in Chicago = Thu 02:30 UTC → returns Wednesday.
 */
export function businessDayStart(now: Date = new Date()): Date {
  // en-CA formats as YYYY-MM-DD, which parses cleanly as a UTC date.
  const ymd = now.toLocaleDateString("en-CA", { timeZone: BUSINESS_TIME_ZONE });
  return new Date(`${ymd}T00:00:00Z`);
}

/**
 * The actual UTC instant when the current business day began (midnight in
 * the store timezone). Used to split a live week into "closed days"
 * (worked, priced from real punches) and "days still to come" (priced from
 * the schedule) for payroll projection.
 */
export function businessDayBoundaryUtc(now: Date = new Date()): Date {
  const marker = businessDayStart(now);
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find(p => p.type === "timeZoneName")?.value;
  const m = offsetName?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetHours = m ? Number(m[1]) : -5;
  const offsetMinutes = m?.[2] ? Math.sign(offsetHours) * Number(m[2]) : 0;
  return new Date(
    marker.getTime() - (offsetHours * 60 + offsetMinutes) * 60_000
  );
}

/**
 * Parse a printed shift time label ("9:00am", "11pm", "12:15 PM") into
 * minutes since midnight, or null if unreadable. Used to pro-rate how much
 * of today's schedule is still ahead when projecting payroll.
 */
export function parseTimeLabelToMinutes(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m?\.?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  const pm = m[3].toLowerCase() === "p";
  if (hours === 12) hours = 0;
  return (hours + (pm ? 12 : 0)) * 60 + minutes;
}

/** Minutes since midnight in the store timezone for a given instant. */
export function businessMinutesOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0) % 24;
  const min = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return h * 60 + min;
}
