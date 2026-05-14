import { describe, expect, it } from "vitest";
import {
  computeGrossPay,
  estimateWithholding,
  getWeekStart,
  OVERTIME_MULTIPLIER,
  OVERTIME_THRESHOLD_HOURS,
  ROLES,
  STORES,
  FEDERAL_TAX_RATE,
  STATE_TAX_RATE,
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

  it("uses 40-hour overtime threshold and 1.5x multiplier", () => {
    expect(OVERTIME_THRESHOLD_HOURS).toBe(40);
    expect(OVERTIME_MULTIPLIER).toBe(1.5);
  });
});

describe("computeGrossPay", () => {
  it("computes regular pay only under 40 hours", () => {
    const r = computeGrossPay(30, 15);
    expect(r.regularHours).toBe(30);
    expect(r.overtimeHours).toBe(0);
    expect(r.regularPay).toBe(450);
    expect(r.overtimePay).toBe(0);
    expect(r.grossPay).toBe(450);
  });

  it("computes exactly 40 hours as regular only", () => {
    const r = computeGrossPay(40, 20);
    expect(r.regularPay).toBe(800);
    expect(r.overtimePay).toBe(0);
    expect(r.grossPay).toBe(800);
  });

  it("applies 1.5x overtime over 40 hours", () => {
    const r = computeGrossPay(45, 20);
    // 40 * 20 = 800 regular, 5 * 20 * 1.5 = 150 OT, total 950
    expect(r.regularPay).toBe(800);
    expect(r.overtimePay).toBe(150);
    expect(r.grossPay).toBe(950);
    expect(r.overtimeHours).toBe(5);
  });

  it("handles zero hours", () => {
    const r = computeGrossPay(0, 18);
    expect(r.grossPay).toBe(0);
    expect(r.regularPay).toBe(0);
    expect(r.overtimePay).toBe(0);
  });

  it("handles fractional hours", () => {
    const r = computeGrossPay(40.5, 10);
    expect(r.regularPay).toBe(400);
    expect(r.overtimePay).toBeCloseTo(7.5, 5);
    expect(r.grossPay).toBeCloseTo(407.5, 5);
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

describe("getWeekStart", () => {
  it("returns Monday for a midweek date", () => {
    // 2026-05-14 is a Thursday (UTC)
    const w = getWeekStart(new Date("2026-05-14T15:00:00Z"));
    expect(w.getUTCDay()).toBe(1);
    expect(w.toISOString().startsWith("2026-05-11")).toBe(true);
  });

  it("returns Monday when input is already Monday", () => {
    const w = getWeekStart(new Date("2026-05-11T00:00:00Z"));
    expect(w.toISOString().startsWith("2026-05-11")).toBe(true);
  });

  it("returns Monday when input is Sunday", () => {
    const w = getWeekStart(new Date("2026-05-17T12:00:00Z")); // Sunday
    expect(w.toISOString().startsWith("2026-05-11")).toBe(true);
  });

  it("returns Monday when input is Saturday", () => {
    const w = getWeekStart(new Date("2026-05-16T05:00:00Z")); // Saturday
    expect(w.toISOString().startsWith("2026-05-11")).toBe(true);
  });
});
