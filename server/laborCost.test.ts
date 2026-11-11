/**
 * Labor cost agrees everywhere: for the same week and store, the manager
 * dashboard, the Executive view and the Finance estimate show the gross the
 * Payroll page shows — including for people on a standing set pay, who used
 * to be priced at clocked hours × their hourly rate on the dashboard.
 *
 * The procedures run for real against a small in-memory stand-in for the
 * tables they read (employees, payroll entries, time punches).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listEmployees: vi.fn(),
    getEmployeesByIds: vi.fn(),
    getPayrollByWeek: vi.fn(),
    getPayrollRange: vi.fn(),
    hoursWorkedForWeekBulk: vi.fn(),
    listOpenPunches: vi.fn(),
    listPunchesInRange: vi.fn(),
    getShiftsForWeek: vi.fn(async () => []),
  };
});

import { weekPay } from "../shared/weekPay";
import type { TrpcContext } from "./_core/context";
import {
  getEmployeesByIds,
  getPayrollByWeek,
  getPayrollRange,
  hoursWorkedForWeekBulk,
  listEmployees,
  listOpenPunches,
  listPunchesInRange,
} from "./db";
import { buildPortalSummary } from "./portalPage";
import { appRouter } from "./routers";

const STORE = "Hotspot Market 11";
const OTHER_STORE = "Hotspot Market 13";

// Wednesday Aug 26, 2026, 1:00 PM in the stores' time zone.
const NOW = new Date("2026-08-26T18:00:00.000Z");
/** The pay week in progress (Thu Aug 20 – Wed Aug 26). */
const LIVE_WEEK = new Date("2026-08-20T00:00:00.000Z");
/** The last closed pay week (Thu Aug 13 – Wed Aug 19). */
const CLOSED_WEEK = new Date("2026-08-13T00:00:00.000Z");
/** The closed week before that — nothing happens in it. */
const QUIET_WEEK = new Date("2026-08-06T00:00:00.000Z");

/* ------------------------------ the roster ------------------------------ */

const CASHIER = {
  id: 1,
  fullName: "Casey Till",
  phone: "555-0101",
  role: "Cashier",
  storeLocation: STORE,
  payRate: "16.00",
  weeklyPay: null as string | null,
  clockCodeHash: null,
  active: 1,
};
/** Standing set pay: $1,100 a week, with $24/h still on file. */
const MANAGER = {
  id: 2,
  fullName: "Morgan Lead",
  phone: "555-0102",
  role: "Manager",
  storeLocation: STORE,
  payRate: "24.00",
  weeklyPay: "1100.00" as string | null,
  clockCodeHash: null,
  active: 1,
};

type Employee = typeof CASHIER;
type Punch = {
  id: number;
  employeeId: number;
  storeLocation: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  note: string | null;
};
type Entry = {
  id: number;
  employeeId: number;
  storeLocation: string;
  weekStart: Date;
  hoursWorked: string;
  scheduledHours: string;
  payRateSnapshot: string;
  regularPay: string;
  overtimePay: string;
  grossPay: string;
  notes: string | null;
};

const world = {
  employees: [] as Employee[],
  entries: [] as Entry[],
  punches: [] as Punch[],
};

let nextId = 1;
function punch(emp: Employee, inIso: string, outIso: string | null): Punch {
  return {
    id: nextId++,
    employeeId: emp.id,
    storeLocation: emp.storeLocation,
    clockInAt: new Date(inIso),
    clockOutAt: outIso ? new Date(outIso) : null,
    note: null,
  };
}
/** A payroll entry the way payroll.saveHours writes it. */
function saved(
  emp: Employee,
  week: Date,
  hours: number,
  opts: { rate?: number; fixedGross?: number; notes?: string } = {},
): Entry {
  const rate = opts.rate ?? Number(emp.payRate);
  const gross = opts.fixedGross ?? hours * rate;
  return {
    id: nextId++,
    employeeId: emp.id,
    storeLocation: emp.storeLocation,
    weekStart: week,
    hoursWorked: hours.toFixed(2),
    scheduledHours: "0.00",
    payRateSnapshot: rate.toFixed(2),
    regularPay: gross.toFixed(2),
    overtimePay: "0.00",
    grossPay: gross.toFixed(2),
    notes: opts.notes ?? (opts.fixedGross !== undefined ? "fixed-pay" : null),
  };
}

