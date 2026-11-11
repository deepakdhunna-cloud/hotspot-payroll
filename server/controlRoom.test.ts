import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * The command center's Control tab changes how the whole site runs, so the
 * procedures behind it are CEO-only and refuse bad values before anything is
 * written. (No database in tests: everything here must fail — or be refused —
 * before a write is attempted.)
 */
function ctxFor(who: "ceo" | "cfo" | string): TrpcContext {
  const session =
    who === "ceo"
      ? { scope: "ceo", role: "admin", store: null }
      : who === "cfo"
        ? { scope: "cfo", role: "cfo", store: null }
        : { scope: who, role: "manager", store: who };
  return {
    session: { ...session, issuedAt: Date.now() },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;
}

const manager = () => appRouter.createCaller(ctxFor("Hotspot Market 11"));
const cfo = () => appRouter.createCaller(ctxFor("cfo"));
const ceo = () => appRouter.createCaller(ctxFor("ceo"));

describe("Control: only the CEO can change how the site runs", () => {
  it("a store manager cannot change rules, add a store or add a role", async () => {
    await expect(manager().settings.setRules({ longShiftHours: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      manager().settings.addStore({ name: "Hotspot Market 99", pin: "4321" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager().settings.addRole({ name: "Shift Lead" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("the read-only CFO login cannot either", async () => {
    await expect(cfo().settings.setRules({ estFederalPct: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      cfo().settings.addStore({ name: "Hotspot Market 99", pin: "4321" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cfo().settings.addRole({ name: "Shift Lead" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("managers still read the rules (the dashboard needs the long-shift limit)", async () => {
    const s = await manager().settings.get();
    expect(s.rules.longShiftHours).toBe(12);
    expect(s.rules.estFederalRate).toBeCloseTo(0.18);
    expect(s.rules.estStateRate).toBeCloseTo(0.05);
  });
});

describe("Control: values are checked before anything is saved", () => {
  it("rule values outside their limits are refused", async () => {
    await expect(ceo().settings.setRules({ estFederalPct: 61 })).rejects.toThrow();
    await expect(ceo().settings.setRules({ estStatePct: -1 })).rejects.toThrow();
    await expect(ceo().settings.setRules({ longShiftHours: 5 })).rejects.toThrow();
    await expect(ceo().settings.setRules({ longShiftHours: 25 })).rejects.toThrow();
    await expect(ceo().settings.setRules({ longShiftHours: 12.5 })).rejects.toThrow();
  });

  it("a store needs a usable, unused name", async () => {
    await expect(ceo().settings.addStore({ name: "ab", pin: "4321" })).rejects.toThrow(
      /at least 3 characters/i,
    );
    await expect(
      ceo().settings.addStore({ name: "hotspot market 11", pin: "4321" }),
    ).rejects.toThrow(/already exists/i);
    // Would collide with the CEO sign-in or the "all stores" filter.
    await expect(ceo().settings.addStore({ name: "CEO", pin: "4321" })).rejects.toThrow(
      /reserved/i,
    );
    await expect(ceo().settings.addStore({ name: "All", pin: "4321" })).rejects.toThrow(
      /reserved/i,
    );
    // ...or with who the activity log names for automatic actions.
    await expect(ceo().settings.addStore({ name: "System", pin: "4321" })).rejects.toThrow(
      /reserved/i,
    );
    await expect(ceo().settings.addStore({ name: "anonymous", pin: "4321" })).rejects.toThrow(
      /reserved/i,
    );
    await expect(
      ceo().settings.addStore({ name: "Store <script>", pin: "4321" }),
    ).rejects.toThrow(/letters, numbers/i);
  });

  it("a store's manager PIN must be 4 to 8 digits", async () => {
    for (const pin of ["123", "123456789", "12ab", ""]) {
      await expect(
        ceo().settings.addStore({ name: "Hotspot Market 99", pin }),
      ).rejects.toThrow();
    }
  });

  it("a role needs a usable, unused name", async () => {
    await expect(ceo().settings.addRole({ name: "x" })).rejects.toThrow(/at least 2 characters/i);
    await expect(ceo().settings.addRole({ name: "manager" })).rejects.toThrow(/already exists/i);
    await expect(ceo().settings.addRole({ name: "Lead; DROP" })).rejects.toThrow(
      /letters, numbers/i,
    );
  });

  it("a store or role that isn't in the registry is refused everywhere it is used", async () => {
    await expect(
      ceo().employees.bulkUpdate({
        ids: [1],
        // @ts-expect-error not a store
        storeLocation: "Hotspot Market 99",
      }),
    ).rejects.toThrow();
  });
});
