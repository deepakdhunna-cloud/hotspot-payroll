import { describe, expect, it } from "vitest";
import {
  computeGrossPay,
  estimateWithholding,
  getWeekStart,
  ROLES,
  STORES,
  FEDERAL_TAX_RATE,
  STATE_TAX_RATE,
  PAY_WEEK_START_DAY,
} from "../shared/hotspot";

describe("Hotspot constants", () => {
  it("has exactly the four expected stores", () => {
    expect([...STORES]).toEqual([
      "Hotspot Market 11",
      "Hotspot Market 13",
      "Hotspot Market 14",
      "Hotspot Travel Center",
    ]);
  });

  it("has the six expected roles", () => {
    expect([...ROLES]).toEqual([
      "Manager",
      "Assistant Manager",
      "Cashier",
      "Kitchen Manager",
      "Cook",
      "Janitorial",
    ]);
  });

  it("uses Thursday-anchored pay week (day 4)", () => {
    expect(PAY_WEEK_START_DAY).toBe(4);
  });
});

describe("computeGrossPay (no overtime)", () => {
  it("multiplies hours by rate", () => {
    const r = computeGrossPay(30, 15);
    expect(r.regularHours).toBe(30);
    expect(r.regularPay).toBe(450);
    expect(r.grossPay).toBe(450);
  });

  it("uses the same rate beyond 40 hours (no 1.5x)", () => {
    const r = computeGrossPay(45, 20);
    expect(r.grossPay).toBe(900);
    expect(r.regularPay).toBe(900);
  });

  it("handles zero hours", () => {
    const r = computeGrossPay(0, 18);
    expect(r.grossPay).toBe(0);
    expect(r.regularPay).toBe(0);
  });

  it("handles fractional hours", () => {
    const r = computeGrossPay(40.5, 10);
    expect(r.grossPay).toBeCloseTo(405, 5);
  });
});

describe("estimateWithholding", () => {
  it("applies federal and state estimates correctly", () => {
    const r = estimateWithholding(1000);
    expect(r.federal).toBeCloseTo(1000 * FEDERAL_TAX_RATE, 5);
    expect(r.state).toBeCloseTo(1000 * STATE_TAX_RATE, 5);
    expect(r.totalTax).toBeCloseTo(r.federal + r.state, 5);
    expect(r.netPay).toBeCloseTo(1000 - r.federal - r.state, 5);
  });

  it("returns zeros for zero gross", () => {
    const r = estimateWithholding(0);
    expect(r.federal).toBe(0);
    expect(r.state).toBe(0);
    expect(r.totalTax).toBe(0);
    expect(r.netPay).toBe(0);
  });
});

describe("getWeekStart (Thursday-anchored)", () => {
  it("returns Thursday for a midweek date", () => {
    // 2026-05-14 is a Thursday; week starts the same day
    const w = getWeekStart(new Date("2026-05-14T15:00:00Z"));
    expect(w.getUTCDay()).toBe(4);
    expect(w.toISOString().startsWith("2026-05-14")).toBe(true);
  });

  it("rolls back to previous Thursday for a Wednesday", () => {
    // 2026-05-13 is a Wednesday → previous Thursday is 2026-05-07
    const w = getWeekStart(new Date("2026-05-13T12:00:00Z"));
    expect(w.toISOString().startsWith("2026-05-07")).toBe(true);
  });

  it("rolls back from Sunday to Thursday", () => {
    const w = getWeekStart(new Date("2026-05-10T12:00:00Z")); // Sunday
    expect(w.toISOString().startsWith("2026-05-07")).toBe(true);
  });

  it("rolls back from Saturday to Thursday", () => {
    const w = getWeekStart(new Date("2026-05-09T05:00:00Z")); // Saturday
    expect(w.toISOString().startsWith("2026-05-07")).toBe(true);
  });
});
