import { getWeekStart, payWeekOf } from "@shared/hotspot";

/**
 * The live Dashboard can show a punch that began before the displayed pay
 * week. Load that punch's schedule week as well, so its scheduled-end action
 * remains available instead of being limited to the current week’s shifts.
 */
export function dashboardScheduleWeeks(
  currentWeek: Date,
  openPunches: ReadonlyArray<{ clockInAt: Date | string }>,
): Date[] {
  const weeks = new Map<string, Date>();
  const current = getWeekStart(currentWeek);
  weeks.set(current.toISOString(), current);
  // A punch's week is decided by its store-local date (a Wednesday 9pm
  // clock-in is still Wednesday), not by the UTC calendar.
  for (const punch of openPunches) {
    const week = payWeekOf(new Date(punch.clockInAt));
    weeks.set(week.toISOString(), week);
  }
  return Array.from(weeks.values());
}
