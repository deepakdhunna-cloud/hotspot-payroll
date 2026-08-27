import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listEmployees: vi.fn(async () => []),
  listOpenPunches: vi.fn(async () => []),
  listPunchesInRange: vi.fn(async () => []),
  hoursWorkedForWeekBulk: vi.fn(async () => new Map()),
  getPayrollByWeek: vi.fn(async () => []),
  getShiftsForWeek: vi.fn(async () => []),
  getAttentionByRefKeys: vi.fn(async () => []),
  insertAttentionItems: vi.fn(async () => {}),
  listAttentionItems: vi.fn(async () => []),
  reopenAttentionItems: vi.fn(async () => {}),
  resolveAttentionItems: vi.fn(async () => {}),
  updateAttentionText: vi.fn(async () => {}),
  closePunchIfOpen: vi.fn(async () => false),
  getAppSetting: vi.fn(async () => undefined),
  getEmployeeById: vi.fn(async () => undefined),
  logAudit: vi.fn(async () => {}),
}));

import {
  buildPortalSummary,
  portalPageAllowed,
  renderPortalAccessPage,
  renderPortalDashboardPage,
} from "./portalPage";
import {
  hoursWorkedForWeekBulk,
  listEmployees,
  listOpenPunches,
  listPunchesInRange,
} from "./db";

describe("portal page access", () => {
  it("denies without a configured token, no matter the key", () => {
    expect(portalPageAllowed("anything", undefined)).toBe(false);
    expect(portalPageAllowed(undefined, undefined)).toBe(false);
  });

  it("requires the exact key, timing-safe", () => {
    expect(portalPageAllowed("right-key", "right-key")).toBe(true);
    expect(portalPageAllowed("wrong-key", "right-key")).toBe(false);
    expect(portalPageAllowed("right-key-longer", "right-key")).toBe(false);
    expect(portalPageAllowed(undefined, "right-key")).toBe(false);
    expect(portalPageAllowed("", "right-key")).toBe(false);
  });
});

describe("portal summary", () => {
  // Wednesday 2026-08-26 18:00 UTC — inside the pay week starting Thu 08-20.
  const NOW = new Date("2026-08-26T18:00:00.000Z");

  const employees = [
    {
      id: 1,
      fullName: "Amrit Kaur",
      role: "Manager",
      storeLocation: "Hotspot Market 11",
      payRate: "20.00",
      phone: "555-0000",
      clockCodeHash: "secret-hash",
      active: 1,
    },
    {
      id: 2,
      fullName: "Jo Cook",
      role: "Cook",
      storeLocation: "Hotspot Market 11",
      payRate: "15.50",
      phone: "555-1111",
      clockCodeHash: null,
      active: 1,
    },
    {
      id: 3,
      fullName: "Sam Till",
      role: "Cashier",
      storeLocation: "Hotspot Market 13",
      payRate: "14.00",
      phone: "555-2222",
      clockCodeHash: null,
      active: 1,
    },
  ] as any[];

  beforeEach(() => {
    vi.mocked(listEmployees).mockResolvedValue(employees);
    vi.mocked(listOpenPunches).mockResolvedValue([
      {
        id: 10,
        employeeId: 1,
        storeLocation: "Hotspot Market 11",
        clockInAt: new Date("2026-08-26T14:00:00.000Z"),
        clockOutAt: null,
      },
      // Orphan punch (employee no longer active/known) must not crash.
      {
        id: 11,
        employeeId: 999,
        storeLocation: "Hotspot Market 11",
        clockInAt: new Date("2026-08-26T15:00:00.000Z"),
        clockOutAt: null,
      },
    ] as any[]);
    vi.mocked(hoursWorkedForWeekBulk).mockResolvedValue(
      new Map([
        [1, 10],
        [2, 4],
        [3, 8],
      ]),
    );
    vi.mocked(listPunchesInRange).mockResolvedValue([
      // Market 13's newest punch is 3 days old → silent.
      {
        id: 20,
        employeeId: 3,
        storeLocation: "Hotspot Market 13",
        clockInAt: new Date("2026-08-23T14:00:00.000Z"),
        clockOutAt: new Date("2026-08-23T20:00:00.000Z"),
      },
    ] as any[]);
  });

  it("aggregates per store and in totals", async () => {
    const summary = await buildPortalSummary(NOW);

    expect(summary.weekStartIso).toBe("2026-08-20T00:00:00.000Z");

    const m11 = summary.stores.find((s) => s.store === "Hotspot Market 11")!;
    expect(m11.clockedIn).toEqual([
      {
        name: "Amrit Kaur",
        role: "Manager",
        sinceIso: "2026-08-26T14:00:00.000Z",
      },
    ]);
    expect(m11.weekHours).toBe(14);
    expect(m11.weekLaborCost).toBe(10 * 20 + 4 * 15.5);
    // The open punch counts as feed activity → reporting.
    expect(m11.reporting).toBe(true);

    const m13 = summary.stores.find((s) => s.store === "Hotspot Market 13")!;
    expect(m13.clockedIn).toEqual([]);
    expect(m13.weekHours).toBe(8);
    expect(m13.reporting).toBe(false);
    expect(m13.lastPunchIso).toBe("2026-08-23T20:00:00.000Z");

    // Stores with no staff and no punches still appear, all-zero.
    const travel = summary.stores.find(
      (s) => s.store === "Hotspot Travel Center",
    )!;
    expect(travel.weekHours).toBe(0);
    expect(travel.lastPunchIso).toBeNull();

    expect(summary.totals.clockedInNow).toBe(1);
    expect(summary.totals.weekHours).toBe(22);
    expect(summary.totals.weekLaborCost).toBe(262 + 8 * 14);
    expect(summary.totals.storesReporting).toBe(1);
    expect(summary.totals.storeCount).toBe(4);
  });

  it("never leaks pay rates, phones, or hashes", async () => {
    const json = JSON.stringify(await buildPortalSummary(NOW));
    expect(json).not.toContain("payRate");
    expect(json).not.toContain("20.00");
    expect(json).not.toContain("555-");
    expect(json).not.toContain("secret-hash");
    expect(json).not.toContain("phone");
  });
});

describe("portal pages", () => {
  it("every page refuses indexing and the dashboard fetches its data endpoint", () => {
    for (const html of [renderPortalDashboardPage(), renderPortalAccessPage()]) {
      expect(html).toContain('name="robots"');
      expect(html).toContain('name="referrer"');
    }
    expect(renderPortalDashboardPage()).toContain("/portal/data");
  });
});
