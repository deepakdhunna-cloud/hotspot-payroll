import {
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
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    storeIdx: index("idx_employees_store").on(table.storeLocation),
  }),
);

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
