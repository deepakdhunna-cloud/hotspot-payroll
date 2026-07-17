import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditLog,
  employees,
  InsertAuditLogEntry,
  InsertEmployee,
  InsertManagerStore,
  InsertPayrollEntry,
  InsertScheduleImport,
  InsertScheduleShift,
  InsertTimePunch,
  InsertUser,
  managerStores,
  payrollEntries,
  scheduleImports,
  scheduleShifts,
  timePunches,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/* -------------------- USERS -------------------- */

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }

  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/* -------------------- MANAGER STORE ASSIGNMENTS -------------------- */

export async function getManagerStores(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(managerStores).where(eq(managerStores.userId, userId));
}

export async function setManagerStores(userId: number, stores: string[]) {
  const db = await getDb();
  if (!db) return;
  await db.delete(managerStores).where(eq(managerStores.userId, userId));
  if (stores.length > 0) {
    const rows: InsertManagerStore[] = stores.map((s) => ({
      userId,
      storeLocation: s,
    }));
    await db.insert(managerStores).values(rows);
  }
}

/* -------------------- EMPLOYEES -------------------- */

export async function listEmployees(filter?: { stores?: string[]; activeOnly?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds = [] as any[];
  if (filter?.stores && filter.stores.length > 0) {
    conds.push(inArray(employees.storeLocation, filter.stores));
  }
  if (filter?.activeOnly !== false) {
    conds.push(eq(employees.active, 1));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(employees)
    .where(where as any)
    .orderBy(employees.fullName);
}

export async function getEmployeeById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  return rows[0];
}

/** Bulk fetch, used to hydrate names without N+1 queries. */
export async function getEmployeesByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db.select().from(employees).where(inArray(employees.id, ids));
}

export async function createEmployee(data: InsertEmployee) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(employees).values(data);
  const id = Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
  return id;
}

export async function updateEmployee(
  id: number,
  data: Partial<Omit<InsertEmployee, "id" | "createdAt">>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(employees).set(data).where(eq(employees.id, id));
}

export async function deactivateEmployee(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(employees).set({ active: 0 }).where(eq(employees.id, id));
}

/**
 * Permanently delete an employee and every dependent record (payroll history,
 * time punches, scheduled shifts) in a single transaction so a mid-delete
 * failure can never leave orphaned rows. Callers must confirm in the UI and
 * write an audit-log snapshot first, so the data remains recoverable.
 */
export async function deleteEmployee(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async (tx) => {
    await tx.delete(payrollEntries).where(eq(payrollEntries.employeeId, id));
    await tx.delete(timePunches).where(eq(timePunches.employeeId, id));
    await tx.delete(scheduleShifts).where(eq(scheduleShifts.employeeId, id));
    await tx.delete(employees).where(eq(employees.id, id));
  });
}

/* -------------------- PAYROLL ENTRIES -------------------- */

export async function upsertPayrollEntry(data: InsertPayrollEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Find existing row by (employeeId, weekStart)
  const existing = await db
    .select()
    .from(payrollEntries)
    .where(
      and(
        eq(payrollEntries.employeeId, data.employeeId),
        eq(payrollEntries.weekStart, data.weekStart as Date),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(payrollEntries)
      .set({
        hoursWorked: data.hoursWorked,
        scheduledHours: data.scheduledHours,
        payRateSnapshot: data.payRateSnapshot,
        regularPay: data.regularPay,
        overtimePay: data.overtimePay,
        grossPay: data.grossPay,
        storeLocation: data.storeLocation,
        notes: data.notes,
      })
      .where(eq(payrollEntries.id, existing[0].id));
    return existing[0].id;
  }
  const result = await db.insert(payrollEntries).values(data);
  return Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
}

export async function getPayrollByWeek(weekStart: Date, stores?: string[]) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(payrollEntries.weekStart, weekStart)] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(payrollEntries.storeLocation, stores));
  }
  return db
    .select()
    .from(payrollEntries)
    .where(and(...conds));
}

export async function getEmployeePayrollHistory(employeeId: number, limit = 52) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(payrollEntries)
    .where(eq(payrollEntries.employeeId, employeeId))
    .orderBy(desc(payrollEntries.weekStart))
    .limit(limit);
}

export async function getPayrollRange(
  startDate: Date,
  endDate: Date,
  stores?: string[],
) {
  const db = await getDb();
  if (!db) return [];
  const conds = [
    gte(payrollEntries.weekStart, startDate),
    lte(payrollEntries.weekStart, endDate),
  ] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(payrollEntries.storeLocation, stores));
  }
  return db
    .select()
    .from(payrollEntries)
    .where(and(...conds))
    .orderBy(desc(payrollEntries.weekStart));
}

/* -------------------- TIME CLOCK -------------------- */

