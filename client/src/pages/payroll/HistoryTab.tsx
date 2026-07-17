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
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { StatCard } from "@/components/StatCard";
import {
  currentPayPeriodStart,
  fromDateInput,
  shiftPayWeek,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import {
  CalendarRange,
  ClipboardList,
  Clock,
  DollarSign,
  FileSpreadsheet,
} from "lucide-react";
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

  return (
    <div className="space-y-6">
      <Card className="surface-card border-0">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end md:flex-wrap gap-3">
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              From pay week
            </Label>
            <Input
              type="date"
              value={toDateInput(startWeek)}
              onChange={(e) => {
                if (!e.target.value) return;
                changeStart(startOfPayWeek(fromDateInput(e.target.value)));
              }}
              className="w-44"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              To pay week
            </Label>
            <Input
              type="date"
              value={toDateInput(endWeek)}
              onChange={(e) => {
                if (!e.target.value) return;
                changeEnd(startOfPayWeek(fromDateInput(e.target.value)));
              }}
              className="w-44"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Quick range
            </Label>
            <div className="flex gap-1.5">
              {[4, 8, 13].map((w) => (
                <Button
                  key={w}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => applyPreset(w)}
                  title={`Last ${w} closed pay weeks`}
                >
                  Last {w} weeks
                </Button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <CalendarRange className="h-3 w-3" />
              {weekCount} pay week{weekCount === 1 ? "" : "s"}
            </span>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!rangeQ.data || employees.length === 0}
              title="Download this range as an .xlsx spreadsheet (opens in Google Sheets)"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export .xlsx
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Range total hours"
          value={`${totals.hours.toFixed(1)} h`}
          icon={<Clock />}
        />
        <StatCard
          label="Range total gross"
          value={fmtMoney(totals.gross)}
          icon={<DollarSign />}
          style={{ animationDelay: "60ms" }}
        />
        <StatCard
          label="Payroll entries"
          value={totals.weeks}
          sub="employee-weeks in range"
          icon={<ClipboardList />}
          style={{ animationDelay: "120ms" }}
        />
      </section>

      <PositionBreakdown
        items={employees
          .map((e) => ({ role: e.role, hours: e.hours, gross: e.gross }))
          .filter((it) => it.hours > 0 || it.gross > 0)}
        sub={`saved payroll split by role · ${fmtWeekRange(startWeek)} → ${fmtWeekRange(endWeek)}`}
      />

      <Card className="surface-card border-0">
        <CardHeader>
          <CardTitle className="section-title">Per employee</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Weeks paid</TableHead>
                  <TableHead className="text-right">Total hours</TableHead>
                  <TableHead className="text-right">Avg hrs/wk</TableHead>
                  <TableHead className="text-right">Total gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rangeQ.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      Loading history…
                    </TableCell>
                  </TableRow>
                )}
                {!rangeQ.isLoading && employees.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      No saved payroll entries in this range yet.
                    </TableCell>
                  </TableRow>
                )}
                {employees.map((e) => (
                  <TableRow key={e.employeeId}>
                    <TableCell className="font-medium">
                      {e.employeeName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
                    </TableCell>
                    <TableCell className="text-xs">{e.role}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.weekCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.hours.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(e.weekCount > 0 ? e.hours / e.weekCount : 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmtMoney(e.gross)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {employees.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold">
                      Totals
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totals.weeks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {totals.hours.toFixed(2)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmtMoney(totals.gross)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
