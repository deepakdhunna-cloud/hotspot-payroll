import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  isValidPin,
  normalizePin,
  signPinSession,
  verifyPinSession,
} from "./_core/pinAuth";
import { PIN_COOKIE_NAME } from "../shared/const";

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

  it("ALL_SCOPES contains CEO, CFO and the four stores", () => {
    expect(ALL_SCOPES).toContain("ceo");
    expect(ALL_SCOPES).toContain("cfo");
    expect(ALL_SCOPES).toContain("Hotspot Market 11");
    expect(ALL_SCOPES).toContain("Hotspot Market 13");
    expect(ALL_SCOPES).toContain("Hotspot Market 14");
    expect(ALL_SCOPES).toContain("Hotspot Travel Center");
    expect(ALL_SCOPES).toHaveLength(6);
  });

  it("signPinSession + verifyPinSession round-trip a CEO session", async () => {
    const token = await signPinSession("ceo");
    const req = {
      headers: { cookie: `${PIN_COOKIE_NAME}=${token}` },
    } as any;
    const session = await verifyPinSession(req);
    expect(session?.scope).toBe("ceo");
    expect(session?.role).toBe("admin");
    expect(session?.store).toBeNull();
  });

  it("signPinSession + verifyPinSession round-trip a store manager session", async () => {
    const token = await signPinSession("Hotspot Market 14");
    const req = {
      headers: { cookie: `${PIN_COOKIE_NAME}=${token}` },
    } as any;
    const session = await verifyPinSession(req);
    expect(session?.scope).toBe("Hotspot Market 14");
    expect(session?.role).toBe("manager");
    expect(session?.store).toBe("Hotspot Market 14");
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
