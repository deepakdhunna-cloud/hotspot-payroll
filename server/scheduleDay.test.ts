import { describe, expect, it } from "vitest";
import {
  formatScheduleDay,
  getWeekDays,
  getWeekStart,
  resolveScheduleDay,
} from "../shared/hotspot";

// Thu May 7 2026 is a pay-week start (Thursday → Wednesday).
const WEEK = getWeekStart(new Date("2026-05-07T00:00:00Z"));

describe("getWeekDays", () => {
  it("returns the 7 days of a Thursday-anchored week in order", () => {
    const days = getWeekDays(WEEK);
    expect(days).toHaveLength(7);
    expect(days[0].toISOString()).toBe("2026-05-07T00:00:00.000Z"); // Thu
    expect(days[6].toISOString()).toBe("2026-05-13T00:00:00.000Z"); // Wed
    expect(days[0].getUTCDay()).toBe(4);
  });
});

describe("resolveScheduleDay", () => {
  it("resolves full day names and abbreviations", () => {
    expect(resolveScheduleDay(WEEK, "Thursday")?.toISOString()).toBe(
      "2026-05-07T00:00:00.000Z",
    );
    expect(resolveScheduleDay(WEEK, "mon")?.toISOString()).toBe(
      "2026-05-11T00:00:00.000Z",
    );
    expect(resolveScheduleDay(WEEK, "Wed")?.toISOString()).toBe(
      "2026-05-13T00:00:00.000Z",
    );
    expect(resolveScheduleDay(WEEK, "TUES")?.toISOString()).toBe(
      "2026-05-12T00:00:00.000Z",
    );
  });

  it("resolves US-style and ISO dates inside the week window", () => {
    expect(resolveScheduleDay(WEEK, "5/9")?.toISOString()).toBe(
      "2026-05-09T00:00:00.000Z",
    );
    expect(resolveScheduleDay(WEEK, "5/9/2026")?.toISOString()).toBe(
      "2026-05-09T00:00:00.000Z",
    );
    expect(resolveScheduleDay(WEEK, "2026-05-12")?.toISOString()).toBe(
      "2026-05-12T00:00:00.000Z",
    );
  });

  it("returns null for dates outside the week and garbage input", () => {
    expect(resolveScheduleDay(WEEK, "5/20")).toBeNull();
    expect(resolveScheduleDay(WEEK, "")).toBeNull();
    expect(resolveScheduleDay(WEEK, "someday")).toBeNull();
  });
});

describe("formatScheduleDay", () => {
  it("formats as weekday month/day in UTC", () => {
    expect(formatScheduleDay(new Date("2026-05-07T00:00:00Z"))).toBe("Thu 5/7");
    expect(formatScheduleDay(new Date("2026-05-13T00:00:00Z"))).toBe("Wed 5/13");
  });
});
