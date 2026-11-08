/**
 * The payroll cockpit. One screen, two modes:
 *
 *  LIVE WEEK  — who's on the clock, hours accruing against the schedule,
 *               live labor cost, and anything needing attention.
 *  CLOSED WEEK — what happened, what's been saved to payroll, what still
 *               needs finalizing, one click from export.
 *
 * Top to bottom it answers, in order: does anything need me (attention),
 * what do I want to do (quick actions), how is the week going (KPIs), who's
 * here right now, and the detail behind it. The eight-week filmstrip at the
 * foot makes any older pay week (always Thu → Wed) one click away.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { businessDayStart } from "@shared/hotspot";
import { AttentionCenter } from "@/components/AttentionCenter";
import { EmptyState } from "@/components/EmptyState";
import { InitialsBadge } from "@/components/InitialsBadge";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { WeekTrend } from "@/components/WeekTrend";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STORE_ABBR, fmtHours, fmtHoursLabel, fmtMoney, fmtWeekRange } from "@/lib/format";
import {
  BUSINESS_TIME_ZONE,
  fmtDuration,
  fmtTime,
  inProgressPayWeekStart,
  payWeekBounds,
  payWeekDays,
  shortDayLabel,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  RotateCw,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  LogOut,
  Pencil,
  ClipboardCheck,
  History,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {
  ClockOutDialog,
  FixTimeDialog,
  type QuickPunch,
} from "@/components/PunchQuickActions";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

export default function Home() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // The CFO login's home IS the finance portal.
  const [, setLocation] = useLocation();
  const isCfo = user?.role === "cfo";
  useEffect(() => {
    if (isCfo) setLocation("/cfo", { replace: true });
  }, [isCfo, setLocation]);
  const [weekStart, setWeekStart] = useState(() => inProgressPayWeekStart());
  const { scope: storeFilter } = useStoreScope();
  const [showAllClockedIn, setShowAllClockedIn] = useState(false);
  // Long ledgers (the CEO sees every store) start with the top 10.
  const [showAllLedger, setShowAllLedger] = useState(false);
  const LEDGER_PREVIEW = 10;

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
  // One-tap punch fixes from the live list.
  const [clockOutFor, setClockOutFor] = useState<QuickPunch | null>(null);
  const [fixTimeFor, setFixTimeFor] = useState<QuickPunch | null>(null);
  const asQuickPunch = (c: (typeof clockedIn)[number]): QuickPunch => ({
    id: c.punchId,
    employeeName: c.fullName,
    clockInAt: c.clockInAt,
    clockOutAt: null,
    shiftEndLabel: c.shiftEndLabel,
  });

  const isLiveWeek = weekStart.getTime() === inProgressPayWeekStart().getTime();

  /* ---------------- derived signals ---------------- */

  // One definition of "saved" everywhere: hours or pay on the saved entry
  // (a set-pay week can carry pay with 0 hours recorded).
  const isSaved = (e: (typeof employees)[number]) => e.hoursWorked > 0 || e.grossPay > 0;
  // Worked that week but nothing saved to payroll yet (matters once closed).
  const unsaved = employees.filter((e) => e.clockHours > 0.25 && !isSaved(e));
  const savedCount = employees.filter(isSaved).length;
  // "Saved X of Y" counts only people with something to pay.
  const payableCount = employees.filter((e) => isSaved(e) || e.clockHours > 0.25).length;
  // Never show zeros for a week that failed to load.
  const summaryFailed = summaryQ.isError && !data;
  // Open punches running longer than 12h are almost always forgotten.
  const forgotten = clockedIn.filter(
    (c) => Date.now() - new Date(c.clockInAt).getTime() > 12 * 3_600_000,
  );

  const pace = useMemo(() => {
    if (!isLiveWeek || totals.totalScheduled <= 0) return null;
    // Elapsed share of the week in store time (Thu 00:00 → Thu 00:00 Chicago).
    const { start, end } = payWeekBounds(weekStart);
    const frac = Math.min(
      1,
      Math.max(0, (Date.now() - start.getTime()) / (end.getTime() - start.getTime())),
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

  const firstName = isAdmin ? "" : (greetingQ.data?.name ?? "").split(" ")[0];
  // Greeting and date follow store time, like everything else on the page.
  const hour = Number(
    new Date().toLocaleString("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: BUSINESS_TIME_ZONE,
    }),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const scopeLabel = isAdmin
    ? storeFilter === "all"
      ? "All stores"
      : storeFilter
    : (user?.store ?? "");
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => b.clockHours - a.clockHours),
    [employees],
  );
  // "Today" in store-local time, so the evening shift doesn't jump ahead a day.
  const todayIso = toDateInput(businessDayStart());

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        description={
          isLiveWeek
            ? [todayLabel, scopeLabel].filter(Boolean).join(" · ")
            : `Closed week · ${fmtWeekRange(weekStart)}${scopeLabel ? ` · ${scopeLabel}` : ""}`
        }
        actions={<QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />}
      />

      {/* Everything that needs a person, with its fix. One quiet line when clear. */}
      <AttentionCenter />

      {/* Every everyday action, one tap from home */}
      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <QuickAction href="/payroll?tab=punches&add=1" icon={<Clock />} label="Add a punch" hint="Fix or add hours" />
        <QuickAction href="/employees?add=1" icon={<UserPlus />} label="Add employee" hint="New team member" />
        <QuickAction href="/schedule-import" icon={<CalendarDays />} label="Import schedule" hint="Upload this week" />
        <QuickAction href="/payroll" icon={<Wallet />} label="Run payroll" hint="Review and export" />
      </nav>

      {/* KPI band — one strip, one dominant number per mode */}
      {summaryQ.isLoading ? (
        <Skeleton className="h-[116px] rounded-xl" />
      ) : summaryFailed ? (
        <div
          role="alert"
          className="surface-card flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <div className="flex items-center gap-3">
            <span className="icon-badge hue-amber">
              <AlertTriangle />
            </span>
            <div>
              <p className="text-sm font-medium">Couldn&apos;t load this week&apos;s numbers</p>
              <p className="text-sm text-muted-foreground">
                Check the connection, then try again. Nothing below is current until it loads.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => summaryQ.refetch()} className="shrink-0">
            <RotateCw className="h-4 w-4 mr-2" /> Try again
          </Button>
        </div>
      ) : isLiveWeek ? (
        <KpiBand>
          <KpiCell
            hero
            icon={<Clock />}
            label="Hours clocked"
            value={fmtHours(totals.totalHours)}
            sub={
              totals.totalScheduled > 0
                ? `of ${fmtHours(totals.totalScheduled)} scheduled${
                    pace ? ` · heading for ~${fmtHours(pace.projected, 0)}` : ""
                  }`
                : "no schedule this week"
            }
            footer={
              pace ? (
                pace.kind === "over" ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />
                    Running over schedule
                  </span>
                ) : pace.kind === "under" ? (
                  <span className="chip-neutral">Running under schedule</span>
                ) : (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> On pace
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            hue="green"
            icon={<Wallet />}
            label="Labor cost so far"
            value={<Money value={totals.totalGross} />}
            sub="earned this week"
          />
          <KpiCell
            hue="teal"
            icon={<TrendingUp />}
            label="Projected payroll"
            value={<Money value={totals.totalProjectedGross} />}
            sub="worked + still scheduled"
            footer={
              totals.totalScheduledCost > 0 ? (
                totals.totalProjectedGross - totals.totalScheduledCost > 25 ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />
                    {fmtMoney(totals.totalProjectedGross - totals.totalScheduledCost)} over plan
                  </span>
                ) : (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> On plan
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            hue="violet"
            icon={<CalendarDays />}
            label="Planned payroll"
            value={<Money value={totals.totalScheduledCost} />}
            sub={totals.totalScheduledCost > 0 ? "if the week goes to schedule" : "import a schedule to see it"}
          />
        </KpiBand>
      ) : (
        <KpiBand>
          <KpiCell
            hero
            icon={<Wallet />}
            label="Payroll saved"
            value={<Money value={totals.totalSavedGross} />}
            sub={
              payableCount > 0
                ? `${savedCount} of ${payableCount} ${payableCount === 1 ? "person" : "people"} saved`
                : "nobody worked that week"
            }
            footer={
              unsaved.length > 0 ? (
                <span className="chip-warn">
                  <AlertTriangle className="h-3 w-3" />
                  {unsaved.length} not saved
                </span>
              ) : savedCount > 0 ? (
                <span className="chip-good">
                  <CheckCircle2 className="h-3 w-3" /> Complete
                </span>
              ) : null
            }
          />
          <KpiCell
            hue="blue"
            icon={<Clock />}
            label="Hours worked"
            value={fmtHours(totals.totalHours)}
            sub={
              totals.totalScheduled > 0
                ? `of ${fmtHours(totals.totalScheduled)} scheduled`
                : "no schedule that week"
            }
            footer={
              totals.totalScheduled > 0 ? (
                totals.totalHours - totals.totalScheduled > 0.25 ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />+
                    {fmtHoursLabel(totals.totalHours - totals.totalScheduled)} over
                  </span>
                ) : (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> Within schedule
                  </span>
                )
              ) : null
            }
          />
          <KpiCell
            hue="teal"
            icon={<ClipboardCheck />}
            label="Hours entered"
            value={fmtHours(totals.totalEntered)}
            sub="saved to payroll"
          />
          <KpiCell
            hue="green"
            icon={<Wallet />}
            label="Labor cost"
            value={<Money value={totals.totalGross} />}
            sub="earned that week"
          />
        </KpiBand>
      )}

      {/* Finalize CTA for a closed week with unsaved rows */}
      {!isLiveWeek && unsaved.length > 0 ? (
        <div className="callout-warn rounded-xl flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {unsaved.length} {unsaved.length === 1 ? "person has" : "people have"} hours
              that aren&apos;t saved to payroll yet
            </p>
            <p className="text-sm text-muted-foreground">
              Review the week and save it so it can be exported.
            </p>
          </div>
          <Button asChild>
            <Link href={`/payroll?week=${toDateInput(weekStart)}`}>
              Finalize payroll <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
      ) : null}

      {/* Operational detail */}
      <div className="grid gap-5 md:gap-6 lg:grid-cols-[1.25fr_1fr]">
        {isLiveWeek ? (
          <Card className="surface-card gap-0 py-0">
            <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
              <CardTitle className="section-title">
                <span className="icon-badge icon-badge-sm">
                  <Users />
                </span>
                <span className="relative flex h-2 w-2 order-last">
                  {clockedIn.length > 0 ? (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                  ) : null}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      clockedIn.length > 0 ? "bg-success" : "bg-muted-foreground/40"
                    }`}
                  />
                </span>
                On the clock
                <span className="text-muted-foreground font-normal tabular-nums">
                  {clockedIn.length}
                </span>
              </CardTitle>
              <Button size="sm" variant="outline" className="h-9 sm:h-8" asChild>
                <Link href="/payroll?tab=punches">All punches</Link>
              </Button>
            </CardHeader>
            <CardContent className="px-4 sm:px-5 pb-4">
              {summaryQ.isLoading ? (
                <CardRowsSkeleton />
              ) : summaryFailed ? (
                <CardLoadError onRetry={() => summaryQ.refetch()} />
              ) : clockedIn.length === 0 ? (
                <EmptyState
                  icon={<Clock />}
                  title="Nobody is on the clock"
                  hint="People appear here the moment they clock in."
                />
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {(showAllClockedIn ? clockedIn : clockedIn.slice(0, 6)).map((c) => {
                      const hrs = (Date.now() - new Date(c.clockInAt).getTime()) / 3_600_000;
                      const long = hrs > 12;
                      return (
                        <li key={c.punchId} className="flex items-center gap-3 py-2.5">
                          <InitialsBadge name={c.fullName} />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/employees/${c.employeeId}`}
                              className="block truncate text-sm font-medium hover:underline underline-offset-2"
                            >
                              {c.fullName}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              <span className="role-tag">{c.role}</span>
                              {stores.length > 1
                                ? ` · ${STORE_ABBR[c.storeLocation] ?? c.storeLocation}`
                                : ""}{" "}
                              · in at {fmtTime(c.clockInAt)}
                            </p>
                          </div>
                          <span
                            className={
                              long
                                ? "chip-warn tabular-nums"
                                : "text-sm tabular-nums text-muted-foreground"
                            }
                          >
                            {long ? <AlertTriangle className="h-3 w-3" /> : null}
                            {fmtDuration(hrs)}
                          </span>
                          <div className="flex shrink-0 items-center">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground"
                              onClick={() => setFixTimeFor(asQuickPunch(c))}
                              aria-label={`Fix ${c.fullName}'s clock-in time`}
                              title="Fix clock-in time"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant={long ? "default" : "outline"}
                              className="h-9 sm:h-8 px-2.5"
                              onClick={() => setClockOutFor(asQuickPunch(c))}
                              title={
                                long
                                  ? "Looks forgotten — clock them out"
                                  : "Clock this person out"
                              }
                            >
                              <LogOut className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                              <span className="sr-only sm:not-sr-only">Clock out</span>
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {clockedIn.length > 6 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 h-9 text-muted-foreground"
                      onClick={() => setShowAllClockedIn((v) => !v)}
                    >
                      {showAllClockedIn
                        ? "Show fewer"
                        : `Show all ${clockedIn.length}`}
                    </Button>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="surface-card gap-0 py-0">
            <CardHeader className="card-head px-4 sm:px-5 py-3">
              <CardTitle className="section-title">
                <span className="icon-badge icon-badge-sm">
                  <Clock />
                </span>
                Most hours that week
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 sm:px-5 pb-4">
              {summaryQ.isLoading ? (
                <CardRowsSkeleton />
              ) : summaryFailed ? (
                <CardLoadError onRetry={() => summaryQ.refetch()} />
              ) : employees.filter((e) => e.clockHours > 0).length === 0 ? (
                <EmptyState icon={<Clock />} title="No hours were clocked that week" />
              ) : (
                <ul className="divide-y divide-border">
                  {sortedEmployees
                    .filter((e) => e.clockHours > 0)
                    .slice(0, 6)
                    .map((e) => (
                      <li key={e.id} className="flex items-center gap-3 py-2.5">
                        <InitialsBadge name={e.fullName} />
                        <Link
                          href={`/employees/${e.id}`}
                          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline underline-offset-2"
                        >
                          {e.fullName}
                        </Link>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {fmtHoursLabel(e.clockHours)}
                        </span>
                        {isSaved(e) ? (
                          <span className="chip-good">Saved</span>
                        ) : (
                          <span className="chip-warn">Not saved</span>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="surface-card gap-0 py-0 flex flex-col">
          <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <CalendarDays />
              </span>
              Scheduled hours by day
            </CardTitle>
            <Button size="sm" variant="outline" className="h-9 sm:h-8" asChild>
              <Link href="/schedule-import">Schedule</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-4 sm:px-5 pb-4 flex-1 flex flex-col">
            {summaryQ.isLoading ? (
              <Skeleton className="min-h-44 flex-1 rounded-lg" />
            ) : summaryFailed ? (
              <CardLoadError onRetry={() => summaryQ.refetch()} />
            ) : !data?.hasDaySchedule ? (
              <EmptyState
                icon={<CalendarDays />}
                title={isLiveWeek ? "No schedule for this week" : "No schedule for that week"}
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/schedule-import">Import schedule</Link>
                  </Button>
                }
              />
            ) : (
              // Bars are sized in % of the space the card gives them, so the
              // chart fills its card whatever the neighbouring card's height.
              <div className="flex flex-1 min-h-44 items-stretch justify-between gap-1.5 sm:gap-2 pt-1">
                {dayStrip.map((d) => {
                  const isToday = toDateInput(d.day) === todayIso;
                  return (
                    <div
                      key={d.day.toISOString()}
                      className="flex flex-1 flex-col items-center gap-1.5"
                      title={`${shortDayLabel(d.day)}: ${fmtHoursLabel(d.totalHours)} across ${d.shiftCount} shift${d.shiftCount === 1 ? "" : "s"}`}
                    >
                      <div className="relative flex w-full flex-1 items-end justify-center pt-5">
                      <div
                        className="sk-bar relative w-full max-w-10 rounded-md"
                        style={{
                          height:
                            d.totalHours > 0
                              ? `max(6px, ${(d.totalHours / maxDayHours) * 100}%)`
                              : "2px",
                          background:
                            d.totalHours <= 0
                              ? "var(--border)"
                              : isToday
                                ? "var(--chart-1)"
                                : "color-mix(in oklab, var(--chart-1) 30%, var(--card))",
                        }}
                      >
                        {d.totalHours > 0 ? (
                          <span className="absolute -top-5 inset-x-0 text-center text-[11px] tabular-nums text-muted-foreground">
                            {fmtHours(d.totalHours, 0)}
                          </span>
                        ) : null}
                      </div>
                      </div>
                      <span
                        className={`text-[11px] ${isToday ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      >
                        {d.day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The week's ledger */}
      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <UserRound />
            </span>
            {isLiveWeek ? "This week by employee" : "Week by employee"}
          </CardTitle>
          <Button size="sm" variant="outline" className="h-9 sm:h-8" asChild>
            <Link href={`/payroll?week=${toDateInput(weekStart)}`}>
              {isLiveWeek ? "Open payroll" : "Enter hours"}
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {summaryQ.isLoading ? (
            <div className="space-y-2 px-5 py-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : summaryFailed ? (
            <CardLoadError onRetry={() => summaryQ.refetch()} />
          ) : employees.length === 0 ? (
            <EmptyState
              title="No employees yet"
              action={
                <Button size="sm" asChild>
                  <Link href="/employees?add=1">Add employee</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {(showAllLedger ? sortedEmployees : sortedEmployees.slice(0, LEDGER_PREVIEW)).map((emp) => {
                const onClockNow = clockedIn.some((c) => c.employeeId === emp.id);
                const pct =
                  emp.scheduledHours > 0
                    ? Math.min(1, emp.clockHours / emp.scheduledHours)
                    : 0;
                // One status, shown in its own column on desktop and under
                // the name on phones (never color-only).
                const status = onClockNow ? (
                  <span className="chip-good">
                    <Clock className="h-3 w-3" /> On the clock
                  </span>
                ) : emp.overClocked ? (
                  <span className="chip-warn">
                    <AlertTriangle className="h-3 w-3" />+
                    {fmtHoursLabel(emp.overClockedBy)} over
                  </span>
                ) : !isLiveWeek && emp.clockHours > 0.25 && !isSaved(emp) ? (
                  <span className="chip-warn">Not saved</span>
                ) : !isLiveWeek && isSaved(emp) ? (
                  <span className="chip-good">
                    <CheckCircle2 className="h-3 w-3" /> Saved
                  </span>
                ) : null;
                return (
                  <li key={emp.id}>
                    <Link
                      href={`/employees/${emp.id}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 sm:px-5 py-2.5 hover:bg-muted/50 transition-colors sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_6rem]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <InitialsBadge name={emp.fullName} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{emp.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="role-tag">{emp.role}</span>
                            {stores.length > 1
                              ? ` · ${STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}`
                              : ""}
                          </p>
                          {status ? <span className="mt-1 flex sm:hidden">{status}</span> : null}
                        </div>
                      </div>
                      <span className="text-right text-sm font-medium tabular-nums sm:order-last">
                        {isLiveWeek ? (
                          <Money value={emp.clockHours * emp.payRate} />
                        ) : emp.grossPay > 0 ? (
                          <Money value={emp.grossPay} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                        <div className="sk-track h-2 flex-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="sk-fill h-full rounded-full"
                            style={{
                              width: `${pct * 100}%`,
                              background: emp.overClocked ? "var(--warning)" : "var(--chart-1)",
                            }}
                          />
                        </div>
                        <span className="w-[6rem] text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                          {emp.scheduledHours > 0
                            ? `${fmtHours(emp.clockHours)} / ${fmtHoursLabel(emp.scheduledHours)}`
                            : fmtHoursLabel(emp.clockHours)}
                        </span>
                      </div>
                      <span className="hidden sm:flex justify-end">{status}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {sortedEmployees.length > LEDGER_PREVIEW ? (
            <div className="px-4 sm:px-5 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-9 text-muted-foreground"
                onClick={() => setShowAllLedger((v) => !v)}
              >
                {showAllLedger ? "Show fewer" : `Show all ${sortedEmployees.length}`}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Eight-week filmstrip — older payroll is one click away */}
      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <History />
            </span>
            Last 8 pay weeks
          </CardTitle>
          <span className="hidden sm:inline text-xs text-muted-foreground">
            Pick a week to open it
          </span>
        </CardHeader>
        <CardContent className="px-4 sm:px-5 pb-4">
          {trendQ.isLoading ? (
            <Skeleton className="h-24 rounded-md" />
          ) : trendQ.isError && !trendQ.data ? (
            <CardLoadError onRetry={() => trendQ.refetch()} />
          ) : (
            <WeekTrend
              weeks={(trendQ.data?.weeks ?? []) as any}
              selected={weekStart}
              onSelect={(w) => setWeekStart(w)}
            />
          )}
        </CardContent>
      </Card>

      <ClockOutDialog
        punch={clockOutFor}
        onOpenChange={(o) => !o && setClockOutFor(null)}
      />
      <FixTimeDialog
        punch={fixTimeFor}
        onOpenChange={(o) => !o && setFixTimeFor(null)}
      />
    </div>
  );
}

/** Placeholder rows while the week loads — never a premature empty state. */
function CardRowsSkeleton() {
  return (
    <div className="space-y-2 py-2" role="status" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** A card whose data failed: say so, and offer the retry. */
function CardLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
      <p className="text-sm font-semibold">Couldn&apos;t load this</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

/** A shortcut to one everyday task: brand icon, name, one line of what it does. */
function QuickAction({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="sk-key group flex items-center gap-3 rounded-xl px-3 py-3 transition-all"
    >
      <span className="icon-badge transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight sm:truncate">{label}</span>
        <span className="hidden sm:block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}
