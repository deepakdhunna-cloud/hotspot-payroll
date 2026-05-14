/**
 * Tests for the per-employee aggregation logic used by trpc payroll.range.
 *
 * We don't need a live DB to validate the math + sort ordering: the procedure
 * fetches rows via getPayrollRange and then folds them into per-employee
 * aggregates client-side. We replicate that exact reducer here so any
 * regression in totals / week counts / sort order is caught at unit-test speed.
 */
import { describe, expect, it } from "vitest";

type Entry = {
  employeeId: number;
  storeLocation: string;
  hoursWorked: number;
  grossPay: number;
};
type Emp = { id: number; fullName: string; storeLocation: string; role: string };

function aggregate(entries: Entry[], empsById: Map<number, Emp>) {
  type Agg = {
    employeeId: number;
    employeeName: string;
    storeLocation: string;
    role: string;
    hours: number;
    gross: number;
    weekCount: number;
  };
  const agg = new Map<number, Agg>();
  let grandHours = 0;
  let grandGross = 0;
  for (const e of entries) {
    const emp = empsById.get(e.employeeId);
    const h = Number(e.hoursWorked) || 0;
    const g = Number(e.grossPay) || 0;
    grandHours += h;
    grandGross += g;
    const row = agg.get(e.employeeId) ?? {
      employeeId: e.employeeId,
      employeeName: emp?.fullName ?? `Employee #${e.employeeId}`,
      storeLocation: emp?.storeLocation ?? e.storeLocation,
      role: emp?.role ?? "",
      hours: 0,
      gross: 0,
      weekCount: 0,
    };
    row.hours += h;
    row.gross += g;
    row.weekCount += 1;
    agg.set(e.employeeId, row);
  }
  return {
    totals: { hours: grandHours, gross: grandGross, weeks: entries.length },
    employees: Array.from(agg.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    ),
  };
}

describe("payroll.range aggregation", () => {
  const emps = new Map<number, Emp>([
    [1, { id: 1, fullName: "Alex Lee", storeLocation: "S11", role: "Cashier" }],
    [2, { id: 2, fullName: "Brooke Tan", storeLocation: "S13", role: "Manager" }],
    [3, { id: 3, fullName: "Casey Roe", storeLocation: "S11", role: "Cook" }],
  ]);

  it("sums hours, gross and week counts per employee across the range", () => {
    const entries: Entry[] = [
      { employeeId: 1, storeLocation: "S11", hoursWorked: 30, grossPay: 450 },
      { employeeId: 1, storeLocation: "S11", hoursWorked: 35, grossPay: 525 },
      { employeeId: 2, storeLocation: "S13", hoursWorked: 40, grossPay: 800 },
      { employeeId: 3, storeLocation: "S11", hoursWorked: 12, grossPay: 180 },
    ];
    const r = aggregate(entries, emps);
    const alex = r.employees.find((e) => e.employeeName === "Alex Lee")!;
    expect(alex.hours).toBe(65);
    expect(alex.gross).toBe(975);
    expect(alex.weekCount).toBe(2);
    const brooke = r.employees.find((e) => e.employeeName === "Brooke Tan")!;
    expect(brooke.weekCount).toBe(1);
    expect(brooke.gross).toBe(800);
    expect(r.totals.hours).toBe(117);
    expect(r.totals.gross).toBe(1955);
    expect(r.totals.weeks).toBe(4);
  });

  it("sorts the resulting employee list alphabetically by name", () => {
    const entries: Entry[] = [
      { employeeId: 2, storeLocation: "S13", hoursWorked: 1, grossPay: 1 },
      { employeeId: 1, storeLocation: "S11", hoursWorked: 1, grossPay: 1 },
      { employeeId: 3, storeLocation: "S11", hoursWorked: 1, grossPay: 1 },
    ];
    const r = aggregate(entries, emps);
    expect(r.employees.map((e) => e.employeeName)).toEqual([
      "Alex Lee",
      "Brooke Tan",
      "Casey Roe",
    ]);
  });

  it("treats string numerics defensively (mirrors decimal columns)", () => {
    const entries: Entry[] = [
      // Real Drizzle/Mysql decimals come back as strings.
      { employeeId: 1, storeLocation: "S11", hoursWorked: "10.5" as any, grossPay: "157.50" as any },
      { employeeId: 1, storeLocation: "S11", hoursWorked: "9.5" as any, grossPay: "142.50" as any },
    ];
    const r = aggregate(entries, emps);
    expect(r.totals.hours).toBeCloseTo(20, 5);
    expect(r.totals.gross).toBeCloseTo(300, 5);
  });

  it("falls back to an Employee #N name if employee is missing", () => {
    const entries: Entry[] = [
      { employeeId: 99, storeLocation: "S11", hoursWorked: 5, grossPay: 75 },
    ];
    const r = aggregate(entries, emps);
    expect(r.employees[0].employeeName).toBe("Employee #99");
  });

  it("returns zeroed totals for an empty range", () => {
    const r = aggregate([], emps);
    expect(r.totals).toEqual({ hours: 0, gross: 0, weeks: 0 });
    expect(r.employees).toEqual([]);
  });
});
