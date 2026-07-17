import { describe, expect, it } from "vitest";
import { parseTimeLabelToMinutes } from "@shared/hotspot";

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
