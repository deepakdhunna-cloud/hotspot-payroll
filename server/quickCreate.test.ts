import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctxFor(store: string | null) {
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

describe("employees.quickCreate", () => {
  it("rejects a manager creating an employee outside their store", async () => {
    const caller = appRouter.createCaller(ctxFor("Hotspot Market 11"));
    await expect(
      caller.employees.quickCreate({
        fullName: "Sample Person",
        storeLocation: "Hotspot Market 14",
      }),
    ).rejects.toThrow(/assigned store/i);
  });

  it("rejects empty names via zod validation", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.employees.quickCreate({
        fullName: "",
        storeLocation: "Hotspot Market 11",
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown store values via zod validation", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.employees.quickCreate({
        fullName: "Sample Person",
        // @ts-expect-error invalid by design
        storeLocation: "Not A Real Store",
      }),
    ).rejects.toThrow();
  });
});
