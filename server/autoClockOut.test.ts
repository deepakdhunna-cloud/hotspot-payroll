import { describe, expect, it } from "vitest";
import {
  autoClockOutNote,
  autoCutoffFor,
  isAutoClosedNote,
  parseAutoClockOutHours,
} from "./autoClockOut";

describe("parseAutoClockOutHours", () => {
  it("accepts whole hours inside the allowed range", () => {
    expect(parseAutoClockOutHours("10")).toBe(10);
    expect(parseAutoClockOutHours("4")).toBe(4);
    expect(parseAutoClockOutHours("24")).toBe(24);
  });

  it("treats off/invalid values as disabled", () => {
    expect(parseAutoClockOutHours(undefined)).toBeNull();
    expect(parseAutoClockOutHours(null)).toBeNull();
    expect(parseAutoClockOutHours("")).toBeNull();
    expect(parseAutoClockOutHours("0")).toBeNull();
    expect(parseAutoClockOutHours("3")).toBeNull(); // below minimum
    expect(parseAutoClockOutHours("25")).toBeNull(); // above maximum
    expect(parseAutoClockOutHours("9.5")).toBeNull(); // whole hours only
    expect(parseAutoClockOutHours("abc")).toBeNull();
  });
});

describe("autoCutoffFor", () => {
  const clockIn = new Date("2026-07-17T08:00:00Z");

  it("stays null while the punch is under the limit", () => {
    expect(autoCutoffFor(clockIn, 10, new Date("2026-07-17T17:59:00Z"))).toBeNull();
  });

  it("returns clock-in + limit once crossed — never the sweep time", () => {
    const atLimit = autoCutoffFor(clockIn, 10, new Date("2026-07-17T18:00:00Z"));
    expect(atLimit?.toISOString()).toBe("2026-07-17T18:00:00.000Z");
    // Even a sweep running a day late records the cutoff, not "now".
    const lateSweep = autoCutoffFor(clockIn, 10, new Date("2026-07-18T14:30:00Z"));
    expect(lateSweep?.toISOString()).toBe("2026-07-17T18:00:00.000Z");
  });

  it("ignores punches whose clock-in is in the future", () => {
    expect(
      autoCutoffFor(new Date("2026-07-18T08:00:00Z"), 10, new Date("2026-07-17T08:00:00Z")),
    ).toBeNull();
  });
});

describe("auto clock-out note marker", () => {
  it("round-trips through the note text", () => {
    expect(isAutoClosedNote(autoClockOutNote(10))).toBe(true);
    expect(isAutoClosedNote(`forgot badge · ${autoClockOutNote(12)}`)).toBe(true);
    expect(isAutoClosedNote("left early")).toBe(false);
    expect(isAutoClosedNote(null)).toBe(false);
    expect(isAutoClosedNote(undefined)).toBe(false);
  });
});
