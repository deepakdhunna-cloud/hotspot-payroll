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
import { Money } from "@/components/Money";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import {
  AlertTriangle,
  Check,
  Clock,
  DollarSign,
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

/**
 * A payroll entry that only exists to carry scheduled hours (created by a
 * schedule import/commit) — the manager never entered hours on it. Legacy
 * rows from before the "schedule-only" marker are detected by their saved
 * 0 hours alongside real clock punches.
 */
function isScheduleOnlyEntry(
  entry: { notes: string | null; hoursWorked: string } | null,
  clockH: number | undefined,
): boolean {
  if (!entry) return false;
  if (entry.notes === "schedule-only") return true;
  return (
    entry.notes !== "fixed-pay" &&
    Number(entry.hoursWorked) === 0 &&
    clockH !== undefined &&
    clockH > 0
  );
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
  // SET PAY: a row with a key here is paid a flat amount this week instead
  // of hours × rate (salary weeks, agreed flat rates, bonuses). Hours are
  // still recorded — they just stop driving the dollars.
  const [fixedPay, setFixedPay] = useState<Record<number, string>>({});

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
    const initialFixed: Record<number, string> = {};
    weekQ.data?.employees.forEach((row) => {
      const empId = row.employee.id;
      const clockH = clockHoursMap.get(empId);
      // Entries created by a schedule import/commit only carry the
      // scheduled hours — the manager never entered hours on them. Treat
      // them (and legacy 0-hour rows saved before this marker existed)
      // exactly like unsaved rows so clock punches keep auto-prefilling.
      const scheduleOnly = isScheduleOnlyEntry(row.entry, clockH);
      if (row.entry && !scheduleOnly) {
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
      // Set-pay mode: a week saved as set pay re-opens with its saved
      // amount; a standing profile amount covers EVERY other week — past
      // or future, saved hourly or not saved yet.
      const standingWeekly = Number(row.employee.weeklyPay ?? 0);
      if (row.entry?.notes === "fixed-pay") {
        initialFixed[empId] = String(Number(row.entry.grossPay));
      } else if (standingWeekly > 0) {
        initialFixed[empId] = String(standingWeekly);
      }
      initialRates[empId] = String(
        Number(row.entry?.payRateSnapshot ?? row.employee.payRate ?? 0),
      );
    });
    setHours(initialHours);
    setRates(initialRates);
    setManualOverride(initialOverride);
    setFixedPay(initialFixed);
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
    const fixedRaw = fixedPay[employeeId];
    const isFixed = fixedRaw !== undefined;
    if (isFixed) {
      const amount = Number(fixedRaw);
      if (fixedRaw === "" || isNaN(amount) || amount < 0) {
        toast.error("Enter a valid set-pay amount.");
        return;
      }
      // Hours stay on the record but no longer drive the dollars — an
      // empty hours field simply records zero.
      const hoursVal =
        rawHours === "" || isNaN(numHours) || numHours < 0 ? 0 : numHours;
      setSaving((s) => ({ ...s, [employeeId]: true }));
      try {
        await saveHoursM.mutateAsync({
          employeeId,
          weekStart,
          hoursWorked: hoursVal,
          scheduledHours: scheduled,
          payRateOverride:
            rawRate !== "" && !isNaN(numRate) && numRate >= 0
              ? numRate
              : undefined,
          fixedGross: amount,
        });
        toast.success("Saved as set pay");
      } finally {
        setSaving((s) => ({ ...s, [employeeId]: false }));
      }
      return;
    }
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
      const empId = row.employee.id;
      const rawHours = hours[empId];
      const fixedRaw = fixedPay[empId];
      if (fixedRaw !== undefined) {
        const amount = Number(fixedRaw);
        if (fixedRaw === "" || isNaN(amount) || amount < 0) continue;
        const numHours = Number(rawHours);
        await saveHoursM.mutateAsync({
          employeeId: empId,
          weekStart,
          hoursWorked:
            rawHours === "" || rawHours === undefined || isNaN(numHours)
              ? 0
              : Math.max(0, numHours),
          scheduledHours: Number(row.entry?.scheduledHours ?? 0),
          fixedGross: amount,
        });
        saved++;
        continue;
      }
      if (rawHours === "" || rawHours === undefined) continue;
      const numHours = Number(rawHours);
      const numRate = Number(rates[empId]);
      if (isNaN(numHours) || numHours < 0) continue;
      if (isNaN(numRate) || numRate < 0) continue;
      await saveHoursM.mutateAsync({
        employeeId: empId,
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
      const fixedRaw = fixedPay[r.employee.id];
      const h = rawH === undefined || rawH === "" ? 0 : Number(rawH);
      if (!isNaN(h)) hoursTotal += h;
      if (fixedRaw !== undefined) {
        const a = Number(fixedRaw);
        if (fixedRaw !== "" && !isNaN(a)) grossTotal += a;
        continue;
      }
      const rate =
        rawR === undefined || rawR === ""
          ? Number(r.employee.payRate)
          : Number(rawR);
      if (!isNaN(h) && !isNaN(rate)) {
        grossTotal += computeGross(h, rate).grossPay;
      }
    }
    return { hoursTotal, grossTotal };
  }, [weekQ.data, hours, rates, fixedPay]);

  // Same live numbers as the table rows, regrouped by position. Rate
  // mirrors the row's own expression (cleared field = $0, like the row's
  // rendered gross), and people with no hours are left out so "N people"
  // means people actually being paid this week.
  const positionItems = useMemo(
    () =>
      (weekQ.data?.employees ?? [])
        .map((r) => {
          const rawH = hours[r.employee.id];
          const rawR = rates[r.employee.id];
          const fixedRaw = fixedPay[r.employee.id];
          const h = rawH === undefined || rawH === "" ? 0 : Number(rawH);
          if (fixedRaw !== undefined) {
            const a = Number(fixedRaw);
            return {
              role: r.employee.role,
              hours: isNaN(h) ? 0 : h,
              gross: fixedRaw !== "" && !isNaN(a) ? a : 0,
            };
          }
          const rate =
            rawR === undefined
              ? Number(r.employee.payRate)
              : rawR === ""
                ? 0
                : Number(rawR);
          return {
            role: r.employee.role,
            hours: isNaN(h) ? 0 : h,
            gross:
              !isNaN(h) && !isNaN(rate) ? computeGross(h, rate).grossPay : 0,
          };
        })
        .filter((it) => it.hours > 0 || it.gross > 0),
    [weekQ.data, hours, rates, fixedPay],
  );

  const handleExport = async () => {
    const rows = (weekQ.data?.employees ?? []).map((r) => {
      const h = Number(hours[r.employee.id] ?? 0);
      const rate = Number(rates[r.employee.id] ?? r.employee.payRate);
      const fixedRaw = fixedPay[r.employee.id];
      const gross =
        fixedRaw !== undefined && fixedRaw !== "" && !isNaN(Number(fixedRaw))
          ? Number(fixedRaw)
          : h * rate;
      return {
        employee: r.employee.fullName,
        store: r.employee.storeLocation,
        role: r.employee.role,
        rate,
        scheduled: Number(r.entry?.scheduledHours ?? 0),
        hours: h,
        gross,
      };
    });
    const periodLabel = fmtWeekRange(weekStart);
    const filename = `Hotspot-Payroll-${periodLabel.replace(/\s/g, "")}.xlsx`;
    try {
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
    } catch (err) {
      console.error("[Export] failed:", err);
      toast.error(
        "Couldn't build the spreadsheet — a new version of the app was likely deployed. Refresh the page (your saved entries are safe) and export again.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <KpiBand className="grid-cols-2 xl:grid-cols-3">
        <KpiCell
          hero
          label="Projected gross"
          value={<Money value={totals.grossTotal} />}
          sub="adds up the rows below as you type"
        />
        <KpiCell
          label="Hours entered"
          value={`${totals.hoursTotal.toFixed(1)} h`}
          sub={`for the week of ${fmtWeekRange(weekStart)}`}
        />
        <KpiCell
          label="Saved"
          value={`${
            (weekQ.data?.employees ?? []).filter(
              (r) =>
                r.entry &&
                !isScheduleOnlyEntry(r.entry, clockHoursMap.get(r.employee.id)),
            ).length
          }/${weekQ.data?.employees.length ?? 0}`}
          sub="rows saved so far this week"
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
                  const fixedRaw = fixedPay[emp.id];
                  const isFixedRow = fixedRaw !== undefined;
                  const { grossPay: hourlyGross } = computeGross(hrs, rate);
                  const grossPay = isFixedRow
                    ? fixedRaw === "" || isNaN(Number(fixedRaw))
                      ? 0
                      : Number(fixedRaw)
                    : hourlyGross;
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
                      <TableCell className="text-right">
                        {isFixedRow ? (
                          <div className="flex flex-col items-end gap-1">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={fixedRaw}
                              onChange={(e) =>
                                setFixedPay((s) => ({
                                  ...s,
                                  [emp.id]: e.target.value,
                                }))
                              }
                              onBlur={() => {
                                if (
                                  fixedRaw !== "" &&
                                  !isNaN(Number(fixedRaw))
                                ) {
                                  handleSaveOne(emp.id, scheduled);
                                }
                              }}
                              placeholder="0.00"
                              aria-label={`Set pay amount for ${emp.fullName}`}
                              className="text-right tabular-nums h-9 w-28 ml-auto"
                            />
                            <div className="flex items-center gap-2 text-[10px]">
                              <span
                                className="chip-warn"
                                title="This week is a flat amount — hours are recorded but don't drive the pay"
                              >
                                <DollarSign className="h-3 w-3" /> set pay
                              </span>
                              <button
                                type="button"
                                className="text-primary hover:underline inline-flex items-center gap-1"
                                onClick={() =>
                                  setFixedPay((s) => {
                                    const next = { ...s };
                                    delete next[emp.id];
                                    return next;
                                  })
                                }
                                title="Back to hours × rate (saves on the next change)"
                              >
                                <Undo2 className="h-3 w-3" /> Hourly
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <span className="tabular-nums font-semibold">
                              {fmtMoney(grossPay)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground"
                              onClick={() =>
                                setFixedPay((s) => ({
                                  ...s,
                                  [emp.id]:
                                    grossPay > 0 ? grossPay.toFixed(2) : "",
                                }))
                              }
                              aria-label={`Set a flat pay amount for ${emp.fullName}`}
                              title="Set pay: a flat dollar amount for this week instead of hours × rate"
                            >
                              <DollarSign className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {saving[emp.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                        ) : row.entry &&
                          !isScheduleOnlyEntry(row.entry, clockHours) ? (
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

      <PositionBreakdown
        items={positionItems}
        sub="this week's pay split by role — live from the hours above, so it always matches the table"
      />

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Download className="h-3 w-3" /> Saved hours, rates and gross are kept
        permanently. Use the History tab to look back any number of weeks.
      </p>
    </div>
  );
}
