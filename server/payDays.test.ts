import { describe, expect, it } from "vitest";
import {
  dayKey,
  payEndProblem,
  payPeriodOf,
  payWeekBounds,
  payWeekOf,
} from "@shared/hotspot";
import { buildWeekSheet, periodNote } from "@/lib/payrollSheet";
import { payrollStillOpen, periodElapsed } from "@/lib/payweek";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Payroll normally pays Thursday → Wednesday. When it has to go out early,
 * a week can END EARLY and the days it leaves off are paid with the next
 * week's payroll, which STARTS EARLY to take them in. Every punch must still
 * be paid exactly once: the two payrolls' instants have to meet exactly.
 *
 * The example is Thanksgiving 2026: the Nov 19 week (Thu Nov 19 – Wed Nov
 * 25) is paid on Wednesday Nov 25, so it pays through Tuesday Nov 24 and
 * Wednesday Nov 25 goes with the Nov 26 week's payroll.
 */
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOV19 = d("2026-11-19");
const NOV26 = d("2026-11-26");
const none = new Map<string, string>();
const thanksgiving = new Map([["2026-11-19", "2026-11-24"]]);

describe("the days a pay week's payroll pays", () => {
  it("is Thursday → Wednesday with nothing recorded, the same instants as the pay week", () => {
    const p = payPeriodOf(NOV19, none);
    expect(dayKey(p.firstDay)).toBe("2026-11-19");
    expect(dayKey(p.lastDay)).toBe("2026-11-25");
    expect(p.days).toBe(7);
    expect(p.endsEarly).toBe(false);
    expect(p.startsEarly).toBe(false);
    const bounds = payWeekBounds(NOV19);
    expect(p.start.toISOString()).toBe(bounds.start.toISOString());
    expect(p.end.toISOString()).toBe(bounds.end.toISOString());
  });

  it("a week ending early stops at the end of its last day (Chicago midnight)", () => {
    const p = payPeriodOf(NOV19, thanksgiving);
    expect(dayKey(p.lastDay)).toBe("2026-11-24");
    expect(p.days).toBe(6);
    expect(p.endsEarly).toBe(true);
    // Wed Nov 25 00:00 CST = 06:00Z.
    expect(p.end.toISOString()).toBe("2026-11-25T06:00:00.000Z");
  });

  it("the next week starts early to take the left-off day in", () => {
    const p = payPeriodOf(NOV26, thanksgiving);
    expect(dayKey(p.firstDay)).toBe("2026-11-25");
    expect(dayKey(p.lastDay)).toBe("2026-12-02");
    expect(p.days).toBe(8);
    expect(p.startsEarly).toBe(true);
    expect(p.endsEarly).toBe(false);
  });

  it("the two payrolls meet exactly, so no punch is paid twice or never", () => {
    const short = payPeriodOf(NOV19, thanksgiving);
    const long = payPeriodOf(NOV26, thanksgiving);
    expect(short.end.toISOString()).toBe(long.start.toISOString());
    expect(short.start.toISOString()).toBe(payWeekBounds(NOV19).start.toISOString());
    expect(long.end.toISOString()).toBe(payWeekBounds(NOV26).end.toISOString());
  });

  it("a shift that clocked in on Wednesday is paid next week; Tuesday night stays", () => {
    const short = payPeriodOf(NOV19, thanksgiving);
    const long = payPeriodOf(NOV26, thanksgiving);
    const inside = (t: Date, p: { start: Date; end: Date }) => t >= p.start && t < p.end;
    // Wed Nov 25, 9:00 AM CST — someone on the clock "today".
    const wedMorning = new Date("2026-11-25T15:00:00Z");
    expect(inside(wedMorning, short)).toBe(false);
    expect(inside(wedMorning, long)).toBe(true);
    // Tue Nov 24, 11:30 PM CST — the Tuesday closer.
    const tueNight = new Date("2026-11-25T05:30:00Z");
    expect(inside(tueNight, short)).toBe(true);
    expect(inside(tueNight, long)).toBe(false);
    // ...while the calendar week still puts Wednesday in the Nov 19 week.
    expect(dayKey(payWeekOf(wedMorning))).toBe("2026-11-19");
  });

  it("recording the Wednesday is just the normal week", () => {
    const p = payPeriodOf(NOV19, new Map([["2026-11-19", "2026-11-25"]]));
    expect(p.endsEarly).toBe(false);
    expect(p.days).toBe(7);
    expect(payPeriodOf(NOV26, new Map([["2026-11-19", "2026-11-25"]])).startsEarly).toBe(false);
  });

  it("ignores a recorded day outside the week instead of trusting it", () => {
    for (const bad of ["2026-11-18", "2026-11-26", "nonsense", ""]) {
      const ends = new Map([["2026-11-19", bad]]);
      expect(payPeriodOf(NOV19, ends).days).toBe(7);
      expect(payPeriodOf(NOV26, ends).days).toBe(7);
    }
  });

  it("works across the fall-back weekend (CDT → CST)", () => {
    // The Oct 29 week ends early on Sat Oct 31: Sun Nov 1 begins at 05:00Z
    // (midnight is still CDT that day).
    const ends = new Map([["2026-10-29", "2026-10-31"]]);
    const short = payPeriodOf(d("2026-10-29"), ends);
    const long = payPeriodOf(d("2026-11-05"), ends);
    expect(short.end.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(long.start.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(short.days).toBe(3);
    expect(long.days).toBe(11);
  });

  it("can end as early as the Thursday, never before it or after the Wednesday", () => {
    expect(payEndProblem(NOV19, d("2026-11-19"))).toBeNull();
    expect(payEndProblem(NOV19, d("2026-11-24"))).toBeNull();
    expect(payEndProblem(NOV19, d("2026-11-25"))).toBeNull();
    expect(payEndProblem(NOV19, d("2026-11-18"))).toMatch(/Thursday to its Wednesday/);
    expect(payEndProblem(NOV19, d("2026-11-26"))).toMatch(/Thursday to its Wednesday/);
  });
});

describe("screens treat an early-ended week as closed once its last day is over", () => {
  const short = payPeriodOf(NOV19, thanksgiving);

  it("is payable on Wednesday, though the calendar week is still running", () => {
    const wedNoon = new Date("2026-11-25T18:00:00Z").getTime();
    expect(payrollStillOpen(NOV19, short, wedNoon)).toBe(false);
    expect(periodElapsed(short, wedNoon)).toBe(1);
    // Without the days known, the calendar rule: still running.
    expect(payrollStillOpen(NOV19, null, wedNoon)).toBe(true);
  });

  it("is still open on Tuesday", () => {
    const tueNoon = new Date("2026-11-24T18:00:00Z").getTime();
    expect(payrollStillOpen(NOV19, short, tueNoon)).toBe(true);
    expect(periodElapsed(short, tueNoon)).toBeGreaterThan(0.8);
    expect(periodElapsed(short, tueNoon)).toBeLessThan(1);
  });
});

describe("the export says which days it pays", () => {
  const totals = { scheduled: 0, hours: 0, gross: 0 };

  it("names and labels an early-ended week by its days, with where the rest went", () => {
    const short = payPeriodOf(NOV19, thanksgiving);
    const file = buildWeekSheet({ weekStart: NOV19, period: short, scopeStore: null, rows: [], totals });
    expect(file.filename).toBe("Hotspot-Payroll-2026-11-19_to_2026-11-24-All-stores.xlsx");
    expect(file.title).toBe("Hotspot payroll · Nov 19 – Nov 24");
    expect(file.text).toContain("Wed, Nov 25 is paid with next week's payroll");
    expect(file.sheet.subtitle).toContain("Nov 19 – Nov 24, 2026");
  });

  it("says when a week takes in days from the week before", () => {
    const long = payPeriodOf(NOV26, thanksgiving);
    expect(periodNote(NOV26, long)).toBe("includes Wed, Nov 25 from last week");
    const file = buildWeekSheet({ weekStart: NOV26, period: long, scopeStore: null, rows: [], totals });
    expect(file.filename).toBe("Hotspot-Payroll-2026-11-25_to_2026-12-02-All-stores.xlsx");
  });

  it("a normal week's file is unchanged", () => {
    const file = buildWeekSheet({
      weekStart: NOV19,
      period: payPeriodOf(NOV19, none),
      scopeStore: null,
      rows: [],
      totals,
    });
    const legacy = buildWeekSheet({ weekStart: NOV19, scopeStore: null, rows: [], totals });
    expect(file.filename).toBe(legacy.filename);
    expect(file.title).toBe(legacy.title);
    expect(file.text).toBe(legacy.text);
    expect(file.sheet.subtitle).toBe(legacy.sheet.subtitle);
  });
});

/* ------------------- who can change the days, and to what ------------------- */

function ctxFor(who: "ceo" | "cfo" | string): TrpcContext {
  const session =
    who === "ceo"
      ? { scope: "ceo", role: "admin", store: null }
      : who === "cfo"
        ? { scope: "cfo", role: "cfo", store: null }
        : { scope: who, role: "manager", store: who };
  return {
    session: { ...session, issuedAt: Date.now() },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;
}
const caller = (who: string) => appRouter.createCaller(ctxFor(who));

describe("payroll.setDays", () => {
  const live = payWeekOf(new Date());
  const tuesday = new Date(live);
  tuesday.setUTCDate(tuesday.getUTCDate() + 5);

  it("a manager can't change another store's days, and the CFO can't change any", async () => {
    await expect(
      caller("Hotspot Market 11").payroll.setDays({
        weekStart: live,
        lastDay: tuesday,
        store: "Hotspot Market 13",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("cfo").payroll.setDays({ weekStart: live, lastDay: tuesday }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a manager may change their own store's days (it gets as far as saving)", async () => {
    // No database in tests: the write itself fails, after every check passed.
    await expect(
      caller("Hotspot Market 11").payroll.setDays({ weekStart: live, lastDay: tuesday }),
    ).rejects.toThrow(/Database unavailable/);
    await expect(
      caller("Hotspot Market 11").payroll.setDays({
        weekStart: live,
        lastDay: tuesday,
        store: "Hotspot Market 11",
      }),
    ).rejects.toThrow(/Database unavailable/);
  });

  it("refuses a last day outside the week", async () => {
    const nextThursday = new Date(live);
    nextThursday.setUTCDate(nextThursday.getUTCDate() + 7);
    await expect(
      caller("ceo").payroll.setDays({ weekStart: live, lastDay: nextThursday }),
    ).rejects.toThrow(/Thursday to its Wednesday/);
  });

  it("refuses to move days between payrolls that went out long ago", async () => {
    await expect(
      caller("ceo").payroll.setDays({ weekStart: d("2025-01-02"), lastDay: d("2025-01-06") }),
    ).rejects.toThrow(/paid a while ago/);
  });

  it("managers see their own store's days on payroll.week (no database: the normal week)", async () => {
    const res = await caller("Hotspot Market 11").payroll.week({ weekStart: NOV19 });
    expect(dayKey(res.period.firstDay)).toBe("2026-11-19");
    expect(dayKey(res.period.lastDay)).toBe("2026-11-25");
    expect(res.period.mixed).toBe(false);
    expect(res.periods.map((p) => p.store)).toEqual(["Hotspot Market 11"]);
  });
});
