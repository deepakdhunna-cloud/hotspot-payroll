import { describe, expect, it } from "vitest";
import {
  exportEmployee,
  extractBearerToken,
  hasPortalFeedAccess,
} from "./portalFeed";

describe("portal feed authentication", () => {
  it("accepts only a bearer token in the Authorization header", () => {
    expect(extractBearerToken("Bearer secure-token")).toBe("secure-token");
    expect(extractBearerToken("bearer secure-token")).toBe("secure-token");
    expect(extractBearerToken("Basic secure-token")).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it("requires an exact configured token", () => {
    expect(hasPortalFeedAccess("Bearer secure-token", "secure-token")).toBe(true);
    expect(hasPortalFeedAccess("Bearer wrong-token", "secure-token")).toBe(false);
    expect(hasPortalFeedAccess("Bearer secure-token", undefined)).toBe(false);
  });
});

describe("portal feed data safety", () => {
  it("never exposes an employee clock-code hash", () => {
    const employee = {
      id: 1,
      fullName: "Test Employee",
      clockCodeHash: "sensitive-hash",
    } as any;

    expect(exportEmployee(employee)).toEqual({ id: 1, fullName: "Test Employee" });
  });
});
