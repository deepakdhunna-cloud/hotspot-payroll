import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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

describe("employees.bulkUpdate", () => {
  it("rejects requests with no fields to update", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.employees.bulkUpdate({ ids: [1, 2] }),
    ).rejects.toThrow();
  });

  it("rejects empty id arrays", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.employees.bulkUpdate({
        ids: [],
        storeLocation: "Hotspot Market 11",
      }),
    ).rejects.toThrow();
  });

  it("rejects a manager attempting to move employees to a store they don't manage", async () => {
    const caller = appRouter.createCaller(ctxFor("Hotspot Market 11"));
    await expect(
      caller.employees.bulkUpdate({
        ids: [1],
        storeLocation: "Hotspot Market 14",
      }),
    ).rejects.toThrow(/assigned stores/i);
  });

  it("rejects unknown role/store enums via zod", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.employees.bulkUpdate({
        ids: [1],
        // @ts-expect-error invalid by design
        role: "Not A Role",
      }),
    ).rejects.toThrow();
  });
});
