import { describe, expect, it } from "vitest";
import { csrfOriginGuard } from "./csrf";

function run(opts: {
  method: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
}) {
  const headers: Record<string, unknown> = {};
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.host !== undefined) headers.host = opts.host;
  if (opts.forwardedHost !== undefined) headers["x-forwarded-host"] = opts.forwardedHost;

  let statusCode: number | null = null;
  let nextCalled = false;
  const req = { method: opts.method, headers } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as any;

  csrfOriginGuard(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, nextCalled };
}

describe("csrfOriginGuard", () => {
  it("lets safe methods through untouched", () => {
    expect(run({ method: "GET", origin: "https://evil.example" }).nextCalled).toBe(true);
    expect(run({ method: "OPTIONS", origin: "https://evil.example" }).nextCalled).toBe(true);
  });

  it("lets same-origin POSTs through", () => {
    const r = run({
      method: "POST",
      origin: "https://payroll.example.com",
      host: "payroll.example.com",
    });
    expect(r.nextCalled).toBe(true);
  });

  it("honors x-forwarded-host behind a proxy", () => {
    const r = run({
      method: "POST",
      origin: "https://payroll.example.com",
      host: "internal-gateway:3000",
      forwardedHost: "payroll.example.com",
    });
    expect(r.nextCalled).toBe(true);
  });

  it("rejects cross-site POSTs with 403", () => {
    const r = run({
      method: "POST",
      origin: "https://evil.example",
      host: "payroll.example.com",
    });
    expect(r.nextCalled).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it("rejects malformed Origin headers", () => {
    const r = run({
      method: "POST",
      origin: "not a url",
      host: "payroll.example.com",
    });
    expect(r.nextCalled).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it("allows originless requests (non-browser clients)", () => {
    const r = run({ method: "POST", host: "payroll.example.com" });
    expect(r.nextCalled).toBe(true);
  });
});
