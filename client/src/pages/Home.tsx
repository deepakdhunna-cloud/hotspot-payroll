/**
 * Manager dashboard — the operating picture for one store (or all stores in
 * scope): live clock-ins, hours vs schedule, gross pay, day-level schedule
 * coverage, and anything that needs attention this week.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StoreSelect } from "@/components/StoreSelect";
import { WeekNavigator } from "@/components/WeekNavigator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STORE_ABBR, fmtMoney, fmtWeekRange } from "@/lib/format";
import { inProgressPayWeekStart, payWeekDays, shortDayLabel } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Clock,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  Timer,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [weekStart, setWeekStart] = useState(() => inProgressPayWeekStart());
  const [storeFilter, setStoreFilter] = useState("all");

  const scopeQ = trpc.meta.myScope.useQuery();
  const greetingQ = trpc.meta.greetingName.useQuery();
  const stores = scopeQ.data?.stores ?? [];

  const summaryQ = trpc.dashboard.summary.useQuery(
    {
      weekStart,
      store: storeFilter === "all" ? undefined : (storeFilter as any),
    },
    { refetchInterval: 60_000 },
  );
  const data = summaryQ.data;
  const totals = data?.totals ?? {
    totalHours: 0,
    totalScheduled: 0,
    totalGross: 0,
    variance: 0,
  };
  const employees = data?.employees ?? [];
  const clockedIn = data?.clockedInNow ?? [];
  const overClocked = employees.filter((e) => e.overClocked);

  const isCurrentWeek =
    weekStart.getTime() === inProgressPayWeekStart().getTime();

  // Pace: how worked hours track against schedule at this point in the week.
  // Over pace = trending past the scheduled labor budget = a warning.
  const pace = useMemo(() => {
    if (!isCurrentWeek || totals.totalScheduled <= 0) return null;
    const elapsedMs = Date.now() - weekStart.getTime();
    const frac = Math.min(1, Math.max(0.02, elapsedMs / (7 * 86_400_000)));
    const projected = totals.totalHours / frac;
    const tolerance = Math.max(2, totals.totalScheduled * 0.03);
    if (projected > totals.totalScheduled + tolerance)
      return { kind: "over" as const, projected };
    if (projected < totals.totalScheduled - tolerance)
      return { kind: "under" as const, projected };
    return { kind: "on" as const, projected };
  }, [isCurrentWeek, totals.totalHours, totals.totalScheduled, weekStart]);

  // Day-level schedule coverage (Thu → Wed).
  const dayStrip = useMemo(() => {
    const byIso = new Map(
      (data?.scheduleDays ?? []).map((d) => [new Date(d.date).toISOString(), d]),
    );
    return payWeekDays(weekStart).map((day) => {
      const hit = byIso.get(day.toISOString());
      return {
        day,
        totalHours: hit?.totalHours ?? 0,
        shiftCount: hit?.shiftCount ?? 0,
      };
    });
  }, [data?.scheduleDays, weekStart]);
  const maxDayHours = Math.max(1, ...dayStrip.map((d) => d.totalHours));

  const byStore = data?.byStore ?? {};
  const storeNames = Object.keys(byStore);
  const storeGrid =
    storeNames.length === 2
      ? "sm:grid-cols-2"
      : storeNames.length === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2 xl:grid-cols-4";

  const displayName = isAdmin ? "CEO" : (greetingQ.data?.name ?? "Manager");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isAdmin ? "CEO dashboard" : "Manager dashboard"}
        icon={<LayoutDashboard className="h-5 w-5" />}
        title={`Welcome back, ${displayName}`}
        description="This week at a glance: who's clocked in, hours against schedule, and projected pay."
        actions={
          <>
            <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
            <StoreSelect
              stores={stores}
              isAdmin={!!isAdmin}
              value={storeFilter}
              onChange={setStoreFilter}
            />
            <Button
              variant="outline"
              className="h-9 bg-card shadow-sm"
              onClick={() => window.open("/clock", "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" /> Open kiosk
            </Button>
          </>
        }
      />

      {/* Needs attention */}
      {data &&
      (overClocked.length > 0 || !data.hasScheduleImport || data.missingClockCodes > 0) ? (
        <div className="flex flex-wrap items-center gap-2 rise-in">
          {overClocked.length > 0 ? (
            <span className="chip-warn">
              <AlertTriangle className="h-3 w-3" />
              {overClocked.length} over schedule this week
            </span>
          ) : null}
          {!data.hasScheduleImport ? (
            <Link
              href="/schedule-import"
              className="chip-neutral hover:bg-accent transition-colors"
            >
              <Upload className="h-3 w-3" />
              No schedule imported for this week — import now
            </Link>
          ) : null}
          {data.missingClockCodes > 0 ? (
            <Link href="/employees" className="chip-neutral hover:bg-accent transition-colors">
              <KeyRound className="h-3 w-3" />
              {data.missingClockCodes} employee{data.missingClockCodes === 1 ? "" : "s"} without a
              clock code
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* KPI row */}
      {summaryQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Hours worked"
            value={totals.totalHours.toFixed(1)}
            sub={`of ${totals.totalScheduled.toFixed(1)} scheduled`}
            icon={<Timer />}
            style={{ animationDelay: "0ms" }}
            footer={
              pace ? (
                pace.kind === "over" ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />
                    over pace · proj {pace.projected.toFixed(0)}h
                  </span>
                ) : pace.kind === "under" ? (
                  <span className="chip-neutral">
                    behind pace · proj {pace.projected.toFixed(0)}h
                  </span>
                ) : (
                  <span className="chip-good">on pace</span>
                )
              ) : null
            }
          />
          <StatCard
            label="Scheduled hours"
            value={totals.totalScheduled.toFixed(1)}
            sub={fmtWeekRange(weekStart)}
            icon={<CalendarDays />}
            style={{ animationDelay: "40ms" }}
            footer={
              data?.hasScheduleImport ? (
                <span className="chip-good">schedule imported</span>
              ) : (
                <span className="chip-neutral">no import yet</span>
              )
            }
          />
          <StatCard
            label="Gross pay"
            value={fmtMoney(totals.totalGross)}
            sub="entered hours × pay rate"
            icon={<CircleDollarSign />}
            style={{ animationDelay: "80ms" }}
          />
          <StatCard
            label="On the clock now"
            value={clockedIn.length}
            sub={
              clockedIn.length > 0
                ? clockedIn
                    .slice(0, 3)
                    .map((c) => c.fullName.split(" ")[0])
                    .join(", ") + (clockedIn.length > 3 ? "…" : "")
                : "nobody clocked in"
            }
            icon={<Clock />}
            style={{ animationDelay: "120ms" }}
          />
        </div>
      )}

      {/* Live activity + schedule day strip */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="surface-card border-0 rise-in" style={{ animationDelay: "140ms" }}>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {clockedIn.length > 0 ? (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                ) : null}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    clockedIn.length > 0 ? "bg-success" : "bg-muted-foreground/40"
                  }`}
                />
              </span>
              On the clock now
            </CardTitle>
            <Link
              href="/payroll?tab=punches"
              className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5"
            >
              All punches <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {summaryQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 rounded-md" />
                <Skeleton className="h-9 rounded-md" />
              </div>
            ) : clockedIn.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nobody is clocked in right now.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {clockedIn.map((c) => (
                  <li key={c.punchId} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/employees/${c.employeeId}`}
                        className="text-sm font-medium hover:text-primary transition-colors"
                      >
                        {c.fullName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.role} · {STORE_ABBR[c.storeLocation] ?? c.storeLocation}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      since{" "}
                      {new Date(c.clockInAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="surface-card border-0 rise-in" style={{ animationDelay: "180ms" }}>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Scheduled hours by day
            </CardTitle>
            <Link
              href="/schedule-import"
              className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5"
            >
              Import schedule <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {summaryQ.isLoading ? (
              <Skeleton className="h-28 rounded-md" />
            ) : !data?.hasScheduleImport ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No day-level schedule yet — upload this week's Homebase schedule to see daily
                coverage.
              </p>
            ) : (
              <div className="flex items-end justify-between gap-2 h-32 pt-2">
                {dayStrip.map((d) => (
                  <div
                    key={d.day.toISOString()}
                    className="flex flex-col items-center gap-1 flex-1 h-full justify-end group"
                    title={`${shortDayLabel(d.day)} — ${d.totalHours.toFixed(1)}h across ${d.shiftCount} shift${d.shiftCount === 1 ? "" : "s"}`}
                  >
                    {d.totalHours > 0 ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground group-hover:text-foreground transition-colors">
                        {d.totalHours.toFixed(0)}
                      </span>
                    ) : null}
                    <div
                      className="w-full max-w-9 rounded-t-[4px] transition-all"
                      style={{
                        height: `${Math.max(d.totalHours > 0 ? 6 : 2, (d.totalHours / maxDayHours) * 80)}px`,
                        background: d.totalHours > 0 ? "var(--chart-1)" : "var(--border)",
                      }}
                    />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {d.day.toLocaleDateString("en-US", {
                        weekday: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-store cards (only when more than one store is in scope) */}
      {storeNames.length > 1 ? (
        <div className={`grid gap-4 grid-cols-1 ${storeGrid}`}>
          {storeNames.map((s, i) => {
            const st = byStore[s];
            return (
              <Card
                key={s}
                className="surface-card border-0 rise-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
                    <span className="truncate">{s}</span>
                    {st.clockedInCount > 0 ? (
                      <span className="chip-good shrink-0">
                        <Clock className="h-3 w-3" />
                        {st.clockedInCount} in
                      </span>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <div className="kpi-label">Hours</div>
                    <div className="font-semibold tabular-nums">{st.totalHours.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="kpi-label">Scheduled</div>
                    <div className="font-semibold tabular-nums">
                      {st.totalScheduled.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="kpi-label">Gross</div>
                    <div className="font-semibold tabular-nums">{fmtMoney(st.totalGross)}</div>
                  </div>
                  <div>
                    <div className="kpi-label">Staff</div>
                    <div className="font-semibold tabular-nums flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {st.employeeCount}
                      {st.overClockedCount > 0 ? (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" />
                          {st.overClockedCount} over
                        </span>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Employee week table */}
      <Card className="surface-card border-0 rise-in" style={{ animationDelay: "220ms" }}>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">This week by employee</CardTitle>
          <Link href="/payroll">
            <Button size="sm" variant="outline" className="h-8 bg-card">
              Enter weekly hours <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Clocked</TableHead>
                  <TableHead className="text-right">Entered</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryQ.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-sm text-muted-foreground"
                    >
                      Loading employees…
                    </TableCell>
                  </TableRow>
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-sm text-muted-foreground"
                    >
                      No employees in scope yet.{" "}
                      <Link href="/employees" className="text-primary hover:underline">
                        Add your team →
                      </Link>
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <Link
                          href={`/employees/${emp.id}`}
                          className="font-medium hover:text-primary transition-colors"
                        >
                          {emp.fullName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {emp.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {emp.clockHours > 0 ? emp.clockHours.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {emp.hoursWorked.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {emp.scheduledHours.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.overClocked ? (
                          <span className="chip-warn">
                            <AlertTriangle className="h-3 w-3" />+
                            {emp.overClockedBy.toFixed(1)}h over
                          </span>
                        ) : emp.scheduledHours > 0 ? (
                          <span className="chip-good">on schedule</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(emp.grossPay)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