/**
 * Persist a new 4-digit clock code hash for an employee.
 * Caller must ensure uniqueness within the store and that `clockCodeHash`
 * is the result of hashClockCode(rawCode, employeeId).
 */
export async function setClockCodeHash(
  employeeId: number,
  clockCodeHash: string | null,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(employees).set({ clockCodeHash }).where(eq(employees.id, employeeId));
}

export async function findEmployeesWithClockCodes(store: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.storeLocation, store),
        eq(employees.active, 1),
      ),
    );
}

export async function findOpenPunch(employeeId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(timePunches)
    .where(and(eq(timePunches.employeeId, employeeId), isNull(timePunches.clockOutAt)))
    .orderBy(desc(timePunches.clockInAt))
    .limit(1);
  return rows[0];
}

/** Every open punch for one employee — normally 0 or 1, but duplicates can
 *  arrive via manual entry or imports, and clock-out must sweep them all. */
export async function findOpenPunches(employeeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(timePunches)
    .where(and(eq(timePunches.employeeId, employeeId), isNull(timePunches.clockOutAt)))
    .orderBy(desc(timePunches.clockInAt));
}

export async function openPunch(data: InsertTimePunch) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(timePunches).values(data);
  return Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
}

export async function closePunch(id: number, clockOutAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(timePunches).set({ clockOutAt }).where(eq(timePunches.id, id));
}

export async function listPunches(filter: {
  stores?: string[];
  employeeId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [] as any[];
  if (filter.stores && filter.stores.length > 0) {
    conds.push(inArray(timePunches.storeLocation, filter.stores));
  }
  if (filter.employeeId !== undefined) {
    conds.push(eq(timePunches.employeeId, filter.employeeId));
  }
  if (filter.startDate) conds.push(gte(timePunches.clockInAt, filter.startDate));
  if (filter.endDate) conds.push(lt(timePunches.clockInAt, filter.endDate));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(timePunches)
    .where(where as any)
    .orderBy(desc(timePunches.clockInAt))
    .limit(filter.limit ?? 500);
}

export async function getPunchById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(timePunches).where(eq(timePunches.id, id)).limit(1);
  return rows[0];
}

export async function createManualPunch(data: InsertTimePunch) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(timePunches).values({ ...data, source: "manual" });
  return Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
}

export async function updatePunch(
  id: number,
  data: Partial<Pick<InsertTimePunch, "clockInAt" | "clockOutAt" | "note">>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(timePunches).set(data).where(eq(timePunches.id, id));
}

export async function deletePunch(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(timePunches).where(eq(timePunches.id, id));
}

/**
 * Sum of completed punch durations (in hours) for an employee in [start, end).
 * Open punches (no clockOutAt yet) are counted up to `now`, but never past the
 * end of the queried week — otherwise a forgotten clock-out would inflate a
 * past week's totals a little more every day it stays open.
 */
export async function hoursWorkedForWeek(
  employeeId: number,
  start: Date,
  end: Date,
  now: Date = new Date(),
) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select()
    .from(timePunches)
    .where(
      and(
        eq(timePunches.employeeId, employeeId),
        gte(timePunches.clockInAt, start),
        lt(timePunches.clockInAt, end),
      ),
    )
    .orderBy(asc(timePunches.clockInAt));
  const openCap = Math.min(now.getTime(), end.getTime());
  let totalMs = 0;
  for (const r of rows) {
    const inAt = new Date(r.clockInAt).getTime();
    const outAt = r.clockOutAt ? new Date(r.clockOutAt).getTime() : openCap;
    if (outAt > inAt) totalMs += outAt - inAt;
  }
  return totalMs / 3_600_000;
}

/**
 * Bulk variant: returns a Map<employeeId, hours> for the given store filter.
 */
export async function hoursWorkedForWeekBulk(
  start: Date,
  end: Date,
  stores?: string[],
  now: Date = new Date(),
) {
  const db = await getDb();
  if (!db) return new Map<number, number>();
  const conds = [
    gte(timePunches.clockInAt, start),
    lt(timePunches.clockInAt, end),
  ] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(timePunches.storeLocation, stores));
  }
  const rows = await db
    .select()
    .from(timePunches)
    .where(and(...conds));
  const map = new Map<number, number>();
  // Same open-punch cap as hoursWorkedForWeek: never count past the week end.
  const openCap = Math.min(now.getTime(), end.getTime());
  for (const r of rows) {
    const inAt = new Date(r.clockInAt).getTime();
    const outAt = r.clockOutAt ? new Date(r.clockOutAt).getTime() : openCap;
    if (outAt <= inAt) continue;
    const hrs = (outAt - inAt) / 3_600_000;
    map.set(r.employeeId, (map.get(r.employeeId) ?? 0) + hrs);
  }
  return map;
}

