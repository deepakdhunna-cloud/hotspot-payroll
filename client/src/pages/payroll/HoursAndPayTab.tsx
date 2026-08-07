/**
 * Hours & pay tab — the per-employee weekly grid that auto-prefills from
 * clock punches and lets a manager override any row.
 *
 * Editing model: edits stay local and mark the row as "Edited"; nothing
 * saves until the manager commits — per row, or all at once from the
 * floating commit bar. A refetch never clobbers a row you're editing.
 */
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
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { TableStateRows } from "@/components/QueryStates";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { exportXlsx } from "@/lib/xlsx";
import { cn } from "@/lib/utils";
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
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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

type RowBaseline = { hours: string; rate: string; fixed: string | undefined };

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
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Last-saved values per row; "dirty" = current state differs from this.
  const baseline = useRef<Record<number, RowBaseline>>({});
  const [baselineVersion, bumpBaseline] = useReducer((x: number) => x + 1, 0);

  // Live mirrors so the init effect can merge without stale closures.
  const hoursRef = useRef(hours);
  hoursRef.current = hours;
  const ratesRef = useRef(rates);
  ratesRef.current = rates;
  const fixedRef = useRef(fixedPay);
  fixedRef.current = fixedPay;

  const clockHoursQ = trpc.clock.weekHoursBulk.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });
  const clockHoursMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of clockHoursQ.data?.entries ?? []) m.set(e.employeeId, e.hours);
    return m;
  }, [clockHoursQ.data]);

  const rowIsDirty = (empId: number): boolean => {
    const b = baseline.current[empId];
    if (!b) return false;
    return (
      (hoursRef.current[empId] ?? "") !== b.hours ||
      (ratesRef.current[empId] ?? "") !== b.rate ||
      fixedRef.current[empId] !== b.fixed
    );
  };

  useEffect(() => {
    const nextHours: Record<number, string> = {};
    const nextRates: Record<number, string> = {};
    const nextOverride: Record<number, boolean> = {};
    const nextFixed: Record<number, string> = {};
    weekQ.data?.employees.forEach((row) => {
      const empId = row.employee.id;
      const clockH = clockHoursMap.get(empId);
      // Entries created by a schedule import/commit only carry the
      // scheduled hours — the manager never entered hours on them. Treat
      // them (and legacy 0-hour rows saved before this marker existed)
      // exactly like unsaved rows so clock punches keep auto-prefilling.
      const scheduleOnly = isScheduleOnlyEntry(row.entry, clockH);
      let freshHours: string;
      if (row.entry && !scheduleOnly) {
        const saved = Number(row.entry.hoursWorked);
        freshHours = String(saved);
        if (clockH !== undefined && Math.abs(saved - clockH) > 0.01) {
          nextOverride[empId] = true;
        }
      } else if (clockH !== undefined && clockH > 0) {
        freshHours = clockH.toFixed(2);
      } else {
        freshHours = "";
      }
      // Set-pay mode: a week saved as set pay re-opens with its saved
      // amount; a standing profile amount covers EVERY other week — past
      // or future, saved hourly or not saved yet.
      const standingWeekly = Number(row.employee.weeklyPay ?? 0);
      let freshFixed: string | undefined;
      if (row.entry?.notes === "fixed-pay") {
        freshFixed = String(Number(row.entry.grossPay));
      } else if (standingWeekly > 0) {
        freshFixed = String(standingWeekly);
      }
      const freshRate = String(
        Number(row.entry?.payRateSnapshot ?? row.employee.payRate ?? 0),
      );

      // Merge: a row mid-edit keeps its local values and its old baseline,
      // so a background refetch can't wipe unsaved work.
      if (rowIsDirty(empId)) {
        nextHours[empId] = hoursRef.current[empId] ?? "";
        nextRates[empId] = ratesRef.current[empId] ?? "";
        const f = fixedRef.current[empId];
        if (f !== undefined) nextFixed[empId] = f;
        if (manualOverride[empId]) nextOverride[empId] = true;
      } else {
        nextHours[empId] = freshHours;
        nextRates[empId] = freshRate;
        if (freshFixed !== undefined) nextFixed[empId] = freshFixed;
        baseline.current[empId] = {
          hours: freshHours,
          rate: freshRate,
          fixed: freshFixed,
        };
      }
    });
    setHours(nextHours);
    setRates(nextRates);
    setManualOverride(nextOverride);
    setFixedPay(nextFixed);
    bumpBaseline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekQ.data, clockHoursMap]);

  const utils = trpc.useUtils();
  const saveHoursM = trpc.payroll.saveHours.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const invalidateAll = () => {
    utils.payroll.week.invalidate();
    utils.payroll.range.invalidate();
    utils.employees.list.invalidate();
    utils.dashboard.summary.invalidate();
  };

  /** Validate a row's current values. Returns the payload or an error string. */
  const buildPayload = (
    empId: number,
    scheduled: number,
  ):
    | { kind: "fixed"; hoursWorked: number; amount: number; rate?: number }
    | { kind: "hourly"; hoursWorked: number; rate: number }
    | { kind: "error"; message: string }
    | { kind: "skip" } => {
    const rawHours = hours[empId];
    const rawRate = rates[empId];
    const numHours = Number(rawHours);
    const numRate = Number(rawRate);
    const fixedRaw = fixedPay[empId];
    if (fixedRaw !== undefined) {
      const amount = Number(fixedRaw);
      if (fixedRaw === "" || isNaN(amount) || amount < 0)
        return { kind: "error", message: "needs a valid set-pay amount" };
      const hoursVal =
        rawHours === "" || rawHours === undefined || isNaN(numHours) || numHours < 0
          ? 0
          : numHours;
      return {
        kind: "fixed",
        hoursWorked: hoursVal,
        amount,
        rate:
          rawRate !== "" && !isNaN(numRate) && numRate >= 0 ? numRate : undefined,
      };
    }
    if (rawHours === "" || rawHours === undefined)
      return { kind: "skip" };
    if (isNaN(numHours) || numHours < 0)
      return { kind: "error", message: "needs a valid number of hours" };
    if (rawRate === "" || isNaN(numRate) || numRate < 0)
      return { kind: "error", message: "needs a valid pay rate" };
    return { kind: "hourly", hoursWorked: numHours, rate: numRate };
  };

  const commitBaseline = (empId: number) => {
    baseline.current[empId] = {
      hours: hours[empId] ?? "",
      rate: rates[empId] ?? "",
      fixed: fixedPay[empId],
    };
    bumpBaseline();
  };

  const handleSaveOne = async (empId: number, scheduled: number) => {
    const payload = buildPayload(empId, scheduled);
    if (payload.kind === "error") {
      toast.error(`This row ${payload.message}.`);
      return;
    }
    if (payload.kind === "skip") {
      toast.error("Enter hours before saving.");
      return;
    }
    setSaving((s) => ({ ...s, [empId]: true }));
    try {
      await saveHoursM.mutateAsync({
        employeeId: empId,
        weekStart,
        hoursWorked: payload.hoursWorked,
        scheduledHours: scheduled,
        payRateOverride: payload.rate,
        ...(payload.kind === "fixed" ? { fixedGross: payload.amount } : {}),
      });
      commitBaseline(empId);
      toast.success(payload.kind === "fixed" ? "Saved as set pay" : "Saved");
      invalidateAll();
    } finally {
      setSaving((s) => ({ ...s, [empId]: false }));
    }
  };

  const rows = weekQ.data?.employees ?? [];

  const dirtyIds = useMemo(
    () => rows.map((r) => r.employee.id).filter((id) => rowIsDirty(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, hours, rates, fixedPay, baselineVersion],
  );

  /** Save every dirty row; report progress and any rows that failed. */
  const handleSaveAll = async () => {
    const targets = rows.filter((r) => dirtyIds.includes(r.employee.id));
    if (targets.length === 0) return;
    const failed: string[] = [];
    let done = 0;
    setBatchProgress({ done: 0, total: targets.length });
    for (const row of targets) {
      const empId = row.employee.id;
      const scheduled = Number(row.entry?.scheduledHours ?? 0);
      const payload = buildPayload(empId, scheduled);
      if (payload.kind === "error") {
        failed.push(`${row.employee.fullName} (${payload.message})`);
        continue;
      }
      if (payload.kind === "skip") continue;
      try {
        await saveHoursM.mutateAsync({
          employeeId: empId,
          weekStart,
          hoursWorked: payload.hoursWorked,
          scheduledHours: scheduled,
          payRateOverride: payload.rate,
          ...(payload.kind === "fixed" ? { fixedGross: payload.amount } : {}),
        });
        commitBaseline(empId);
        done++;
      } catch {
        failed.push(row.employee.fullName);
      }
      setBatchProgress({ done, total: targets.length });
    }
    setBatchProgress(null);
    invalidateAll();
    if (failed.length) {
      toast.error(
        `Saved ${done}, but ${failed.length} didn't save: ${failed.join(", ")}`,
      );
    } else {
      toast.success(`Saved ${done} payroll entr${done === 1 ? "y" : "ies"}.`);
    }
  };

  /** Throw away local edits and fall back to the last-saved values. */
  const handleDiscard = () => {
    const nextHours = { ...hours };
    const nextRates = { ...rates };
    const nextFixed = { ...fixedPay };
    for (const id of dirtyIds) {
      const b = baseline.current[id];
      if (!b) continue;
      nextHours[id] = b.hours;
      nextRates[id] = b.rate;
      if (b.fixed === undefined) delete nextFixed[id];
      else nextFixed[id] = b.fixed;
    }
    setHours(nextHours);
    setRates(nextRates);
    setFixedPay(nextFixed);
    bumpBaseline();
  };

  const totals = useMemo(() => {
    let scheduledTotal = 0;
    let hoursTotal = 0;
    let grossTotal = 0;
    for (const r of rows) {
      scheduledTotal += Number(r.entry?.scheduledHours ?? 0);
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
    return { scheduledTotal, hoursTotal, grossTotal };
  }, [rows, hours, rates, fixedPay]);

  // Same live numbers as the table rows, regrouped by position. Rate
  // mirrors the row's own expression (cleared field = $0, like the row's
  // rendered gross), and people with no hours are left out so "N people"
  // means people actually being paid this week.
  const positionItems = useMemo(
    () =>
      rows
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
    [rows, hours, rates, fixedPay],
  );

  const handleExport = async () => {
    const exportRows = rows.map((r) => {
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
        rows: exportRows,
        totals: {
          scheduled: exportRows.reduce((a, b) => a + b.scheduled, 0),
          hours: exportRows.reduce((a, b) => a + b.hours, 0),
          gross: exportRows.reduce((a, b) => a + b.gross, 0),
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

  const savedCount = rows.filter(
    (r) =>
      r.entry && !isScheduleOnlyEntry(r.entry, clockHoursMap.get(r.employee.id)),
  ).length;

  /** Everything one row needs, precomputed once for table + card views. */
  const rowView = (row: (typeof rows)[number]) => {
    const emp = row.employee;
    const scheduled = Number(row.entry?.scheduledHours ?? 0);
    const rawHours = hours[emp.id] ?? "";
    const rawRate = rates[emp.id] ?? String(Number(emp.payRate));
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
    const hasClockHours = clockHours !== undefined && clockHours > 0;
    const isManual = manualOverride[emp.id] === true;
    const showReadOnlyClock = hasClockHours && !isManual;
    // Clocked meaningfully past schedule — flag it for the manager.
    const overBy =
      clockHours !== undefined && scheduled > 0 && clockHours > scheduled + 0.25
        ? clockHours - scheduled
        : null;
    const dirty = dirtyIds.includes(emp.id);
    const isSaved =
      !!row.entry && !isScheduleOnlyEntry(row.entry, clockHours);
    return {
      emp,
      scheduled,
      rawHours,
      rawRate,
      fixedRaw,
      isFixedRow,
      grossPay,
      clockHours,
      hasClockHours,
      isManual,
      showReadOnlyClock,
      overBy,
      dirty,
      isSaved,
    };
  };

  const setRowFixed = (empId: number, value: string | null) =>
    setFixedPay((s) => {
      const next = { ...s };
      if (value === null) delete next[empId];
      else next[empId] = value;
      return next;
    });

  const RowStatus = ({
    empId,
    dirty,
    isSaved,
    scheduled,
  }: {
    empId: number;
    dirty: boolean;
    isSaved: boolean;
    scheduled: number;
  }) =>
    saving[empId] ? (
      <Loader2 className="inline h-4 w-4 animate-spin text-muted-foreground" />
    ) : dirty ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="chip-warn">
          <Pencil className="h-3 w-3" /> edited
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-primary"
          onClick={() => handleSaveOne(empId, scheduled)}
          aria-label="Save this row"
          title="Save this row"
        >
          <Save className="h-4 w-4" />
        </Button>
      </span>
    ) : isSaved ? (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check className="h-3 w-3" /> Saved
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );

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
          value={`${savedCount}/${rows.length}`}
          sub={
            dirtyIds.length > 0
              ? `${dirtyIds.length} row${dirtyIds.length === 1 ? "" : "s"} edited — unsaved`
              : "rows saved so far this week"
          }
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
              disabled={rows.length === 0}
              title="Download this week as an .xlsx spreadsheet (opens in Google Sheets)"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export .xlsx
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {/* ---------- Phone layout: one card per employee ---------- */}
          <div className="space-y-3 px-4 pb-2 md:hidden">
            {weekQ.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
              ))}
            {weekQ.isError && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Couldn&apos;t load this week.{" "}
                <button className="font-semibold text-primary" onClick={() => weekQ.refetch()}>
                  Retry
                </button>
              </div>
            )}
            {!weekQ.isLoading && !weekQ.isError && rows.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active employees in this scope.
              </p>
            )}
            {rows.map((row) => {
              const v = rowView(row);
              return (
                <div
                  key={v.emp.id}
                  className={cn(
                    "rounded-xl border border-border bg-card p-4",
                    v.dirty && "border-primary/35",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{v.emp.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {STORE_ABBR[v.emp.storeLocation] ?? v.emp.storeLocation} ·{" "}
                        {v.scheduled.toFixed(1)}h scheduled
                      </div>
                    </div>
                    <RowStatus
                      empId={v.emp.id}
                      dirty={v.dirty}
                      isSaved={v.isSaved}
                      scheduled={v.scheduled}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Pay rate
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.25"
                        min="0"
                        value={v.rawRate}
                        onChange={(e) =>
                          setRates((s) => ({ ...s, [v.emp.id]: e.target.value }))
                        }
                        className="mt-1 h-10 text-right tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Hours
                      </span>
                      {v.showReadOnlyClock ? (
                        <button
                          type="button"
                          className="mt-1 flex h-10 w-full items-center justify-between rounded-md border border-input bg-secondary/50 px-3 text-sm"
                          onClick={() =>
                            setManualOverride((s) => ({ ...s, [v.emp.id]: true }))
                          }
                          title="Auto-pulled from the time clock — tap to edit manually"
                        >
                          <span className="chip-good">
                            <Clock className="h-3 w-3" /> clock
                          </span>
                          <span className="font-medium tabular-nums">
                            {Number(v.clockHours).toFixed(2)}
                          </span>
                        </button>
                      ) : (
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          value={v.rawHours}
                          onChange={(e) =>
                            setHours((s) => ({ ...s, [v.emp.id]: e.target.value }))
                          }
                          placeholder={
                            v.hasClockHours ? Number(v.clockHours).toFixed(2) : "0"
                          }
                          className="mt-1 h-10 text-right tabular-nums"
                        />
                      )}
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {v.overBy !== null && (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" /> +{v.overBy.toFixed(1)}h
                        </span>
                      )}
                      {v.isFixedRow ? (
                        <span className="chip-warn">
                          <DollarSign className="h-3 w-3" /> set pay
                        </span>
                      ) : null}
                    </div>
                    {v.isFixedRow ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={v.fixedRaw}
                        onChange={(e) => setRowFixed(v.emp.id, e.target.value)}
                        aria-label={`Set pay amount for ${v.emp.fullName}`}
                        className="h-9 w-28 text-right tabular-nums"
                      />
                    ) : (
                      <span className="font-semibold tabular-nums">
                        {fmtMoney(v.grossPay)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---------- Desktop layout: the grid ---------- */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-card">
                    Employee
                  </TableHead>
                  <TableHead className="w-[130px] text-right">Pay rate</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="w-[150px] text-right">
                    Hours worked
                  </TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="w-[110px] text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableStateRows
                  colSpan={6}
                  isLoading={weekQ.isLoading}
                  isError={weekQ.isError}
                  onRetry={() => weekQ.refetch()}
                  isEmpty={!weekQ.isLoading && rows.length === 0}
                  emptyTitle="No active employees in this scope"
                  emptyHint="Change the store filter, or add employees from the Employees page."
                />
                {rows.map((row) => {
                  const v = rowView(row);
                  return (
                    <TableRow
                      key={v.emp.id}
                      className={cn(v.dirty && "bg-primary/[0.03]")}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card font-medium">
                        <div>{v.emp.fullName}</div>
                        <div className="text-[11px] font-normal text-muted-foreground">
                          {STORE_ABBR[v.emp.storeLocation] ?? v.emp.storeLocation}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          max="1000"
                          value={v.rawRate}
                          onChange={(e) =>
                            setRates((s) => ({ ...s, [v.emp.id]: e.target.value }))
                          }
                          placeholder="0.00"
                          className="h-9 text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        <div className="flex items-center justify-end gap-2">
                          {v.overBy !== null && (
                            <span
                              className="chip-warn"
                              title="Clock hours exceed scheduled hours"
                            >
                              <AlertTriangle className="h-3 w-3" /> +
                              {v.overBy.toFixed(1)}h over
                            </span>
                          )}
                          <span>{v.scheduled.toFixed(1)} h</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {v.showReadOnlyClock ? (
                          <div className="flex items-center justify-end gap-2">
                            <span
                              className="font-medium tabular-nums"
                              title="Auto-pulled from time clock punches"
                            >
                              {Number(v.clockHours).toFixed(2)}
                            </span>
                            <span className="chip-good">
                              <Clock className="h-3 w-3" /> clock
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() =>
                                setManualOverride((s) => ({
                                  ...s,
                                  [v.emp.id]: true,
                                }))
                              }
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
                              value={v.rawHours}
                              onChange={(e) =>
                                setHours((s) => ({
                                  ...s,
                                  [v.emp.id]: e.target.value,
                                }))
                              }
                              placeholder={
                                v.hasClockHours
                                  ? Number(v.clockHours).toFixed(2)
                                  : "0"
                              }
                              className="h-9 text-right tabular-nums"
                            />
                            {v.hasClockHours && v.isManual && (
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className="chip-warn">
                                  <Pencil className="h-3 w-3" /> manual
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                  onClick={() => {
                                    const val = Number(v.clockHours).toFixed(2);
                                    setHours((s) => ({ ...s, [v.emp.id]: val }));
                                    setManualOverride((s) => ({
                                      ...s,
                                      [v.emp.id]: false,
                                    }));
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
                        {v.isFixedRow ? (
                          <div className="flex flex-col items-end gap-1">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={v.fixedRaw}
                              onChange={(e) => setRowFixed(v.emp.id, e.target.value)}
                              placeholder="0.00"
                              aria-label={`Set pay amount for ${v.emp.fullName}`}
                              className="ml-auto h-9 w-28 text-right tabular-nums"
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
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                onClick={() => setRowFixed(v.emp.id, null)}
                                title="Back to hours × rate"
                              >
                                <Undo2 className="h-3 w-3" /> Hourly
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold tabular-nums">
                              {fmtMoney(v.grossPay)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground"
                              onClick={() =>
                                setRowFixed(
                                  v.emp.id,
                                  v.grossPay > 0 ? v.grossPay.toFixed(2) : "",
                                )
                              }
                              aria-label={`Set a flat pay amount for ${v.emp.fullName}`}
                              title="Set pay: a flat dollar amount for this week instead of hours × rate"
                            >
                              <DollarSign className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowStatus
                          empId={v.emp.id}
                          dirty={v.dirty}
                          isSaved={v.isSaved}
                          scheduled={v.scheduled}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="sticky left-0 z-10 bg-card font-semibold">
                      Totals
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      {totals.scheduledTotal.toFixed(1)} h
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {totals.hoursTotal.toFixed(1)} h
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtMoney(totals.grossTotal)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <PositionBreakdown
        items={positionItems}
        sub="this week's pay split by role — live from the hours above, so it always matches the table"
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Download className="h-3 w-3" /> Saved hours, rates and gross are kept
        permanently. Use the History tab to look back any number of weeks.
      </p>

      {/* ---------- Commit bar: appears only when there's unsaved work ---------- */}
      {dirtyIds.length > 0 && (
        <div className="sticky bottom-4 z-20 px-2">
          <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card/95 px-4 py-3 shadow-[0_8px_30px_-8px_rgb(16_24_40/0.3)] backdrop-blur">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              {dirtyIds.length} unsaved change{dirtyIds.length === 1 ? "" : "s"}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                disabled={batchProgress !== null}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={batchProgress !== null}
              >
                <Save className="mr-2 h-4 w-4" />
                {batchProgress
                  ? `Saving ${batchProgress.done}/${batchProgress.total}…`
                  : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
