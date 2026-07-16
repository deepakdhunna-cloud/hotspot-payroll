import { describe, expect, it } from "vitest";
import {
  checkPinHash,
  hashPinLegacy,
  hashPinScrypt,
  isValidPin,
  normalizePin,
} from "./_core/pinAuth";

describe("PIN hashing", () => {
  it("verifies a scrypt hash and rejects wrong PINs", async () => {
    const hash = await hashPinScrypt("4821", "ceo");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await checkPinHash("4821", "ceo", hash)).toBe(true);
    expect(await checkPinHash("4822", "ceo", hash)).toBe(false);
  });

  it("scopes hashes: the same PIN under another scope does not match", async () => {
    const hash = await hashPinScrypt("4821", "Hotspot Market 11");
    expect(await checkPinHash("4821", "ceo", hash)).toBe(false);
  });

  it("produces a different salt (and hash) every time", async () => {
    const a = await hashPinScrypt("4821", "ceo");
    const b = await hashPinScrypt("4821", "ceo");
    expect(a).not.toBe(b);
    expect(await checkPinHash("4821", "ceo", a)).toBe(true);
    expect(await checkPinHash("4821", "ceo", b)).toBe(true);
  });

  it("still verifies legacy sha256 hashes (pre-upgrade rows)", async () => {
    const legacy = hashPinLegacy("1313", "Hotspot Market 13");
    expect(await checkPinHash("1313", "Hotspot Market 13", legacy)).toBe(true);
    expect(await checkPinHash("1314", "Hotspot Market 13", legacy)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await checkPinHash("1234", "ceo", "scrypt$broken")).toBe(false);
    expect(await checkPinHash("1234", "ceo", "not-a-hash")).toBe(false);
    expect(await checkPinHash("1234", "ceo", "")).toBe(false);
  });
});

describe("PIN normalization", () => {
  it("strips non-digits and validates 4-8 digit PINs", () => {
    expect(normalizePin(" 12-34 ")).toBe("1234");
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
  });
});
