import { describe, expect, it } from "vitest";
import {
  calcRow,
  freshRow,
  freshView,
  isScheduleOnlyEntry,
  saveInputFor,
  type WeekRow,
} from "@/lib/payrollRow";
import { payWeekBounds, payWeekElapsed } from "@/lib/payweek";

/**
 * The payroll row math is shared by the weekly timesheet and the command
 * center's Autopilot. These pin down what an untouched row opens with and
 * exactly what saving it sends — the Autopilot can only ever save this.
 */
const WEEK = new Date("2026-10-29T05:00:00Z");

function row(over: {
  payRate?: string;
  weeklyPay?: string | null;
  active?: number;
  entry?: Partial<NonNullable<WeekRow["entry"]>> | null;
}): WeekRow {
  return {
    employee: {
      id: 7,
      fullName: "Ana Diaz",
      payRate: over.payRate ?? "16.50",
      weeklyPay: over.weeklyPay ?? null,
      role: "Cashier",
      storeLocation: "Hotspot Market 11",
      active: over.active ?? 1,
    },
    entry: over.entry
      ? {
          hoursWorked: "0.00",
          scheduledHours: "0.00",
          payRateSnapshot: "16.50",
          grossPay: "0.00",
          notes: null,
          ...over.entry,
        }
      : null,
  } as unknown as WeekRow;
}

describe("what an untouched row opens with", () => {
  it("nothing saved: hours come straight from the time clock at the profile rate", () => {
    const { edit } = freshRow(row({}), 31.4);
    expect(edit).toEqual({ hours: "31.40", rate: "16.50", fixed: null, manual: false });
    expect(calcRow(edit).gross).toBe(518.1);
  });

  it("nothing saved and nothing clocked: an empty row, not a zero", () => {
    const v = freshView(row({}), undefined);
    expect(v.edit.hours).toBe("");
    expect(v.status).toBe("empty");
    expect(v.hasWork).toBe(false);
  });

  it("a saved week reopens with its own hours and the rate it was paid at", () => {
    const r = row({
      payRate: "18.00", // the profile rate went up since
      entry: { hoursWorked: "30.00", payRateSnapshot: "16.50", grossPay: "495.00" },
    });
    const v = freshView(r, 30);
    expect(v.isSaved).toBe(true);
    expect(v.edit.rate).toBe("16.50");
    expect(v.calc.gross).toBe(495);
    expect(v.edit.manual).toBe(false);
  });

  it("saved hours that no longer match the clock open as typed hours", () => {
    const r = row({ entry: { hoursWorked: "30.00", grossPay: "495.00" } });
    expect(freshRow(r, 33.2).edit.manual).toBe(true);
    // under three minutes apart is rounding, not a change
    expect(freshRow(r, 30.04).edit.manual).toBe(false);
  });

  it("a schedule-only placeholder is not a saved week: the clock still fills it", () => {
    const r = row({ entry: { scheduledHours: "32.00", notes: "schedule-only" } });
    expect(isScheduleOnlyEntry(r.entry, 28)).toBe(true);
    const v = freshView(r, 28);
    expect(v.isSaved).toBe(false);
    expect(v.status).toBe("unsaved");
    expect(v.edit.hours).toBe("28.00");
    expect(v.scheduled).toBe(32);
  });

  it("a legacy placeholder (0 hours saved, real punches) is treated the same way", () => {
    const r = row({ entry: { scheduledHours: "32.00", hoursWorked: "0.00" } });
    expect(isScheduleOnlyEntry(r.entry, 28)).toBe(true);
    // ...but a deliberate saved 0 with nothing on the clock stays saved
    expect(isScheduleOnlyEntry(r.entry, undefined)).toBe(false);
  });

  it("standing set pay fills a week that isn't saved yet, whatever the hours", () => {
    const v = freshView(row({ weeklyPay: "1100.00", payRate: "24.00" }), 22.92);
    expect(v.calc.isFixed).toBe(true);
    expect(v.calc.gross).toBe(1100);
    expect(v.edit.hours).toBe("22.92");
    // even with no time on the clock there is something to pay
    expect(freshView(row({ weeklyPay: "1100.00" }), undefined).hasWork).toBe(true);
  });

  it("a week saved as set pay reopens with the amount it was saved at", () => {
    const r = row({
      weeklyPay: "1200.00", // the standing amount changed since
      entry: { hoursWorked: "40.00", grossPay: "1100.00", notes: "fixed-pay" },
    });
    const v = freshView(r, 40);
    expect(v.calc.isFixed).toBe(true);
    expect(v.calc.gross).toBe(1100);
  });

  it("a week deliberately saved hourly stays hourly despite a standing set pay", () => {
    const r = row({
      weeklyPay: "1100.00",
      entry: { hoursWorked: "20.00", payRateSnapshot: "24.00", grossPay: "480.00" },
    });
    const v = freshView(r, 20);
    expect(v.calc.isFixed).toBe(false);
    expect(v.calc.gross).toBe(480);
  });
});

