import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter, requestIp } from "./rateLimit";

describe("SlidingWindowLimiter", () => {
  it("allows attempts until the failure threshold is reached", () => {
    const limiter = new SlidingWindowLimiter(3, 10_000, 60_000);
    const t0 = 1_000_000;
    expect(limiter.lockedForMs("a", t0)).toBe(0);
    limiter.recordFailure("a", t0);
    limiter.recordFailure("a", t0 + 100);
    expect(limiter.lockedForMs("a", t0 + 200)).toBe(0);
  });

  it("locks the key once failures hit the threshold", () => {
    const limiter = new SlidingWindowLimiter(3, 10_000, 60_000);
    const t0 = 1_000_000;
    limiter.recordFailure("a", t0);
    limiter.recordFailure("a", t0 + 100);
    limiter.recordFailure("a", t0 + 200);
    const locked = limiter.lockedForMs("a", t0 + 300);
    expect(locked).toBeGreaterThan(0);
    expect(locked).toBeLessThanOrEqual(60_000);
  });

  it("unlocks after the lock window passes", () => {
    const limiter = new SlidingWindowLimiter(2, 10_000, 30_000);
    const t0 = 1_000_000;
    limiter.recordFailure("a", t0);
    limiter.recordFailure("a", t0 + 1);
    expect(limiter.lockedForMs("a", t0 + 2)).toBeGreaterThan(0);
    expect(limiter.lockedForMs("a", t0 + 30_002)).toBe(0);
  });

  it("forgets failures outside the sliding window", () => {
    const limiter = new SlidingWindowLimiter(3, 10_000, 60_000);
    const t0 = 1_000_000;
    limiter.recordFailure("a", t0);
    limiter.recordFailure("a", t0 + 1);
    // Third failure lands after the first two expired — no lock.
    limiter.recordFailure("a", t0 + 20_000);
    expect(limiter.lockedForMs("a", t0 + 20_001)).toBe(0);
  });

  it("isolates keys and resets on success", () => {
    const limiter = new SlidingWindowLimiter(2, 10_000, 30_000);
    const t0 = 1_000_000;
    limiter.recordFailure("a", t0);
    limiter.recordFailure("a", t0 + 1);
    expect(limiter.lockedForMs("a", t0 + 2)).toBeGreaterThan(0);
    expect(limiter.lockedForMs("b", t0 + 2)).toBe(0);
    limiter.reset("a");
    expect(limiter.lockedForMs("a", t0 + 3)).toBe(0);
  });
});

describe("requestIp", () => {
  it("prefers the first x-forwarded-for hop", () => {
    expect(
      requestIp({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }),
    ).toBe("203.0.113.9");
  });

  it("falls back to socket address, then 'unknown'", () => {
    expect(
      requestIp({ headers: {}, socket: { remoteAddress: "192.168.1.5" } }),
    ).toBe("192.168.1.5");
    expect(requestIp({ headers: {} })).toBe("unknown");
  });
});
