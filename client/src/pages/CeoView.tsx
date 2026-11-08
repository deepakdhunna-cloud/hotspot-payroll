/**
 * Executive view — the whole company on one screen.
 *
 * Top: mode-aware pulse (live week = who's working and what labor costs
 * right now; closed week = what was saved and the withholding estimates).
 * Middle: one card per store — click a card to focus every number on that
 * store, click again to zoom back out. Eight-week filmstrip for history.
 * Tabs below hold the payroll detail, PIN management and the audit trail.
 * The open tab and the chosen week live in the URL (?tab=, ?week=), so a
 * refresh, Back or a shared link lands on the same view.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AttentionCenter } from "@/components/AttentionCenter";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InitialsBadge } from "@/components/InitialsBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { BlockState, TableStateRows } from "@/components/QueryStates";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { WeekTrend } from "@/components/WeekTrend";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/errors";
import {
  STORE_ABBR,
  fmtHours,
  fmtHoursLabel,
  fmtMoney,
  fmtWeekRange,
  storeColor,
} from "@/lib/format";
import {
  currentPayPeriodStart,
  fmtDateTime,
  fmtDayHeading,
  fmtTime,
  fromDateInput,
  inProgressPayWeekStart,
  startOfPayWeek,
  storeDayKey,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Globe,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Radio,
  RefreshCw,
  Satellite,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* ------------------------------ URL state ------------------------------ */

const TAB_KEYS = ["overview", "payroll", "pins", "activity", "portal"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function searchParams(): URLSearchParams {
  return new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search
  );
}

/** Rewrite one query parameter in place — no new history entry. */
function replaceSearchParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function initialTab(): TabKey {
  const t = searchParams().get("tab") ?? "";
  return (TAB_KEYS as readonly string[]).includes(t)
    ? (t as TabKey)
    : "overview";
}

function initialWeek(): Date {
  const live = inProgressPayWeekStart();
  const raw = searchParams().get("week");
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return live;
  const w = startOfPayWeek(fromDateInput(raw));
  return w.getTime() > live.getTime() ? live : w;
}

/* ------------------------------ helpers ------------------------------ */

type WeeklyRow = {
  id: number;
  fullName: string;
  role: string;
  storeLocation: string;
  payRate: number;
  hoursWorked: number;
  scheduledHours: number;
  clockHours: number;
  overClocked: boolean;
  grossPay: number;
  federal: number;
  state: number;
  netPay: number;
};

/** A week counts as saved for someone once hours OR set pay were saved. */
const isSaved = (r: WeeklyRow) => r.hoursWorked > 0 || r.grossPay > 0;
/** Worked (clocked a real shift) but nothing saved for them yet. */
const isUnsaved = (r: WeeklyRow) => !isSaved(r) && r.clockHours > 0.25;

const storeShort = (s: string) => STORE_ABBR[s] ?? s;