/**
 * All punches that are currently open (clocked in, no clock-out yet),
 * optionally narrowed to a set of stores. Powers the live dashboard.
 */
export async function listOpenPunches(stores?: string[]) {
  const db = await getDb();
  if (!db) return [];
  const conds = [isNull(timePunches.clockOutAt)] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(timePunches.storeLocation, stores));
  }
  return db
    .select()
    .from(timePunches)
    .where(and(...conds))
    .orderBy(asc(timePunches.clockInAt));
}

/**
 * All punches whose clock-in falls in [start, end) for the given stores —
 * used to bucket clocked hours by pay week for the dashboard trend.
 * No row limit: the trend window is bounded (≤ 12 weeks) by the caller.
 */
export async function listPunchesInRange(start: Date, end: Date, stores?: string[]) {
  const db = await getDb();
  if (!db) return [];
  const conds = [gte(timePunches.clockInAt, start), lt(timePunches.clockInAt, end)] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(timePunches.storeLocation, stores));
  }
  return db
    .select()
    .from(timePunches)
    .where(and(...conds));
}

export async function countEmployees() {
  const db = await getDb();
  if (!db) return 0;
  const r = await db
    .select({ c: sql<number>`count(*)` })
    .from(employees)
    .where(eq(employees.active, 1));
  return Number(r[0]?.c ?? 0);
}

/* -------------------- SCHEDULE SHIFTS (day-level) -------------------- */

/**
 * Replace the full set of scheduled shifts for one employee in one pay week.
 * Runs in a transaction: the old set is only removed if the new set commits.
 */
export async function replaceWeekShifts(
  employeeId: number,
  weekStart: Date,
  shifts: Omit<InsertScheduleShift, "employeeId" | "weekStart">[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async (tx) => {
    await tx
      .delete(scheduleShifts)
      .where(
        and(
          eq(scheduleShifts.employeeId, employeeId),
          eq(scheduleShifts.weekStart, weekStart),
        ),
      );
    if (shifts.length > 0) {
      await tx
        .insert(scheduleShifts)
        .values(shifts.map((s) => ({ ...s, employeeId, weekStart })));
    }
  });
}

export async function getShiftsForWeek(weekStart: Date, stores?: string[]) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(scheduleShifts.weekStart, weekStart)] as any[];
  if (stores && stores.length > 0) {
    conds.push(inArray(scheduleShifts.storeLocation, stores));
  }
  return db
    .select()
    .from(scheduleShifts)
    .where(and(...conds))
    .orderBy(asc(scheduleShifts.shiftDate));
}

export async function getShiftsForEmployeeWeek(employeeId: number, weekStart: Date) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(scheduleShifts)
    .where(
      and(
        eq(scheduleShifts.employeeId, employeeId),
        eq(scheduleShifts.weekStart, weekStart),
      ),
    )
    .orderBy(asc(scheduleShifts.shiftDate));
}

/* -------------------- SCHEDULE IMPORTS -------------------- */

export async function createScheduleImport(data: InsertScheduleImport) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(scheduleImports).values(data);
  return Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
}

export async function markImportCommitted(id: number, counts?: { matchedCount?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(scheduleImports)
    .set({
      status: "committed",
      committedAt: new Date(),
      ...(counts?.matchedCount !== undefined ? { matchedCount: counts.matchedCount } : {}),
    })
    .where(eq(scheduleImports.id, id));
}

export async function getScheduleImportById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(scheduleImports)
    .where(eq(scheduleImports.id, id))
    .limit(1);
  return rows[0];
}

export async function listScheduleImports(filter?: { stores?: string[]; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conds = [] as any[];
  if (filter?.stores && filter.stores.length > 0) {
    conds.push(inArray(scheduleImports.storeLocation, filter.stores));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(scheduleImports)
    .where(where as any)
    .orderBy(desc(scheduleImports.createdAt))
    .limit(filter?.limit ?? 20);
}

/* -------------------- AUDIT LOG -------------------- */

/**
 * Append an audit entry. Never throws: an audit failure must not break the
 * underlying operation, so errors are logged and swallowed.
 */
export async function logAudit(entry: InsertAuditLogEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLog).values({
      ...entry,
      detail: entry.detail ? entry.detail.slice(0, 60_000) : entry.detail,
    });
  } catch (error) {
    console.error("[Audit] Failed to write audit entry:", error);
  }
}

export async function listAuditLog(filter?: {
  actorScope?: string;
  entityType?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [] as any[];
  if (filter?.actorScope) conds.push(eq(auditLog.actorScope, filter.actorScope));
  if (filter?.entityType) conds.push(eq(auditLog.entityType, filter.entityType));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(auditLog)
    .where(where as any)
    .orderBy(desc(auditLog.createdAt))
    .limit(filter?.limit ?? 100);
}
