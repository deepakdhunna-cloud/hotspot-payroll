import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * These tests cover the input + permission gates around employees.delete.
 * The full cascade against MySQL is exercised by the integration runtime; here
 * we focus on the gates that run *before* hitting the database, which is what
 * a permission test legitimately needs to assert.
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

describe("employees.delete", () => {
  it("rejects an unauthenticated caller (no session)", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.employees.delete({ id: 1 })).rejects.toThrow();
  });

  it("rejects invalid input (non-integer id)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      // @ts-expect-error - validating the zod gate
      caller.employees.delete({ id: "not-a-number" }),
    ).rejects.toThrow();
  });

  it("returns NOT_FOUND when targeting a non-existent employee (passes auth, fails lookup)", async () => {
    // CEO session - skips the store-scope check and reaches the lookup step.
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.employees.delete({ id: 999999 })).rejects.toThrow(/not[_ ]?found/i);
  });
});
