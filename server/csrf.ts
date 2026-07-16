import type { NextFunction, Request, Response } from "express";

/**
 * Same-origin guard for mutating API requests.
 *
 * Session cookies are SameSite=None (the platform preview runs the app in an
 * iframe), so the browser would attach them to cross-site POSTs. This guard
 * rejects any mutating request whose Origin header doesn't match the host the
 * request arrived on. Requests without an Origin header (curl, server-to-
 * server, same-origin GET navigations) pass through.
 */
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  try {
    const host = new URL(origin).host;
    const expected = req.headers["x-forwarded-host"] ?? req.headers.host;
    const expectedHosts = (Array.isArray(expected) ? expected : [expected ?? ""])
      .flatMap((h) => h.split(","))
      .map((h) => h.trim())
      .filter(Boolean);
    if (expectedHosts.includes(host)) {
      next();
      return;
    }
  } catch {
    // Malformed Origin header — treat as cross-site.
  }
  res.status(403).json({ error: "Cross-origin request rejected" });
}
