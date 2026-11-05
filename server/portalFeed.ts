import { timingSafeEqual } from "node:crypto";
import {
  appSettings,
  attentionItems,
  auditLog,
  employees,
  payrollEntries,
  scheduleImports,
  scheduleShifts,
  timePunches,
} from "../drizzle/schema";
import { getDb } from "./db";

export const PORTAL_FEED_SCHEMA_VERSION = "1.1";

/** Returns a bearer token only when the Authorization format is unambiguous. */
export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * Compare the configured secret without leaking matching-prefix timing.
 * A missing configuration intentionally denies all feed requests.
 */
export function hasPortalFeedAccess(
  authorization: string | undefined,
  configuredToken: string | undefined,
): boolean {
  const presentedToken = extractBearerToken(authorization);
  if (!presentedToken || !configuredToken) return false;

  const presented = Buffer.from(presentedToken);
  const configured = Buffer.from(configuredToken);
  return (
    presented.length === configured.length &&
    timingSafeEqual(presented, configured)
  );
}

/** Removes credentials that must never leave Hotspot Payroll. */
export function exportEmployee(
  employee: typeof employees.$inferSelect,
): Omit<typeof employees.$inferSelect, "clockCodeHash"> {
  const { clockCodeHash: _clockCodeHash, ...safeEmployee } = employee;
  return safeEmployee;
}

/**
 * A point-in-time full snapshot for an authenticated portal: every
 * operational record since day one, so any single response is enough to
 * mirror the site. Excludes authentication data and clock-code hashes; the
 * audit log (large, append-only) only when asked for.
 */
export async function buildPortalFeed(opts: { includeAudit?: boolean } = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [
    allEmployees,
    allPayrollEntries,
    allPunches,
    allScheduleShifts,
    allScheduleImports,
    allAttentionItems,
    allAppSettings,
    allAuditLog,
  ] = await Promise.all([
    db.select().from(employees),
    db.select().from(payrollEntries),
    db.select().from(timePunches),
    db.select().from(scheduleShifts),
    db.select().from(scheduleImports),
    db.select().from(attentionItems),
    db.select().from(appSettings),
    opts.includeAudit ? db.select().from(auditLog) : Promise.resolve(null),
  ]);

  return {
    schemaVersion: PORTAL_FEED_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    employees: allEmployees.map(exportEmployee),
    payrollEntries: allPayrollEntries,
    timePunches: allPunches,
    scheduleShifts: allScheduleShifts,
    scheduleImports: allScheduleImports,
    attentionItems: allAttentionItems,
    appSettings: allAppSettings,
    ...(allAuditLog ? { auditLog: allAuditLog } : {}),
  };
}
