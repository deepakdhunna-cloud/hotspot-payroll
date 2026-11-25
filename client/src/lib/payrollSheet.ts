/**
 * One pay week as a spreadsheet, plus the words that go with it when it is
 * shared. The weekly timesheet and the command center's autopilot both build
 * their export from here, so the file is the same wherever it is made.
 */
import {
  STORE_ABBR,
  fmtDayRange,
  fmtDaySpan,
  fmtHours,
  fmtMoney,
  fmtWeekRange,
} from "@/lib/format";
import { addDaysMarker, toDateInput, type PeriodDays } from "@/lib/payweek";
import type { XlsxSheet } from "@/lib/xlsx";

export type WeekSheetRow = {
  employee: string;
  store: string;
  role: string;
  payType: string;
  rate: number;
  scheduled: number;
  hours: number;
  gross: number;
  /** "Saved", "Not saved", "Edited, not saved" or "No hours". */
  status: string;
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * When a payroll doesn't pay exactly Thursday → Wednesday, the line that
 * says so — whoever receives the file needs to know which days it covers
 * and where the rest went.
 */
export function periodNote(weekStart: Date, period: PeriodDays | null | undefined): string | null {
  if (!period) return null;
  const first = new Date(period.firstDay);
  const last = new Date(period.lastDay);
  const thursday = weekStart;
  const wednesday = addDaysMarker(weekStart, 6);
  const parts: string[] = [];
  if (first.getTime() < thursday.getTime()) {
    parts.push(`includes ${fmtDaySpan(first, addDaysMarker(thursday, -1))} from last week`);
  }
  if (last.getTime() < wednesday.getTime()) {
    parts.push(`${fmtDaySpan(addDaysMarker(last, 1), wednesday)} is paid with next week's payroll`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

export function buildWeekSheet(args: {
  weekStart: Date;
  /**
   * The days this payroll pays, when known. A week that ends early or takes
   * in days from the week before is labelled and named by those days.
   */
  period?: PeriodDays | null;
  /** The one store this covers, or null for all stores. */
  scopeStore: string | null;
  rows: WeekSheetRow[];
  totals: { scheduled: number; hours: number; gross: number };
}): { filename: string; sheet: XlsxSheet<WeekSheetRow>; title: string; text: string } {
  const { weekStart, period, scopeStore, rows, totals } = args;
  const firstDay = period ? new Date(period.firstDay) : weekStart;
  const weekEnd = period ? new Date(period.lastDay) : addDaysMarker(weekStart, 6);
  const range = period ? fmtDayRange(firstDay, weekEnd) : fmtWeekRange(weekStart);
  const note = periodNote(weekStart, period);
  const year = weekEnd.getUTCFullYear();
  const storeLabel = scopeStore ?? "All stores";
  const storeSlug = (scopeStore ? (STORE_ABBR[scopeStore] ?? scopeStore) : "All-stores").replace(
    /\s+/g,
    "-",
  );
  const filename = `Hotspot-Payroll-${toDateInput(firstDay)}_to_${toDateInput(weekEnd)}-${storeSlug}.xlsx`;
  const paid = rows.filter((r) => r.status !== "No hours");
  const savedN = paid.filter((r) => r.status === "Saved").length;
  const pendingN = paid.length - savedN;

  const sheet: XlsxSheet<WeekSheetRow> = {
    name: "Hours & pay",
    title: "Weekly payroll",
    subtitle: `Pay week ${range}, ${year} · ${storeLabel}${note ? ` · ${note}` : ""}`,
    summary: [
      { label: "Gross pay", value: fmtMoney(totals.gross) },
      { label: "Hours worked", value: fmtHours(totals.hours, 2) },
      { label: "People paid", value: String(paid.length) },
      { label: "Saved to payroll", value: `${savedN} of ${paid.length}` },
    ],
    columns: [
      { header: "Employee", key: "employee", width: 26 },
      { header: "Store", key: "store", width: 20 },
      { header: "Role", key: "role", width: 18 },
      { header: "Pay type", key: "payType", width: 11 },
      { header: "Hourly rate", key: "rate", width: 12, numFmt: "$#,##0.00", align: "right" },
      { header: "Scheduled hours", key: "scheduled", width: 16, numFmt: "#,##0.0", align: "right" },
      { header: "Hours worked", key: "hours", width: 14, numFmt: "#,##0.00", align: "right" },
      { header: "Gross pay", key: "gross", width: 14, numFmt: "$#,##0.00", align: "right" },
      {
        header: "Status",
        key: "status",
        width: 18,
        tone: (r) => (r.status === "Saved" ? "good" : r.status === "No hours" ? "muted" : "warn"),
      },
    ],
    rows,
    totals: {
      scheduled: Number(totals.scheduled.toFixed(2)),
      hours: Number(totals.hours.toFixed(2)),
      gross: Number(totals.gross.toFixed(2)),
    },
    totalsLabelKey: "employee",
    totalsLabel: "Total",
  };

  return {
    filename,
    sheet,
    title: `Hotspot payroll · ${range}`,
    text: [
      `${storeLabel} — pay week ${range}, ${year}`,
      ...(note ? [`Note: ${note.charAt(0).toUpperCase()}${note.slice(1)}.`] : []),
      `${paid.length} ${plural(paid.length, "person", "people")} · ${fmtHours(totals.hours, 2)} hours · ${fmtMoney(totals.gross)} gross`,
      pendingN > 0
        ? `${pendingN} ${plural(pendingN, "row")} not saved to payroll yet`
        : "Everyone is saved to payroll",
    ].join("\n"),
  };
}
