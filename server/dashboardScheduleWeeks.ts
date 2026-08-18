import { getWeekStart } from "@shared/hotspot";

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
  for (const date of [currentWeek, ...openPunches.map((punch) => punch.clockInAt)]) {
    const week = getWeekStart(new Date(date));
    weeks.set(week.toISOString(), week);
  }
  return Array.from(weeks.values());
}
