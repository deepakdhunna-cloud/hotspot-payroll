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
import { FileSpreadsheet, CalendarRange } from "lucide-react";
import { toast } from "sonner";

function startOfPayWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}
function toDateInput(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromDateInput(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export default function HistoryTab({
  storeFilter,
}: {
  storeFilter: string;
}) {
  // Default: last 8 closed pay periods.
  const [startWeek, setStartWeek] = useState<Date>(() => {
    const d = startOfPayWeek(new Date());
    d.setUTCDate(d.getUTCDate() - 7 * 8);
    return d;
  });
  const [endWeek, setEndWeek] = useState<Date>(() => {
    const d = startOfPayWeek(new Date());
    d.setUTCDate(d.getUTCDate() - 7); // last closed week
    return d;
  });

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
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              From pay week
            </Label>
            <Input
              type="date"
              value={toDateInput(startWeek)}
              onChange={(e) => {
                if (!e.target.value) return;
                setStartWeek(startOfPayWeek(fromDateInput(e.target.value)));
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
                setEndWeek(startOfPayWeek(fromDateInput(e.target.value)));
              }}
              className="w-44"
            />
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
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Range total hours
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {totals.hours.toFixed(1)} h
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Range total gross
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {fmtMoney(totals.gross)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Payroll entries
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {totals.weeks}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              employee-weeks in range
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Per employee</CardTitle>
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
