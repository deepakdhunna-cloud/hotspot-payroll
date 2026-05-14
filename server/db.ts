import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  employees,
  InsertEmployee,
  InsertManagerStore,
  InsertPayrollEntry,
  InsertUser,
  managerStores,
  payrollEntries,
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
 * Permanently delete an employee and their entire payroll history.
 * This cannot be undone — callers must confirm in the UI.
 */
export async function deleteEmployee(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(payrollEntries).where(eq(payrollEntries.employeeId, id));
  await db.delete(employees).where(eq(employees.id, id));
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

export async function countEmployees() {
  const db = await getDb();
  if (!db) return 0;
  const r = await db
    .select({ c: sql<number>`count(*)` })
    .from(employees)
    .where(eq(employees.active, 1));
  return Number(r[0]?.c ?? 0);
}
