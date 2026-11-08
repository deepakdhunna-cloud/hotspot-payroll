/**
 * History tab — multi-week payroll summary across any Thursday-anchored range.
 * Saved payroll entries are persisted permanently, so managers/CEO can look
 * back as many weeks as they want. Includes an xlsx export of the range.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { TableStateRows } from "@/components/QueryStates";
import {
  currentPayPeriodStart,
  fromDateInput,
  shiftPayWeek,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { CalendarCheck, Clock, FileSpreadsheet, UserRound, Wallet } from "lucide-react";
import { toast } from "sonner";

export default function HistoryTab({
  storeFilter,
}: {
  storeFilter: string;
}) {
  // Default: last 8 closed pay periods, ending at the last closed week.
  const [startWeek, setStartWeek] = useState<Date>(() =>
    shiftPayWeek(currentPayPeriodStart(), -7),
  );
  const [endWeek, setEndWeek] = useState<Date>(() => currentPayPeriodStart());

  // Keep the range ordered: if start ends up after end, clamp end to start.
  const changeStart = (d: Date) => {
    setStartWeek(d);
    if (d.getTime() > endWeek.getTime()) setEndWeek(new Date(d));
  };
  const changeEnd = (d: Date) => {
    setEndWeek(d.getTime() < startWeek.getTime() ? new Date(startWeek) : d);
  };

  // Quick presets: N closed pay weeks ending at the last closed week.
  const applyPreset = (weeks: number) => {
    const end = currentPayPeriodStart();
    setEndWeek(end);
    setStartWeek(shiftPayWeek(end, -(weeks - 1)));
  };

  const rangeQ = trpc.payroll.range.useQuery({
    startWeek,
    endWeek,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const weekCount = useMemo(() => {
    const diff = Math.round(
      (endWeek.getTime() - startWeek.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    return Math.max(1, diff + 1);
  }, [startWeek, endWeek]);

  const employees = rangeQ.data?.employees ?? [];
  const totals = rangeQ.data?.totals ?? { hours: 0, gross: 0, weeks: 0 };

  const handleExport = async () => {
    const rangeLabel = `${fmtWeekRange(startWeek)} → ${fmtWeekRange(endWeek)}`;
    const filename = `Hotspot-Payroll-History-${toDateInput(
      startWeek,
    )}_to_${toDateInput(endWeek)}.xlsx`;
    try {
    await exportXlsx<{
      employee: string;
      store: string;
      role: string;
      weeks: number;
      hours: number;
      avgWeekly: number;
      gross: number;
    }>(filename, {
      name: "Payroll history",
      title: "Hotspot Market — Payroll history",
      subtitle: `Range: ${rangeLabel}`,
      columns: [
        { header: "Employee", key: "employee", width: 26 },
        { header: "Store", key: "store", width: 18 },
        { header: "Role", key: "role", width: 14 },
        {
          header: "Weeks paid",
          key: "weeks",
          width: 12,
          numFmt: "0",
          align: "right",
        },
        {
          header: "Total hours",
          key: "hours",
          width: 14,
          numFmt: "0.00",
          align: "right",
        },
        {
          header: "Avg hrs/wk",
          key: "avgWeekly",
          width: 12,
          numFmt: "0.00",
          align: "right",
        },
        {
          header: "Total gross",
          key: "gross",
          width: 14,
          numFmt: "$#,##0.00",
          align: "right",
        },
      ],
      rows: employees.map((e) => ({
        employee: e.employeeName,
        store: e.storeLocation,
        role: e.role,
        weeks: e.weekCount,
        hours: e.hours,
        avgWeekly: e.weekCount > 0 ? e.hours / e.weekCount : 0,
        gross: e.gross,
      })),
      totals: {
        weeks: totals.weeks,
        hours: totals.hours,
        gross: totals.gross,
      },
      totalsLabelKey: "employee",
      totalsLabel: "Totals",
    });
    toast.success("Spreadsheet downloaded.");
    } catch (err) {
      console.error("[Export] failed:", err);
      toast.error(
        "Couldn't build the spreadsheet — a new version of the app was likely deployed. Refresh the page and export again.",
      );
    }
  };

  const lastClosed = currentPayPeriodStart().getTime();
  const activePreset =
    endWeek.getTime() === lastClosed
      ? [4, 8, 13].find((w) => weekCount === w) ?? null
      : null;
  const multiStore = new Set(employees.map((e) => e.storeLocation)).size > 1;
  const positionItems = employees
    .map((e) => ({ role: e.role, hours: e.hours, gross: e.gross }))
    .filter((it) => it.hours > 0 || it.gross > 0);

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Toolbar: pick a range, then export it */}
      <div className="surface-card p-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="inline-flex w-full sm:w-auto items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {[4, 8, 13].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => applyPreset(w)}
              title={`Last ${w} closed pay weeks`}
              className={`h-8 flex-1 sm:flex-none rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors ${
                activePreset === w
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w} weeks
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Input
            type="date"
            aria-label="From pay week"
            value={toDateInput(startWeek)}
            onChange={(e) => {
              if (!e.target.value) return;
              changeStart(startOfPayWeek(fromDateInput(e.target.value)));
            }}
            className="h-9 w-full sm:w-40"
          />
          <span>to</span>
          <Input
            type="date"
            aria-label="To pay week"
            value={toDateInput(endWeek)}
            onChange={(e) => {
              if (!e.target.value) return;
              changeEnd(startOfPayWeek(fromDateInput(e.target.value)));
            }}
            className="h-9 w-full sm:w-40"
          />
        </div>
        <Button
          variant="outline"
          className="h-9 lg:ml-auto"
          onClick={handleExport}
          disabled={!rangeQ.data || employees.length === 0}
          title="Download this range as an .xlsx spreadsheet (opens in Google Sheets)"
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Export {weekCount} week{weekCount === 1 ? "" : "s"}
        </Button>
      </div>

      <KpiBand className="grid-cols-2 xl:grid-cols-3">
        <KpiCell hero icon={<Wallet />} label="Gross pay" value={<Money value={totals.gross} />} sub={`${fmtWeekRange(startWeek)} → ${fmtWeekRange(endWeek)}`} />
        <KpiCell hue="blue" icon={<Clock />} label="Hours" value={totals.hours.toFixed(1)} sub={`over ${weekCount} pay week${weekCount === 1 ? "" : "s"}`} />
        <KpiCell hue="teal" icon={<CalendarCheck />} label="Paid weeks" value={totals.weeks} sub="one per person per week" />
      </KpiBand>

      <Card className="surface-card border-0 gap-0 py-0">
        <CardHeader className="px-4 sm:px-5 pt-4 pb-2">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <UserRound />
            </span>
            By employee
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-5">Employee</TableHead>
                  {multiStore ? <TableHead className="hidden md:table-cell">Store</TableHead> : null}
                  <TableHead className="hidden md:table-cell text-right">Weeks</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Avg / week</TableHead>
                  <TableHead className="text-right pr-4 sm:pr-5">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableStateRows
                  colSpan={multiStore ? 6 : 5}
                  isLoading={rangeQ.isLoading}
                  isError={rangeQ.isError}
                  onRetry={() => rangeQ.refetch()}
                  isEmpty={!rangeQ.isLoading && employees.length === 0}
                  emptyTitle="No saved payroll in this range"
                  emptyHint="Weeks show up here once their payroll is saved."
                />
                {employees.map((e) => (
                  <TableRow key={e.employeeId}>
                    <TableCell className="pl-4 sm:pl-5">
                      <p className="font-medium">{e.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{e.role}</p>
                    </TableCell>
                    {multiStore ? (
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {e.weekCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.hours.toFixed(1)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
                      {(e.weekCount > 0 ? e.hours / e.weekCount : 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium pr-4 sm:pr-5">
                      {fmtMoney(e.gross)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {employees.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4 sm:pl-5 font-medium">Total</TableCell>
                    {multiStore ? <TableCell className="hidden md:table-cell" /> : null}
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {totals.weeks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {totals.hours.toFixed(1)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="text-right tabular-nums font-medium pr-4 sm:pr-5">
                      {fmtMoney(totals.gross)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <PositionBreakdown items={positionItems} />
    </div>
  );
}
