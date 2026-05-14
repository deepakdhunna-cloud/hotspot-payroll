import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { PIN_COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

function createCtx(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    session: {
      scope: "ceo",
      role: "admin",
      store: null,
      issuedAt: Date.now(),
    },
    req: {
      protocol: "https",
      headers: {},
      get: () => "example.com",
    } as unknown as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as unknown as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the PIN session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(PIN_COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      httpOnly: true,
      path: "/",
    });
  });
});
