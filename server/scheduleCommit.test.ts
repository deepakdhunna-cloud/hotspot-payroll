import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Gates around schedule.commit (zod validation + auth + scope skipping).
 * With no DATABASE_URL, db helpers return empty sets, so every entry is
 * skipped — which also exercises the skip-accounting path.
 */
function ctxFor(store: string | null): TrpcContext {
  return {
    session: {
      scope: store ?? "ceo",
      role: store ? "manager" : "admin",
      store,
      issuedAt: Date.now(),
    },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;
}

const WEEK = new Date("2026-05-07T00:00:00Z");

describe("schedule.commit", () => {
  it("rejects unauthenticated callers", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.schedule.commit({
        weekStart: WEEK,
        entries: [{ employeeId: 1, scheduledHours: 8 }],
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty entries array via zod", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.schedule.commit({ weekStart: WEEK, entries: [] }),
    ).rejects.toThrow();
  });

  it("rejects out-of-range scheduled hours and shift hours", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.schedule.commit({
        weekStart: WEEK,
        entries: [{ employeeId: 1, scheduledHours: 200 }],
      }),
    ).rejects.toThrow();
    await expect(
      caller.schedule.commit({
        weekStart: WEEK,
        entries: [
          {
            employeeId: 1,
            scheduledHours: 8,
            shifts: [{ date: WEEK, hours: 30 }],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("skips employees that cannot be found (no partial writes)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    const result = await caller.schedule.commit({
      weekStart: WEEK,
      entries: [
        { employeeId: 111, scheduledHours: 8 },
        { employeeId: 222, scheduledHours: 12 },
      ],
    });
    expect(result.saved).toBe(0);
    expect(result.skipped).toEqual([111, 222]);
  });
});

describe("schedule.week / schedule.imports scope gates", () => {
  it("rejects unauthenticated callers", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.schedule.week({ weekStart: WEEK })).rejects.toThrow();
    await expect(caller.schedule.imports()).rejects.toThrow();
  });

  it("returns empty shifts for a manager scope with no data", async () => {
    const caller = appRouter.createCaller(ctxFor("Hotspot Market 11"));
    const result = await caller.schedule.week({ weekStart: WEEK });
    expect(result.shifts).toEqual([]);
    expect(result.weekStart.toISOString()).toBe(WEEK.toISOString());
  });
});

describe("ceo.auditLog authorization", () => {
  it("rejects manager sessions", async () => {
    const caller = appRouter.createCaller(ctxFor("Hotspot Market 11"));
    await expect(caller.ceo.auditLog()).rejects.toThrow(/permission/i);
  });

  it("returns an array for the CEO (empty without a database)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.ceo.auditLog()).resolves.toEqual([]);
  });
});
