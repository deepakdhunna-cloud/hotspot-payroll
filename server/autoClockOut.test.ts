import { describe, expect, it } from "vitest";
import {
  autoClockOutNote,
  autoCutoffFor,
  buildAutoClockOutItem,
  isAutoClosedNote,
  limitFromNote,
  parseAutoClockOutHours,
  stripAutoClockOutNote,
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

  it("reads the limit back out of the note", () => {
    expect(limitFromNote(autoClockOutNote(14))).toBe(14);
    expect(limitFromNote(`forgot badge · ${autoClockOutNote(8)}`)).toBe(8);
    expect(limitFromNote("left early")).toBeNull();
    expect(limitFromNote(null)).toBeNull();
  });

  it("stripping the marker restores the original note (or null)", () => {
    expect(stripAutoClockOutNote(autoClockOutNote(10))).toBeNull();
    expect(
      stripAutoClockOutNote(`forgot badge · ${autoClockOutNote(12)}`),
    ).toBe("forgot badge");
    expect(stripAutoClockOutNote("left early")).toBe("left early");
    expect(stripAutoClockOutNote(null)).toBeNull();
    const stripped = stripAutoClockOutNote(
      `forgot badge · ${autoClockOutNote(12)}`,
    );
    expect(isAutoClosedNote(stripped)).toBe(false);
  });
});

describe("buildAutoClockOutItem", () => {
  const base = {
    id: 44,
    employeeId: 1,
    storeLocation: "Hotspot Market 13",
    clockInAt: new Date("2026-07-16T10:00:00Z"),
    note: autoClockOutNote(14),
  };

  it("describes an untouched auto close as automatic", () => {
    const item = buildAutoClockOutItem(
      { ...base, clockOutAt: new Date("2026-07-17T00:00:00Z") }, // in + 14h
      "Maya Lopez",
    );
    expect(item.refKey).toBe("auto_clockout:44");
    expect(item.title).toContain("was clocked out automatically after 14.0h");
    expect(item.weekStart?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("describes an edited punch as corrected — never claims the system chose the new time", () => {
    const item = buildAutoClockOutItem(
      { ...base, clockOutAt: new Date("2026-07-16T18:30:00Z") }, // human-fixed 8.5h
      "Maya Lopez",
    );
    expect(item.title).toContain("corrected to 8.5h");
    expect(item.detail).toContain("Originally closed by the 14h auto clock-out limit");
    expect(item.title).not.toContain("was clocked out automatically after");
  });
});
