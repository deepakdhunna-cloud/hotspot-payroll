import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  isValidPin,
  normalizePin,
  sessionStores,
  signPinSession,
  verifyPinSession,
} from "./_core/pinAuth";
import { legacyProfileFor } from "./accessProfiles";
import { PIN_COOKIE_NAME } from "../shared/const";

const reqWith = (token: string) =>
  ({ headers: { cookie: `${PIN_COOKIE_NAME}=${token}` } }) as any;

describe("pinAuth helpers", () => {
  it("isValidPin accepts 4-8 digit numerics only", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });

  it("normalizePin strips non-digits", () => {
    expect(normalizePin(" 12 34 ")).toBe("1234");
    expect(normalizePin("a1b2c3d4")).toBe("1234");
  });

  it("ALL_SCOPES contains CEO, CFO and the five stores", () => {
    expect(ALL_SCOPES).toContain("ceo");
    expect(ALL_SCOPES).toContain("cfo");
    expect(ALL_SCOPES).toContain("Hotspot Market 11");
    expect(ALL_SCOPES).toContain("Hotspot Market 13");
    expect(ALL_SCOPES).toContain("Hotspot Market 14");
    expect(ALL_SCOPES).toContain("Hotspot Market 17");
    expect(ALL_SCOPES).toContain("Hotspot Travel Center");
    expect(ALL_SCOPES).toHaveLength(7);
  });

  it("signPinSession + verifyPinSession round-trip a CEO session", async () => {
    const token = await signPinSession(legacyProfileFor("ceo")!);
    const req = {
      headers: { cookie: `${PIN_COOKIE_NAME}=${token}` },
    } as any;
    const session = await verifyPinSession(req);
    expect(session?.scope).toBe("ceo");
    expect(session?.role).toBe("admin");
    expect(session?.store).toBeNull();
  });

  it("signPinSession + verifyPinSession round-trip a store manager session", async () => {
    const token = await signPinSession(legacyProfileFor("Hotspot Market 14")!);
    const req = {
      headers: { cookie: `${PIN_COOKIE_NAME}=${token}` },
    } as any;
    const session = await verifyPinSession(req);
    expect(session?.scope).toBe("Hotspot Market 14");
    expect(session?.role).toBe("manager");
    expect(session?.store).toBe("Hotspot Market 14");
  });

  it("round-trips a multi-store manager profile", async () => {
    const token = await signPinSession({
      id: 12,
      name: "Raj",
      role: "manager",
      stores: ["Hotspot Market 11", "Hotspot Market 13"],
      pinScope: "profile:abc123",
    });
    const session = await verifyPinSession(reqWith(token));
    expect(session?.scope).toBe("profile:abc123");
    expect(session?.profileId).toBe(12);
    expect(session?.name).toBe("Raj");
    expect(session?.role).toBe("manager");
    expect(session?.stores).toEqual(["Hotspot Market 11", "Hotspot Market 13"]);
    // Several stores: there is no single "the store".
    expect(session?.store).toBeNull();
  });

  it("round-trips a CFO profile with no stores", async () => {
    const token = await signPinSession({
      id: 3,
      name: "Finance",
      role: "cfo",
      stores: [],
      pinScope: "profile:cf0",
    });
    const session = await verifyPinSession(reqWith(token));
    expect(session?.role).toBe("cfo");
    expect(session?.stores).toEqual([]);
    expect(session?.store).toBeNull();
  });

  it("refuses a manager token that carries no stores", async () => {
    const token = await signPinSession({
      id: 9,
      name: "Nobody",
      role: "manager",
      stores: [],
      pinScope: "profile:empty",
    });
    expect(await verifyPinSession(reqWith(token))).toBeNull();
  });

  it("sessionStores: CEO sees all, CFO none, managers their own", () => {
    expect(sessionStores({ role: "admin", store: null })).toHaveLength(5);
    expect(sessionStores({ role: "cfo", store: null })).toEqual([]);
    expect(
      sessionStores({
        role: "manager",
        store: null,
        stores: ["Hotspot Market 13", "Hotspot Travel Center"],
      }),
    ).toEqual(["Hotspot Market 13", "Hotspot Travel Center"]);
    // Hand-built sessions without `stores` fall back to `store`.
    expect(sessionStores({ role: "manager", store: "Hotspot Market 17" })).toEqual([
      "Hotspot Market 17",
    ]);
  });

  it("verifyPinSession returns null for missing cookie or bad token", async () => {
    expect(await verifyPinSession({ headers: {} } as any)).toBeNull();
    expect(
      await verifyPinSession({
        headers: { cookie: `${PIN_COOKIE_NAME}=garbage` },
      } as any),
    ).toBeNull();
  });
});
