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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Check,
  Loader2,
  Pencil,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

// Hotspot pay period: Thursday – Wednesday. Anchor any date to the Thursday on
// or before it (UTC).
function startOfPayWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function toDateInput(d: Date): string {
  // YYYY-MM-DD using UTC pieces so the calendar input matches the stored date.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateInput(value: string): Date {
  // Parse YYYY-MM-DD as a UTC date at midnight.
  return new Date(`${value}T00:00:00Z`);
}

function computeGross(hours: number, rate: number) {
  const gross = hours * rate;
  return { grossPay: gross, regularPay: gross };
}

export default function WeeklyPayroll() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfPayWeek(new Date()));
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const scopeQ = trpc.meta.myScope.useQuery();
  const weekQ = trpc.payroll.week.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const stores = scopeQ.data?.stores ?? [];

  // Locally edited hours and rates per row.
  const [hours, setHours] = useState<Record<number, string>>({});
  const [rates, setRates] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const initialHours: Record<number, string> = {};
    const initialRates: Record<number, string> = {};
    weekQ.data?.employees.forEach((row) => {
      initialHours[row.employee.id] = row.entry
        ? String(Number(row.entry.hoursWorked))
        : "";
      // Prefer the snapshot rate from the saved entry; otherwise the profile rate.
      initialRates[row.employee.id] = String(
        Number(row.entry?.payRateSnapshot ?? row.employee.payRate ?? 0),
      );
    });
    setHours(initialHours);
    setRates(initialRates);
  }, [weekQ.data]);

  const utils = trpc.useUtils();
  const saveHoursM = trpc.payroll.saveHours.useMutation({
    onSuccess: () => {
      utils.payroll.week.invalidate();
      utils.employees.list.invalidate();
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
    const rows = weekQ.data?.employees ?? [];
    let saved = 0;
    setSaving({});
    for (const row of rows) {
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
    const rows = weekQ.data?.employees ?? [];
    let hoursTotal = 0;
    let grossTotal = 0;
    for (const r of rows) {
      const rawH = hours[r.employee.id];
      const rawR = rates[r.employee.id];
      const h = rawH === undefined || rawH === "" ? 0 : Number(rawH);
      const rate = rawR === undefined || rawR === "" ? Number(r.employee.payRate) : Number(rawR);
      if (!isNaN(h) && !isNaN(rate)) {
        hoursTotal += h;
        grossTotal += computeGross(h, rate).grossPay;
      }
    }
    return { hoursTotal, grossTotal };
  }, [weekQ.data, hours, rates]);

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
            Pay period runs Thursday through Wednesday. Type each employee's hours
            (and adjust the rate if needed) — gross is computed automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 px-2 text-sm font-medium hover:bg-accent rounded-md py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Edit pay-period start date"
                >
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {fmtWeekRange(weekStart)}
                  <Pencil className="h-3 w-3 text-muted-foreground ml-1" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="end">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Pay-period start
                  </label>
                  <Input
                    type="date"
                    value={toDateInput(weekStart)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      // Snap any picked date back to the Thursday of its week
                      // so reports always align with the Thu–Wed pay period.
                      setWeekStart(startOfPayWeek(fromDateInput(e.target.value)));
                    }}
                    className="w-44"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Snaps to the Thursday of the chosen week.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
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
                  <TableHead className="text-right w-[130px]">Pay rate</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right w-[140px]">Hours worked</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      Loading employees…
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      No active employees in this scope.
                    </TableCell>
                  </TableRow>
                )}
                {weekQ.data?.employees.map((row) => {
                  const emp = row.employee;
                  const scheduled = Number(row.entry?.scheduledHours ?? 0);
                  const rawHours = hours[emp.id] ?? "";
                  const rawRate = rates[emp.id] ?? String(Number(emp.payRate));
                  const hrs = rawHours === "" ? 0 : Number(rawHours);
                  const rate = rawRate === "" ? 0 : Number(rawRate);
                  const { grossPay } = computeGross(hrs, rate);
                  return (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{emp.fullName}</TableCell>
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
                            setRates((s) => ({ ...s, [emp.id]: e.target.value }))
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
                        {scheduled.toFixed(1)} h
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min="0"
                          max="168"
                          value={rawHours}
                          onChange={(e) =>
                            setHours((s) => ({ ...s, [emp.id]: e.target.value }))
                          }
                          onBlur={() => {
                            if (
                              rawHours !== "" &&
                              rawHours !== String(Number(row.entry?.hoursWorked ?? 0))
                            ) {
                              handleSaveOne(emp.id, scheduled);
                            }
                          }}
                          placeholder="0"
                          className="text-right tabular-nums h-9"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(grossPay)}
                      </TableCell>
                      <TableCell className="text-right">
                        {saving[emp.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                        ) : row.entry ? (
                          <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
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
