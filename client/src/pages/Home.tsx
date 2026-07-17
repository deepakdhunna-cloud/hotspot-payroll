/**
 * The payroll cockpit. One screen, two modes:
 *
 *  LIVE WEEK  — who's on the clock, hours accruing against the schedule,
 *               live labor cost, and anything needing attention.
 *  CLOSED WEEK — what happened, what's been saved to payroll, what still
 *               needs finalizing, one click from export.
 *
 * The eight-week filmstrip makes any older pay week (always Thu → Wed)
 * one click away.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { AttentionCenter } from "@/components/AttentionCenter";
import { EmptyState } from "@/components/EmptyState";
import { InitialsBadge } from "@/components/InitialsBadge";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { StoreSelect } from "@/components/StoreSelect";
import { WeekTrend } from "@/components/WeekTrend";
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
import {
  fmtDuration,
  inProgressPayWeekStart,
  payWeekDays,
  shortDayLabel,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  LayoutDashboard,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [weekStart, setWeekStart] = useState(() => inProgressPayWeekStart());
  const [storeFilter, setStoreFilter] = useState("all");
  const [showAllClockedIn, setShowAllClockedIn] = useState(false);

  const scopeQ = trpc.meta.myScope.useQuery();
  const greetingQ = trpc.meta.greetingName.useQuery();
  const stores = scopeQ.data?.stores ?? [];
  const store = storeFilter === "all" ? undefined : (storeFilter as any);

  const summaryQ = trpc.dashboard.summary.useQuery(
    { weekStart, store },
    { refetchInterval: 60_000 },
  );
  const trendQ = trpc.dashboard.trend.useQuery(
    { weeks: 8, store },
    { refetchInterval: 5 * 60_000 },
  );

  const data = summaryQ.data;
  const totals = data?.totals ?? {
    totalHours: 0,
    totalScheduled: 0,
    totalGross: 0,
    totalEntered: 0,
    totalSavedGross: 0,
    totalScheduledCost: 0,
    totalProjectedGross: 0,
    variance: 0,
  };
  const employees = data?.employees ?? [];
  const clockedIn = data?.clockedInNow ?? [];

  const isLiveWeek = weekStart.getTime() === inProgressPayWeekStart().getTime();

  /* ---------------- derived signals ---------------- */

  const overClocked = employees.filter((e) => e.overClocked);
  // Worked this week but nothing saved to payroll yet (matters once closed).
  const unsaved = employees.filter((e) => e.clockHours > 0.25 && e.hoursWorked === 0);
  const savedCount = employees.filter((e) => e.hoursWorked > 0).length;
  // Open punches running longer than 12h are almost always forgotten.
  const forgotten = clockedIn.filter(
    (c) => Date.now() - new Date(c.clockInAt).getTime() > 12 * 3_600_000,
  );

  const pace = useMemo(() => {
    if (!isLiveWeek || totals.totalScheduled <= 0) return null;
    const frac = Math.min(
      1,
      Math.max(0, (Date.now() - weekStart.getTime()) / (7 * 86_400_000)),
    );
    if (frac <= 0) return null;
    const diff = totals.totalHours - totals.totalScheduled * frac;
    const tolerance = Math.max(2, totals.totalScheduled * 0.03);
    const projected = totals.totalHours / frac;
    if (diff > tolerance) return { kind: "over" as const, projected };
    if (diff < -tolerance) return { kind: "under" as const, projected };
    return { kind: "on" as const, projected };
  }, [isLiveWeek, totals.totalHours, totals.totalScheduled, weekStart]);

  const dayStrip = useMemo(() => {
    const byIso = new Map(
      (data?.scheduleDays ?? []).map((d) => [new Date(d.date).toISOString(), d]),
    );
    return payWeekDays(weekStart).map((day) => {
      const hit = byIso.get(day.toISOString());
      return { day, totalHours: hit?.totalHours ?? 0, shiftCount: hit?.shiftCount ?? 0 };
    });
  }, [data?.scheduleDays, weekStart]);
  const maxDayHours = Math.max(1, ...dayStrip.map((d) => d.totalHours));

  const displayName = isAdmin ? "CEO" : (greetingQ.data?.name ?? "Manager");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isAdmin ? "CEO dashboard" : "Manager dashboard"}
        icon={<LayoutDashboard className="h-5 w-5" />}
        title={`Welcome back, ${displayName}`}
        description={
          isLiveWeek
            ? `${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} — live view, numbers move as your team clocks in and out.`
            : `Closed week · ${fmtWeekRange(weekStart)} — review what happened and finalize payroll.`
        }
        actions={
          <>
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />
            <StoreSelect
              stores={stores}
              isAdmin={!!isAdmin}
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </>
        }
      />

      {/* The assistant — persistent, dated task stack across the whole site */}
      <AttentionCenter />

      {/* KPI band — one strip, one dominant number per mode */}
      {summaryQ.isLoading ? (
        <Skeleton className="h-[124px] rounded-xl" />
      ) : isLiveWeek ? (
        <KpiBand>
          <KpiCell
            hero
            label="Hours clocked"
            value={totals.totalHours.toFixed(1)}
            sub={
              totals.totalScheduled > 0
                ? `of ${totals.totalScheduled.toFixed(1)} hours scheduled`
                : "no schedule loaded for this week"
            }
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
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> on pace
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            label="Projected payroll"
            value={<Money value={totals.totalProjectedGross} />}
            sub="hours already worked + shifts still to come"
            footer={
              totals.totalScheduledCost > 0 ? (
                totals.totalProjectedGross - totals.totalScheduledCost > 25 ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />+
                    {fmtMoney(totals.totalProjectedGross - totals.totalScheduledCost)} over
                    plan
                  </span>
                ) : (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> on plan
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            label="Scheduled payroll"
            value={<Money value={totals.totalScheduledCost} />}
            sub={
              totals.totalScheduledCost > 0
                ? "what the week costs if it goes exactly to plan"
                : "appears once a schedule is imported"
            }
          />
          <KpiCell
            label="Labor cost (live)"
            value={<Money value={totals.totalGross} />}
            sub="what the team has earned so far this week"
          />
        </KpiBand>
      ) : (
        <KpiBand>
          <KpiCell
            hero
            label="Payroll saved"
            value={<Money value={totals.totalSavedGross} />}
            sub="the payroll that was saved for this week"
            footer={
              unsaved.length > 0 ? (
                <span className="chip-warn">
                  <AlertTriangle className="h-3 w-3" />
                  {unsaved.length} unsaved
                </span>
              ) : savedCount > 0 ? (
                <span className="chip-good">
                  <CheckCircle2 className="h-3 w-3" /> complete
                </span>
              ) : null
            }
          />
          <KpiCell
            label="Hours worked"
            value={totals.totalHours.toFixed(1)}
            sub={
              totals.totalScheduled > 0
                ? `of ${totals.totalScheduled.toFixed(1)} hours scheduled`
                : "no schedule was loaded that week"
            }
            footer={
              totals.totalScheduled > 0 ? (
                totals.totalHours - totals.totalScheduled > 0.25 ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />+
                    {(totals.totalHours - totals.totalScheduled).toFixed(1)}h over schedule
                  </span>
                ) : (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> within schedule
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            label="Saved to payroll"
            value={`${savedCount}/${employees.length}`}
            sub={`${totals.totalEntered.toFixed(1)} hours entered so far`}
          />
          <KpiCell
            label="Labor cost"
            value={<Money value={totals.totalGross} />}
            sub="what the team earned that week"
          />
        </KpiBand>
      )}

      {/* Eight-week filmstrip — older payroll is one click away */}
      <Card className="surface-card border-0 rise-in" style={{ animationDelay: "140ms" }}>
        <CardHeader className="pb-1 flex flex-row items-center justify-between">
          <CardTitle className="section-title">Last 8 pay weeks</CardTitle>
          <span className="text-xs text-muted-foreground">
            bars = clocked hours · <span className="text-success">●</span> payroll saved · click to open
          </span>
        </CardHeader>
        <CardContent>
          {trendQ.isLoading ? (
            <Skeleton className="h-24 rounded-md" />
          ) : (
            <WeekTrend
              weeks={(trendQ.data?.weeks ?? []) as any}
              selected={weekStart}
              onSelect={(w) => setWeekStart(w)}
            />
          )}
        </CardContent>
      </Card>

      {/* Operational detail */}
      <div className="grid gap-4 lg:grid-cols-2">
        {isLiveWeek ? (
          <Card className="surface-card border-0 rise-in" style={{ animationDelay: "160ms" }}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="section-title flex items-center gap-2">
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
              {clockedIn.length === 0 ? (
                <EmptyState
                  title="Nobody is on the clock"
                  hint="This list fills in live as people punch in at the kiosk."
                />
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {(showAllClockedIn ? clockedIn : clockedIn.slice(0, 6)).map((c) => {
                      const hrs = (Date.now() - new Date(c.clockInAt).getTime()) / 3_600_000;
                      const long = hrs > 12;
                      return (
                        <li key={c.punchId} className="flex items-center justify-between py-2.5">
                          <div className="min-w-0 flex items-center gap-2.5">
                            <InitialsBadge name={c.fullName} size="sm" />
                            <span className="min-w-0">
                              <Link
                                href={`/employees/${c.employeeId}`}
                                className="text-sm font-medium hover:text-primary transition-colors"
                              >
                                {c.fullName}
                              </Link>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {c.role}
                                {stores.length > 1
                                  ? ` · ${STORE_ABBR[c.storeLocation] ?? c.storeLocation}`
                                  : ""}
                              </span>
                            </span>
                          </div>
                          <span
                            className={`text-xs tabular-nums shrink-0 ${
                              long ? "chip-warn" : "text-muted-foreground"
                            }`}
                          >
                            {long ? <AlertTriangle className="h-3 w-3" /> : null}
                            {fmtDuration(hrs)} · since{" "}
                            {new Date(c.clockInAt).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {clockedIn.length > 6 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-3 h-8 text-xs bg-card"
                      onClick={() => setShowAllClockedIn((v) => !v)}
                    >
                      {showAllClockedIn
                        ? "Show fewer"
                        : `See all ${clockedIn.length} on the clock`}
                    </Button>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="surface-card border-0 rise-in" style={{ animationDelay: "160ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="section-title">Week recap</CardTitle>
            </CardHeader>
            <CardContent>
              {employees.filter((e) => e.clockHours > 0).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hours were clocked this week.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {[...employees]
                    .filter((e) => e.clockHours > 0)
                    .sort((a, b) => b.clockHours - a.clockHours)
                    .slice(0, 6)
                    .map((e) => (
                      <li key={e.id} className="flex items-center justify-between py-2.5">
                        <Link
                          href={`/employees/${e.id}`}
                          className="text-sm font-medium hover:text-primary transition-colors truncate"
                        >
                          {e.fullName}
                        </Link>
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                          {e.clockHours.toFixed(1)}h
                          {e.hoursWorked > 0 ? (
                            <span className="text-success"> · saved</span>
                          ) : (
                            <span className="text-warning"> · not saved</span>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {!isLiveWeek && unsaved.length > 0 ? (
                <Link href={`/payroll?week=${toDateInput(weekStart)}`}>
                  <Button className="w-full mt-4">
                    Finalize payroll for this week
                    <ArrowUpRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Card className="surface-card border-0 rise-in" style={{ animationDelay: "200ms" }}>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="section-title flex items-center gap-2">
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
            {!data?.hasDaySchedule ? (
              <EmptyState
                title="No daily coverage yet"
                hint="Import this week's schedule and each day's staffing shows here."
              />
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
                        background:
                          d.totalHours > 0
                            ? "linear-gradient(180deg, #5b9be0, var(--chart-1) 60%)"
                            : "var(--border)",
                      }}
                    />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {d.day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The week's ledger */}
      <Card className="surface-card border-0 rise-in" style={{ animationDelay: "240ms" }}>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="section-title">
            {isLiveWeek ? "This week by employee" : `Week of ${fmtWeekRange(weekStart)}`}
          </CardTitle>
          <Link href={`/payroll?week=${toDateInput(weekStart)}`}>
            <Button size="sm" variant="outline" className="h-8 bg-card">
              {isLiveWeek ? "Open payroll" : "Enter hours"}{" "}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="w-[38%]">Hours vs schedule</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">
                    {isLiveWeek ? "Labor cost" : "Saved gross"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                      Loading employees…
                    </TableCell>
                  </TableRow>
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                      No employees in scope yet.{" "}
                      <Link href="/employees" className="text-primary hover:underline">
                        Add your team →
                      </Link>
                    </TableCell>
                  </TableRow>
                ) : (
                  [...employees]
                    .sort((a, b) => b.clockHours - a.clockHours)
                    .map((emp) => {
                      const onClockNow = clockedIn.some((c) => c.employeeId === emp.id);
                      const pct =
                        emp.scheduledHours > 0
                          ? Math.min(1.25, emp.clockHours / emp.scheduledHours)
                          : 0;
                      return (
                        <TableRow key={emp.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <InitialsBadge name={emp.fullName} />
                              <div className="min-w-0">
                                <Link
                                  href={`/employees/${emp.id}`}
                                  className="font-medium hover:text-primary transition-colors"
                                >
                                  {emp.fullName}
                                </Link>
                                <div className="text-xs text-muted-foreground">
                                  {emp.role}
                                  {stores.length > 1
                                    ? ` · ${STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}`
                                    : ""}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-2.5 flex-1 max-w-56 rounded-full bg-muted shadow-inner overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(100, pct * 80)}%`,
                                    background: emp.overClocked
                                      ? "var(--warning)"
                                      : "var(--chart-1)",
                                  }}
                                />
                              </div>
                              <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                                {emp.clockHours.toFixed(1)}
                                {emp.scheduledHours > 0
                                  ? ` / ${emp.scheduledHours.toFixed(1)}h`
                                  : "h"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {onClockNow ? (
                              <span className="chip-good">
                                <Clock className="h-3 w-3" /> on the clock
                              </span>
                            ) : emp.overClocked ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" />+
                                {emp.overClockedBy.toFixed(1)}h over
                              </span>
                            ) : !isLiveWeek && emp.clockHours > 0.25 && emp.hoursWorked === 0 ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" /> not saved
                              </span>
                            ) : !isLiveWeek && emp.hoursWorked > 0 ? (
                              <span className="chip-good">
                                <CheckCircle2 className="h-3 w-3" /> saved
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {isLiveWeek ? (
                              <Money value={emp.clockHours * emp.payRate} />
                            ) : emp.grossPay > 0 ? (
                              <Money value={emp.grossPay} />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
