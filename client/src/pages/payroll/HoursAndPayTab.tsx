/**
 * Hours & pay tab — the per-employee weekly grid that auto-prefills from
 * clock punches and lets a manager override any row by clicking the pencil.
 * Lifted out of the original WeeklyPayroll page so the new combined Payroll
 * page can compose it alongside Punches and History tabs.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Save,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function computeGross(hours: number, rate: number) {
  return { grossPay: hours * rate };
}

export default function HoursAndPayTab({
  weekStart,
  storeFilter,
}: {
  weekStart: Date;
  storeFilter: string;
}) {
  const weekQ = trpc.payroll.week.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  // Per-row local edits.
  const [hours, setHours] = useState<Record<number, string>>({});
  const [rates, setRates] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [manualOverride, setManualOverride] = useState<Record<number, boolean>>(
    {},
  );

  const clockHoursQ = trpc.clock.weekHoursBulk.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });
  const clockHoursMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of clockHoursQ.data?.entries ?? []) m.set(e.employeeId, e.hours);
    return m;
  }, [clockHoursQ.data]);

  useEffect(() => {
    const initialHours: Record<number, string> = {};
    const initialRates: Record<number, string> = {};
    const initialOverride: Record<number, boolean> = {};
    weekQ.data?.employees.forEach((row) => {
      const empId = row.employee.id;
      const clockH = clockHoursMap.get(empId);
      if (row.entry) {
        const saved = Number(row.entry.hoursWorked);
        initialHours[empId] = String(saved);
        if (clockH !== undefined && Math.abs(saved - clockH) > 0.01) {
          initialOverride[empId] = true;
        }
      } else if (clockH !== undefined && clockH > 0) {
        initialHours[empId] = clockH.toFixed(2);
      } else {
        initialHours[empId] = "";
      }
      initialRates[empId] = String(
        Number(row.entry?.payRateSnapshot ?? row.employee.payRate ?? 0),
      );
    });
    setHours(initialHours);
    setRates(initialRates);
    setManualOverride(initialOverride);
  }, [weekQ.data, clockHoursMap]);

  const utils = trpc.useUtils();
  const saveHoursM = trpc.payroll.saveHours.useMutation({
    onSuccess: () => {
      utils.payroll.week.invalidate();
      utils.payroll.range.invalidate();
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSaveOne = async (employeeId: number, scheduled: number) => {
    const rawHours = hours[employeeId];
    const rawRate = rates[employeeId];
    const numHours = Number(rawHours);
    const numRate = Number(rawRate);
    if (rawHours === "" || isNaN(numHours) || numHours < 0) {
      toast.error("Enter a valid number of hours.");
      return;
    }
    if (rawRate === "" || isNaN(numRate) || numRate < 0) {
      toast.error("Enter a valid pay rate.");
      return;
    }
    setSaving((s) => ({ ...s, [employeeId]: true }));
    try {
      await saveHoursM.mutateAsync({
        employeeId,
        weekStart,
        hoursWorked: numHours,
        scheduledHours: scheduled,
        payRateOverride: numRate,
      });
      toast.success("Saved");
    } finally {
      setSaving((s) => ({ ...s, [employeeId]: false }));
    }
  };

  const handleSaveAll = async () => {
    const rowsForSave = weekQ.data?.employees ?? [];
    let saved = 0;
    setSaving({});
    for (const row of rowsForSave) {
      const rawHours = hours[row.employee.id];
      if (rawHours === "" || rawHours === undefined) continue;
      const numHours = Number(rawHours);
      const numRate = Number(rates[row.employee.id]);
      if (isNaN(numHours) || numHours < 0) continue;
      if (isNaN(numRate) || numRate < 0) continue;
      await saveHoursM.mutateAsync({
        employeeId: row.employee.id,
        weekStart,
        hoursWorked: numHours,
        scheduledHours: Number(row.entry?.scheduledHours ?? 0),
        payRateOverride: numRate,
      });
      saved++;
    }
    toast.success(`Saved ${saved} payroll entr${saved === 1 ? "y" : "ies"}.`);
  };

  const totals = useMemo(() => {
    const rowsForTotals = weekQ.data?.employees ?? [];
    let hoursTotal = 0;
    let grossTotal = 0;
    for (const r of rowsForTotals) {
      const rawH = hours[r.employee.id];
      const rawR = rates[r.employee.id];
      const h = rawH === undefined || rawH === "" ? 0 : Number(rawH);
      const rate =
        rawR === undefined || rawR === ""
          ? Number(r.employee.payRate)
          : Number(rawR);
      if (!isNaN(h) && !isNaN(rate)) {
        hoursTotal += h;
        grossTotal += computeGross(h, rate).grossPay;
      }
    }
    return { hoursTotal, grossTotal };
  }, [weekQ.data, hours, rates]);

  const handleExport = async () => {
    const rows = (weekQ.data?.employees ?? []).map((r) => {
      const h = Number(hours[r.employee.id] ?? 0);
      const rate = Number(rates[r.employee.id] ?? r.employee.payRate);
      return {
        employee: r.employee.fullName,
        store: r.employee.storeLocation,
        role: r.employee.role,
        rate,
        scheduled: Number(r.entry?.scheduledHours ?? 0),
        hours: h,
        gross: h * rate,
      };
    });
    const periodLabel = fmtWeekRange(weekStart);
    const filename = `Hotspot-Payroll-${periodLabel.replace(/\s/g, "")}.xlsx`;
    await exportXlsx<{
      employee: string;
      store: string;
      role: string;
      rate: number;
      scheduled: number;
      hours: number;
      gross: number;
    }>(filename, {
      name: "Hours & pay",
      title: `Hotspot Market — Weekly Payroll`,
      subtitle: `Pay period: ${periodLabel}`,
      columns: [
        { header: "Employee", key: "employee", width: 24 },
        { header: "Store", key: "store", width: 18 },
        { header: "Role", key: "role", width: 14 },
        { header: "Pay rate", key: "rate", width: 12, numFmt: "$#,##0.00", align: "right" },
        { header: "Scheduled", key: "scheduled", width: 12, numFmt: "0.00", align: "right" },
        { header: "Hours worked", key: "hours", width: 14, numFmt: "0.00", align: "right" },
        { header: "Gross pay", key: "gross", width: 14, numFmt: "$#,##0.00", align: "right" },
      ],
      rows,
      totals: {
        scheduled: rows.reduce((a, b) => a + b.scheduled, 0),
        hours: rows.reduce((a, b) => a + b.hours, 0),
        gross: rows.reduce((a, b) => a + b.gross, 0),
      },
      totalsLabelKey: "employee",
      totalsLabel: "Totals",
    });
    toast.success("Spreadsheet downloaded.");
  };

  return (
    <div className="space-y-6">
      <KpiBand className="grid-cols-2 xl:grid-cols-3">
        <KpiCell
          hero
          label="Projected gross"
          value={fmtMoney(totals.grossTotal)}
          sub="live total for the entries below"
        />
        <KpiCell
          label="Hours entered"
          value={`${totals.hoursTotal.toFixed(1)} h`}
          sub={`week of ${fmtWeekRange(weekStart)}`}
        />
        <KpiCell
          label="Saved"
          value={`${(weekQ.data?.employees ?? []).filter((r) => r.entry).length}/${weekQ.data?.employees.length ?? 0}`}
          sub="entries committed for this week"
        />
      </KpiBand>

      <Card className="surface-card border-0">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="section-title">Hours worked</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!weekQ.data || weekQ.data.employees.length === 0}
              title="Download this week as an .xlsx spreadsheet (opens in Google Sheets)"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export .xlsx
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={saveHoursM.isPending}
            >
              <Save className="h-4 w-4 mr-2" />
              {saveHoursM.isPending ? "Saving…" : "Save all"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right w-[130px]">
                    Pay rate
                  </TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right w-[140px]">
                    Hours worked
                  </TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="w-[100px] text-right">Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekQ.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      Loading employees…
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      No active employees in this scope.
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.map((row) => {
                  const emp = row.employee;
                  const scheduled = Number(row.entry?.scheduledHours ?? 0);
                  const rawHours = hours[emp.id] ?? "";
                  const rawRate =
                    rates[emp.id] ?? String(Number(emp.payRate));
                  const hrs = rawHours === "" ? 0 : Number(rawHours);
                  const rate = rawRate === "" ? 0 : Number(rawRate);
                  const { grossPay } = computeGross(hrs, rate);
                  const clockHours = clockHoursMap.get(emp.id);
                  const hasClockHours =
                    clockHours !== undefined && clockHours > 0;
                  const isManual = manualOverride[emp.id] === true;
                  const showReadOnlyClock = hasClockHours && !isManual;
                  // Clocked meaningfully past schedule — flag it for the
                  // manager while they enter payroll.
                  const overBy =
                    clockHours !== undefined &&
                    scheduled > 0 &&
                    clockHours > scheduled + 0.25
                      ? clockHours - scheduled
                      : null;
                  return (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">
                        {emp.fullName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          max="1000"
                          value={rawRate}
                          onChange={(e) =>
                            setRates((s) => ({
                              ...s,
                              [emp.id]: e.target.value,
                            }))
                          }
                          onBlur={() => {
                            const numRate = Number(rawRate);
                            const profileRate = Number(emp.payRate);
                            if (
                              rawRate !== "" &&
                              !isNaN(numRate) &&
                              numRate !== profileRate &&
                              rawHours !== ""
                            ) {
                              handleSaveOne(emp.id, scheduled);
                            }
                          }}
                          placeholder="0.00"
                          className="text-right tabular-nums h-9"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        <div className="flex items-center justify-end gap-2">
                          {overBy !== null && (
                            <span
                              className="chip-warn"
                              title="Clock hours exceed scheduled hours"
                            >
                              <AlertTriangle className="h-3 w-3" /> +
                              {overBy.toFixed(1)}h over
                            </span>
                          )}
                          <span>{scheduled.toFixed(1)} h</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {showReadOnlyClock ? (
                          <div className="flex items-center justify-end gap-2">
                            <span
                              className="tabular-nums font-medium"
                              title="Auto-pulled from time clock punches"
                            >
                              {Number(clockHours).toFixed(2)}
                            </span>
                            <span className="chip-good">
                              <Clock className="h-3 w-3" /> clock
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                setManualOverride((s) => ({
                                  ...s,
                                  [emp.id]: true,
                                }));
                              }}
                              aria-label="Override clock hours"
                              title="Edit manually"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.25"
                              min="0"
                              max="168"
                              value={rawHours}
                              onChange={(e) =>
                                setHours((s) => ({
                                  ...s,
                                  [emp.id]: e.target.value,
                                }))
                              }
                              onBlur={() => {
                                if (
                                  rawHours !== "" &&
                                  rawHours !==
                                    String(Number(row.entry?.hoursWorked ?? 0))
                                ) {
                                  handleSaveOne(emp.id, scheduled);
                                }
                              }}
                              placeholder={
                                hasClockHours
                                  ? Number(clockHours).toFixed(2)
                                  : "0"
                              }
                              className="text-right tabular-nums h-9"
                            />
                            {hasClockHours && isManual && (
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className="chip-warn">
                                  <Pencil className="h-3 w-3" /> manual
                                </span>
                                <button
                                  type="button"
                                  className="text-primary hover:underline inline-flex items-center gap-1"
                                  onClick={() => {
                                    const v = Number(clockHours).toFixed(2);
                                    setHours((s) => ({
                                      ...s,
                                      [emp.id]: v,
                                    }));
                                    setManualOverride((s) => ({
                                      ...s,
                                      [emp.id]: false,
                                    }));
                                    handleSaveOne(emp.id, scheduled);
                                  }}
                                  title="Reset to clock hours"
                                >
                                  <Undo2 className="h-3 w-3" /> Reset
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(grossPay)}
                      </TableCell>
                      <TableCell className="text-right">
                        {saving[emp.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                        ) : row.entry ? (
                          <span className="text-xs text-success inline-flex items-center gap-1">
                            <Check className="h-3 w-3" /> Saved
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Download className="h-3 w-3" /> Saved hours, rates and gross are kept
        permanently. Use the History tab to look back any number of weeks.
      </p>
    </div>
  );
}
