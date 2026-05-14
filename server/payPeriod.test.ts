import { describe, expect, it } from "vitest";
import {
  getWeekStart,
  getCurrentPayPeriodStart,
  formatWeekRange,
} from "../shared/hotspot";

/**
 * Hotspot's pay period runs Thursday → Wednesday and a week is only paid
 * AFTER it closes (Wed night). So "current pay period" = the most recent
 * fully-closed Thursday→Wednesday week.
 */
describe("pay period anchoring", () => {
  it("on Thursday May 14, 2026 returns May 7 – May 13 (the just-closed week)", () => {
    const start = getCurrentPayPeriodStart(new Date("2026-05-14T12:00:00Z"));
    expect(start.toISOString().slice(0, 10)).toBe("2026-05-07");
    expect(formatWeekRange(start)).toBe("May 7 – May 13");
  });

  it("on Wednesday May 13, 2026 (last day of period) still returns Apr 30 – May 6", () => {
    // Wednesday is still inside the in-progress week; the most-recent closed
    // week is the one that ended the prior Wednesday (May 6).
    const start = getCurrentPayPeriodStart(new Date("2026-05-13T12:00:00Z"));
    expect(start.toISOString().slice(0, 10)).toBe("2026-04-30");
    expect(formatWeekRange(start)).toBe("Apr 30 – May 6");
  });

  it("on Thursday May 21, 2026 rolls forward to May 14 – May 20", () => {
    const start = getCurrentPayPeriodStart(new Date("2026-05-21T12:00:00Z"));
    expect(start.toISOString().slice(0, 10)).toBe("2026-05-14");
    expect(formatWeekRange(start)).toBe("May 14 – May 20");
  });

  it("getWeekStart still anchors to the Thursday on or before the given date", () => {
    // Thursday itself
    expect(
      getWeekStart(new Date("2026-05-14T00:00:00Z")).toISOString().slice(0, 10),
    ).toBe("2026-05-14");
    // Sunday May 10 → previous Thursday May 7
    expect(
      getWeekStart(new Date("2026-05-10T00:00:00Z")).toISOString().slice(0, 10),
    ).toBe("2026-05-07");
  });
});
