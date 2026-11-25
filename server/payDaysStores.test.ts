import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Each store can end its own week early. These check how the recorded
 * choices combine — the all-stores one, each store's own — and that hours
 * are counted over each store's own days. The database is mocked: the
 * settings rows and the clock-hours query.
 */
vi.mock("./db", () => ({
  getAppSettings: vi.fn(),
  hoursWorkedForWeekBulk: vi.fn(),
}));

import * as db from "./db";
import { hoursForPeriods, storePayEndKey, storePeriods } from "./payPeriods";
import { dayKey, payEndKey, spanOfPeriods } from "@shared/hotspot";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOV19 = d("2026-11-19");
const NOV26 = d("2026-11-26");
const HM11 = "Hotspot Market 11";
const HM13 = "Hotspot Market 13";

/** Answer getAppSettings from a fixed set of rows. */
function settings(rows: Record<string, string>) {
  vi.mocked(db.getAppSettings).mockImplementation(async (keys: string[]) => {
    const m = new Map<string, string>();
    for (const k of keys) if (rows[k] !== undefined) m.set(k, rows[k]);
    return m;
  });
}
const days = (p: { firstDay: Date; lastDay: Date }) =>
  `${dayKey(p.firstDay)}..${dayKey(p.lastDay)}`;

beforeEach(() => vi.clearAllMocks());

describe("each store's days", () => {
  it("with nothing recorded, every store pays its normal week", async () => {
    settings({});
    const m = await storePeriods(NOV19, [HM11, HM13]);
    expect(days(m.get(HM11)!)).toBe("2026-11-19..2026-11-25");
    expect(days(m.get(HM13)!)).toBe("2026-11-19..2026-11-25");
  });

  it("the CEO's all-stores choice applies to every store", async () => {
    settings({ [payEndKey(NOV19)]: "2026-11-24" });
    const m = await storePeriods(NOV19, [HM11, HM13]);
    expect(days(m.get(HM11)!)).toBe("2026-11-19..2026-11-24");
    expect(days(m.get(HM13)!)).toBe("2026-11-19..2026-11-24");
  });

  it("a store's own choice affects only that store", async () => {
    settings({ [storePayEndKey(NOV19, HM11)]: "2026-11-24" });
    const m = await storePeriods(NOV19, [HM11, HM13]);
    expect(days(m.get(HM11)!)).toBe("2026-11-19..2026-11-24");
    expect(days(m.get(HM13)!)).toBe("2026-11-19..2026-11-25");
    // ...and only that store's next week starts early.
    const next = await storePeriods(NOV26, [HM11, HM13]);
    expect(days(next.get(HM11)!)).toBe("2026-11-25..2026-12-02");
    expect(days(next.get(HM13)!)).toBe("2026-11-26..2026-12-02");
  });

  it("a store's own choice wins over the all-stores one — the Wednesday keeps it normal", async () => {
    settings({
      [payEndKey(NOV19)]: "2026-11-24",
      [storePayEndKey(NOV19, HM13)]: "2026-11-25",
      [storePayEndKey(NOV19, HM11)]: "2026-11-23",
    });
    const m = await storePeriods(NOV19, [HM11, HM13, "Hotspot Market 14"]);
    expect(days(m.get(HM11)!)).toBe("2026-11-19..2026-11-23");
    expect(days(m.get(HM13)!)).toBe("2026-11-19..2026-11-25");
    expect(days(m.get("Hotspot Market 14")!)).toBe("2026-11-19..2026-11-24");
  });

  it("an all-stores view spans every store's days and says they differ", async () => {
    settings({ [storePayEndKey(NOV19, HM11)]: "2026-11-24" });
    const m = await storePeriods(NOV19, [HM11, HM13]);
    const span = spanOfPeriods(NOV19, [m.get(HM11)!, m.get(HM13)!]);
    expect(span.mixed).toBe(true);
    expect(days(span)).toBe("2026-11-19..2026-11-25");
    // It ends when the LAST store's days end.
    expect(span.end.toISOString()).toBe(m.get(HM13)!.end.toISOString());
    expect(spanOfPeriods(NOV19, [m.get(HM13)!, m.get(HM13)!]).mixed).toBe(false);
  });

  it("keeps a long store name's key within the 64-character limit, and stable", () => {
    const long = "Hotspot Market Downtown Riverside Travel Plaza 2";
    const key = storePayEndKey(NOV19, long);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toBe(storePayEndKey(NOV19, long));
    expect(key).not.toBe(storePayEndKey(NOV19, `${long}x`));
    expect(storePayEndKey(NOV19, HM11)).toBe("payend:2026-11-19:Hotspot Market 11");
  });
});

describe("hours over each store's own days", () => {
  it("reads stores sharing their days together, and adds the rest separately", async () => {
    settings({ [storePayEndKey(NOV19, HM11)]: "2026-11-24" });
    const m = await storePeriods(NOV19, [HM11, HM13, "Hotspot Market 14"]);
    vi.mocked(db.hoursWorkedForWeekBulk).mockImplementation(async (_s, _e, stores) =>
      stores?.includes(HM11) ? new Map([[1, 40]]) : new Map([[2, 20], [1, 2.5]]),
    );
    const hours = await hoursForPeriods(m);
    const calls = vi.mocked(db.hoursWorkedForWeekBulk).mock.calls;
    expect(calls).toHaveLength(2);
    const short = calls.find((c) => c[2]?.includes(HM11))!;
    expect(short[2]).toEqual([HM11]);
    expect(short[1].toISOString()).toBe("2026-11-25T06:00:00.000Z");
    const normal = calls.find((c) => !c[2]?.includes(HM11))!;
    expect(normal[2]).toEqual([HM13, "Hotspot Market 14"]);
    expect(normal[1].toISOString()).toBe("2026-11-26T06:00:00.000Z");
    expect(hours.get(1)).toBe(42.5);
    expect(hours.get(2)).toBe(20);
  });
});
