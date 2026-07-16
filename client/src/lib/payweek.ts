/**
 * Pay-week date helpers, shared by every page.
 * The Hotspot pay period runs Thursday 00:00 UTC → Wednesday.
 */

/** Snap any date to the Thursday (00:00 UTC) on or before it. */
export function startOfPayWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const diff = (d.getUTCDay() - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * The most recently CLOSED pay week (the one being paid out).
 * On Thu May 14 this returns May 7, i.e. the May 7–13 week.
 */
export function currentPayPeriodStart(now: Date = new Date()): Date {
  const start = startOfPayWeek(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return start;
}

/** The IN-PROGRESS pay week (used by the dashboard and schedule import). */
export function inProgressPayWeekStart(now: Date = new Date()): Date {
  return startOfPayWeek(now);
}

/** Shift a week start by ±n weeks. */
export function shiftPayWeek(weekStart: Date, deltaWeeks: number): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d;
}

/** The 7 days of a pay week, Thursday first. */
export function payWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
}

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

/** "Thu 5/7" style label for a schedule day (UTC). */
export function shortDayLabel(day: Date): string {
  const wd = day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${day.getUTCMonth() + 1}/${day.getUTCDate()}`;
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

/** "3h 24m" from fractional hours. */
export function fmtDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
