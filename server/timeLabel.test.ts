import { describe, expect, it } from "vitest";
import { parseLooseDateNearAnchor, parseTimeLabelToMinutes } from "@shared/hotspot";

describe("parseTimeLabelToMinutes", () => {
  it("parses standard kiosk-style labels", () => {
    expect(parseTimeLabelToMinutes("9:00am")).toBe(540);
    expect(parseTimeLabelToMinutes("5:00pm")).toBe(1020);
    expect(parseTimeLabelToMinutes("12:00pm")).toBe(720);
    expect(parseTimeLabelToMinutes("12:00am")).toBe(0);
    expect(parseTimeLabelToMinutes("11:45 PM")).toBe(1425);
    expect(parseTimeLabelToMinutes("7am")).toBe(420);
  });

  it("returns null for garbage without throwing", () => {
    expect(parseTimeLabelToMinutes("")).toBeNull();
    expect(parseTimeLabelToMinutes(null)).toBeNull();
    expect(parseTimeLabelToMinutes("open")).toBeNull();
    expect(parseTimeLabelToMinutes("25:00pm")).toBeNull();
    expect(parseTimeLabelToMinutes("9:75am")).toBeNull();
  });
});

describe("parseLooseDateNearAnchor", () => {
  const anchor = new Date(Date.UTC(2026, 6, 16)); // Thu Jul 16 2026

  it("parses printed date forms to UTC midnight", () => {
    expect(parseLooseDateNearAnchor("7/9", anchor)?.toISOString()).toBe(
      "2026-07-09T00:00:00.000Z",
    );
    expect(parseLooseDateNearAnchor("07/16/26", anchor)?.toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(parseLooseDateNearAnchor("2026-07-22", anchor)?.toISOString()).toBe(
      "2026-07-22T00:00:00.000Z",
    );
  });

  it("picks the year closest to the anchor across New Year", () => {
    const dec = new Date(Date.UTC(2026, 11, 30));
    expect(parseLooseDateNearAnchor("1/2", dec)?.toISOString()).toBe(
      "2027-01-02T00:00:00.000Z",
    );
    const jan = new Date(Date.UTC(2027, 0, 2));
    expect(parseLooseDateNearAnchor("12/30", jan)?.toISOString()).toBe(
      "2026-12-30T00:00:00.000Z",
    );
  });

  it("rejects non-dates", () => {
    expect(parseLooseDateNearAnchor("Thursday", anchor)).toBeNull();
    expect(parseLooseDateNearAnchor("", anchor)).toBeNull();
    expect(parseLooseDateNearAnchor(null, anchor)).toBeNull();
    expect(parseLooseDateNearAnchor("13/45", anchor)).toBeNull();
  });
});
