import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { PinSession } from "./_core/pinAuth";

/** A manager profile that covers two stores. */
function managerOf(stores: PinSession["stores"]): TrpcContext {
  return {
    session: {
      scope: "profile:test",
      profileId: 42,
      name: "Raj",
      role: "manager",
      stores,
      store: stores.length === 1 ? stores[0] : null,
      issuedAt: Date.now(),
    },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;
}

describe("multi-store manager profiles", () => {
  const twoStores = managerOf(["Hotspot Market 11", "Hotspot Market 13"]);

  it("myScope lists every store on the profile", async () => {
    const scope = await appRouter.createCaller(twoStores).meta.myScope();
    expect(scope).toEqual({
      isAdmin: false,
      stores: ["Hotspot Market 11", "Hotspot Market 13"],
    });
  });

  it("auth.me reports the profile's name and stores", async () => {
    const me = await appRouter.createCaller(twoStores).auth.me();
    expect(me).toMatchObject({
      role: "manager",
      name: "Raj",
      stores: ["Hotspot Market 11", "Hotspot Market 13"],
      store: null,
      profileId: 42,
    });
  });

  it("still can't add employees to a store outside the profile", async () => {
    await expect(
      appRouter.createCaller(twoStores).employees.quickCreate({
        fullName: "Sample Person",
        storeLocation: "Hotspot Market 14",
      }),
    ).rejects.toThrow(/assigned store/i);
  });

  it("greets a named profile by its own name", async () => {
    const g = await appRouter.createCaller(twoStores).meta.greetingName();
    expect(g).toEqual({ role: "manager", name: "Raj" });
  });

  it("is kept out of CEO-only profile management", async () => {
    await expect(appRouter.createCaller(twoStores).profiles.list()).rejects.toThrow();
    await expect(
      appRouter.createCaller(twoStores).profiles.create({
        name: "Sneaky",
        role: "admin",
        stores: [],
        pin: "123456",
      }),
    ).rejects.toThrow(/permission/i);
  });
});

describe("profile rules that need no database", () => {
  const ceo: TrpcContext = {
    session: {
      scope: "ceo",
      profileId: 1,
      name: "CEO",
      role: "admin",
      stores: [],
      store: null,
      issuedAt: Date.now(),
    },
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  } as TrpcContext;

  it("a manager needs at least one store", async () => {
    await expect(
      appRouter.createCaller(ceo).profiles.create({
        name: "No Stores",
        role: "manager",
        stores: [],
        pin: "246810",
      }),
    ).rejects.toThrow(/at least one store/i);
  });

  it("rejects bad PINs and blank names", async () => {
    const caller = appRouter.createCaller(ceo);
    await expect(
      caller.profiles.create({ name: "X", role: "cfo", stores: [], pin: "12" }),
    ).rejects.toThrow();
    await expect(
      caller.profiles.create({ name: "   ", role: "cfo", stores: [], pin: "123456" }),
    ).rejects.toThrow();
  });
});
