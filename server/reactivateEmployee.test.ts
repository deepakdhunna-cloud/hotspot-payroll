import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Gates around employees.reactivate (the undo for deactivate) and the
 * includeInactive option on employees.list. Like the delete tests, these
 * assert what runs before the database: auth, input validation and the
 * not-found path for a CEO session.
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

describe("employees.reactivate", () => {
  it("rejects an unauthenticated caller (no session)", async () => {
    const ctx = {
      session: null,
      req: { headers: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    } as unknown as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.employees.reactivate({ id: 1 })).rejects.toThrow();
  });

  it("rejects invalid input (non-integer id)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      // @ts-expect-error - validating the zod gate
      caller.employees.reactivate({ id: "not-a-number" }),
    ).rejects.toThrow();
  });

  it("returns NOT_FOUND for a non-existent employee (passes auth, fails lookup)", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.employees.reactivate({ id: 999999 })).rejects.toThrow(
      /not[_ ]?found/i,
    );
  });
});

describe("employees.list includeInactive", () => {
  it("rejects a non-boolean includeInactive", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      // @ts-expect-error - validating the zod gate
      caller.employees.list({ includeInactive: "yes" }),
    ).rejects.toThrow();
  });
});
