/**
 * History tab — saved payroll across any range of Thursday-anchored pay
 * weeks. Saved payroll entries are permanent, so managers and the CEO can
 * look back as far as they like. Only payroll that was actually saved counts
 * here (schedule placeholders are left out on the server); the range exports
 * to .xlsx.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtHours, fmtMoney, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { TableStateRows } from "@/components/QueryStates";
import {
  currentPayPeriodStart,
  fromDateInput,
  inProgressPayWeekStart,
  shiftPayWeek,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { CalendarCheck, Clock, FileSpreadsheet, Loader2, UserRound, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStoreScope } from "@/contexts/StoreScopeContext";

const PRESETS = [4, 8, 13] as const;

/** The Wednesday that closes a pay week. */
function weekEndOf(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

/** "Sep 10 – Nov 4, 2026" (year on both ends only when they differ). */
function fmtSpan(start: Date, endWeek: Date): string {
  const end = weekEndOf(endWeek);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const md: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const mdy: Intl.DateTimeFormatOptions = { ...md, year: "numeric" };
  return `${start.toLocaleDateString("en-US", sameYear ? md : mdy)} – ${end.toLocaleDateString("en-US", mdy)}`;
}

export default function HistoryTab({
  storeFilter,
}: {
  storeFilter: string;
}) {
  // Default: the last 8 closed pay weeks, ending at the last closed week.
  const [startWeek, setStartWeek] = useState<Date>(() =>
    shiftPayWeek(currentPayPeriodStart(), -7),
  );
  const [endWeek, setEndWeek] = useState<Date>(() => currentPayPeriodStart());
  const [exporting, setExporting] = useState(false);
  const { stores: visibleStores } = useStoreScope();
  // "All" for a one-store login IS that store — name it in exports.
  const scopeStore =
    storeFilter !== "all" ? storeFilter : visibleStores.length === 1 ? visibleStores[0] : null;

  // Keep the range ordered: if start ends up after end, move end to start.
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
  const ready = rangeQ.isSuccess;
  const span = fmtSpan(startWeek, endWeek);
  // Weeks that haven't started can't be picked.
  const maxDay = toDateInput(weekEndOf(inProgressPayWeekStart()));

  const handleExport = async () => {
    const storeLabel = scopeStore ?? "All stores";
    const storeSlug = (scopeStore ? (STORE_ABBR[scopeStore] ?? scopeStore) : "All-stores").replace(/\s+/g, "-");
    const filename = `Hotspot-Payroll-History-${toDateInput(startWeek)}_to_${toDateInput(
      weekEndOf(endWeek),
    )}-${storeSlug}.xlsx`;
    setExporting(true);
    try {
      await exportXlsx(filename, {
        name: "Payroll history",
        title: "Hotspot Market — Payroll history",
        subtitle: `${span} · ${weekCount} pay ${weekCount === 1 ? "week" : "weeks"} · ${storeLabel}`,
        columns: [
          { header: "Employee", key: "employee", width: 26 },
          { header: "Store", key: "store", width: 20 },
          { header: "Role", key: "role", width: 18 },
          { header: "Weeks paid", key: "weeks", width: 12, numFmt: "0", align: "right" },
          { header: "Hours worked", key: "hours", width: 14, numFmt: "0.00", align: "right" },
          { header: "Avg hours / week", key: "avgWeekly", width: 16, numFmt: "0.0", align: "right" },
          { header: "Gross pay", key: "gross", width: 14, numFmt: "$#,##0.00", align: "right" },
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
          hours: Number(totals.hours.toFixed(2)),
          gross: Number(totals.gross.toFixed(2)),
        },
        totalsLabelKey: "employee",
        totalsLabel: "Total",
      });
      toast.success("Spreadsheet downloaded.", { description: filename });
    } catch (err) {
      console.error("[Export] failed:", err);
      toast.error(
        "Couldn't build the spreadsheet. A new version of the app may have been released — refresh the page and export again.",
      );
    } finally {
      setExporting(false);
    }
  };

  const lastClosed = currentPayPeriodStart().getTime();
  const activePreset =
    endWeek.getTime() === lastClosed
      ? PRESETS.find((w) => weekCount === w) ?? null
      : null;
  const multiStore = new Set(employees.map((e) => e.storeLocation)).size > 1;
  const positionItems = employees
    .map((e) => ({ role: e.role, hours: e.hours, gross: e.gross }))
    .filter((it) => it.hours > 0 || it.gross > 0);
  const kpiLoading = (
    <span className="inline-block h-8 w-28 animate-pulse rounded-md bg-white/10" aria-label="Loading" />
  );
  const kpi = (v: React.ReactNode) => (ready ? v : rangeQ.isError ? "—" : kpiLoading);

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Toolbar: pick a range of pay weeks */}
      <div className="surface-card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div
          role="group"
          aria-label="Quick ranges"
          className="sk-track inline-flex w-full items-center gap-0.5 rounded-lg bg-muted p-0.5 sm:w-auto"
        >
          {PRESETS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => applyPreset(w)}
              aria-pressed={activePreset === w}
              title={`The last ${w} closed pay weeks`}
              className={cn(
                "h-9 flex-1 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors sm:h-8 sm:flex-none",
                activePreset === w
                  ? "sk-seg-on bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Last {w} weeks
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="hist-from" className="text-xs text-muted-foreground">
              From week of
            </Label>
            <Input
              id="hist-from"
              type="date"
              value={toDateInput(startWeek)}
              max={maxDay}
              onChange={(e) => {
                if (!e.target.value) return;
                changeStart(startOfPayWeek(fromDateInput(e.target.value)));
              }}
              className="h-9 w-full sm:w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hist-to" className="text-xs text-muted-foreground">
              To week of
            </Label>
            <Input
              id="hist-to"
              type="date"
              value={toDateInput(endWeek)}
              min={toDateInput(startWeek)}
              max={maxDay}
              onChange={(e) => {
                if (!e.target.value) return;
                changeEnd(startOfPayWeek(fromDateInput(e.target.value)));
              }}
              className="h-9 w-full sm:w-40"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground lg:ml-auto lg:text-right">
          <span className="font-medium text-foreground">{span}</span>
          <br className="hidden lg:block" />
          <span className="lg:hidden"> · </span>
          {weekCount} pay {weekCount === 1 ? "week" : "weeks"}, Thursday to Wednesday
        </p>
      </div>

      <KpiBand className="grid-cols-2 xl:grid-cols-3">
        <KpiCell
          hero
          icon={<Wallet />}
          label="Gross pay"
          value={kpi(<Money value={totals.gross} />)}
          sub={span}
        />
        <KpiCell
          hue="blue"
          icon={<Clock />}
          label="Hours worked"
          value={kpi(fmtHours(totals.hours))}
          sub={`over ${weekCount} pay ${weekCount === 1 ? "week" : "weeks"}`}
        />
        <KpiCell
          hue="teal"
          icon={<CalendarCheck />}
          label="Paid weeks"
          value={kpi(totals.weeks.toLocaleString("en-US"))}
          sub="one per person per saved week"
        />
      </KpiBand>

      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-row flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3">
          <div className="min-w-0">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <UserRound />
              </span>
              By employee
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Saved payroll only · {span}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 sm:h-8"
            onClick={() => void handleExport()}
            disabled={!ready || employees.length === 0 || exporting}
            title="Download this range as an .xlsx spreadsheet (opens in Google Sheets and Excel)"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-5">Employee</TableHead>
                  {multiStore ? <TableHead className="hidden md:table-cell">Store</TableHead> : null}
                  <TableHead className="hidden md:table-cell text-right">Weeks paid</TableHead>
                  <TableHead className="text-right">Hours worked</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Avg hours / week</TableHead>
                  <TableHead className="text-right pr-4 sm:pr-5">Gross pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableStateRows
                  colSpan={multiStore ? 6 : 5}
                  isLoading={rangeQ.isLoading}
                  isError={rangeQ.isError}
                  onRetry={() => rangeQ.refetch()}
                  isEmpty={ready && employees.length === 0}
                  emptyTitle="No saved payroll in this range"
                  emptyHint="Weeks show up here once their hours are saved on the Hours & pay tab."
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
                      {fmtHours(e.hours)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
                      {fmtHours(e.weekCount > 0 ? e.hours / e.weekCount : 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium pr-4 sm:pr-5">
                      {fmtMoney(e.gross)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {ready && employees.length > 0 && (
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="pl-4 sm:pl-5 font-semibold">Total</TableCell>
                    {multiStore ? <TableCell className="hidden md:table-cell" /> : null}
                    <TableCell className="hidden md:table-cell text-right font-semibold tabular-nums">
                      {totals.weeks}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtHours(totals.hours)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="text-right font-semibold tabular-nums pr-4 sm:pr-5">
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
