/**
 * Regression tests for the "missing clocked hours" bug (Jul 16–22 week):
 * schedule.commit used to create payroll entries with hoursWorked=0 that
 * the Hours & pay grid then treated as manager-saved rows, hiding the
 * clock-punch auto-prefill for the whole week.
 *
 * These tests run only when DATABASE_URL points at a disposable test
 * database (set TEST_DATABASE_URL); otherwise they are skipped, matching
 * the repo's no-database default test mode.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";

const TEST_URL = process.env.TEST_DATABASE_URL;

const d = describe.runIf(Boolean(TEST_URL));

d("schedule.commit schedule-only marker (db integration)", () => {
  let conn: mysql.Connection;
  let appRouter: typeof import("./routers").appRouter;
  let empA = 0;
  let empB = 0;
  const WEEK = new Date("2026-07-16T00:00:00Z");

  function ceoCtx() {
    return {
      session: { scope: "ceo", role: "admin", store: null, issuedAt: Date.now() },
      req: { headers: {} },
      res: {},
    } as unknown as import("./_core/context").TrpcContext;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    ({ appRouter } = await import("./routers"));
    conn = await mysql.createConnection(TEST_URL!);
    const [a] = await conn.query<any>(
      "INSERT INTO employees (fullName, phone, payRate, role, storeLocation, active) VALUES ('Test SchedOnly A', '555-0001', 15.00, 'Cashier', 'Hotspot Market 11', 1)",
    );
    empA = (a as any).insertId;
    const [b] = await conn.query<any>(
      "INSERT INTO employees (fullName, phone, payRate, role, storeLocation, active) VALUES ('Test SchedOnly B', '555-0002', 16.00, 'Cook', 'Hotspot Market 11', 1)",
    );
    empB = (b as any).insertId;
    // empB already has a real saved entry with notes=fixed-pay for the week.
    await conn.query(
      "INSERT INTO payroll_entries (employeeId, storeLocation, weekStart, hoursWorked, scheduledHours, payRateSnapshot, regularPay, overtimePay, grossPay, notes) VALUES (?, 'Hotspot Market 11', ?, '10.00', '0.00', '16.00', '500.00', '0.00', '500.00', 'fixed-pay')",
      [empB, WEEK],
    );
  });

  afterAll(async () => {
    if (!conn) return;
    await conn.query("DELETE FROM payroll_entries WHERE employeeId IN (?, ?)", [empA, empB]);
    await conn.query("DELETE FROM schedule_shifts WHERE employeeId IN (?, ?)", [empA, empB]);
    await conn.query("DELETE FROM employees WHERE id IN (?, ?)", [empA, empB]);
    await conn.end();
  });

  it("marks a freshly created entry schedule-only and preserves existing notes", async () => {
    const caller = appRouter.createCaller(ceoCtx());
    const result = await caller.schedule.commit({
      weekStart: WEEK,
      entries: [
        { employeeId: empA, scheduledHours: 24 },
        { employeeId: empB, scheduledHours: 30 },
      ],
    });
    expect(result.saved).toBe(2);

    const [rows] = await conn.query<any[]>(
      "SELECT employeeId, hoursWorked, scheduledHours, notes FROM payroll_entries WHERE employeeId IN (?, ?) AND weekStart = ?",
      [empA, empB, WEEK],
    );
    const byEmp = new Map((rows as any[]).map((r) => [r.employeeId, r]));

    // Fresh row: hours stay 0 but the row is flagged as schedule-only so
    // the grid keeps prefilling from clock punches.
    expect(Number(byEmp.get(empA).hoursWorked)).toBe(0);
    expect(byEmp.get(empA).notes).toBe("schedule-only");
    expect(Number(byEmp.get(empA).scheduledHours)).toBe(24);

    // Existing row: hours and its real note survive the commit untouched.
    expect(Number(byEmp.get(empB).hoursWorked)).toBe(10);
    expect(byEmp.get(empB).notes).toBe("fixed-pay");
    expect(Number(byEmp.get(empB).scheduledHours)).toBe(30);
  });
});