/** Closed week: the cashier clocked 38.5 h. */
const cashierClosedWeek = () => [
  punch(CASHIER, "2026-08-14T14:00:00Z", "2026-08-14T22:00:00Z"),
  punch(CASHIER, "2026-08-15T14:00:00Z", "2026-08-15T22:00:00Z"),
  punch(CASHIER, "2026-08-16T14:00:00Z", "2026-08-16T22:00:00Z"),
  punch(CASHIER, "2026-08-17T14:00:00Z", "2026-08-17T22:00:00Z"),
  punch(CASHIER, "2026-08-18T14:00:00Z", "2026-08-18T20:30:00Z"),
];
/** Closed week: the manager clocked 22 h 55 min (22.92 h) — $550 at $24/h. */
const managerClosedWeek = () => [
  punch(MANAGER, "2026-08-14T13:00:00Z", "2026-08-15T01:00:00Z"),
  punch(MANAGER, "2026-08-16T13:00:00Z", "2026-08-16T23:55:00Z"),
];

const inStores = (store: string, stores?: string[]) =>
  !stores || stores.length === 0 || stores.includes(store);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  world.employees = [CASHIER, MANAGER];
  world.entries = [];
  world.punches = [...cashierClosedWeek(), ...managerClosedWeek()];

  vi.mocked(listEmployees).mockImplementation(async filter =>
    world.employees.filter(
      e =>
        (filter?.activeOnly === false || e.active === 1) &&
        inStores(e.storeLocation, filter?.stores),
    ) as any,
  );
  vi.mocked(getEmployeesByIds).mockImplementation(
    async ids => world.employees.filter(e => ids.includes(e.id)) as any,
  );
  vi.mocked(getPayrollByWeek).mockImplementation(
    async (week, stores) =>
      world.entries.filter(
        e =>
          e.weekStart.getTime() === week.getTime() &&
          inStores(e.storeLocation, stores),
      ) as any,
  );
  vi.mocked(getPayrollRange).mockImplementation(
    async (start, end, stores) =>
      world.entries.filter(
        e =>
          e.weekStart.getTime() >= start.getTime() &&
          e.weekStart.getTime() <= end.getTime() &&
          inStores(e.storeLocation, stores),
      ) as any,
  );
  vi.mocked(listPunchesInRange).mockImplementation(
    async (start, end, stores) =>
      world.punches.filter(
        p =>
          p.clockInAt.getTime() >= start.getTime() &&
          p.clockInAt.getTime() < end.getTime() &&
          inStores(p.storeLocation, stores),
      ) as any,
  );
  vi.mocked(listOpenPunches).mockImplementation(
    async stores =>
      world.punches.filter(
        p => !p.clockOutAt && inStores(p.storeLocation, stores),
      ) as any,
  );
  // Same arithmetic as the real query: punches that START in the window,
  // an open punch counted up to now (never past the window's end).
  vi.mocked(hoursWorkedForWeekBulk).mockImplementation(
    async (start, end, stores, now = new Date()) => {
      const hours = new Map<number, number>();
      const openCap = Math.min(now.getTime(), end.getTime());
      for (const p of world.punches) {
        const inAt = p.clockInAt.getTime();
        if (inAt < start.getTime() || inAt >= end.getTime()) continue;
        if (!inStores(p.storeLocation, stores)) continue;
        const outAt = p.clockOutAt ? p.clockOutAt.getTime() : openCap;
        if (outAt <= inAt) continue;
        hours.set(
          p.employeeId,
          (hours.get(p.employeeId) ?? 0) + (outAt - inAt) / 3_600_000,
        );
      }
      return hours;
    },
  );
});

/* ------------------------------- sessions ------------------------------- */

