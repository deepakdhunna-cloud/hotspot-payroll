/**
 * The one rule for what a person's pay week costs (shared/weekPay.ts). The
 * Hours & pay grid opens every row from it and the dashboard, Executive,
 * Finance and portal figures price people with it, so these cases are the
 * contract all of those surfaces share.
 */
import { describe, expect, it } from "vitest";
import { computeGrossPay } from "../shared/hotspot";
import {
  FIXED_PAY_NOTE,
  SCHEDULE_ONLY_NOTE,
  isScheduleOnlyEntry,
  weekPay,
  type WeekPay,
} from "../shared/weekPay";

/** A manager on $1,100 a week with a $24/h rate on file. */
const SET_PAY = { payRate: "24.00", weeklyPay: "1100.00" };
/** An hourly cashier at $16/h. */
const HOURLY = { payRate: "16.00", weeklyPay: null };

/** A payroll entry the way saveHours writes it (decimals come back as strings). */
function savedEntry(hours: number, rate: number, fixedGross?: number) {
  const gross = fixedGross ?? computeGrossPay(hours, rate).grossPay;
  return {
    hoursWorked: hours.toFixed(2),
    payRateSnapshot: rate.toFixed(2),
    grossPay: gross.toFixed(2),
    notes: fixedGross !== undefined ? FIXED_PAY_NOTE : null,
  };
}

/**
 * The Hours & pay grid's own arithmetic on an untouched row: it formats the
 * rule's values into its text fields (freshRow) and prices those fields
 * (calcRow). Kept here so a change to the rule that would make the grid and
 * the dashboard disagree fails a test.
 */
function gridGross(pay: WeekPay): number {
  const hours = pay.hours === null ? "" : pay.hours.toFixed(2);
  const rate = pay.rate.toFixed(2);
  const fixed = pay.fixed === null ? null : pay.fixed.toFixed(2);
  const gross =
    fixed !== null
      ? Number(fixed)
      : computeGrossPay(hours === "" ? 0 : Number(hours), Number(rate)).grossPay;
  return Number(gross.toFixed(2));
}

describe("weekPay — a week that is not saved yet", () => {
  it("prices an hourly person at clocked hours × pay rate", () => {
    const pay = weekPay({ ...HOURLY, clockHours: 38.5 });
    expect(pay).toEqual({
      saved: false,
      hours: 38.5,
      rate: 16,
      fixed: null,
      gross: 616,
    });
  });

  it("rounds clocked hours to two decimals, then the dollars to cents", () => {
    // 22 h 55 min on the clock reads 22.92 h in the grid.
    const pay = weekPay({ ...HOURLY, clockHours: 22 + 55 / 60 });
    expect(pay.hours).toBe(22.92);
    expect(pay.gross).toBe(366.72);
  });

  it("costs a set-pay person their flat weekly amount, not hours × rate", () => {
    // The case from the bug report: 22.9 h at $24/h is ~$550, but the week
    // pays (and costs) $1,100.
    const pay = weekPay({ ...SET_PAY, clockHours: 22.9 });
    expect(pay.gross).toBe(1100);
    expect(pay.fixed).toBe(1100);
    expect(pay.hours).toBe(22.9);
    expect(pay.saved).toBe(false);
  });

  it("costs a set-pay person the full amount with no clocked time at all", () => {
    expect(weekPay({ ...SET_PAY }).gross).toBe(1100);
    expect(weekPay({ ...SET_PAY, clockHours: 0 }).gross).toBe(1100);
    expect(weekPay({ ...SET_PAY }).hours).toBeNull();
  });

  it("costs nothing for an hourly person who has not clocked in", () => {
    expect(weekPay({ ...HOURLY }).gross).toBe(0);
    expect(weekPay({ ...HOURLY, clockHours: 0 }).hours).toBeNull();
  });

  it("treats an empty or zero weekly amount as hourly", () => {
    for (const weeklyPay of [null, undefined, "0.00", 0]) {
      const pay = weekPay({ payRate: "16.00", weeklyPay, clockHours: 10 });
      expect(pay.fixed).toBeNull();
      expect(pay.gross).toBe(160);
    }
  });
});

