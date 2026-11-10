import { describe, expect, it } from "vitest";
import {
  LEGACY_SCOPES,
  isLiveProfile,
  legacyProfileFor,
  newProfileScope,
  normalizeStores,
  parseStores,
  storeShortName,
  storesForRole,
  toSessionProfile,
} from "./accessProfiles";
import type { AccessProfile } from "../drizzle/schema";

function row(over: Partial<AccessProfile> = {}): AccessProfile {
  return {
    id: 1,
    name: "Raj",
    role: "manager",
    stores: JSON.stringify(["Hotspot Market 11"]),
    pinScope: "profile:1",
    active: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

describe("legacy logins carry over as profiles", () => {
  it("maps the seven original PIN scopes with the same reach", () => {
    expect(LEGACY_SCOPES).toHaveLength(7);
    expect(legacyProfileFor("ceo")).toMatchObject({ name: "CEO", role: "admin", stores: [] });
    expect(legacyProfileFor("cfo")).toMatchObject({ name: "CFO", role: "cfo", stores: [] });
    expect(legacyProfileFor("Hotspot Market 11")).toMatchObject({
      name: "HM 11 Manager",
      role: "manager",
      stores: ["Hotspot Market 11"],
      pinScope: "Hotspot Market 11",
    });
    expect(legacyProfileFor("Hotspot Travel Center")?.name).toBe("Travel Center Manager");
  });

  it("knows nothing about other scopes", () => {
    expect(legacyProfileFor("profile:abc")).toBeNull();
    expect(legacyProfileFor("kiosk")).toBeNull();
  });

  it("storeShortName shortens store names", () => {
    expect(storeShortName("Hotspot Market 17")).toBe("HM 17");
    expect(storeShortName("Hotspot Travel Center")).toBe("Travel Center");
  });
});

describe("store lists", () => {
  it("normalizeStores keeps known stores, once each, in store order", () => {
    expect(
      normalizeStores([
        "Hotspot Travel Center",
        "Nowhere",
        "Hotspot Market 11",
        "Hotspot Market 11",
      ]),
    ).toEqual(["Hotspot Market 11", "Hotspot Travel Center"]);
  });

  it("parseStores tolerates junk", () => {
    expect(parseStores(null)).toEqual([]);
    expect(parseStores("not json")).toEqual([]);
    expect(parseStores('{"a":1}')).toEqual([]);
    expect(parseStores('["Hotspot Market 14", 5]')).toEqual(["Hotspot Market 14"]);
  });

  it("only managers carry stores", () => {
    expect(storesForRole("admin", ["Hotspot Market 11"])).toEqual([]);
    expect(storesForRole("cfo", ["Hotspot Market 11"])).toEqual([]);
    expect(storesForRole("manager", ["Hotspot Market 13", "Hotspot Market 11"])).toEqual([
      "Hotspot Market 11",
      "Hotspot Market 13",
    ]);
  });
});

describe("which profiles can sign in", () => {
  it("live: active, not removed, and a manager has a store", () => {
    expect(isLiveProfile(row())).toBe(true);
    expect(isLiveProfile(row({ active: 0 }))).toBe(false);
    expect(isLiveProfile(row({ deletedAt: new Date() }))).toBe(false);
    expect(isLiveProfile(row({ stores: "[]" }))).toBe(false);
    expect(isLiveProfile(row({ role: "cfo", stores: "[]" }))).toBe(true);
  });

  it("toSessionProfile reads the stored stores", () => {
    expect(
      toSessionProfile(
        row({ stores: JSON.stringify(["Hotspot Market 14", "Hotspot Market 11"]) }),
      ),
    ).toEqual({
      id: 1,
      name: "Raj",
      role: "manager",
      stores: ["Hotspot Market 11", "Hotspot Market 14"],
      pinScope: "profile:1",
    });
    // A CEO row with stray stores still reaches everything by role, not by list.
    expect(toSessionProfile(row({ role: "admin" })).stores).toEqual([]);
  });

  it("new profiles get unique scopes that never collide with the legacy ones", () => {
    const a = newProfileScope();
    const b = newProfileScope();
    expect(a).not.toBe(b);
    expect(a.startsWith("profile:")).toBe(true);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(LEGACY_SCOPES).not.toContain(a);
  });
});
