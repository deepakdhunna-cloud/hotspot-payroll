import { describe, expect, it } from "vitest";
import { dashboardScheduleWeeks } from "./dashboardScheduleWeeks";

describe("dashboardScheduleWeeks", () => {
  it("includes the current and each open-punch pay week without duplicates", () => {
    const weeks = dashboardScheduleWeeks(new Date("2026-08-13T00:00:00.000Z"), [
      { clockInAt: new Date("2026-08-18T09:00:00.000Z") },
      { clockInAt: new Date("2026-08-07T09:00:00.000Z") },
      { clockInAt: new Date("2026-08-08T09:00:00.000Z") },
    ]);

    expect(weeks.map((week) => week.toISOString())).toEqual([
      "2026-08-13T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z",
    ]);
  });
});