describe("weekPay — a saved week", () => {
  it("costs the saved gross and keeps the rate it was paid at", () => {
    // Saved at $15/h; the profile has since moved to $16/h and the clock
    // now reads more hours — the saved week does not move.
    const pay = weekPay({
      ...HOURLY,
      entry: savedEntry(40, 15),
      clockHours: 44,
    });
    expect(pay).toEqual({
      saved: true,
      hours: 40,
      rate: 15,
      fixed: null,
      gross: 600,
    });
  });

  it("reopens a week saved as set pay with its saved amount", () => {
    // Saved at $900 that week, even though the standing amount is $1,100.
    const pay = weekPay({
      ...SET_PAY,
      entry: savedEntry(30, 24, 900),
      clockHours: 30,
    });
    expect(pay.saved).toBe(true);
    expect(pay.fixed).toBe(900);
    expect(pay.gross).toBe(900);
  });

  it("keeps a week deliberately saved hourly as hourly for a set-pay person", () => {
    const pay = weekPay({
      ...SET_PAY,
      entry: savedEntry(10, 24),
      clockHours: 10,
    });
    expect(pay.fixed).toBeNull();
    expect(pay.gross).toBe(240);
  });

  it("counts a saved 0 hours (nobody clocked) as saved at $0", () => {
    const pay = weekPay({ ...HOURLY, entry: savedEntry(0, 16) });
    expect(pay.saved).toBe(true);
    expect(pay.gross).toBe(0);
  });
});

describe("weekPay — schedule placeholders are not saved payroll", () => {
  const placeholder = {
    hoursWorked: "0.00",
    payRateSnapshot: "24.00",
    grossPay: "0.00",
    notes: SCHEDULE_ONLY_NOTE,
  };

  it("prices a schedule-only row like a week with no entry", () => {
    expect(weekPay({ ...HOURLY, entry: placeholder, clockHours: 12 })).toEqual(
      weekPay({ ...HOURLY, clockHours: 12 }),
    );
    expect(weekPay({ ...SET_PAY, entry: placeholder })).toEqual(
      weekPay({ ...SET_PAY }),
    );
    expect(weekPay({ ...SET_PAY, entry: placeholder }).gross).toBe(1100);
  });

  it("detects a legacy placeholder: 0 saved hours next to real punches", () => {
    const legacy = { ...placeholder, notes: null };
    expect(isScheduleOnlyEntry(legacy, 8)).toBe(true);
    expect(isScheduleOnlyEntry(legacy, 0)).toBe(false);
    expect(isScheduleOnlyEntry(legacy, undefined)).toBe(false);
    expect(weekPay({ ...HOURLY, entry: legacy, clockHours: 8 }).gross).toBe(128);
  });

  it("never mistakes a saved set-pay week with 0 hours for a placeholder", () => {
    const setPayNoHours = savedEntry(0, 24, 1100);
    expect(isScheduleOnlyEntry(setPayNoHours, 8)).toBe(false);
    expect(weekPay({ ...SET_PAY, entry: setPayNoHours, clockHours: 8 }).saved).toBe(
      true,
    );
  });
});

describe("weekPay — the same number the Hours & pay grid shows", () => {
  const cases: [string, Parameters<typeof weekPay>[0]][] = [
    ["hourly, from the clock", { ...HOURLY, clockHours: 38.5 }],
    ["hourly, odd minutes", { ...HOURLY, clockHours: 22 + 55 / 60 }],
    ["hourly, odd rate", { payRate: "15.55", clockHours: 31.4166667 }],
    ["hourly, nothing clocked", { ...HOURLY }],
    ["set pay, clocked", { ...SET_PAY, clockHours: 22.9 }],
    ["set pay, not clocked", { ...SET_PAY }],
    ["saved hourly", { ...HOURLY, entry: savedEntry(39.75, 15.55), clockHours: 41 }],
    ["saved set pay", { ...SET_PAY, entry: savedEntry(30, 24, 900) }],
    ["set-pay person saved hourly", { ...SET_PAY, entry: savedEntry(10, 24) }],
    ["saved zero", { ...HOURLY, entry: savedEntry(0, 16) }],
  ];

  it.each(cases)("%s", (_name, input) => {
    const pay = weekPay(input);
    expect(gridGross(pay)).toBe(pay.gross);
  });
});
