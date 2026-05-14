// Hotspot Market shared constants
// Keep store names and roles consistent across the entire app.

export const STORES = [
  "Hotspot Market 11",
  "Hotspot Market 13",
  "Hotspot Market 14",
  "Hotspot Travel Center",
] as const;

export type Store = (typeof STORES)[number];

export const ROLES = [
  "Manager",
  "Assistant Manager",
  "Cashier",
  "Kitchen Manager",
  "Cook",
  "Janitorial",
] as const;

export type EmployeeRole = (typeof ROLES)[number];

export const OVERTIME_THRESHOLD_HOURS = 40;
export const OVERTIME_MULTIPLIER = 1.5;

// Approximate tax withholding rates (estimates only - for CEO planning view).
// Federal: simplified flat estimate covering FICA (7.65%) + federal income tax estimate.
// State: a conservative state income tax estimate (configurable).
export const FEDERAL_TAX_RATE = 0.18; // 18% federal estimate (FIT + FICA combined approx.)
export const STATE_TAX_RATE = 0.05; // 5% state estimate

export function computeGrossPay(hoursWorked: number, payRate: number) {
  const regularHours = Math.min(hoursWorked, OVERTIME_THRESHOLD_HOURS);
  const overtimeHours = Math.max(0, hoursWorked - OVERTIME_THRESHOLD_HOURS);
  const regularPay = regularHours * payRate;
  const overtimePay = overtimeHours * payRate * OVERTIME_MULTIPLIER;
  return {
    regularHours,
    overtimeHours,
    regularPay,
    overtimePay,
    grossPay: regularPay + overtimePay,
  };
}

export function estimateWithholding(grossPay: number) {
  const federal = grossPay * FEDERAL_TAX_RATE;
  const state = grossPay * STATE_TAX_RATE;
  return {
    federal,
    state,
    totalTax: federal + state,
    netPay: grossPay - federal - state,
  };
}

// Get the Monday of the week containing the given date (in UTC).
// Returns a Date set to 00:00:00 UTC on Monday.
export function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} – ${fmt(end)}`;
}
