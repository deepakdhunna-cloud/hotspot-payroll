import { describe, expect, it } from "vitest";
import {
  businessDayBoundaryUtc,
  businessMidnightUtc,
  lastClosedPayWeek,
  payWeekBounds,
  payWeekOf,
} from "@shared/hotspot";

/**
 * Pay weeks are Thursday → Wednesday in STORE time (America/Chicago). Punch
 * windows must use Chicago midnight, not UTC midnight, or a Wednesday-night
 * closer's shift lands in the following week.
 */
describe("store-time pay weeks", () => {
  it("bounds a CDT week at Chicago midnight (05:00Z)", () => {
    const { start, end } = payWeekBounds(new Date("2026-10-29T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-29T05:00:00.000Z");
    // Nov 5 is after the Nov 1 fall-back, so CST: 06:00Z.
    expect(end.toISOString()).toBe("2026-11-05T06:00:00.000Z");
  });

  it("bounds a CST week at Chicago midnight (06:00Z)", () => {
    const { start, end } = payWeekBounds(new Date("2026-11-05T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-05T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-12T06:00:00.000Z");
  });

  it("puts a Wednesday 8pm Chicago clock-in in the week that is ending", () => {
    // Wed Nov 4, 8:00 PM CST = Thu Nov 5, 02:00Z.
    const clockIn = new Date("2026-11-05T02:00:00Z");
    expect(payWeekOf(clockIn).toISOString()).toBe("2026-10-29T00:00:00.000Z");
    const { start, end } = payWeekBounds(new Date("2026-10-29T00:00:00Z"));
    expect(clockIn >= start && clockIn < end).toBe(true);
  });

  it("starts the new week at Thursday 00:00 Chicago", () => {
    // Thu Nov 5, 00:30 CST = 06:30Z.
    expect(payWeekOf(new Date("2026-11-05T06:30:00Z")).toISOString()).toBe(
      "2026-11-05T00:00:00.000Z"
    );
  });

  it("keeps Wednesday evening on the closing week for 'last closed'", () => {
    // Wed Nov 4, 7:30 PM CST: the live week is still Oct 29, so the last
    // closed week is Oct 22.
    expect(
      lastClosedPayWeek(new Date("2026-11-05T01:30:00Z")).toISOString()
    ).toBe("2026-10-22T00:00:00.000Z");
  });

  it("uses the offset in force at local midnight on a DST day", () => {
    // Sun Nov 1, 2026: midnight is still CDT (05:00Z) even though the
    // afternoon is CST.
    expect(businessMidnightUtc(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z"
    );
    expect(businessDayBoundaryUtc(new Date("2026-11-01T20:00:00Z")).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z"
    );
  });
});
