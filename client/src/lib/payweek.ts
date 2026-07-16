/**
 * Pay-week date helpers, shared by every page.
 * The Hotspot pay period runs Thursday 00:00 UTC → Wednesday.
 *
 * The week math itself lives in shared/hotspot.ts — the SAME functions the
 * server uses to write payroll rows — and is re-exported here under the
 * client's names so the two sides can never disagree on week anchoring.
 */
import {
  formatScheduleDay,
  getCurrentPayPeriodStart,
  getWeekDays,
  getWeekStart,
} from "@shared/hotspot";

/** Snap any date to the Thursday (00:00 UTC) on or before it. */
export const startOfPayWeek = getWeekStart;

/**
 * The most recently CLOSED pay week (the one being paid out).
 * On Thu May 14 this returns May 7, i.e. the May 7–13 week.
 */
export const currentPayPeriodStart = getCurrentPayPeriodStart;

/** The IN-PROGRESS pay week (used by the dashboard and schedule import). */
export function inProgressPayWeekStart(now: Date = new Date()): Date {
  return getWeekStart(now);
}

/** Shift a week start by ±n weeks. */
export function shiftPayWeek(weekStart: Date, deltaWeeks: number): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d;
}

/** The 7 days of a pay week, Thursday first. */
export const payWeekDays = getWeekDays;

/** "Thu 5/7" style label for a schedule day (UTC). */
export const shortDayLabel = formatScheduleDay;

/** Serialize for <input type="date"> (UTC-based). */
export function toDateInput(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Parse an <input type="date"> value as 00:00 UTC. */
export function fromDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Local date+time for punch rows: "May 7, 2:15 PM". */
export function fmtDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3h 24m" from fractional hours. Rounds to whole minutes first so a
 * 1h 59m 50s shift reads "2h 00m", never "1h 60m". */
export function fmtDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
