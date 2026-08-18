import { timingSafeEqual } from "node:crypto";
import {
  employees,
  payrollEntries,
  scheduleShifts,
  timePunches,
} from "../drizzle/schema";
import { getDb } from "./db";

export const PORTAL_FEED_SCHEMA_VERSION = "1.0";

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
 * A point-in-time full snapshot for an authenticated portal. The snapshot
 * includes operational payroll data, but excludes authentication data,
 * clock-code hashes, and internal audit records.
 */
export async function buildPortalFeed() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [allEmployees, allPayrollEntries, allPunches, allScheduleShifts] =
    await Promise.all([
      db.select().from(employees),
      db.select().from(payrollEntries),
      db.select().from(timePunches),
      db.select().from(scheduleShifts),
    ]);

  return {
    schemaVersion: PORTAL_FEED_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    employees: allEmployees.map(exportEmployee),
    payrollEntries: allPayrollEntries,
    timePunches: allPunches,
    scheduleShifts: allScheduleShifts,
  };
}