export default function CeoView() {
  usePageTitle("Executive");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const [weekStart, setWeekState] = useState<Date>(initialWeek);
  const { scope: storeFilter, setScope: setStoreFilter } = useStoreScope();

  const setTab = (next: string) => {
    const t = (TAB_KEYS as readonly string[]).includes(next)
      ? (next as TabKey)
      : "overview";
    setTabState(t);
    replaceSearchParam("tab", t === "overview" ? null : t);
  };
  const setWeekStart = (next: Date) => {
    setWeekState(next);
    const live = inProgressPayWeekStart();
    replaceSearchParam(
      "week",
      next.getTime() === live.getTime() ? null : toDateInput(next)
    );
  };

  // Always fetch every store — the store cards ARE the filter, so the
  // all-stores picture must stay on screen while one store is focused.
  const ceoQ = trpc.ceo.weekly.useQuery(
    { weekStart },
    { enabled: !!isAdmin, refetchInterval: 60_000 }
  );
  const trendQ = trpc.dashboard.trend.useQuery(
    {
      weeks: 8,
      store: storeFilter === "all" ? undefined : (storeFilter as any),
    },
    { enabled: !!isAdmin, refetchInterval: 5 * 60_000 }
  );

  const data = ceoQ.data;
  const byStore = (data?.byStore ?? {}) as Record<string, any>;
  const allRows = (data?.rows ?? []) as WeeklyRow[];
  const isLiveWeek = weekStart.getTime() === inProgressPayWeekStart().getTime();
  const loading = ceoQ.isPending && !ceoQ.isError;

  /* ------------- filter-aware aggregates (client-side, instant) ------------- */

  const rows = useMemo(
    () =>
      storeFilter === "all"
        ? allRows
        : allRows.filter(r => r.storeLocation === storeFilter),
    [allRows, storeFilter]
  );

  const perStore = useMemo(() => {
    const m = new Map<string, { liveLabor: number; unsaved: number }>();
    for (const r of allRows) {
      const cur = m.get(r.storeLocation) ?? { liveLabor: 0, unsaved: 0 };
      cur.liveLabor += r.clockHours * r.payRate;
      if (isUnsaved(r)) cur.unsaved += 1;
      m.set(r.storeLocation, cur);
    }
    return m;
  }, [allRows]);

  const agg = useMemo(() => {
    const keys =
      storeFilter === "all"
        ? Object.keys(byStore)
        : Object.keys(byStore).filter(k => k === storeFilter);
    const zero = {
      totalHours: 0,
      totalClockHours: 0,
      totalScheduled: 0,
      totalGross: 0,
      totalFederal: 0,
      totalState: 0,
      totalNet: 0,
      employeeCount: 0,
      clockedInCount: 0,
      overClockedCount: 0,
    };
    return keys.reduce((acc, k) => {
      const s = byStore[k];
      return {
        totalHours: acc.totalHours + s.totalHours,
        totalClockHours: acc.totalClockHours + s.totalClockHours,
        totalScheduled: acc.totalScheduled + s.totalScheduled,
        totalGross: acc.totalGross + s.totalGross,
        totalFederal: acc.totalFederal + s.totalFederal,
        totalState: acc.totalState + s.totalState,
        totalNet: acc.totalNet + s.totalNet,
        employeeCount: acc.employeeCount + s.employeeCount,
        clockedInCount: acc.clockedInCount + s.clockedInCount,
        overClockedCount: acc.overClockedCount + s.overClockedCount,
      };
    }, zero);
  }, [byStore, storeFilter]);

  const liveLabor = rows.reduce((s, r) => s + r.clockHours * r.payRate, 0);
  const savedCount = rows.filter(isSaved).length;
  const unsavedCount = rows.filter(isUnsaved).length;
  const payableCount = rows.filter(r => isSaved(r) || isUnsaved(r)).length;
  const storesWithClockedIn = Object.values(byStore).filter(
    (s: any) => s.clockedInCount > 0
  ).length;

  // Last closed week's saved payroll — the live week's point of comparison.
  const lastClosed = currentPayPeriodStart();
  const lastClosedTrend = (trendQ.data?.weeks ?? []).find(
    w => new Date(w.weekStart).getTime() === lastClosed.getTime()
  );

  const focusLabel =
    storeFilter === "all" ? "all stores" : storeShort(storeFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive"
        description={
          isLiveWeek
            ? `This week · ${focusLabel} · tap a store card to focus on it`
            : `Closed week · ${fmtWeekRange(weekStart)} · ${focusLabel}`
        }
        actions={<QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />}
      />

      {/* The assistant — same persistent task stack, all stores in scope */}
      <AttentionCenter />

      {/* Everything the CEO does here, one tap away at the top of the page */}
      <Tabs value={tab} onValueChange={setTab} className="gap-4 md:gap-5">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="w-max md:self-start">
            <TabsTrigger value="overview">
              <LayoutDashboard /> Overview
            </TabsTrigger>
            <TabsTrigger value="payroll">
              <Wallet /> Payroll
            </TabsTrigger>
            <TabsTrigger value="pins">
              <KeyRound /> Access &amp; PINs
            </TabsTrigger>
            <TabsTrigger value="activity">
              <History /> Activity
            </TabsTrigger>
            <TabsTrigger value="portal">
              <Radio /> Live portal
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5 md:space-y-6">
          {ceoQ.isError ? (
            <Card className="surface-card gap-0 py-0">
              <CardContent className="p-4 sm:p-5">
                <BlockState isError onRetry={() => ceoQ.refetch()}>
                  {null}
                </BlockState>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Company pulse — one strip, the money leads */}
              {loading ? (
                <Skeleton className="h-[124px] rounded-xl" />
              ) : (
                <KpiBand>
                  <KpiCell
                    hero
                    icon={<Wallet />}
                    label={isLiveWeek ? "Labor cost so far" : "Gross payroll"}
                    value={
                      <Money value={isLiveWeek ? liveLabor : agg.totalGross} />
                    }
                    sub={
                      isLiveWeek
                        ? `earned this week · ${focusLabel}`
                        : `saved for that week · ${focusLabel}`
                    }
                    footer={
                      !isLiveWeek && unsavedCount > 0 ? (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" />
                          {unsavedCount} worked, not saved
                        </span>
                      ) : !isLiveWeek && savedCount > 0 ? (
                        <span className="chip-good">
                          <CheckCircle2 className="h-3 w-3" /> Payroll complete
                        </span>
                      ) : null
                    }
                  />
                  <KpiCell
                    hue="blue"
                    icon={<Clock />}
                    label="Hours clocked"
                    value={fmtHours(agg.totalClockHours)}
                    sub={
                      agg.totalScheduled > 0
                        ? `of ${fmtHoursLabel(agg.totalScheduled)} scheduled`
                        : isLiveWeek
                          ? "no schedule this week"
                          : "no schedule for that week"
                    }
                    footer={
                      agg.overClockedCount > 0 ? (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" />
                          {agg.overClockedCount} over schedule
                        </span>
                      ) : agg.totalScheduled > 0 ? (
                        <span className="chip-good">
                          <CheckCircle2 className="h-3 w-3" /> Within schedule
                        </span>
                      ) : null
                    }
                  />
                  {isLiveWeek ? (
                    <KpiCell
                      hue="green"
                      icon={<Users />}
                      label="On the clock now"
                      value={agg.clockedInCount}
                      sub={
                        agg.clockedInCount === 0
                          ? "nobody is clocked in"
                          : storeFilter === "all"
                            ? `across ${storesWithClockedIn} store${storesWithClockedIn === 1 ? "" : "s"}`
                            : `at ${focusLabel}`
                      }
                    />
                  ) : (
                    <KpiCell
                      hue="teal"
                      icon={<CheckCircle2 />}
                      label="Saved to payroll"
                      value={
                        payableCount > 0
                          ? `${savedCount} of ${payableCount}`
                          : "—"
                      }
                      sub={
                        payableCount > 0
                          ? `people who worked · ${fmtHoursLabel(agg.totalHours)} saved`
                          : "nobody worked that week"
                      }
                    />
                  )}
                  {isLiveWeek ? (
                    <KpiCell
                      hue="teal"
                      icon={<History />}
                      label="Last week's payroll"
                      value={
                        lastClosedTrend && lastClosedTrend.savedGross > 0 ? (
                          <Money value={lastClosedTrend.savedGross} />
                        ) : (
                          "—"
                        )
                      }
                      sub={
                        trendQ.isPending
                          ? "loading…"
                          : lastClosedTrend && lastClosedTrend.savedGross > 0
                            ? `${fmtWeekRange(lastClosed)} · saved`
                            : `${fmtWeekRange(lastClosed)} · not saved yet`
                      }
                    />
                  ) : (
                    <KpiCell
                      hue="violet"
                      icon={<Landmark />}
                      label="Net pay (est.)"
                      value={<Money value={agg.totalNet} />}
                      sub={`≈ ${fmtMoney(agg.totalFederal + agg.totalState)} withheld (est.)`}
                    />
                  )}
                </KpiBand>
              )}

              {/* Every store at one glance — the cards are the filter */}
              <section
                className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
                aria-label="Stores"
              >
                {loading
                  ? [0, 1, 2, 3, 4].map(i => (
                      <Skeleton key={i} className="h-36 rounded-xl" />
                    ))
                  : Object.entries(byStore).map(([store, s]) => {
                      const focused = storeFilter === store;
                      const dimmed = storeFilter !== "all" && !focused;
                      const stat = perStore.get(store) ?? {
                        liveLabor: 0,
                        unsaved: 0,
                      };
                      const money = isLiveWeek ? stat.liveLabor : s.totalGross;
                      const hue = dimmed
                        ? `color-mix(in oklab, ${storeColor(store)} 28%, var(--border))`
                        : storeColor(store);
                      const toggle = () =>
                        setStoreFilter(focused ? "all" : store);
                      return (
                        <Card
                          key={store}
                          role="button"
                          tabIndex={0}
                          aria-pressed={focused}
                          aria-label={`${store}: ${fmtMoney(money)}, ${fmtHoursLabel(s.totalClockHours)} of ${fmtHoursLabel(s.totalScheduled)}. ${focused ? "Showing this store only — press to show all stores." : "Press to focus on this store."}`}
                          onClick={toggle}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggle();
                            }
                          }}
                          className={cn(
                            "surface-card gap-0 py-0 cursor-pointer transition-transform select-none overflow-hidden",
                            !focused && "hover:-translate-y-px"
                          )}
                          style={
                            { ["--hue" as string]: hue } as React.CSSProperties
                          }
                          title={
                            focused
                              ? "Tap to show all stores"
                              : `Tap to focus on ${store}`
                          }
                        >
                          <div
                            className="h-1 w-full"
                            style={{ background: "var(--hue)" }}
                            aria-hidden="true"
                          />
                          <CardContent className="p-4 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <span className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ background: "var(--hue)" }}
                                  aria-hidden="true"
                                />
                                {storeShort(store)}
                              </span>
                              {isLiveWeek && s.clockedInCount > 0 ? (
                                <span className="chip-good shrink-0">
                                  {s.clockedInCount} clocked in
                                </span>
                              ) : null}
                            </div>
                            <div>
                              <p className="text-xl font-semibold tabular-nums tracking-tight">
                                <Money value={money} />
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {fmtHoursLabel(s.totalClockHours)} of{" "}
                                {fmtHoursLabel(s.totalScheduled)}
                              </p>
                              <div className="sk-track mt-1.5 h-2 rounded-full bg-[color-mix(in_oklab,var(--hue)_14%,transparent)] overflow-hidden">
                                <div
                                  className="sk-fill h-full rounded-full"
                                  style={{
                                    width: `${s.totalScheduled > 0 ? Math.min(100, (s.totalClockHours / s.totalScheduled) * 100) : 0}%`,
                                    background: "var(--hue)",
                                  }}
                                />
                              </div>
                            </div>
                            {!isLiveWeek && stat.unsaved > 0 ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" />
                                {stat.unsaved} not saved
                              </span>
                            ) : s.overClockedCount > 0 ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" />
                                {s.overClockedCount} over schedule
                              </span>
                            ) : !isLiveWeek && s.totalGross > 0 ? (
                              <span className="chip-good">
                                <CheckCircle2 className="h-3 w-3" /> All saved
                              </span>
                            ) : (
                              <span className="chip-good">
                                <CheckCircle2 className="h-3 w-3" /> On track
                              </span>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
              </section>
            </>
          )}

          {/* Eight-week filmstrip — older payroll is one click away */}
          <Card className="surface-card gap-0 py-0">
            <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
              <CardTitle className="section-title">
                <span className="icon-badge icon-badge-sm">
                  <History />
                </span>
                Last 8 pay weeks
                {storeFilter !== "all" ? ` · ${focusLabel}` : ""}
              </CardTitle>
              <span className="hidden sm:inline text-xs text-muted-foreground">
                Tap a week to open it
              </span>
            </CardHeader>
            <CardContent className="px-4 sm:px-5 pt-4 pb-4">
              <BlockState
                isLoading={trendQ.isPending && !trendQ.isError}
                isError={trendQ.isError}
                onRetry={() => trendQ.refetch()}
                skeletonClassName="h-24 rounded-md"
              >
                <WeekTrend
                  weeks={(trendQ.data?.weeks ?? []) as any}
                  selected={weekStart}
                  onSelect={w => setWeekStart(w)}
                />
              </BlockState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll">
          <PayrollPanel
            rows={rows}
            isLiveWeek={isLiveWeek}
            weekStart={weekStart}
            showGroups={storeFilter === "all"}
            focusLabel={focusLabel}
            loading={loading}
            isError={ceoQ.isError}
            onRetry={() => ceoQ.refetch()}
          />
        </TabsContent>

        <TabsContent value="pins">
          <PinsPanel />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityPanel />
        </TabsContent>

        <TabsContent value="portal">
          <LivePortalPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ Payroll tab ------------------------------ */

/**
 * Per-person payroll for the chosen week, grouped by store with subtotals.
 * Live week: what each person has earned so far against their schedule.
 * Closed week: saved hours and pay with the withholding estimate — and the
 * people who worked but were never saved float to the top of their store.
 */
function PayrollPanel({
  rows,
  isLiveWeek,
  weekStart,
  showGroups,
  focusLabel,
  loading,
  isError,
  onRetry,
}: {
  rows: WeeklyRow[];
  isLiveWeek: boolean;
  weekStart: Date;
  showGroups: boolean;
  focusLabel: string;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const colSpan = isLiveWeek ? 5 : 7;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byStore = new Map<string, WeeklyRow[]>();
    for (const r of rows) {
      if (!byStore.has(r.storeLocation)) {
        byStore.set(r.storeLocation, []);
        order.push(r.storeLocation);
      }
      byStore.get(r.storeLocation)!.push(r);
    }
    const storeOrder = Object.keys(STORE_ABBR);
    const rank = (st: string) => {
      const i = storeOrder.indexOf(st);
      return i < 0 ? storeOrder.length : i;
    };
    order.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return order.map(store => {
      const list = [...byStore.get(store)!].sort((a, b) =>
        isLiveWeek
          ? b.clockHours - a.clockHours || a.fullName.localeCompare(b.fullName)
          : Number(isUnsaved(b)) - Number(isUnsaved(a)) ||
            Number(b.overClocked) - Number(a.overClocked) ||
            a.fullName.localeCompare(b.fullName)
      );
      return { store, list, totals: totalsOf(list) };
    });
  }, [rows, isLiveWeek]);

  const grand = useMemo(() => totalsOf(rows), [rows]);

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head px-4 sm:px-5 py-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <Wallet />
          </span>
          {isLiveWeek ? "This week by employee" : "Payroll by employee"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {fmtWeekRange(weekStart)} · {focusLabel}.
          </span>{" "}
          {isLiveWeek
            ? "Earned so far is clocked hours × each person's pay rate. Saved pay and tax estimates appear once the week closes and managers save it."
            : "Taxes are estimates on saved payroll: federal (income tax and FICA) about 18%, state about 5%."}
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                {isLiveWeek ? (
                  <>
                    <TableHead className="hidden sm:table-cell text-right">
                      Scheduled
                    </TableHead>
                    <TableHead className="text-right">Clocked</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">
                      Status
                    </TableHead>
                    <TableHead className="text-right">Earned so far</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="hidden sm:table-cell text-right">
                      Clocked
                    </TableHead>
                    <TableHead className="text-right">Saved hours</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Est. tax
                    </TableHead>
                    <TableHead className="hidden sm:table-cell text-right">
                      Est. net
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableStateRows
                colSpan={colSpan}
                skeletonRows={8}
                isLoading={loading}
                isError={isError}
                onRetry={onRetry}
                isEmpty={!loading && !isError && rows.length === 0}
                emptyTitle="No employees in this view"
                emptyHint="Pick another store or week."
              />
              {!loading && !isError
                ? groups.map(g => (
                    <React.Fragment key={g.store}>
                      {showGroups && groups.length > 1 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={colSpan}
                            className="bg-muted/40 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs">
                              <span className="flex items-center gap-2 font-semibold text-foreground">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ background: storeColor(g.store) }}
                                  aria-hidden="true"
                                />
                                {g.store}
                                <span className="font-normal text-muted-foreground">
                                  {g.list.length}{" "}
                                  {g.list.length === 1 ? "person" : "people"}
                                </span>
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {fmtHoursLabel(g.totals.clock)} clocked ·{" "}
                                <span className="font-semibold text-foreground">
                                  {fmtMoney(
                                    isLiveWeek
                                      ? g.totals.earned
                                      : g.totals.gross
                                  )}
                                </span>
                                {!isLiveWeek && g.totals.unsaved > 0
                                  ? ` · ${g.totals.unsaved} not saved`
                                  : ""}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {g.list.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <InitialsBadge name={r.fullName} size="sm" />
                              <div className="min-w-0">
                                <span className="font-medium">
                                  {r.fullName}
                                </span>
                                <div className="text-xs text-muted-foreground">
                                  {r.role}
                                  {showGroups
                                    ? null
                                    : ` · ${storeShort(r.storeLocation)}`}
                                </div>
                                {isLiveWeek && r.overClocked ? (
                                  <span className="chip-warn mt-1 sm:hidden">
                                    <AlertTriangle className="h-3 w-3" /> Over
                                    schedule
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          {isLiveWeek ? (
                            <>
                              <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
                                {r.scheduledHours > 0
                                  ? fmtHours(r.scheduledHours)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.clockHours > 0
                                  ? fmtHours(r.clockHours)
                                  : "—"}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-right">
                                <StatusChips row={r} isLiveWeek />
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                {r.clockHours > 0
                                  ? fmtMoney(r.clockHours * r.payRate)
                                  : "—"}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="hidden sm:table-cell text-right tabular-nums">
                                {r.clockHours > 0
                                  ? fmtHours(r.clockHours)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.hoursWorked > 0
                                  ? fmtHours(r.hoursWorked)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <StatusChips row={r} isLiveWeek={false} />
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                {r.grossPay > 0 ? fmtMoney(r.grossPay) : "—"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-right tabular-nums text-muted-foreground">
                                {r.grossPay > 0
                                  ? fmtMoney(r.federal + r.state)
                                  : "—"}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-right tabular-nums">
                                {r.grossPay > 0 ? fmtMoney(r.netPay) : "—"}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </React.Fragment>
                  ))
                : null}
            </TableBody>
            {!loading && !isError && rows.length > 0 ? (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="font-semibold">
                    Total · {rows.length}{" "}
                    {rows.length === 1 ? "person" : "people"}
                  </TableCell>
                  {isLiveWeek ? (
                    <>
                      <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
                        {fmtHours(grand.scheduled)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtHours(grand.clock)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell" />
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(grand.earned)}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="hidden sm:table-cell text-right tabular-nums">
                        {fmtHours(grand.clock)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtHours(grand.saved)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {grand.unsaved > 0 ? `${grand.unsaved} not saved` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(grand.gross)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right tabular-nums text-muted-foreground">
                        {fmtMoney(grand.tax)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right tabular-nums font-semibold">
                        {fmtMoney(grand.net)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function totalsOf(list: WeeklyRow[]) {
  return list.reduce(
    (t, r) => ({
      scheduled: t.scheduled + r.scheduledHours,
      clock: t.clock + r.clockHours,
      saved: t.saved + r.hoursWorked,
      earned: t.earned + r.clockHours * r.payRate,
      gross: t.gross + r.grossPay,
      tax: t.tax + r.federal + r.state,
      net: t.net + r.netPay,
      unsaved: t.unsaved + (isUnsaved(r) ? 1 : 0),
    }),
    {
      scheduled: 0,
      clock: 0,
      saved: 0,
      earned: 0,
      gross: 0,
      tax: 0,
      net: 0,
      unsaved: 0,
    }
  );
}

function StatusChips({
  row,
  isLiveWeek,
}: {
  row: WeeklyRow;
  isLiveWeek: boolean;
}) {
  const chips: React.ReactNode[] = [];
  if (!isLiveWeek && isUnsaved(row)) {
    chips.push(
      <span key="unsaved" className="chip-warn">
        <AlertTriangle className="h-3 w-3" /> Not saved
      </span>
    );
  }
  if (row.overClocked) {
    chips.push(
      <span key="over" className="chip-warn">
        <AlertTriangle className="h-3 w-3" /> Over schedule
      </span>
    );
  }
  if (isSaved(row)) {
    chips.push(
      <span key="saved" className="chip-good">
        <CheckCircle2 className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (chips.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">{chips}</span>
  );
}

/* ------------------------------ PINs tab ------------------------------ */

/** Plain-language name, reach and icon for each login. */
function pinMeta(scope: string, fallback: string) {
  if (scope === "ceo") {
    return {
      title: "CEO master PIN",
      short: "the CEO PIN",
      reach: "Every store, payroll, PINs and settings",
      icon: <ShieldCheck className="h-4 w-4" />,
    };
  }
  if (scope === "cfo") {
    return {
      title: "CFO PIN",
      short: "the CFO PIN",
      reach: "Read-only Finance page",
      icon: <Landmark className="h-4 w-4" />,
    };
  }
  if (STORE_ABBR[scope]) {
    return {
      title: `${scope} manager PIN`,
      short: `${storeShort(scope)}'s manager PIN`,
      reach: `Managers at ${scope} only`,
      icon: <Building2 className="h-4 w-4" />,
    };
  }
  return {
    title: fallback,
    short: fallback,
    reach: "",
    icon: <KeyRound className="h-4 w-4" />,
  };
}

function PinsPanel() {
  const pinsQ = trpc.ceo.listPins.useQuery();
  const utils = trpc.useUtils();
  const updatePin = trpc.ceo.updatePin.useMutation();
  const [openScope, setOpenScope] = useState<string | null>(null);

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head px-4 sm:px-5 py-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <KeyRound />
          </span>
          Access PINs
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Each login has its own PIN. Changing one signs out every device that
          used the old PIN, so do it when a device is lost or someone with the
          PIN leaves.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {pinsQ.isPending || pinsQ.isError ? (
          <div className="p-4 sm:p-5">
            <BlockState
              isLoading={pinsQ.isPending && !pinsQ.isError}
              isError={pinsQ.isError}
              onRetry={() => pinsQ.refetch()}
              skeletonClassName="h-56"
            >
              {null}
            </BlockState>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pinsQ.data.map(row => (
              <PinRow
                key={row.scope}
                scope={row.scope}
                label={row.label}
                isSet={row.isSet}
                updatedAt={row.updatedAt}
                open={openScope === row.scope}
                onOpenChange={o => setOpenScope(o ? row.scope : null)}
                saving={updatePin.isPending}
                onSave={(pin, done) =>
                  updatePin.mutate(
                    { scope: row.scope as any, pin },
                    {
                      onSuccess: () => {
                        utils.ceo.listPins.invalidate();
                        done(null);
                      },
                      onError: e => done(errorMessage(e)),
                    }
                  )
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PinRow({
  scope,
  label,
  isSet,
  updatedAt,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  scope: string;
  label: string;
  isSet: boolean;
  updatedAt: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `done(null)` on success, `done(message)` on failure. */
  onSave: (pin: string, done: (error: string | null) => void) => void;
  saving: boolean;
}) {
  const meta = pinMeta(scope, label);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Closing the form always forgets what was typed, and hands focus back to
  // this row's button (unless the person has already moved on elsewhere).
  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirm("");
      setShow(false);
      setError(null);
      const active = document.activeElement;
      if (
        wasOpen.current &&
        (!active ||
          active === document.body ||
          rowRef.current?.contains(active))
      ) {
        changeRef.current?.focus();
      }
    }
    wasOpen.current = open;
  }, [open]);

  const idBase = `pin-${scope.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const pinValid = /^\d{4,8}$/.test(pin);
  const matches = pin === confirm;
  const canSave = pinValid && matches && !saving;
  const hint =
    pin.length > 0 && !pinValid && confirm.length === 0
      ? "Use 4 to 8 digits."
      : confirm.length > 0 && confirm.length >= pin.length && !matches
        ? "The two PINs don't match."
        : null;
  const signOutLine =
    scope === "ceo"
      ? "This signs out every device using the CEO PIN, including this one. You'll sign in again with the new PIN."
      : `This signs out every device using ${meta.short} right away. Anyone who uses it must sign in again with the new PIN.`;

  const digitsOnly = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 8);

  return (
    <li ref={rowRef} className="px-4 sm:px-5 py-3.5">
      <div className="flex items-start gap-3 sm:items-center">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5">{meta.title}</p>
            <p className="text-xs text-muted-foreground">
              {meta.reach}
              {meta.reach ? " · " : ""}
              {isSet && updatedAt
                ? `changed ${fmtDateTime(updatedAt)}`
                : isSet
                  ? "set"
                  : "not set yet"}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-2 sm:mt-0 sm:shrink-0">
            {isSet ? (
              <span className="chip-good">Active</span>
            ) : (
              <span className="chip-warn">Not set</span>
            )}
            {open ? null : (
              <Button
                ref={changeRef}
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-8"
                aria-expanded={false}
                aria-controls={`${idBase}-form`}
                aria-label={`${isSet ? "Change" : "Set"} ${meta.title}`}
                onClick={() => onOpenChange(true)}
              >
                {isSet ? "Change PIN" : "Set PIN"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {open ? (
        <form
          id={`${idBase}-form`}
          className="mt-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4 space-y-3"
          onSubmit={e => e.preventDefault()}
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-new`}>New PIN</Label>
              <Input
                id={`${idBase}-new`}
                type={show ? "text" : "password"}
                inputMode="numeric"
                autoComplete="new-password"
                autoFocus
                maxLength={8}
                placeholder="4 to 8 digits"
                value={pin}
                aria-invalid={
                  pin.length > 0 && !pinValid && confirm.length > 0
                    ? true
                    : undefined
                }
                onChange={e => {
                  setPin(digitsOnly(e.target.value));
                  setError(null);
                }}
                className="h-10 bg-card tabular-nums tracking-widest"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-confirm`}>Type it again</Label>
              <Input
                id={`${idBase}-confirm`}
                type={show ? "text" : "password"}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                placeholder="Same PIN"
                value={confirm}
                aria-invalid={
                  hint === "The two PINs don't match." ? true : undefined
                }
                aria-describedby={`${idBase}-hint`}
                onChange={e => {
                  setConfirm(digitsOnly(e.target.value));
                  setError(null);
                }}
                className="h-10 bg-card tabular-nums tracking-widest"
              />
            </div>
          </div>

          <p
            id={`${idBase}-hint`}
            role={error ? "alert" : undefined}
            className={cn(
              "min-h-4 text-xs",
              error || hint ? "delta-bad font-medium" : "text-muted-foreground"
            )}
          >
            {error ?? hint ?? signOutLine}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 sm:h-8 text-muted-foreground"
              aria-pressed={show}
              onClick={() => setShow(s => !s)}
            >
              {show ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {show ? "Hide digits" : "Show digits"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 sm:h-8"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <ConfirmDialog
                disabled={!canSave}
                title={`Change ${meta.title}?`}
                description={signOutLine}
                confirmLabel="Change PIN"
                onConfirm={() =>
                  onSave(pin, err => {
                    if (err) {
                      setError(err);
                      return;
                    }
                    toast.success(
                      `${meta.title} changed. Devices using the old PIN were signed out.`
                    );
                    onOpenChange(false);
                  })
                }
                trigger={
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 sm:h-8"
                    disabled={!canSave}
                  >
                    {saving ? "Saving…" : "Save PIN"}
                  </Button>
                }
              />
            </div>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/* ------------------------------ Activity tab ------------------------------ */

const ACTION_LABELS: Record<string, string> = {
  "auth.pin_success": "Signed in",
  "auth.pin_failed": "Failed sign-in attempt",
  "employees.create": "Added employee",
  "employees.quickCreate": "Quick-added employee",
  "employees.update": "Edited employee",
  "employees.bulkUpdate": "Bulk-edited employees",
  "employees.setWeeklyPay": "Changed weekly set pay",
  "employees.deactivate": "Deactivated employee",
  "employees.reactivate": "Reactivated employee",
  "employees.delete": "Deleted employee (snapshot kept)",
  "payroll.saveHours": "Saved payroll",
  "payroll.saveSchedule": "Saved scheduled hours",
  "schedule.commit": "Committed a schedule",
  "schedule.deleteWeek": "Deleted a week's schedule",
  "schedule.moveWeek": "Moved a schedule to another week",
  "schedule.replaceClear": "Took people off a replaced schedule",
  "clock.setCode": "Set clock code",
  "clock.clearCode": "Removed clock code",
  "clock.createManual": "Added a punch by hand",
  "clock.updatePunch": "Edited a punch",
  "clock.deletePunch": "Deleted a punch",
  "clock.punch_failed": "Unrecognized kiosk code",
  "clock.autoClockOut": "Automatic clock-out",
  "clock.autoClockOutCorrected": "Corrected an automatic clock-out",
  "attention.resolve": "Signed off an alert",
  "settings.autoClockOut": "Changed automatic clock-out",
  "ceo.updatePin": "Changed a PIN",
  "portal.syncNow": "Pushed a snapshot to the portal",
  "export.full": "Downloaded the full data export",
};

const FIELD_WORDS: Record<string, string> = {
  fullName: "name",
  phone: "phone",
  payRate: "pay rate",
  role: "role",
  storeLocation: "store",
  weeklyPay: "weekly pay",
  active: "status",
  notes: "notes",
};

function actorName(scope: string, detail: Record<string, any> | null): string {
  if (scope === "ceo") return "CEO";
  if (scope === "cfo") return "CFO";
  if (scope === "kiosk") {
    const store = typeof detail?.store === "string" ? detail.store : null;
    return store ? `Time clock · ${storeShort(store)}` : "Time clock";
  }
  if (scope === "system") return "Automatic";
  if (scope === "anonymous") return "Unknown device";
  if (STORE_ABBR[scope]) return `${storeShort(scope)} manager`;
  return scope;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function parseDetail(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** One plain sentence for each logged action — never raw JSON. */
function summarize(
  e: {
    action: string;
    entityId: number | null;
    ip: string | null;
    detail: string | null;
  },
  d: Record<string, any> | null,
  nameOf: (id: unknown) => string
): string | null {
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const week = (v: unknown) => (v ? fmtWeekRange(new Date(v as string)) : "");
  const span = (inAt: unknown, outAt: unknown) =>
    inAt
      ? `${fmtDateTime(inAt as string)} – ${outAt ? fmtTime(outAt as string) : "still open"}`
      : "";
  const join = (...parts: (string | null | undefined | false)[]) =>
    parts.filter(Boolean).join(" · ");
  try {
    switch (e.action) {
      case "auth.pin_success":
        return null;
      case "auth.pin_failed":
        return e.ip ? `Wrong PIN from ${e.ip}` : "Wrong PIN";
      case "clock.punch_failed":
        return d?.store ? `At ${storeShort(d.store)}` : null;
      case "employees.create":
      case "employees.quickCreate":
      case "employees.deactivate":
      case "employees.reactivate":
        return join(d?.fullName, d?.store && storeShort(d.store));
      case "employees.update": {
        const who =
          d?.before?.fullName ?? (e.entityId ? nameOf(e.entityId) : "");
        const changed: string[] = Array.isArray(d?.changed)
          ? d!.changed.map((k: string) => FIELD_WORDS[k] ?? k)
          : [];
        return changed.length
          ? `${who}: ${listWords(changed)} changed`
          : who || null;
      }
      case "employees.setWeeklyPay": {
        const who = e.entityId ? nameOf(e.entityId) : "";
        const what = d?.weeklyPay
          ? `set pay ${fmtMoney(num(d.weeklyPay))} a week`
          : "weekly set pay removed";
        const weeks = d?.rewroteWeeks
          ? `${d.rewroteWeeks} saved week${d.rewroteWeeks === 1 ? "" : "s"} updated`
          : null;
        return join(who && `${who}: ${what}`, !who && what, weeks);
      }
      case "employees.bulkUpdate": {
        const n = num(d?.updated ?? d?.ids?.length ?? 0);
        const fields = Object.keys(d?.update ?? {}).map(
          k => FIELD_WORDS[k] ?? k
        );
        return join(
          `${n} employee${n === 1 ? "" : "s"}`,
          fields.length > 0 && `${listWords(fields)} changed`
        );
      }
      case "employees.delete": {
        const emp = d?.employee;
        const weeks = Array.isArray(d?.payrollHistory)
          ? d!.payrollHistory.length
          : 0;
        return join(
          emp?.fullName ?? (e.entityId ? nameOf(e.entityId) : "Employee"),
          emp?.storeLocation && storeShort(emp.storeLocation),
          `${weeks} payroll week${weeks === 1 ? "" : "s"} in the snapshot`,
          d?.bulk && "bulk delete"
        );
      }
      case "payroll.saveHours":
        return join(
          nameOf(d?.employeeId),
          d?.weekStart && week(d.weekStart),
          d?.fixedPay
            ? `set pay ${fmtMoney(num(d?.grossPay))}`
            : `${fmtHoursLabel(num(d?.hoursWorked))} · ${fmtMoney(num(d?.grossPay))}`,
          d?.profileRateUpdated &&
            `profile rate now ${fmtMoney(num(d?.payRate))}/h`
        );
      case "schedule.commit": {
        const saved = num(d?.saved ?? 0);
        return join(
          d?.weekStart && week(d.weekStart),
          `${saved} ${saved === 1 ? "person" : "people"}`,
          d?.replace && "replaced the old schedule",
          num(d?.cleared ?? 0) > 0 && `${d!.cleared} taken off`,
          Array.isArray(d?.skipped) &&
            d!.skipped.length > 0 &&
            `${d!.skipped.length} skipped`
        );
      }
      case "schedule.deleteWeek":
        return join(
          d?.weekStart && week(d.weekStart),
          d?.shiftCount !== undefined && `${d.shiftCount} shifts`,
          Array.isArray(d?.stores) && d!.stores.map(storeShort).join(", ")
        );
      case "schedule.moveWeek":
        return join(
          d?.shiftCount !== undefined && `${d.shiftCount} shifts`,
          d?.fromWeek && d?.toWeek && `${week(d.fromWeek)} → ${week(d.toWeek)}`
        );
      case "schedule.replaceClear": {
        const n = Array.isArray(d?.employeeIds) ? d!.employeeIds.length : 0;
        return join(
          d?.weekStart && week(d.weekStart),
          `${n} ${n === 1 ? "person" : "people"} taken off the schedule`
        );
      }
      case "clock.setCode":
      case "clock.clearCode":
        return d?.fullName ?? (e.entityId ? nameOf(e.entityId) : null);
      case "clock.createManual":
        return join(nameOf(d?.employeeId), span(d?.clockInAt, d?.clockOutAt));
      case "clock.updatePunch":
        return d?.before
          ? `Was ${span(d.before.clockInAt, d.before.clockOutAt)}`
          : null;
      case "clock.deletePunch": {
        const p = d?.deleted;
        return p
          ? join(nameOf(p.employeeId), span(p.clockInAt, p.clockOutAt))
          : null;
      }
      case "clock.autoClockOut":
        return join(
          nameOf(d?.employeeId),
          d?.limitHours && `closed after ${fmtHoursLabel(num(d.limitHours), 0)}`
        );
      case "clock.autoClockOutCorrected":
        return join(
          nameOf(d?.employeeId),
          d?.clockOutAt && `real clock-out ${fmtDateTime(d.clockOutAt)}`
        );
      case "attention.resolve": {
        const how =
          d?.resolution === "approved"
            ? "Approved"
            : d?.resolution === "dismissed"
              ? "Dismissed"
              : "Reviewed";
        return d?.title ? `${how}: ${d.title}` : how;
      }
      case "settings.autoClockOut":
        return d?.hours
          ? `After ${fmtHoursLabel(num(d.hours), 0)}`
          : "Turned off";
      case "ceo.updatePin":
        return d?.scope
          ? pinMeta(String(d.scope), String(d.scope)).title
          : null;
      case "portal.syncNow":
        return d?.ok ? "Delivered" : `Failed${d?.error ? `: ${d.error}` : ""}`;
      case "export.full":
        return d?.includeCredentials
          ? "Included PINs and clock codes"
          : "Without PINs or clock codes";
      default: {
        if (!d) return e.detail ? e.detail.slice(0, 140) : null;
        const simple = Object.entries(d)
          .filter(
            ([, v]) =>
              v === null || ["string", "number", "boolean"].includes(typeof v)
          )
          .slice(0, 3)
          .map(([k, v]) => `${FIELD_WORDS[k] ?? k}: ${String(v)}`);
        return simple.length ? simple.join(" · ") : null;
      }
    }
  } catch {
    return null;
  }
}

type ActivityFilter = "changes" | "signins" | "all";

/** Append-only audit trail: logins, deletions, PIN changes, payroll edits. */
function ActivityPanel() {
  const [limit, setLimit] = useState(200);
  const auditQ = trpc.ceo.auditLog.useQuery(
    { limit },
    { placeholderData: prev => prev }
  );
  // Names for entries that only carry an employee id.
  const peopleQ = trpc.employees.list.useQuery(
    { includeInactive: true },
    { staleTime: 5 * 60_000 }
  );
  const nameById = useMemo(
    () => new Map((peopleQ.data ?? []).map(p => [p.id, p.fullName])),
    [peopleQ.data]
  );
  const nameOf = (id: unknown) => {
    const n = typeof id === "number" ? id : Number(id);
    if (!Number.isFinite(n)) return "Employee";
    return nameById.get(n) ?? `Employee #${n}`;
  };

  const [filter, setFilter] = useState<ActivityFilter>("changes");
  const [openId, setOpenId] = useState<number | null>(null);

  const entries = auditQ.data ?? [];
  const isSignIn = (a: string) => a.startsWith("auth.");
  const counts = {
    changes: entries.filter(e => e.action !== "auth.pin_success").length,
    signins: entries.filter(e => isSignIn(e.action)).length,
    all: entries.length,
  };
  const visible = entries.filter(e =>
    filter === "all"
      ? true
      : filter === "signins"
        ? isSignIn(e.action)
        : e.action !== "auth.pin_success"
  );

  // Group by store-local day: "Today", "Yesterday", "Friday, Nov 6".
  const todayKey = storeDayKey(new Date());
  const yesterdayKey = storeDayKey(new Date(Date.now() - 86_400_000));
  const groups: { key: string; label: string; items: typeof visible }[] = [];
  for (const e of visible) {
    const key = storeDayKey(e.createdAt);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label =
        key === todayKey
          ? "Today"
          : key === yesterdayKey
            ? "Yesterday"
            : fmtDayHeading(e.createdAt);
      g = { key, label, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  const FILTERS: { key: ActivityFilter; label: string; short?: string }[] = [
    { key: "changes", label: "Changes & alerts", short: "Changes" },
    { key: "signins", label: "Sign-ins" },
    { key: "all", label: "Everything" },
  ];

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head flex flex-col gap-3 px-4 sm:px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <History />
            </span>
            Activity log
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Every sensitive action is recorded, with a snapshot of anything
            deleted. Open a row for the full record.
          </p>
        </div>
        <div
          role="group"
          aria-label="Show"
          className="sk-track flex w-full shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5 sm:inline-flex sm:w-auto"
        >
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-9 sm:h-8 flex-1 sm:flex-none rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                filter === f.key
                  ? "sk-seg-on bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.short ? (
                <>
                  <span className="sm:hidden">{f.short}</span>
                  <span className="hidden sm:inline">{f.label}</span>
                </>
              ) : (
                f.label
              )}
              {auditQ.data ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {counts[f.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {auditQ.isPending || auditQ.isError || visible.length === 0 ? (
          <div className="p-4 sm:p-5">
            <BlockState
              isLoading={auditQ.isPending && !auditQ.isError}
              isError={auditQ.isError}
              onRetry={() => auditQ.refetch()}
              isEmpty={visible.length === 0}
              emptyTitle={
                filter === "changes"
                  ? "No changes or alerts in this stretch"
                  : filter === "signins"
                    ? "No sign-ins in this stretch"
                    : "No recorded activity yet"
              }
              emptyHint={
                entries.length > 0 && filter !== "all"
                  ? "Switch to Everything to see the rest."
                  : undefined
              }
              skeletonClassName="h-64"
            >
              {null}
            </BlockState>
          </div>
        ) : (
          <div>
            {groups.map(g => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky top-0 z-[1] border-y border-border bg-muted/60 px-4 sm:px-5 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur first:border-t-0">
                  {g.label}
                </h3>
                <ul className="divide-y divide-border">
                  {g.items.map(e => {
                    const d = parseDetail(e.detail);
                    const summary = summarize(e, d, nameOf);
                    const label = ACTION_LABELS[e.action] ?? e.action;
                    const failed = e.action.includes("failed");
                    const open = openId === e.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : e.id)}
                          className="group relative flex w-full flex-col gap-0.5 px-4 py-2.5 pr-11 text-left transition-colors hover:bg-muted/40 sm:grid sm:grid-cols-[4.75rem_9.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-4 sm:px-5 sm:pr-12"
                        >
                          <span className="flex items-baseline gap-2 sm:contents">
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {fmtTime(e.createdAt)}
                            </span>
                            <span className="truncate text-sm font-medium">
                              {actorName(e.actorScope, d)}
                            </span>
                          </span>
                          <span className="min-w-0 text-sm">
                            {failed ? (
                              <span className="chip-warn mr-1.5 align-middle">
                                <AlertTriangle className="h-3 w-3" />
                                {label}
                              </span>
                            ) : (
                              <span className="mr-1.5">{label}</span>
                            )}
                            {summary ? (
                              <span className="text-muted-foreground break-words">
                                {failed ? "" : "· "}
                                {summary}
                              </span>
                            ) : null}
                          </span>
                          <ChevronDown
                            className="absolute right-4 top-3 h-4 w-4 text-muted-foreground transition-transform group-aria-expanded:rotate-180 sm:right-5"
                            aria-hidden="true"
                          />
                        </button>
                        {open ? (
                          <div className="space-y-2 bg-muted/25 px-4 pb-3 pt-1 sm:px-5 sm:pl-[calc(1.25rem+4.75rem+1rem)]">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                              <dt className="text-muted-foreground">When</dt>
                              <dd className="tabular-nums">
                                {fmtDateTime(e.createdAt)}
                              </dd>
                              <dt className="text-muted-foreground">Action</dt>
                              <dd className="font-mono">{e.action}</dd>
                              {e.entityType ? (
                                <>
                                  <dt className="text-muted-foreground">
                                    Record
                                  </dt>
                                  <dd className="font-mono">
                                    {e.entityType}
                                    {e.entityId ? ` #${e.entityId}` : ""}
                                  </dd>
                                </>
                              ) : null}
                              {e.ip ? (
                                <>
                                  <dt className="text-muted-foreground">
                                    From
                                  </dt>
                                  <dd className="font-mono">{e.ip}</dd>
                                </>
                              ) : null}
                            </dl>
                            {e.detail ? (
                              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-card p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                                {d ? JSON.stringify(d, null, 2) : e.detail}
                              </pre>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                No extra detail recorded.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {entries.length >= limit && limit < 500 ? (
              <div className="border-t border-border p-3 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={auditQ.isFetching}
                  onClick={() => setLimit(l => Math.min(500, l + 150))}
                >
                  {auditQ.isFetching ? "Loading…" : "Show older activity"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Live portal tab ------------------------------ */

/** One labelled fact in the relay status grid. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** A numbered step in the move-to-portal guide. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <span
        className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="space-y-2">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </section>
  );
}

/**
 * Live portal relay — shows whether this site is actually delivering its
 * data to the portal, why not when it isn't, and a button to push right
 * now. The site is the system of record; the portal only receives.
 */
function LivePortalPanel() {
  const statusQ = trpc.portal.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const linkQ = trpc.portal.portalLink.useQuery();
  const utils = trpc.useUtils();
  const syncNow = trpc.portal.syncNow.useMutation({
    onSuccess: r => {
      if (r.ok) {
        toast.success(`Snapshot delivered to the portal (${r.durationMs} ms)`);
      } else {
        toast.error(r.error ?? "The push failed. Check the relay settings.");
      }
      utils.portal.status.invalidate();
    },
    onError: e => toast.error(errorMessage(e)),
  });

  const s = statusQ.data;

  const sinceLabel = (iso?: string) => {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "moments ago";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
    return `${Math.floor(ms / 86_400_000)} d ago`;
  };

  const relayChip = !s ? null : !s.configured ? (
    <span className="chip-warn">
      <AlertTriangle className="h-3 w-3" /> Off — nothing is being sent
    </span>
  ) : s.lastError ? (
    <span className="chip-bad">
      <AlertTriangle className="h-3 w-3" /> Failing ({s.consecutiveFailures} in
      a row)
    </span>
  ) : s.lastSuccessAt ? (
    <span className="chip-good">
      <CheckCircle2 className="h-3 w-3" /> Delivering
    </span>
  ) : (
    <span className="chip-neutral">Waiting for the first push</span>
  );

  return (
    <div className="space-y-4">
      <MoveToPortalCard />
      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-col gap-3 px-4 sm:px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <Satellite />
              </span>
              Live relay to the portal
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              This website is the system of record. When the relay is on, it
              pushes the full snapshot (employees, payroll, punches, schedules)
              to the portal seconds after every change, plus on a fixed cadence
              as a safety net.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {relayChip}
            <Button
              size="sm"
              variant="outline"
              className="h-9 sm:h-8"
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending || !s?.configured}
              title={!s?.configured ? "Turn the relay on first" : undefined}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  syncNow.isPending && "animate-spin"
                )}
              />
              {syncNow.isPending ? "Pushing…" : "Sync now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-5 py-4 text-sm">
          {statusQ.isPending || statusQ.isError || !s ? (
            <BlockState
              isLoading={statusQ.isPending && !statusQ.isError}
              isError={statusQ.isError || (!statusQ.isPending && !s)}
              onRetry={() => statusQ.refetch()}
              skeletonClassName="h-24"
            >
              {null}
            </BlockState>
          ) : !s.configured ? (
            <div className="rounded-xl border border-dashed border-border p-4 space-y-2">
              {s.configError ? (
                <p className="font-medium delta-bad">{s.configError}</p>
              ) : (
                <p className="font-medium">The relay is not configured.</p>
              )}
              <p className="text-muted-foreground">
                Set{" "}
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  PORTAL_SYNC_URL
                </code>{" "}
                (the portal&apos;s ingest address) and{" "}
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  PORTAL_SYNC_TOKEN
                </code>{" "}
                (shared secret) in this site&apos;s hosting environment, then
                restart it. Until then the portal receives nothing from this
                site.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {s.lastError && (
                <div className="rounded-xl border border-[color-mix(in_oklab,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_5%,var(--card))] p-3">
                  <p className="font-medium flex items-center gap-1.5 delta-bad">
                    <AlertTriangle className="h-4 w-4" />
                    Last push failed
                  </p>
                  <p className="text-muted-foreground mt-1 break-words">
                    {s.lastError}
                  </p>
                </div>
              )}
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Destination">
                  <span className="font-mono text-xs break-all">
                    {s.target}
                  </span>
                </Field>
                <Field label="Cadence">
                  Every {s.intervalSeconds} s, plus right after each change
                </Field>
                <Field label="Authentication">
                  {s.hasToken ? "Bearer token set" : "No token (open endpoint)"}
                </Field>
                <Field label="Last delivered">
                  {s.lastSuccessAt ? (
                    <>
                      {sinceLabel(s.lastSuccessAt)}
                      <span className="text-xs text-muted-foreground ml-1.5">
                        ({fmtDateTime(new Date(s.lastSuccessAt))})
                      </span>
                    </>
                  ) : (
                    "Never since this server started"
                  )}
                </Field>
                <Field label="Last attempt">
                  {sinceLabel(s.lastAttemptAt)}
                  {typeof s.lastDurationMs === "number" && s.lastAttemptAt && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      ({s.lastDurationMs} ms)
                    </span>
                  )}
                </Field>
                <Field label="Records in the last delivery">
                  {s.lastCounts
                    ? `${s.lastCounts.employees} employees · ${s.lastCounts.payrollEntries} payroll · ${s.lastCounts.timePunches} punches · ${s.lastCounts.scheduleShifts} shifts`
                    : "—"}
                </Field>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-col gap-3 px-4 sm:px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <Globe />
              </span>
              The portal page, hosted right here
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              A standalone, read-only live dashboard at{" "}
              <code className="font-mono">/portal</code>: who&apos;s on the
              clock, week hours and labor per store, refreshed every 30 seconds.
              The link carries its own access key, so anyone you send it to can
              watch and do nothing more. No pay rates or personal details appear
              on it.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 sm:h-8 shrink-0"
            disabled={!linkQ.data?.configured}
            title={
              !linkQ.data?.configured
                ? "Set PORTAL_FEED_TOKEN first"
                : undefined
            }
            onClick={() => {
              if (linkQ.data?.url)
                window.open(linkQ.data.url, "_blank", "noopener,noreferrer");
            }}
          >
            <Satellite className="h-3.5 w-3.5" /> Open portal
          </Button>
        </CardHeader>
        <CardContent className="px-4 sm:px-5 py-4 text-sm space-y-3">
          {s?.pullFeedTokenSet ? (
            <span className="chip-good">
              <CheckCircle2 className="h-3 w-3" /> On — the portal page and pull
              feed are unlocked
            </span>
          ) : (
            <div className="space-y-1.5">
              <span className="chip-neutral">Off</span>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">PORTAL_FEED_TOKEN</code> is not set
                in this site&apos;s environment, so the portal page and the pull
                feed at <code className="font-mono">/api/portal-feed</code> are
                refused until it is.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Integrations can also pull the full raw snapshot from{" "}
            <code className="font-mono">/api/portal-feed</code> with{" "}
            <code className="font-mono">Authorization: Bearer</code> and the
            same token.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Everything needed to move the site into the CEO's own portal: the full
 * history as files, the live feed for whatever comes after, and the code.
 */
function MoveToPortalCard() {
  const [withCredentials, setWithCredentials] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const accessQ = trpc.portal.feedAccess.useQuery(undefined, {
    enabled: revealed,
  });
  const token = accessQ.data?.token ?? null;
  const feedUrl = `${window.location.origin}/api/portal-feed`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy. Select it and copy it by hand.");
    }
  };

  const downloadEverything = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/export/full${withCredentials ? "?credentials=1" : ""}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `The server answered ${res.status}.`);
      }
      const name =
        /filename="([^"]+)"/.exec(
          res.headers.get("Content-Disposition") ?? ""
        )?.[1] ?? "hotspot-payroll-export.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(
        "Downloaded. It holds personal data, so keep it somewhere private."
      );
    } catch (e) {
      toast.error(`Export failed. ${errorMessage(e)}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head px-4 sm:px-5 py-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <Database />
          </span>
          Move everything to your own portal
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Three pieces: every record from day one, a live connection for
          everything entered after that, and the website itself.
        </p>
      </CardHeader>
      <CardContent className="px-4 sm:px-5 py-4 space-y-5 text-sm">
        <Step n={1} title="All history: download everything">
          <p className="text-xs text-muted-foreground">
            One .zip with every employee, punch, payroll week, schedule, alert
            and activity-log entry, as JSON, spreadsheet (CSV) and MySQL files,
            plus a step-by-step guide. Each download is recorded in the activity
            log.
          </p>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={withCredentials}
              onCheckedChange={v => setWithCredentials(v === true)}
              className="mt-0.5"
            />
            <span>
              Include sign-in PINs and employee clock codes. Only needed if your
              portal will run sign-in and the time clock itself.{" "}
              <span className="font-medium delta-bad">
                The clock-code data can be turned back into each employee&apos;s
                code, so treat the file like a list of codes.
              </span>
            </span>
          </label>
          <Button
            size="sm"
            className="h-9 sm:h-8"
            onClick={downloadEverything}
            disabled={downloading}
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Preparing…" : "Download everything (.zip)"}
          </Button>
        </Step>

        <Step n={2} title="New data, live: connect your portal">
          <p className="text-xs text-muted-foreground">
            Your portal asks this address for data and sends the key in an{" "}
            <code className="font-mono">Authorization: Bearer</code> header.
            Every answer is the complete, current data: everything in the
            download plus whatever was entered since. Checking every 1–5 minutes
            keeps the portal live.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded-md break-all">
              {feedUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-9 sm:h-8"
              onClick={() => copy(feedUrl, "Feed address")}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded-md break-all">
              {!revealed
                ? "••••••••••••••••"
                : accessQ.isPending
                  ? "loading…"
                  : (token ?? "Not set. Add PORTAL_FEED_TOKEN on Railway.")}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-9 sm:h-8"
              aria-pressed={revealed}
              onClick={() => setRevealed(r => !r)}
            >
              {revealed ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {revealed ? "Hide key" : "Show key"}
            </Button>
            {revealed && token && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 sm:h-8"
                onClick={() => copy(token, "Access key")}
              >
                <Copy className="h-3.5 w-3.5" /> Copy key
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Would you rather this site send the data to your portal? Set{" "}
            <code className="font-mono">PORTAL_SYNC_URL</code> on Railway. The
            relay card below shows whether it&apos;s delivering.
          </p>
        </Step>

        <Step n={3} title="The website itself">
          <p className="text-xs text-muted-foreground">
            The code lives in GitHub at{" "}
            <code className="font-mono">
              deepakdhunna-cloud/hotspot-payroll
            </code>
            . The guide in the download explains running it inside your portal
            and copying the whole database across in one step.
          </p>
        </Step>
      </CardContent>
    </Card>
  );
}