function callerFor(scope: "ceo" | "cfo" | typeof STORE) {
  const session =
    scope === "ceo"
      ? { scope, role: "admin", store: null }
      : scope === "cfo"
        ? { scope, role: "cfo", store: null }
        : { scope, role: "manager", store: scope };
  return appRouter.createCaller({
    session: { ...session, issuedAt: Date.now() },
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext);
}
type Caller = ReturnType<typeof callerFor>;

/**
 * The Payroll page's numbers for a week: it loads payroll.week and
 * clock.weekHoursBulk, opens every row from the shared week rule and sums
 * the rows' gross. (server/weekPay.test.ts pins the grid's own arithmetic
 * to that rule.)
 */
async function payrollPage(caller: Caller, weekStart: Date, store?: string) {
  const input = { weekStart, store: store as any };
  const [week, clock] = await Promise.all([
    caller.payroll.week(input),
    caller.clock.weekHoursBulk(input),
  ]);
  const clockByEmp = new Map(clock.entries.map(e => [e.employeeId, e.hours]));
  const rows = week.employees.map(row => ({
    id: row.employee.id,
    gross: weekPay({
      entry: row.entry,
      clockHours: clockByEmp.get(row.employee.id),
      payRate: row.employee.payRate,
      weeklyPay: row.employee.weeklyPay,
    }).gross,
  }));
  return {
    rows,
    byId: new Map(rows.map(r => [r.id, r.gross])),
    total: rows.reduce((sum, r) => sum + r.gross, 0),
  };
}

const laborById = (employees: { id: number; laborCost: number }[]) =>
  new Map(employees.map(e => [e.id, e.laborCost]));

/* ------------------------------ dashboard ------------------------------ */

describe("dashboard.summary labor cost — one hourly and one set-pay employee", () => {
  it("prices the set-pay manager at the weekly amount, not clocked hours × rate", async () => {
    const summary = await callerFor(STORE).dashboard.summary({
      weekStart: CLOSED_WEEK,
    });

    const labor = laborById(summary.employees);
    expect(labor.get(CASHIER.id)).toBe(616); // 38.5 h × $16
    expect(labor.get(MANAGER.id)).toBe(1100); // not 22.92 h × $24 ≈ $550

    expect(summary.byStore[STORE].totalGross).toBeCloseTo(1716, 6);
    expect(summary.totals.totalGross).toBeCloseTo(1716, 6);
    // Hours still come straight from the clock.
    expect(summary.totals.totalHours).toBeCloseTo(38.5 + 22 + 55 / 60, 6);
    // Nothing is saved yet, so nothing is reported as saved payroll.
    expect(summary.totals.totalSavedGross).toBe(0);
  });

  it("equals the Payroll page's gross, row by row and in total", async () => {
    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);

    expect(page.total).toBeCloseTo(1716, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
    expect(laborById(summary.employees)).toEqual(page.byId);
  });

  it("keeps the per-store split for the CEO's all-stores view", async () => {
    const elsewhere = {
      ...CASHIER,
      id: 3,
      fullName: "Sam Cook",
      storeLocation: OTHER_STORE,
      payRate: "15.00",
    };
    world.employees = [CASHIER, MANAGER, elsewhere];
    world.punches.push(
      punch(elsewhere, "2026-08-14T14:00:00Z", "2026-08-14T20:00:00Z"),
    );

    const caller = callerFor("ceo");
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    expect(summary.byStore[STORE].totalGross).toBeCloseTo(1716, 6);
    expect(summary.byStore[OTHER_STORE].totalGross).toBeCloseTo(90, 6);
    expect(summary.totals.totalGross).toBeCloseTo(1806, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);

    // Focused on one store, both pages narrow to the same people.
    const [focused, focusedPage] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK, store: STORE }),
      payrollPage(caller, CLOSED_WEEK, STORE),
    ]);
    expect(focused.totals.totalGross).toBeCloseTo(1716, 6);
    expect(focused.totals.totalGross).toBeCloseTo(focusedPage.total, 6);
  });

  it("counts set pay in full even when the manager never clocked in", async () => {
    world.punches = cashierClosedWeek();

    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    expect(laborById(summary.employees).get(MANAGER.id)).toBe(1100);
    expect(summary.totals.totalGross).toBeCloseTo(1716, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
  });

  it("uses the saved gross once a week is saved", async () => {
    world.entries = [
      // Saved at 40 h although the clock says 38.5 h.
      saved(CASHIER, CLOSED_WEEK, 40),
      // Saved as $900 set pay that week, not the standing $1,100.
      saved(MANAGER, CLOSED_WEEK, 22.92, { fixedGross: 900 }),
    ];

    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    const labor = laborById(summary.employees);
    expect(labor.get(CASHIER.id)).toBe(640);
    expect(labor.get(MANAGER.id)).toBe(900);
    expect(summary.totals.totalGross).toBeCloseTo(1540, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
    // Fully saved: labor cost and saved payroll are the same money.
    expect(summary.totals.totalSavedGross).toBeCloseTo(1540, 6);
  });

  it("mixes saved and unsaved rows the way the Payroll page does", async () => {
    // Only the cashier is saved; the manager's row is still open.
    world.entries = [saved(CASHIER, CLOSED_WEEK, 40)];

    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    expect(summary.totals.totalGross).toBeCloseTo(640 + 1100, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
    expect(summary.totals.totalSavedGross).toBeCloseTo(640, 6);
  });

  it("does not treat schedule placeholders as saved payroll", async () => {
    world.entries = [
      saved(CASHIER, CLOSED_WEEK, 0, { notes: "schedule-only" }),
      saved(MANAGER, CLOSED_WEEK, 0, { notes: "schedule-only" }),
    ];

    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    expect(summary.totals.totalGross).toBeCloseTo(1716, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
  });

  it("reports labor cost so far for the week in progress", async () => {
    // Live week: the cashier worked 8 h yesterday and has been on the
    // clock for 4 h today; the manager has not clocked in yet.
    world.punches = [
      punch(CASHIER, "2026-08-25T14:00:00Z", "2026-08-25T22:00:00Z"),
      punch(CASHIER, "2026-08-26T14:00:00Z", null),
    ];

    const caller = callerFor(STORE);
    const [summary, page] = await Promise.all([
      caller.dashboard.summary(),
      payrollPage(caller, LIVE_WEEK),
    ]);
    expect(summary.weekStart.getTime()).toBe(LIVE_WEEK.getTime());
    const labor = laborById(summary.employees);
    expect(labor.get(CASHIER.id)).toBe(192); // 12 h × $16
    expect(labor.get(MANAGER.id)).toBe(1100);
    expect(summary.totals.totalGross).toBeCloseTo(1292, 6);
    expect(summary.totals.totalGross).toBeCloseTo(page.total, 6);
    // The projection has always counted set pay flat; the cost so far can
    // no longer run below it for a salaried store.
    expect(summary.totals.totalProjectedGross).toBeGreaterThanOrEqual(
      summary.totals.totalGross - 1e-6,
    );
  });
});

/* ---------------------------- Executive view ---------------------------- */

describe("ceo.weekly labor cost", () => {
  it("gives every row the Payroll page's gross", async () => {
    const caller = callerFor("ceo");
    const [weekly, page] = await Promise.all([
      caller.ceo.weekly({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    const labor = laborById(weekly.rows);
    expect(labor.get(CASHIER.id)).toBe(616);
    expect(labor.get(MANAGER.id)).toBe(1100);
    expect(labor).toEqual(page.byId);
    // Saved-payroll figures are untouched: nothing is saved yet.
    expect(weekly.grand.totalGross).toBe(0);
  });

  it("covers a former employee's final week, like the Payroll page", async () => {
    world.employees = [CASHIER, { ...MANAGER, active: 0 }];

    const caller = callerFor("ceo");
    const [weekly, page] = await Promise.all([
      caller.ceo.weekly({ weekStart: CLOSED_WEEK }),
      payrollPage(caller, CLOSED_WEEK),
    ]);
    expect(page.rows).toHaveLength(2);
    expect(laborById(weekly.rows)).toEqual(page.byId);
    expect(laborById(weekly.rows).get(MANAGER.id)).toBe(1100);
  });
});

/* ---------------------------- Finance estimate --------------------------- */

describe("cfo.summary estimate for a week that was never finalized", () => {
  const weekOf = <T extends { weekStart: Date }>(weeks: T[], week: Date) =>
    weeks.find(w => new Date(w.weekStart).getTime() === week.getTime())!;

  it("estimates set pay in full and hourly people from the clock", async () => {
    const caller = callerFor("cfo");
    const [cfo, dashboard] = await Promise.all([
      caller.cfo.summary({ weeks: 3 }),
      caller.dashboard.summary({ weekStart: CLOSED_WEEK }),
    ]);
    const week = weekOf(cfo.weeks, CLOSED_WEEK);
    expect(week.estimated).toBe(true);
    expect(week.gross).toBeCloseTo(1716, 6);
    expect(week.byStore[STORE].gross).toBeCloseTo(1716, 6);
    expect(week.peoplePaid).toBe(2);
    // One rule: the estimate is the dashboard's labor cost for that week.
    expect(week.gross).toBeCloseTo(dashboard.totals.totalGross, 6);

    expect(cfo.latestWeekPeople).toEqual(
      expect.arrayContaining([
        { role: "Cashier", hours: 38.5, gross: 616 },
        expect.objectContaining({ role: "Manager", gross: 1100 }),
      ]),
    );
  });

  it("still counts a set-pay manager who never clocked in", async () => {
    world.punches = cashierClosedWeek();

    const cfo = await callerFor("cfo").cfo.summary({ weeks: 3 });
    const week = weekOf(cfo.weeks, CLOSED_WEEK);
    expect(week.estimated).toBe(true);
    expect(week.gross).toBeCloseTo(1716, 6);
    expect(week.hours).toBeCloseTo(38.5, 6);
    expect(week.peoplePaid).toBe(2);
    expect(cfo.latestWeekPeople).toContainEqual({
      role: "Manager",
      hours: 0,
      gross: 1100,
    });
  });

  it("leaves a week with no clocked time empty instead of inventing set pay", async () => {
    const cfo = await callerFor("cfo").cfo.summary({ weeks: 3 });
    const quiet = weekOf(cfo.weeks, QUIET_WEEK);
    expect(quiet.gross).toBe(0);
    expect(quiet.estimated).toBe(false);
    expect(quiet.peoplePaid).toBe(0);
  });

  it("switches to the saved payroll once the week is saved", async () => {
    world.entries = [
      saved(CASHIER, CLOSED_WEEK, 40),
      saved(MANAGER, CLOSED_WEEK, 22.92, { fixedGross: 1100 }),
    ];

    const cfo = await callerFor("cfo").cfo.summary({ weeks: 3 });
    const week = weekOf(cfo.weeks, CLOSED_WEEK);
    expect(week.estimated).toBe(false);
    expect(week.gross).toBeCloseTo(1740, 6);
  });
});

/* ------------------------------ live portal ------------------------------ */

describe("portal summary labor cost", () => {
  it("counts set pay in full for the week in progress", async () => {
    world.punches = [
      punch(CASHIER, "2026-08-25T14:00:00Z", "2026-08-25T22:00:00Z"),
      punch(MANAGER, "2026-08-25T13:00:00Z", "2026-08-25T23:00:00Z"),
    ];

    const [portal, dashboard] = await Promise.all([
      buildPortalSummary(NOW),
      callerFor("ceo").dashboard.summary(),
    ]);
    const store = portal.stores.find(s => s.store === STORE)!;
    expect(store.weekLaborCost).toBe(128 + 1100); // 8 h × $16, plus set pay
    expect(portal.totals.weekLaborCost).toBe(1228);
    expect(portal.totals.weekLaborCost).toBeCloseTo(
      dashboard.totals.totalGross,
      6,
    );
  });
});