describe("what a row comes to", () => {
  it("gross is hours × rate, rounded to cents the way the server saves it", () => {
    expect(calcRow({ hours: "37.55", rate: "17", fixed: null, manual: false }).gross).toBe(638.35);
    expect(calcRow({ hours: "12.65", rate: "15.5", fixed: null, manual: false }).gross).toBe(196.08);
  });

  it("bad values are named, and count for nothing", () => {
    const c = calcRow({ hours: "200", rate: "", fixed: null, manual: true });
    expect(c.errors.hours).toMatch(/168/);
    expect(c.errors.rate).toMatch(/hourly rate/i);
    expect(c.gross).toBe(0);
    expect(calcRow({ hours: "abc", rate: "15", fixed: null, manual: true }).errors.hours).toBeTruthy();
    expect(calcRow({ hours: "10", rate: "1001", fixed: null, manual: true }).errors.rate).toBeTruthy();
    expect(calcRow({ hours: "10", rate: "15", fixed: "", manual: true }).errors.fixed).toBeTruthy();
  });
});

describe("what saving a row sends", () => {
  const save = (v: ReturnType<typeof freshView>, olderWeek = false, rateChanged = false) =>
    saveInputFor({
      employeeId: v.id,
      weekStart: WEEK,
      scheduled: v.scheduled,
      calc: v.calc,
      rateChanged,
      olderWeek,
    });

  it("an untouched clock row: its hours and schedule, and no rate (the server prices it)", () => {
    const v = freshView(row({ entry: { scheduledHours: "32.00", notes: "schedule-only" } }), 28);
    const built = save(v);
    expect(built).toEqual({
      ok: true,
      input: { employeeId: 7, weekStart: WEEK, hoursWorked: 28, scheduledHours: 32 },
    });
  });

  it("set pay is sent as the flat amount", () => {
    const built = save(freshView(row({ weeklyPay: "1100.00" }), 22.92));
    expect(built.ok && built.input.fixedGross).toBe(1100);
    expect(built.ok && built.input.hoursWorked).toBe(22.92);
  });

  it("the rate is sent only when it was changed, or for an older week", () => {
    const v = freshView(row({}), 20);
    expect(save(v).ok && "payRateOverride" in (save(v) as any).input).toBe(false);
    const changed = save(v, false, true);
    expect(changed.ok && changed.input.payRateOverride).toBe(16.5);
    const older = save(v, true, false);
    expect(older.ok && older.input.payRateOverride).toBe(16.5);
  });

  it("a row that can't be saved says why instead of sending anything", () => {
    const empty = save(freshView(row({}), undefined));
    expect(empty).toEqual({ ok: false, message: "Enter hours (use 0 if they didn't work)." });
    const noRate = saveInputFor({
      employeeId: 7,
      weekStart: WEEK,
      scheduled: 0,
      calc: calcRow({ hours: "10", rate: "", fixed: null, manual: false }),
      rateChanged: false,
      olderWeek: false,
    });
    expect(noRate.ok).toBe(false);
  });
});

describe("how far a pay week has run (set pay accrues with it)", () => {
  const { start, end } = payWeekBounds(WEEK);
  it("is 0 before the week starts and 1 once it has closed", () => {
    expect(payWeekElapsed(WEEK, start.getTime() - 60_000)).toBe(0);
    expect(payWeekElapsed(WEEK, end.getTime() + 60_000)).toBe(1);
    expect(payWeekElapsed(WEEK, end.getTime() + 30 * 86_400_000)).toBe(1);
  });
  it("is the share of the week gone by in between", () => {
    const mid = (start.getTime() + end.getTime()) / 2;
    expect(payWeekElapsed(WEEK, mid)).toBeCloseTo(0.5, 6);
    expect(payWeekElapsed(WEEK, start.getTime())).toBe(0);
  });
});
