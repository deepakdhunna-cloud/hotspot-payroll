import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { fmtHours, fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Users as UsersIcon,
  Building2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

// Hotspot pay period: Thursday – Wednesday. Anchor any date to the Thursday
// on or before it (UTC), and default the dashboard to the most recently
// closed pay period (the week we're actively paying).
function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function currentPayPeriodStart(now: Date = new Date()): Date {
  const start = startOfWeek(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return start;
}

export default function Home() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => currentPayPeriodStart(new Date()));
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const scopeQ = trpc.meta.myScope.useQuery();
  const greetingQ = trpc.meta.greetingName.useQuery();
  const stores = scopeQ.data?.stores ?? [];

  const summaryQ = trpc.dashboard.summary.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const totals = summaryQ.data?.totals ?? {
    totalHours: 0,
    totalScheduled: 0,
    totalGross: 0,
    variance: 0,
  };
  const byStore = summaryQ.data?.byStore ?? {};
  const employees = summaryQ.data?.employees ?? [];

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d);
  };

  const totalEmployees = useMemo(
    () => Object.values(byStore).reduce((acc: number, b: any) => acc + b.employeeCount, 0),
    [byStore],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            {user?.role === "admin" ? "CEO Dashboard" : "Manager Dashboard"}
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1">
            Welcome back,{" "}
            {user?.role === "admin"
              ? "CEO"
              : greetingQ.data?.name ?? "Manager"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live overview of hours, scheduled vs actual, and gross pay across your stores.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 backdrop-blur p-1">
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

      {/* KPI cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total hours worked"
          value={fmtHours(totals.totalHours)}
          icon={<ClipboardList className="h-5 w-5" />}
          accent="primary"
        />
        <KpiCard
          label="Scheduled hours"
          value={fmtHours(totals.totalScheduled)}
          icon={<CalendarDays className="h-5 w-5" />}
          accent="blue"
        />
        <KpiCard
          label="Total gross pay"
          value={fmtMoney(totals.totalGross)}
          icon={<DollarSign className="h-5 w-5" />}
          accent="green"
        />
        <KpiCard
          label="Over / under schedule"
          value={
            <span className={totals.variance >= 0 ? "text-emerald-400" : "text-red-400"}>
              {totals.variance >= 0 ? "+" : ""}
              {totals.variance.toFixed(1)} h
            </span>
          }
          icon={
            totals.variance >= 0 ? (
              <TrendingUp className="h-5 w-5" />
            ) : (
              <TrendingDown className="h-5 w-5" />
            )
          }
          accent={totals.variance >= 0 ? "emerald" : "red"}
        />
      </section>

      {/* Per store cards — grid adapts to how many stores are visible so a
          single store stretches full width instead of looking squished. */}
      <section
        className={
          (() => {
            const n = Object.keys(byStore).length;
            if (n <= 1) return "grid grid-cols-1 gap-4";
            if (n === 2) return "grid grid-cols-1 md:grid-cols-2 gap-4";
            if (n === 3) return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";
            return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4";
          })()
        }
      >
        {Object.entries(byStore).map(([store, s]: any) => {
          const variance = s.totalHours - s.totalScheduled;
          return (
            <Card key={store} className="overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
              <CardHeader className="relative pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {store}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Hours</div>
                    <div className="font-semibold text-base">{fmtHours(s.totalHours)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Gross</div>
                    <div className="font-semibold text-base">{fmtMoney(s.totalGross)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Scheduled</div>
                    <div className="font-medium">{fmtHours(s.totalScheduled)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Employees</div>
                    <div className="font-medium flex items-center gap-1">
                      <UsersIcon className="h-3 w-3" /> {s.employeeCount}
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Variance</span>
                  <Badge
                    variant="outline"
                    className={
                      variance >= 0
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : "border-red-500/40 text-red-400 bg-red-500/10"
                    }
                  >
                    {variance >= 0 ? (
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 mr-1" />
                    )}
                    {variance >= 0 ? "+" : ""}
                    {variance.toFixed(1)} h
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Per-employee table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Employees this week</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {totalEmployees} active employee{totalEmployees === 1 ? "" : "s"} in scope.
            </p>
          </div>
          <Link href="/payroll">
            <Button size="sm" variant="outline">
              Enter weekly hours
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                      No employees yet. <Link href="/employees" className="text-primary underline">Add your first employee</Link>.
                    </TableCell>
                  </TableRow>
                )}
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link href={`/employees/${e.id}`} className="font-medium hover:text-primary">
                        {e.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="font-normal">
                        {e.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(e.payRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.hoursWorked.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {e.scheduledHours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={e.variance >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {e.variance >= 0 ? "+" : ""}
                        {e.variance.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmtMoney(e.grossPay)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  accent: "primary" | "green" | "blue" | "emerald" | "red";
}) {
  const ring = {
    primary: "bg-primary/10 text-primary",
    green: "bg-emerald-500/10 text-emerald-400",
    blue: "bg-sky-500/10 text-sky-400",
    emerald: "bg-emerald-500/10 text-emerald-400",
    red: "bg-red-500/10 text-red-400",
  }[accent];
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold mt-2 tabular-nums">{value}</p>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${ring}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
