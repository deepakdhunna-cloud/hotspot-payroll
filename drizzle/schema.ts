import {
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * - role "admin" = CEO (sees all stores + tax withholding)
 * - role "user"  = Manager (sees only assigned store(s))
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Assigns a manager (user) to one or more store locations.
 * If a user has zero assignments and is an admin, they see all stores.
 */
export const managerStores = mysqlTable(
  "manager_stores",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("idx_manager_stores_user").on(table.userId),
  }),
);

export type ManagerStore = typeof managerStores.$inferSelect;
export type InsertManagerStore = typeof managerStores.$inferInsert;

/**
 * Employee profile. payRate is hourly rate in USD.
 * storeLocation is one of the four Hotspot Market stores.
 */
export const employees = mysqlTable(
  "employees",
  {
    id: int("id").autoincrement().primaryKey(),
    fullName: varchar("fullName", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    payRate: decimal("payRate", { precision: 10, scale: 2 }).notNull(),
    role: varchar("role", { length: 64 }).notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }).notNull(),
    active: int("active").default(1).notNull(),
    /**
     * Manager-assigned 4-digit clock-in code, hashed.
     * Unique within a store (enforced in app logic). Null until set.
     */
    clockCodeHash: varchar("clockCodeHash", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    storeIdx: index("idx_employees_store").on(table.storeLocation),
  }),
);

/**
 * Individual clock-in / clock-out punches.
 * An "open" punch has clockOutAt = null; toggling on the kiosk closes it.
 * Manual entries are inserted with both timestamps set in one shot.
 */
export const timePunches = mysqlTable(
  "time_punches",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }).notNull(),
    clockInAt: timestamp("clockInAt").notNull(),
    clockOutAt: timestamp("clockOutAt"),
    source: mysqlEnum("source", ["kiosk", "manual"]).default("kiosk").notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    employeeIdx: index("idx_time_punches_employee").on(table.employeeId),
    storeWeekIdx: index("idx_time_punches_store_in").on(
      table.storeLocation,
      table.clockInAt,
    ),
  }),
);

export type TimePunch = typeof timePunches.$inferSelect;
export type InsertTimePunch = typeof timePunches.$inferInsert;

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

/**
 * Weekly payroll entry. One row per employee per week.
 * weekStart is a UTC Monday timestamp.
 */
export const payrollEntries = mysqlTable(
  "payroll_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }).notNull(),
    weekStart: timestamp("weekStart").notNull(),
    hoursWorked: decimal("hoursWorked", { precision: 6, scale: 2 }).notNull().default("0"),
    scheduledHours: decimal("scheduledHours", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    // Snapshot of pay rate at the time of entry, so historical records stay correct
    // even if the employee's pay rate later changes.
    payRateSnapshot: decimal("payRateSnapshot", { precision: 10, scale: 2 }).notNull(),
    regularPay: decimal("regularPay", { precision: 10, scale: 2 }).notNull().default("0"),
    overtimePay: decimal("overtimePay", { precision: 10, scale: 2 }).notNull().default("0"),
    grossPay: decimal("grossPay", { precision: 10, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    employeeWeekIdx: index("idx_payroll_employee_week").on(table.employeeId, table.weekStart),
    storeWeekIdx: index("idx_payroll_store_week").on(table.storeLocation, table.weekStart),
  }),
);

export type PayrollEntry = typeof payrollEntries.$inferSelect;
export type InsertPayrollEntry = typeof payrollEntries.$inferInsert;

/**
 * PIN codes for the simple keypad sign-in.
 * scope = 'ceo' OR one of the four store names.
 * pinHash = sha256(pin + scope) — never store raw PINs.
 */
export const pinCodes = mysqlTable(
  "pin_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: varchar("scope", { length: 64 }).notNull().unique(),
    pinHash: varchar("pinHash", { length: 128 }).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
);

export type PinCode = typeof pinCodes.$inferSelect;
export type InsertPinCode = typeof pinCodes.$inferInsert;

/**
 * One scheduled shift for one employee on one calendar day.
 * Rows are produced by the schedule import (day-level extraction) or manual
 * edits, and are replaced as a set per (employeeId, weekStart) on commit.
 */
export const scheduleShifts = mysqlTable(
  "schedule_shifts",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }).notNull(),
    /** Thursday-anchored pay-week start (00:00 UTC). */
    weekStart: timestamp("weekStart").notNull(),
    /** The calendar day of the shift (00:00 UTC). */
    shiftDate: timestamp("shiftDate").notNull(),
    /** Shift times as printed on the schedule, e.g. "9:00am". Optional. */
    startLabel: varchar("startLabel", { length: 32 }),
    endLabel: varchar("endLabel", { length: 32 }),
    hours: decimal("hours", { precision: 5, scale: 2 }).notNull(),
    source: mysqlEnum("source", ["import", "manual"]).default("import").notNull(),
    /** Link back to the schedule_imports row that produced this shift. */
    importId: int("importId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    employeeWeekIdx: index("idx_schedule_shifts_emp_week").on(
      table.employeeId,
      table.weekStart,
    ),
    storeWeekIdx: index("idx_schedule_shifts_store_week").on(
      table.storeLocation,
      table.weekStart,
    ),
  }),
);

