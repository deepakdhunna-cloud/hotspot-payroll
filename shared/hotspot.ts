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

// Approximate tax withholding rates (estimates only - for CEO planning view).
// Federal: simplified flat estimate covering FICA (7.65%) + federal income tax estimate.
// State: a conservative state income tax estimate (configurable).
export const FEDERAL_TAX_RATE = 0.18; // 18% federal estimate (FIT + FICA combined approx.)
export const STATE_TAX_RATE = 0.05; // 5% state estimate

/**
 * Gross pay = hours worked × pay rate. Overtime is not applied; the business
 * tracks every hour at the employee's standard rate.
 */
export function computeGrossPay(hoursWorked: number, payRate: number) {
  const grossPay = hoursWorked * payRate;
  return {
    regularHours: hoursWorked,
    regularPay: grossPay,
    grossPay,
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

/**
 * Hotspot pay period runs Thursday – Wednesday.
 * getWeekStart returns the Thursday on or before the given date, at 00:00 UTC.
 */
export const PAY_WEEK_START_DAY = 4; // Thursday (Sun=0..Sat=6)

export function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day - PAY_WEEK_START_DAY + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} – ${fmt(end)}`;
}
