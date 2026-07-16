import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Brute-force lockout on auth.verifyPin. Without a database every PIN is
 * "incorrect", which is exactly what we need to exercise the limiter.
 * Each test uses its own client IP so the module-global limiter state
 * cannot leak between tests.
 */
function anonCtx(ip: string): TrpcContext {
  return {
    session: null,
    req: {
      headers: { "x-forwarded-for": ip },
      protocol: "https",
    } as unknown as TrpcContext["req"],
    res: { cookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("auth.verifyPin lockout", () => {
  it("locks an IP after 5 failed attempts", async () => {
    const caller = appRouter.createCaller(anonCtx("198.51.100.7"));
    for (let i = 0; i < 5; i++) {
      await expect(caller.auth.verifyPin({ pin: "0000" })).rejects.toThrow(
        /incorrect pin/i,
      );
    }
    // Sixth attempt hits the lock, not the PIN check.
    await expect(caller.auth.verifyPin({ pin: "0000" })).rejects.toThrow(
      /too many incorrect attempts/i,
    );
  }, 15_000);

  it("does not lock other IPs", async () => {
    const caller = appRouter.createCaller(anonCtx("198.51.100.8"));
    await expect(caller.auth.verifyPin({ pin: "0000" })).rejects.toThrow(
      /incorrect pin/i,
    );
  }, 15_000);
});