export type ScheduleShift = typeof scheduleShifts.$inferSelect;
export type InsertScheduleShift = typeof scheduleShifts.$inferInsert;

/**
 * Audit trail of schedule uploads: who uploaded what file for which week,
 * what was extracted, and whether it was committed to payroll.
 */
export const scheduleImports = mysqlTable(
  "schedule_imports",
  {
    id: int("id").autoincrement().primaryKey(),
    /** PIN scope that performed the upload ("ceo" or a store name). */
    uploadedBy: varchar("uploadedBy", { length: 64 }).notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }),
    weekStart: timestamp("weekStart").notNull(),
    fileUrl: text("fileUrl").notNull(),
    filename: varchar("filename", { length: 200 }).notNull(),
    status: mysqlEnum("status", ["parsed", "committed"]).default("parsed").notNull(),
    employeeCount: int("employeeCount").default(0).notNull(),
    matchedCount: int("matchedCount").default(0).notNull(),
    unmatchedCount: int("unmatchedCount").default(0).notNull(),
    totalHours: decimal("totalHours", { precision: 8, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    committedAt: timestamp("committedAt"),
  },
  (table) => ({
    weekIdx: index("idx_schedule_imports_week").on(table.weekStart),
  }),
);

export type ScheduleImport = typeof scheduleImports.$inferSelect;
export type InsertScheduleImport = typeof scheduleImports.$inferInsert;

/**
 * Append-only audit log. Every sensitive mutation writes a row so data is
 * never silently lost: deletes keep a JSON snapshot of what was removed.
 */
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: int("id").autoincrement().primaryKey(),
    /** PIN scope that performed the action ("ceo", a store name, or "kiosk"). */
    actorScope: varchar("actorScope", { length: 64 }).notNull(),
    /** Dotted action name, e.g. "employees.delete", "auth.pin_failed". */
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entityType", { length: 64 }),
    entityId: int("entityId"),
    /** JSON payload with action detail / snapshots of removed data. */
    detail: text("detail"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    createdIdx: index("idx_audit_log_created").on(table.createdAt),
    entityIdx: index("idx_audit_log_entity").on(table.entityType, table.entityId),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;

/**
 * Attention items — the site-wide assistant's persistent task list.
 * Detection scans live data and upserts one row per discrepancy (unique by
 * refKey). Items stay OPEN — stacking up with their first-detected date —
 * until a manager/CEO resolves them (approve/review) or the underlying
 * condition verifiably clears (resolution "auto").
 */
export const attentionItems = mysqlTable(
  "attention_items",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Stable dedupe key, e.g. "long_punch:15570001" or "mismatch:9:2026-07-09". */
    refKey: varchar("refKey", { length: 120 }).notNull().unique(),
    /** long_punch | hours_mismatch | missing_schedule | missing_codes | unsaved_payroll */
    kind: varchar("kind", { length: 32 }).notNull(),
    storeLocation: varchar("storeLocation", { length: 64 }),
    employeeId: int("employeeId"),
    punchId: int("punchId"),
    weekStart: datetime("weekStart"),
    title: varchar("title", { length: 255 }).notNull(),
    detail: text("detail"),
    status: mysqlEnum("status", ["open", "resolved"]).default("open").notNull(),
    /** approved | reviewed | dismissed | auto */
    resolution: varchar("resolution", { length: 16 }),
    resolvedBy: varchar("resolvedBy", { length: 64 }),
    resolvedAt: datetime("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("idx_attention_status").on(table.status, table.storeLocation),
  }),
);

export type AttentionItem = typeof attentionItems.$inferSelect;
export type InsertAttentionItem = typeof attentionItems.$inferInsert;
