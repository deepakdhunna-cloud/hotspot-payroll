import { beforeEach, describe, expect, it } from "vitest";
import { ROLES, STORES, estimateWithholding } from "@shared/hotspot";
import {
  DEFAULT_RULES,
  defaultShortName,
  getRoles,
  getRules,
  getStoreInfo,
  getStores,
  isRole,
  isStore,
  resetRegistryForTests,
  roleNameProblem,
  storeNameProblem,
} from "./registry";

describe("registry (no database: built-ins and defaults)", () => {
  beforeEach(() => resetRegistryForTests());

  it("starts as exactly the built-in stores and roles", () => {
    expect(getStores()).toEqual([...STORES]);
    expect(getRoles()).toEqual([...ROLES]);
    expect(getStoreInfo().every((s) => s.builtIn)).toBe(true);
  });

  it("knows a store or role only by its exact name", () => {
    expect(isStore("Hotspot Market 11")).toBe(true);
    expect(isStore("hotspot market 11")).toBe(false);
    expect(isStore("Hotspot Market 99")).toBe(false);
    expect(isStore(undefined)).toBe(false);
    expect(isStore(11)).toBe(false);
    expect(isRole("Cashier")).toBe(true);
    expect(isRole("Astronaut")).toBe(false);
  });

  it("gives every built-in store its short label", () => {
    expect(getStoreInfo().map((s) => s.short)).toEqual([
      "HM 11",
      "HM 13",
      "HM 14",
      "HM 17",
      "Travel",
    ]);
  });

  it("derives a short label for a new store", () => {
    expect(defaultShortName("Hotspot Market 22")).toBe("HM 22");
    expect(defaultShortName("Hotspot Express")).toBe("Express");
    expect(defaultShortName("Lakeside Fuel & Food")).toBe("Lakeside");
  });

  it("refuses store names that are too short, reserved, odd or taken", () => {
    expect(storeNameProblem("ab")).toMatch(/at least 3/);
    expect(storeNameProblem("x".repeat(57))).toMatch(/56 characters/);
    expect(storeNameProblem("CEO")).toMatch(/reserved/);
    expect(storeNameProblem("all")).toMatch(/reserved/);
    expect(storeNameProblem("Store <script>")).toMatch(/letters, numbers/);
    expect(storeNameProblem("hotspot market 11")).toMatch(/already exists/);
    expect(storeNameProblem("  Hotspot   Market 22 ")).toBeNull();
  });

  it("refuses role names that are too short, odd or taken", () => {
    expect(roleNameProblem("a")).toMatch(/at least 2/);
    expect(roleNameProblem("cashier")).toMatch(/already exists/);
    expect(roleNameProblem("Shift Lead")).toBeNull();
  });

  it("defaults the rules to the long-standing numbers", () => {
    expect(getRules()).toEqual(DEFAULT_RULES);
    expect(getRules().longShiftHours).toBe(12);
  });
});

describe("estimateWithholding", () => {
  it("uses the default rates when none are given", () => {
    const w = estimateWithholding(1000);
    expect(w.federal).toBeCloseTo(180);
    expect(w.state).toBeCloseTo(50);
    expect(w.netPay).toBeCloseTo(770);
  });

  it("uses the rates it is given", () => {
    const w = estimateWithholding(1000, { estFederalRate: 0.2, estStateRate: 0.04 });
    expect(w.federal).toBeCloseTo(200);
    expect(w.state).toBeCloseTo(40);
    expect(w.totalTax).toBeCloseTo(240);
    expect(w.netPay).toBeCloseTo(760);
  });
});
