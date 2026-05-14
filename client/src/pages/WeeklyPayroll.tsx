import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Check,
  Loader2,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function computeGross(hours: number, rate: number) {
  const reg = Math.min(hours, 40);
  const ot = Math.max(0, hours - 40);
  return {
    regularPay: reg * rate,
    overtimePay: ot * rate * 1.5,
    grossPay: reg * rate + ot * rate * 1.5,
    overtimeHours: ot,
  };
}

export default function WeeklyPayroll() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const scopeQ = trpc.meta.myScope.useQuery();
  const weekQ = trpc.payroll.week.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const stores = scopeQ.data?.stores ?? [];

  const [hours, setHours] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const initial: Record<number, string> = {};
    weekQ.data?.employees.forEach((row) => {
      initial[row.employee.id] = row.entry ? String(Number(row.entry.hoursWorked)) : "";
    });
    setHours(initial);
  }, [weekQ.data]);

  const utils = trpc.useUtils();
  const saveHoursM = trpc.payroll.saveHours.useMutation({
    onSuccess: () => {
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d);
  };

  const handleSaveOne = async (employeeId: number, scheduled: number) => {
    const raw = hours[employeeId];
    const num = Number(raw);
    if (raw === "" || isNaN(num) || num < 0) {
      toast.error("Enter a valid number of hours.");
      return;
    }
    setSaving((s) => ({ ...s, [employeeId]: true }));
    try {
      await saveHoursM.mutateAsync({
        employeeId,
        weekStart,
        hoursWorked: num,
        scheduledHours: scheduled,
      });
      toast.success("Saved");
    } finally {
      setSaving((s) => ({ ...s, [employeeId]: false }));
    }
  };

  const handleSaveAll = async () => {
    const rows = weekQ.data?.employees ?? [];
    let saved = 0;
    setSaving({});
    for (const row of rows) {
      const raw = hours[row.employee.id];
      if (raw === "" || raw === undefined) continue;
      const num = Number(raw);
      if (isNaN(num) || num < 0) continue;
      await saveHoursM.mutateAsync({
        employeeId: row.employee.id,
        weekStart,
        hoursWorked: num,
        scheduledHours: Number(row.entry?.scheduledHours ?? 0),
      });
      saved++;
    }
    toast.success(`Saved ${saved} payroll entr${saved === 1 ? "y" : "ies"}.`);
  };

  const totals = useMemo(() => {
    const rows = weekQ.data?.employees ?? [];
    let hoursTotal = 0;
    let grossTotal = 0;
    for (const r of rows) {
      const raw = hours[r.employee.id];
      const h = raw === undefined || raw === "" ? 0 : Number(raw);
      if (!isNaN(h)) {
        hoursTotal += h;
        const { grossPay } = computeGross(h, Number(r.employee.payRate));
        grossTotal += grossPay;
      }
    }
    return { hoursTotal, grossTotal };
  }, [weekQ.data, hours]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            Weekly Payroll Entry
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <ClipboardList className="h-7 w-7" /> Enter hours
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Type each employee's hours. Pay, overtime, and gross totals are computed automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary" />
              {fmtWeekRange(weekStart)}
            </div>
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(1)} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {stores.length > 1 && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All my stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total hours entered</div>
            <div className="text-2xl font-bold mt-2 tabular-nums">{totals.hoursTotal.toFixed(1)} h</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Projected gross</div>
            <div className="text-2xl font-bold mt-2 tabular-nums">{fmtMoney(totals.grossTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Week of</div>
              <div className="text-lg font-semibold mt-1">{fmtWeekRange(weekStart)}</div>
            </div>
            <Button onClick={handleSaveAll} disabled={saveHoursM.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {saveHoursM.isPending ? "Saving…" : "Save all"}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Hours worked</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right w-[160px]">Hours worked</TableHead>
                  <TableHead className="text-right">OT</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                      Loading employees…
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                      No active employees in this scope.
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.map((row) => {
                  const emp = row.employee;
                  const scheduled = Number(row.entry?.scheduledHours ?? 0);
                  const raw = hours[emp.id] ?? "";
                  const hrs = raw === "" ? 0 : Number(raw);
                  const { overtimeHours, grossPay } = computeGross(hrs, Number(emp.payRate));
                  return (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{emp.fullName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoney(Number(emp.payRate))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {scheduled.toFixed(1)} h
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          max="168"
                          value={raw}
                          onChange={(e) =>
                            setHours((s) => ({ ...s, [emp.id]: e.target.value }))
                          }
                          onBlur={() => {
                            if (raw !== "" && raw !== String(Number(row.entry?.hoursWorked ?? 0))) {
                              handleSaveOne(emp.id, scheduled);
                            }
                          }}
                          placeholder="0"
                          className="text-right tabular-nums h-9"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {overtimeHours > 0 ? (
                          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            +{overtimeHours.toFixed(1)} h
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(grossPay)}
                      </TableCell>
                      <TableCell className="text-right">
                        {saving[emp.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                        ) : row.entry ? (
                          <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                            <Check className="h-3 w-3" /> Saved
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
    </div>
  );
}
