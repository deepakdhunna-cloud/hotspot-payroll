/**
 * Pay-week date helpers, shared by every page.
 * The Hotspot pay period runs Thursday → Wednesday in store time (Chicago).
 *
 * The week math itself lives in shared/hotspot.ts — the SAME functions the
 * server uses to write payroll rows — and is re-exported here under the
 * client's names so the two sides can never disagree on week anchoring.
 */
import {
  BUSINESS_TIME_ZONE,
  businessLocalToUtc,
  formatScheduleDay,
  getWeekDays,
  getWeekStart,
  lastClosedPayWeek,
  payWeekBounds,
  payWeekOf,
} from "@shared/hotspot";

/** Snap a date marker to the Thursday (00:00 UTC) on or before it. */
export const startOfPayWeek = getWeekStart;

/**
 * The most recently CLOSED pay week (the one being paid out), decided by
 * today's date in store time. On Thu May 14 this returns May 7, i.e. the
 * May 7–13 week — and Wednesday evening in Chicago is still Wednesday.
 */
export function currentPayPeriodStart(now: Date = new Date()): Date {
  return lastClosedPayWeek(now);
}

/** The IN-PROGRESS pay week by store-local date (dashboard, schedule). */
export function inProgressPayWeekStart(now: Date = new Date()): Date {
  return payWeekOf(now);
}

/**
 * The real instants that bound a pay week's punches — Thursday 00:00 to
 * next Thursday 00:00 in store time. Use these for punch queries, never the
 * UTC date markers.
 */
export { payWeekBounds };

/** The store's time zone; punch times are shown and entered in it. */
export { BUSINESS_TIME_ZONE };

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

/*
 * Punch times are always shown and typed in STORE time (America/Chicago),
 * the same clock the kiosk, the server's messages and the attention center
 * use — a CEO checking from another time zone sees the times the store saw.
 */
const asDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

/** Store-time date + time for punch rows: "May 7, 2:15 PM". */
export function fmtDateTime(d: Date | string): string {
  return asDate(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Store-time clock time: "9:02 AM". */
export function fmtTime(d: Date | string): string {
  return asDate(d).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Store-time day heading: "Wednesday, Nov 4". */
export function fmtDayHeading(d: Date | string): string {
  return asDate(d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Store-local calendar day of an instant, "2026-11-04" — for grouping. */
export function storeDayKey(d: Date | string): string {
  return asDate(d).toLocaleDateString("en-CA", { timeZone: BUSINESS_TIME_ZONE });
}

/** An instant as a datetime-local value in store time: "2026-11-04T21:00". */
export function toStoreInput(d: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(asDate(d));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** A datetime-local value typed in store time → the real instant. */
export function fromStoreInput(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return businessLocalToUtc(y, mo, d, h, mi);
}

/** Short store time zone name for labels: "CST" / "CDT". */
export function storeTzLabel(at: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find(p => p.type === "timeZoneName")?.value ?? "CT"
  );
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
