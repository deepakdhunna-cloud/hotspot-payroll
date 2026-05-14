import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Permission + input-validation gates around clock.* procedures.
 *
 * We focus on the gates that run *before* the database is hit (zod validation
 * + scope checks). The full DB path is exercised by the integration runtime.
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

describe("clock.setCode input validation", () => {
  it("rejects non-4-digit codes via zod", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.clock.setCode({ employeeId: 1, code: "12" }),
    ).rejects.toThrow();
    await expect(
      caller.clock.setCode({ employeeId: 1, code: "12345" }),
    ).rejects.toThrow();
    await expect(
      caller.clock.setCode({ employeeId: 1, code: "abcd" }),
    ).rejects.toThrow();
  });

  it("accepts empty string as the clear-code sentinel", async () => {
    // Targets a non-existent employee on purpose: we want to confirm zod
    // accepts "" and the procedure progresses past validation to the
    // employee lookup, which then throws NOT_FOUND.
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.clock.setCode({ employeeId: 999999, code: "" }),
    ).rejects.toThrow(/not[_ ]?found/i);
  });
});

describe("clock.punch input validation", () => {
  it("rejects an unknown store via zod", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.clock.punch({
        // @ts-expect-error invalid by design
        store: "Not A Real Store",
        code: "1234",
      }),
    ).rejects.toThrow();
  });

  it("rejects codes that aren't exactly 4 digits", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.clock.punch({
        store: "Hotspot Market 11",
        code: "12",
      }),
    ).rejects.toThrow();
  });
});

describe("clock.createManual validation", () => {
  it("rejects when clockOut is not strictly after clockIn", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    const t = new Date("2026-05-14T12:00:00Z");
    await expect(
      caller.clock.createManual({
        employeeId: 1,
        clockInAt: t,
        clockOutAt: t, // same instant — must fail
      }),
    ).rejects.toThrow(/after clock-in/i);

    await expect(
      caller.clock.createManual({
        employeeId: 1,
        clockInAt: t,
        clockOutAt: new Date(t.getTime() - 60_000), // earlier than clock-in
      }),
    ).rejects.toThrow(/after clock-in/i);
  });
});

describe("clock.update validation", () => {
  it("rejects when proposed clockOut is not strictly after proposed clockIn", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    const t = new Date("2026-05-14T12:00:00Z");
    await expect(
      caller.clock.update({
        id: 1,
        clockInAt: t,
        clockOutAt: new Date(t.getTime() - 1),
      }),
    ).rejects.toThrow(/after clock-in/i);
  });

  it("rejects unauthenticated callers", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.clock.update({ id: 1 })).rejects.toThrow();
  });
});

describe("clock.delete authorization", () => {
  it("rejects unauthenticated callers", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.clock.delete({ id: 1 })).rejects.toThrow();
  });

  it("returns NOT_FOUND when targeting a non-existent punch (CEO bypasses store-scope)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.clock.delete({ id: 999999 })).rejects.toThrow(
      /not[_ ]?found/i,
    );
  });
});
