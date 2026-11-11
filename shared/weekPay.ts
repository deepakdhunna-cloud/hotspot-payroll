/**
 * What one person's pay week costs — the ONE rule behind every "labor cost"
 * and "gross" figure in the app: the Hours & pay grid, the manager
 * dashboard, the Executive view, the Finance estimate and the live portal.
 * They all call weekPay(), so they cannot disagree for the same row.
 *
 * The rule:
 *
 *  1. A SAVED week costs what was saved — the entry's gross pay, whether it
 *     was saved hourly or as set pay.
 *  2. A week that is NOT saved yet:
 *       - SET PAY (a standing weekly amount on the profile): the flat
 *         weekly amount, in full, whether or not they have clocked any
 *         time. That is what the grid opens the row with and what saving
 *         the week will write, so it is what the week costs.
 *       - HOURLY: clocked hours × the profile pay rate, with hours rounded
 *         to two decimals the way the grid shows them and the result
 *         rounded to cents.
 *  3. "Saved" means the week has a payroll entry that is not a
 *     schedule-only placeholder (see isScheduleOnlyEntry).
 *
 * Set pay never follows the clock: someone on $1,100 a week who has clocked
 * 22.9 h costs $1,100, not 22.9 × their hourly rate on file.
 */
import { computeGrossPay } from "./hotspot";

/**
 * Marker stored in a payroll entry's notes when the week was saved as a
 * flat "set pay" amount rather than hours × rate.
 */
export const FIXED_PAY_NOTE = "fixed-pay";

/**
 * Marker for payroll entries that exist only because a schedule was
 * committed (they carry scheduledHours). Nobody has entered hours for these
 * rows yet, so they are not saved payroll.
 */
export const SCHEDULE_ONLY_NOTE = "schedule-only";

/** The saved-entry fields the rule reads. Decimal columns arrive as strings. */
export type WeekPayEntry = {
  hoursWorked: string | number;
  grossPay: string | number;
  payRateSnapshot?: string | number | null;
  notes?: string | null;
};

export type WeekPay = {
  /** The week has saved payroll (an entry that is not a placeholder). */
  saved: boolean;
  /** Hours the row carries: saved hours, else clocked hours; null = none. */
  hours: number | null;
  /** Hourly rate for the row: the saved week's own rate, else the profile's. */
  rate: number;
  /** The set-pay amount when the week is paid flat; null = paid hourly. */
  fixed: number | null;
  /** What the week costs, in dollars rounded to cents. */
  gross: number;
};

/** Dollars rounded to cents, exactly the way saved payroll is rounded. */
const toCents = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);

/**
 * A payroll entry that only exists to carry scheduled hours (created by a
 * schedule import/commit) — the manager never entered hours on it. Legacy
 * rows from before the "schedule-only" marker are detected by their saved
 * 0 hours alongside real clock punches.
 */
export function isScheduleOnlyEntry(
  entry: WeekPayEntry | null | undefined,
  clockHours: number | undefined,
): boolean {
  if (!entry) return false;
  if (entry.notes === SCHEDULE_ONLY_NOTE) return true;
  return (
    entry.notes !== FIXED_PAY_NOTE &&
    Number(entry.hoursWorked) === 0 &&
    clockHours !== undefined &&
    clockHours > 0
  );
}

/**
 * One person's week: whether it is saved, what the row carries, and what it
 * costs. See the rule at the top of this file.
 *
 * `clockHours` is the person's clocked time in the week (undefined or 0
 * when they have none); `payRate` and `weeklyPay` come from their profile.
 */
export function weekPay(input: {
  entry?: WeekPayEntry | null;
  clockHours?: number;
  payRate: string | number | null | undefined;
  weeklyPay?: string | number | null;
}): WeekPay {
  const { entry, clockHours } = input;
  const saved = entry && !isScheduleOnlyEntry(entry, clockHours) ? entry : null;

  if (saved) {
    // A saved week keeps the rate it was paid at and costs what was saved.
    const gross = toCents(Number(saved.grossPay));
    return {
      saved: true,
      hours: Number(saved.hoursWorked),
      rate: Number(saved.payRateSnapshot ?? input.payRate ?? 0),
      fixed: saved.notes === FIXED_PAY_NOTE ? gross : null,
      gross,
    };
  }

  const rate = Number(input.payRate ?? 0);
  const hours =
    clockHours !== undefined && clockHours > 0
      ? Number(clockHours.toFixed(2))
      : null;

  // Standing set pay fills every week that isn't saved yet — a week
  // deliberately saved hourly stays hourly (handled above).
  const standing = Number(input.weeklyPay ?? 0);
  if (standing > 0) {
    const fixed = toCents(standing);
    return { saved: false, hours, rate, fixed, gross: fixed };
  }

  return {
    saved: false,
    hours,
    rate,
    fixed: null,
    gross: toCents(computeGrossPay(hours ?? 0, toCents(rate)).grossPay),
  };
}
