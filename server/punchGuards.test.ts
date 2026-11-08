import { describe, expect, it } from "vitest";
import { appRouter, isPayrollOfRecord } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Punch times can't be in the future (checked before any lookup), and
 * history counts only weeks that were actually paid.
 */
function ceoCtx(): TrpcContext {
  return {
    session: { scope: "ceo", role: "admin", store: null, issuedAt: Date.now() },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;
}
const inAnHour = () => new Date(Date.now() + 3_600_000);

describe("punch time guards", () => {
  it("rejects a manual punch that starts in the future", async () => {
    const caller = appRouter.createCaller(ceoCtx());
    await expect(
      caller.clock.createManual({ employeeId: 1, clockInAt: inAnHour() }),
    ).rejects.toThrow(/future/i);
  });

  it("rejects a manual punch that ends in the future", async () => {
    const caller = appRouter.createCaller(ceoCtx());
    await expect(
      caller.clock.createManual({
        employeeId: 1,
        clockInAt: new Date(Date.now() - 3_600_000),
        clockOutAt: inAnHour(),
      }),
    ).rejects.toThrow(/future/i);
  });

  it("rejects an edit that moves clock-out into the future", async () => {
    const caller = appRouter.createCaller(ceoCtx());
    await expect(
      caller.clock.update({ id: 1, clockOutAt: inAnHour() }),
    ).rejects.toThrow(/future/i);
  });
});

describe("isPayrollOfRecord", () => {
  it("skips schedule-only placeholders", () => {
    expect(
      isPayrollOfRecord({ notes: "schedule-only", hoursWorked: "0", grossPay: "0" }),
    ).toBe(false);
  });
  it("skips legacy $0 / 0 h rows without a note", () => {
    expect(isPayrollOfRecord({ notes: null, hoursWorked: "0.00", grossPay: "0.00" })).toBe(false);
  });
  it("keeps saved hours and set-pay weeks", () => {
    expect(isPayrollOfRecord({ notes: null, hoursWorked: "38.5", grossPay: "577.50" })).toBe(true);
    expect(isPayrollOfRecord({ notes: "fixed-pay", hoursWorked: "0", grossPay: "700" })).toBe(true);
  });
});
