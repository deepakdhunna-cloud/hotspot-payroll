import type { Request, Response } from "express";
import { verifyPinSession, type PinSession } from "./_core/pinAuth";
import { logAudit } from "./db";
import { buildFullExport } from "./fullExport";
import { requestIp } from "./rateLimit";

/** The address the browser used, as seen through Railway's proxy. */
export function requestOrigin(req: Request): string {
  const proto = req.header("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host =
    req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.header("host") || "localhost";
  return `${proto}://${host}`;
}

type Deps = {
  verifySession: (req: Request) => Promise<PinSession | null>;
  build: typeof buildFullExport;
  audit: typeof logAudit;
};

const defaultDeps: Deps = {
  verifySession: verifyPinSession,
  build: buildFullExport,
  audit: logAudit,
};

/**
 * GET /api/export/full — every row since day one as a ZIP. CEO session
 * only: the file carries names, phone numbers and pay rates for everyone.
 * `?credentials=1` adds PIN and clock-code hashes (see fullExport.ts).
 */
export async function handleFullExport(
  req: Request,
  res: Response,
  deps: Deps = defaultDeps,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const session = await deps.verifySession(req);
  if (!session) {
    res.status(401).json({ error: "Sign in with the CEO PIN first" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Only the CEO login can export all data" });
    return;
  }
  try {
    const includeCredentials = req.query.credentials === "1";
    const { filename, zip, counts } = await deps.build({
      includeCredentials,
      origin: requestOrigin(req),
    });
    void deps.audit({
      actorScope: session.scope,
      action: "export.full",
      entityType: "export",
      detail: JSON.stringify({ includeCredentials, tables: counts }),
      ip: requestIp(req),
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength));
  } catch (error) {
    console.error("[Export] Full export failed", error);
    res.status(503).json({ error: "The export is temporarily unavailable" });
  }
}
