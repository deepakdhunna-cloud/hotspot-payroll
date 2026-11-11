/**
 * The command center — the heart of the CEO's portal (admin only).
 *
 * Each section has its own address and its own entry in the portal's
 * navigation (lib/portal); this page renders the ones that share the live
 * data and the single focus (tap a store anywhere and every section narrows
 * to it):
 *
 *   /ceo            COMMAND   the company at the center, every store in orbit,
 *                             vital signs, who is on the clock, what needs
 *                             attention, the system log.
 *   /ceo/payroll    PAYROLL   Autopilot (pages/ceo/Autopilot) and the
 *                             saved-payroll ledger under it.
 *   /ceo/stores     STORES    every store side by side (ceo/StoresBoard).
 *   /ceo/insights   INSIGHTS  findings from the site's own figures (ceo/Insights).
 *   /ceo/control    CONTROL   rules, stores, roles, PINs, data (ceo/ControlRoom).
 *   /ceo/log        LOG       the full activity log.
 *
 * People and Finance are their own pages (ceo/PeoplePage, ceo/FinancePage).
 * The chosen weeks live in the address (?week= on Command, ?pay= on
 * Payroll), so a refresh or a shared link lands on the same view. Addresses
 * from before the sections had their own (?tab=) are sent on. The look is
 * one CSS scope, `.cc` in index.css.
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
  BUSINESS_TIME_ZONE,
  currentPayPeriodStart,
  fmtDateTime,
  fmtDayHeading,
  fmtDuration,
  fmtTime,
  fromDateInput,
  inProgressPayWeekStart,
  payWeekElapsed,
  startOfPayWeek,
  storeDayKey,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  ArrowUpRight,
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
  Radar,
  Radio,
  RefreshCw,
  Rocket,
  Satellite,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";
import {
  DESK_HOME,
  ceoPath,
  ceoSectionFromLegacyTab,
  ceoSectionFromSlug,
  type CeoSectionKey,
} from "@/lib/portal";
import { Autopilot } from "./ceo/Autopilot";
import { ControlRoom } from "./ceo/ControlRoom";
import { Insights } from "./ceo/Insights";
import { StoresBoard, type StoreCard } from "./ceo/StoresBoard";
import { OrbitCore, type OrbitStore } from "./ceo/OrbitCore";
import { CountMoney, CountNumber, HudPanel, Led, LiveClock, Readout } from "./ceo/hud";

/* ------------------------------ URL state ------------------------------ */

type TabKey = CeoSectionKey;

const SECTION_TITLE: Partial<Record<TabKey, string>> = {
  overview: "Command center",
  payroll: "Payroll",
  stores: "Stores",
  optimize: "Insights",
  control: "Control",
  activity: "Activity log",
};

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

function initialWeek(): Date {
  const live = inProgressPayWeekStart();
  const raw = searchParams().get("week");
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return live;
  const w = startOfPayWeek(fromDateInput(raw));
  return w.getTime() > live.getTime() ? live : w;
}

/**
 * The week Autopilot is working on (?pay=). With nothing in the address it
 * is the last closed week — the one to be paid; an address that names a
 * past week for the Live view (?week=) opens Autopilot on that week too.
 */
function initialPayWeek(): Date {
  const live = inProgressPayWeekStart();
  const raw = searchParams().get("pay");
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const w = startOfPayWeek(fromDateInput(raw));
    return w.getTime() > live.getTime() ? live : w;
  }
  const linked = initialWeek();
  return linked.getTime() === live.getTime() ? currentPayPeriodStart() : linked;
}

/* ------------------------------ helpers ------------------------------ */

type WeeklyRow = {
  id: number;
  fullName: string;
  role: string;
  storeLocation: string;
  payRate: number;
  /** Standing weekly set pay, or null for someone paid by the hour. */
  weeklyPay: number | null;
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

const onSetPay = (r: WeeklyRow) => r.weeklyPay != null && r.weeklyPay > 0;
/**
 * What someone has cost so far in a week that is still running.
 *
 *  - Paid by the hour: clocked hours at their rate.
 *  - On set pay: their weekly amount, for the share of the week gone by.
 *    Their hours don't change what they are paid, so pricing those hours at
 *    an hourly rate would be a number payroll never matches.
 *
 * At the week's end this adds up to exactly what payroll will be — the same
 * rule the projection uses, so the two figures meet.
 */
const laborSoFar = (r: WeeklyRow, elapsed: number) =>
  // Hours to two decimals and dollars to the cent — the rounding payroll
  // itself is saved with, so a live figure and the saved one never drift.
  cents(onSetPay(r) ? r.weeklyPay! * elapsed : Number(r.clockHours.toFixed(2)) * r.payRate);
const cents = (n: number) => Math.round(n * 100) / 100;

export default function CeoView() {
  usePageTitle("Command center");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // The section comes from the address (/ceo, /ceo/payroll, …).
  const [, routeParams] = useRoute("/ceo/:section");
  const [, navigate] = useLocation();
  const slug = (routeParams as { section?: string } | null)?.section;
  const tab: TabKey = ceoSectionFromSlug(slug) ?? "overview";
  useEffect(() => {
    // An address that names no section opens Command; one from before the
    // sections had addresses (?tab=payroll) is sent to the section it meant.
    const legacy = ceoSectionFromLegacyTab(searchParams().get("tab"));
    if (legacy) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      navigate(`${ceoPath(legacy)}${url.search}`, { replace: true });
    } else if (slug && ceoSectionFromSlug(slug) === null) {
      navigate("/ceo", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  // The Live view follows the week in progress; Autopilot works on the week
  // to be paid (the last closed one) unless another is picked.
  const [weekStart, setWeekState] = useState<Date>(initialWeek);
  const [payWeek, setPayWeekState] = useState<Date>(initialPayWeek);
  const { scope: storeFilter, setScope: setStoreFilter } = useStoreScope();

  const setTab = (next: TabKey) => {
    navigate(ceoPath(next));
    window.scrollTo({ top: 0 });
  };
  const setWeekStart = setWeekState;
  const setPayWeek = setPayWeekState;
  // The chosen weeks are kept in the address of the section they belong to
  // (Command's ?week=, Payroll's ?pay=), so a refresh or a shared link opens
  // the same week — and moving between sections never leaves a stale one.
  useEffect(() => {
    const live = inProgressPayWeekStart();
    replaceSearchParam(
      "week",
      tab === "overview" && weekStart.getTime() !== live.getTime()
        ? toDateInput(weekStart)
        : null
    );
    replaceSearchParam(
      "pay",
      tab === "payroll" && payWeek.getTime() !== currentPayPeriodStart().getTime()
        ? toDateInput(payWeek)
        : null
    );
  }, [tab, weekStart, payWeek]);

  // Always fetch every store — the orbit IS the filter, so the all-stores
  // picture must stay on screen while one store is focused.
  const ceoQ = trpc.ceo.weekly.useQuery(
    { weekStart },
    { enabled: !!isAdmin, refetchInterval: 60_000 }
  );
  const storeArg = storeFilter === "all" ? undefined : (storeFilter as any);
  const summaryQ = trpc.dashboard.summary.useQuery(
    { weekStart, store: storeArg },
    { enabled: !!isAdmin, refetchInterval: 60_000 }
  );
  const trendQ = trpc.dashboard.trend.useQuery(
    { weeks: 8, store: storeArg },
    { enabled: !!isAdmin, refetchInterval: 5 * 60_000 }
  );
  const attentionQ = trpc.attention.list.useQuery(undefined, {
    enabled: !!isAdmin,
    refetchInterval: 60_000,
  });
  const cfoQ = trpc.cfo.summary.useQuery(
    { weeks: 5 },
    { enabled: !!isAdmin, refetchInterval: 5 * 60_000 }
  );
  // Stores: this week live, and the last closed week as saved.
  const liveWeekStart = useMemo(() => inProgressPayWeekStart(), []);
  const lastClosedStart = useMemo(() => currentPayPeriodStart(), []);
  const storesLiveQ = trpc.ceo.weekly.useQuery(
    { weekStart: liveWeekStart },
    { enabled: !!isAdmin && tab === "stores", refetchInterval: 60_000 }
  );
  const lastWeekQ = trpc.ceo.weekly.useQuery(
    { weekStart: lastClosedStart },
    { enabled: !!isAdmin && tab === "stores", refetchInterval: 60_000 }
  );
  // The saved-payroll ledger under Autopilot, for the week being paid.
  const ledgerQ = trpc.ceo.weekly.useQuery(
    { weekStart: payWeek },
    { enabled: !!isAdmin && tab === "payroll", refetchInterval: 60_000 }
  );

  // The Autopilot tab's "so far" figures and the ledger under them come from
  // the same rows at the same instant, so they are the same numbers.
  const ledgerIsLive = payWeek.getTime() === inProgressPayWeekStart().getTime();
  const ledgerRows = useMemo(
    () =>
      ((ledgerQ.data?.rows ?? []) as WeeklyRow[]).filter(
        r => storeFilter === "all" || r.storeLocation === storeFilter
      ),
    [ledgerQ.data, storeFilter]
  );
  const ledgerElapsed = useMemo(
    () => payWeekElapsed(payWeek),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payWeek, ledgerQ.dataUpdatedAt]
  );
  const ledgerSoFar = useMemo(() => {
    if (!ledgerIsLive || !ledgerQ.data) return null;
    const perStore = new Map<string, number>();
    let total = 0;
    for (const r of ledgerRows) {
      const v = laborSoFar(r, ledgerElapsed);
      total += v;
      perStore.set(r.storeLocation, (perStore.get(r.storeLocation) ?? 0) + v);
    }
    return { total, byStore: perStore };
  }, [ledgerIsLive, ledgerQ.data, ledgerRows, ledgerElapsed]);

  const data = ceoQ.data;
  const byStore = (data?.byStore ?? {}) as Record<string, any>;
  const allRows = (data?.rows ?? []) as WeeklyRow[];
  const isLiveWeek = weekStart.getTime() === inProgressPayWeekStart().getTime();
  const loading = ceoQ.isPending && !ceoQ.isError;

  /* ------------- focus-aware aggregates (client-side, instant) ------------- */

  const rows = useMemo(
    () =>
      storeFilter === "all"
        ? allRows
        : allRows.filter(r => r.storeLocation === storeFilter),
    [allRows, storeFilter]
  );
  // How much of the pay week has gone by (store time): the core's dial, and
  // how far set pay has accrued. Refreshed with every data refresh.
  const elapsed = useMemo(
    () => (isLiveWeek ? payWeekElapsed(weekStart) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLiveWeek, weekStart, ceoQ.dataUpdatedAt]
  );
  const perStoreLabor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) {
      m.set(r.storeLocation, (m.get(r.storeLocation) ?? 0) + laborSoFar(r, elapsed ?? 1));
    }
    return m;
  }, [allRows, elapsed]);
  const headcountByStore = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) m.set(r.storeLocation, (m.get(r.storeLocation) ?? 0) + 1);
    return m;
  }, [allRows]);
  const alertsByStore = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of attentionQ.data?.items ?? []) {
      if (i.storeLocation) m.set(i.storeLocation, (m.get(i.storeLocation) ?? 0) + 1);
    }
    return m;
  }, [attentionQ.data]);

  const focusKeys =
    storeFilter === "all"
      ? Object.keys(byStore)
      : Object.keys(byStore).filter(k => k === storeFilter);
  const agg = focusKeys.reduce(
    (acc, k) => {
      const s = byStore[k];
      return {
        totalClockHours: acc.totalClockHours + s.totalClockHours,
        totalScheduled: acc.totalScheduled + s.totalScheduled,
        totalGross: acc.totalGross + s.totalGross,
        clockedInCount: acc.clockedInCount + s.clockedInCount,
        overClockedCount: acc.overClockedCount + s.overClockedCount,
      };
    },
    { totalClockHours: 0, totalScheduled: 0, totalGross: 0, clockedInCount: 0, overClockedCount: 0 }
  );
  const liveLabor = rows.reduce((t, r) => t + laborSoFar(r, elapsed ?? 1), 0);
  const storesWithClockedIn = Object.values(byStore).filter(
    (s: any) => s.clockedInCount > 0
  ).length;

  const lastClosed = currentPayPeriodStart();
  const lastClosedTrend = (trendQ.data?.weeks ?? []).find(
    w => new Date(w.weekStart).getTime() === lastClosed.getTime()
  );
  const totals = summaryQ.data?.totals;
  const overPlan =
    totals && totals.totalScheduledCost > 0
      ? totals.totalProjectedGross - totals.totalScheduledCost
      : 0;

  // Only stores with a team have a clock to report; a store just added and
  // not staffed yet is "being set up", not silent.
  const feeds = (cfoQ.data?.feeds ?? []).filter(f => f.people > 0);
  const liveFeeds = feeds.filter(
    f => f.lastPunchAt && Date.now() - new Date(f.lastPunchAt).getTime() <= 24 * 3_600_000
  ).length;
  // Follows the focus, like everything else on the page.
  const alertCount =
    storeFilter === "all"
      ? (attentionQ.data?.count ?? 0)
      : (attentionQ.data?.items ?? []).filter(
          i => !i.storeLocation || i.storeLocation === storeFilter
        ).length;

  const focusLabel =
    storeFilter === "all" ? "all stores" : storeShort(storeFilter);

  // The Stores board is always "this week, live" beside "last week, as
  // saved" — whatever week Command happens to be looking at.
  const storeCards: StoreCard[] = useMemo(() => {
    const live = storesLiveQ.data;
    if (!live) return [];
    const liveRows = live.rows as WeeklyRow[];
    const lastRows = (lastWeekQ.data?.rows ?? []) as WeeklyRow[];
    const soFar = payWeekElapsed(liveWeekStart);
    const lastPunch = new Map((cfoQ.data?.feeds ?? []).map(f => [f.store, f.lastPunchAt]));
    return Object.entries(live.byStore).map(([store, s]) => {
      const mine = liveRows.filter(r => r.storeLocation === store);
      const last = lastRows.filter(r => r.storeLocation === store);
      const saved = last.filter(isSaved);
      const savedHours = saved.reduce((t, r) => t + r.hoursWorked, 0);
      const savedGross = saved.reduce((t, r) => t + r.grossPay, 0);
      return {
        name: store,
        short: storeShort(store),
        color: storeColor(store),
        people: mine.length,
        onClock: s.clockedInCount,
        alerts: alertsByStore.get(store) ?? 0,
        clockHours: s.totalClockHours,
        scheduled: s.totalScheduled,
        labor: mine.reduce((t, r) => t + laborSoFar(r, soFar), 0),
        lastGross: lastWeekQ.data ? savedGross : null,
        lastSaved: saved.length,
        lastUnsaved: last.filter(isUnsaved).length,
        costPerHour: savedHours > 0 ? savedGross / savedHours : null,
        lastPunchAt: lastPunch.get(store) ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storesLiveQ.data, lastWeekQ.data, cfoQ.data, alertsByStore, liveWeekStart]);

  const orbitStores: OrbitStore[] = Object.entries(byStore).map(([store, s]) => ({
    name: store,
    short: storeShort(store),
    color: storeColor(store),
    clockHours: s.totalClockHours,
    scheduled: s.totalScheduled,
    labor: isLiveWeek ? (perStoreLabor.get(store) ?? 0) : s.totalGross,
    onClock: s.clockedInCount,
    alerts: alertsByStore.get(store) ?? 0,
    people: headcountByStore.get(store) ?? 0,
  }));

  const showWeekNav = tab === "overview" || tab === "payroll";

  return (
    <div className="cc">
      <div className="cc-backdrop" aria-hidden="true" />
      <div className="cc-body space-y-4 sm:space-y-5">
        {/* ---------------- Masthead: where you are, and the vital signs ---------------- */}
        <header className="cc-mast">
          <div className="min-w-0">
            <p className="hud-label">Hotspot Market // CEO</p>
            <h1 className="page-title mt-1">{SECTION_TITLE[tab] ?? "Command center"}</h1>
            <p className="page-subtitle">
              {tab === "payroll"
                ? `Autopilot · ${fmtWeekRange(payWeek)} · ${focusLabel}`
                : tab === "stores"
                  ? `Every store side by side · this week, ${fmtWeekRange(inProgressPayWeekStart())}`
                  : tab === "optimize"
                    ? `What the numbers say could be better · ${focusLabel}`
                    : tab === "control"
                      ? "How the site runs: rules, stores, roles, sign-ins and data"
                      : tab === "activity"
                        ? "Every change, by whom and when"
                        : isLiveWeek
                          ? `This week, live · ${focusLabel}`
                          : `Closed week · ${fmtWeekRange(weekStart)} · ${focusLabel}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveClock />
            {feeds.length > 0 ? (
              <span
                className="hud-chip"
                title="Stores whose time clock has sent a punch in the last day"
              >
                <Led tone={liveFeeds === feeds.length ? "ok" : liveFeeds === 0 ? "bad" : "warn"} />
                <b className="tabular-nums">
                  {liveFeeds}/{feeds.length}
                </b>
                clocks reporting
              </span>
            ) : null}
            <button
              type="button"
              className="hud-chip"
              onClick={() => {
                setTab("overview");
                window.setTimeout(
                  () => document.getElementById("attention")?.scrollIntoView({ block: "start" }),
                  60
                );
              }}
              title="Open the items that need attention"
            >
              <Led tone={alertCount > 0 ? "bad" : "ok"} pulse={alertCount > 0} />
              <b className="tabular-nums">{alertCount}</b>
              {alertCount === 1 ? "alert" : "alerts"}
            </button>
            {showWeekNav ? (
              <QuickWeekNav
                weekStart={tab === "payroll" ? payWeek : weekStart}
                onChange={tab === "payroll" ? setPayWeek : setWeekStart}
              />
            ) : null}
          </div>
        </header>

        {/* ============================== COMMAND ============================== */}
        {tab === "overview" ? (
          <div className="space-y-4 sm:space-y-5">
            {ceoQ.isError ? (
              <HudPanel>
                <div className="p-4 sm:p-5">
                  <BlockState isError onRetry={() => ceoQ.refetch()}>
                    {null}
                  </BlockState>
                </div>
              </HudPanel>
            ) : (
              <>
                <div className="cc-cols-live">
                  {/* The company at the center, every store around it */}
                  <HudPanel
                    title="Orbit"
                    meta={
                      storeFilter === "all"
                        ? "tap a store to focus on it"
                        : `focused on ${focusLabel} · tap the center for all stores`
                    }
                    bodyClassName="p-2 sm:p-4"
                  >
                    {loading ? (
                      <div className="mx-auto aspect-square w-full max-w-[38rem] p-6">
                        <Skeleton className="h-full w-full rounded-full" />
                      </div>
                    ) : (
                      <div className="mx-auto w-full max-w-[38rem]">
                        <OrbitCore
                          stores={orbitStores}
                          focus={storeFilter}
                          onFocus={setStoreFilter}
                          label={
                            storeFilter === "all"
                              ? isLiveWeek
                                ? "LABOR · THIS WEEK"
                                : "GROSS PAYROLL"
                              : `${focusLabel.toUpperCase()} · ${isLiveWeek ? "LABOR" : "GROSS"}`
                          }
                          labor={isLiveWeek ? liveLabor : agg.totalGross}
                          hours={agg.totalClockHours}
                          scheduled={agg.totalScheduled}
                          elapsed={elapsed}
                        />
                      </div>
                    )}
                  </HudPanel>

                  <div className="space-y-4 sm:space-y-5">
                    {/* Vital signs */}
                    <section className="hud hud-rise grid grid-cols-2 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r [&>*]:border-[var(--hud-line)]">
                      <Readout
                        label="On the clock now"
                        value={loading ? "—" : <CountNumber value={agg.clockedInCount} />}
                        sub={
                          agg.clockedInCount === 0
                            ? "nobody is clocked in"
                            : storeFilter === "all"
                              ? `across ${storesWithClockedIn} store${storesWithClockedIn === 1 ? "" : "s"}`
                              : `at ${focusLabel}`
                        }
                      />
                      <Readout
                        label="Hours clocked"
                        value={loading ? "—" : <CountNumber value={agg.totalClockHours} digits={1} />}
                        sub={
                          agg.totalScheduled > 0
                            ? `of ${fmtHoursLabel(agg.totalScheduled)} scheduled`
                            : "no schedule this week"
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
                      <Readout
                        label={isLiveWeek ? "Projected payroll" : "Net pay (est.)"}
                        value={
                          isLiveWeek ? (
                            totals ? (
                              <CountMoney value={totals.totalProjectedGross} />
                            ) : (
                              "—"
                            )
                          ) : (
                            <CountMoney
                              value={rows.reduce((t, r) => t + r.netPay, 0)}
                            />
                          )
                        }
                        sub={
                          isLiveWeek
                            ? totals && totals.totalScheduledCost > 0
                              ? `${fmtMoney(totals.totalScheduledCost)} planned`
                              : "worked + still scheduled"
                            : "after estimated withholding"
                        }
                        footer={
                          isLiveWeek && totals && totals.totalScheduledCost > 0 ? (
                            overPlan > 25 ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" />
                                {fmtMoney(overPlan)} over plan
                              </span>
                            ) : (
                              <span className="chip-good">
                                <CheckCircle2 className="h-3 w-3" /> On plan
                              </span>
                            )
                          ) : null
                        }
                      />
                      <Readout
                        label="Last week's payroll"
                        value={
                          lastClosedTrend && lastClosedTrend.savedGross > 0 ? (
                            <CountMoney value={lastClosedTrend.savedGross} />
                          ) : (
                            "—"
                          )
                        }
                        sub={
                          trendQ.isPending
                            ? "loading…"
                            : `${fmtWeekRange(lastClosed)} · ${
                                lastClosedTrend && lastClosedTrend.savedGross > 0
                                  ? "saved so far"
                                  : "not saved yet"
                              }`
                        }
                        footer={
                          <button
                            type="button"
                            className="mono inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--brand-text)] hover:underline"
                            onClick={() => {
                              setPayWeek(lastClosed);
                              setTab("payroll");
                            }}
                          >
                            Open Autopilot <ArrowUpRight className="h-3 w-3" aria-hidden />
                          </button>
                        }
                      />
                    </section>

                    <LiveRoster
                      people={summaryQ.data?.clockedInNow ?? []}
                      loading={summaryQ.isLoading}
                      multiStore={storeFilter === "all"}
                    />
                  </div>
                </div>

                <div className="cc-cols-wide">
                  {/* Everything waiting on a person, with its fix */}
                  <AttentionCenter store={storeFilter === "all" ? undefined : storeFilter} />
                  <SystemLog onOpenLog={() => setTab("activity")} />
                </div>

                <HudPanel
                  title="Last 8 pay weeks"
                  meta="pick a week to open it"
                  bodyClassName="p-4 sm:p-5"
                >
                  <BlockState
                    isLoading={trendQ.isPending}
                    isError={trendQ.isError}
                    onRetry={() => trendQ.refetch()}
                  >
                    <WeekTrend
                      weeks={(trendQ.data?.weeks ?? []) as any}
                      selected={weekStart}
                      onSelect={w => setWeekStart(w)}
                    />
                  </BlockState>
                </HudPanel>
              </>
            )}
          </div>
        ) : null}

        {/* ============================== PAYROLL ============================== */}
        {tab === "payroll" ? (
          <div>
            <Autopilot weekStart={payWeek} storeFocus={storeFilter} soFar={ledgerSoFar}>
              <PayrollPanel
                rows={ledgerRows}
                isLiveWeek={ledgerIsLive}
                elapsed={ledgerElapsed}
                weekStart={payWeek}
                showGroups={storeFilter === "all"}
                focusLabel={focusLabel}
                loading={ledgerQ.isPending && !ledgerQ.isError}
                isError={ledgerQ.isError}
                onRetry={() => ledgerQ.refetch()}
              />
            </Autopilot>
          </div>
        ) : null}

        {/* ============================== STORES ============================== */}
        {tab === "stores" ? (
          <StoresBoard
            stores={storeCards}
            loading={storesLiveQ.isPending && !storesLiveQ.isError}
            lastWeek={lastClosed}
            lastWeekLoading={lastWeekQ.isPending && !lastWeekQ.isError}
            focus={storeFilter}
            onFocus={store => {
              setStoreFilter(store);
              setTab("overview");
            }}
            onDesk={store => {
              setStoreFilter(store);
              navigate(DESK_HOME);
              window.scrollTo({ top: 0 });
            }}
            onReview={store => {
              setStoreFilter(store);
              setPayWeek(lastClosed);
              setTab("payroll");
            }}
          />
        ) : null}

        {/* ============================= INSIGHTS ============================= */}
        {tab === "optimize" ? (
          <div>
            <Insights
              storeFocus={storeFilter}
              onOpenAutopilot={() => {
                setPayWeek(lastClosed);
                setTab("payroll");
              }}
            />
          </div>
        ) : null}

        {/* ============================== CONTROL ============================== */}
        {tab === "control" ? (
          <ControlRoom access={<PinsPanel />} data={<LivePortalPanel />} />
        ) : null}

        {/* ================================ LOG ================================ */}
        {tab === "activity" ? <ActivityPanel /> : null}
      </div>
    </div>
  );
}

/** Who is on the clock right now, longest shift first. */
function LiveRoster({
  people,
  loading,
  multiStore,
}: {
  people: {
    punchId: number;
    employeeId: number;
    fullName: string;
    role: string;
    storeLocation: string;
    clockInAt: Date | string;
  }[];
  loading: boolean;
  multiStore: boolean;
}) {
  const settingsQ = trpc.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const longShiftHours = settingsQ.data?.rules.longShiftHours ?? 12;
  // Durations tick forward between refreshes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const sorted = [...people].sort(
    (a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime()
  );
  return (
    <HudPanel
      title="On the clock"
      meta={loading ? undefined : `${people.length} right now`}
      actions={
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" asChild>
          <Link href="/payroll?tab=punches">Punches</Link>
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nobody is on the clock. People appear here the moment they clock in.
        </p>
      ) : (
        <ul className="max-h-[19rem] divide-y divide-[var(--hud-line)] overflow-y-auto">
          {sorted.map(c => {
            const hrs = (Date.now() - new Date(c.clockInAt).getTime()) / 3_600_000;
            const long = hrs > longShiftHours;
            return (
              <li key={c.punchId} className="flex items-center gap-3 px-4 py-2.5">
                <InitialsBadge name={c.fullName} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/employees/${c.employeeId}`}
                    className="block truncate text-sm font-medium hover:underline underline-offset-2"
                  >
                    {c.fullName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {multiStore ? `${storeShort(c.storeLocation)} · ` : ""}
                    {c.role} · in at {fmtTime(c.clockInAt)}
                  </p>
                </div>
                <span
                  className={cn(
                    "mono shrink-0 text-sm tabular-nums",
                    long ? "chip-warn" : "text-muted-foreground"
                  )}
                >
                  {long ? <AlertTriangle className="h-3 w-3" /> : null}
                  {fmtDuration(hrs)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </HudPanel>
  );
}

/** The latest entries of the activity log, as a console feed. */
/** Time for something from today (store time); the date for anything older. */
function logStamp(at: Date | string): string {
  const d = new Date(at);
  return storeDayKey(d) === storeDayKey(new Date())
    ? fmtTime(d)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TIME_ZONE });
}

function SystemLog({ onOpenLog }: { onOpenLog: () => void }) {
  // Successful sign-ins are routine; the feed is for changes and failures,
  // so they are left out on the server (before the limit, not after it).
  const auditQ = trpc.ceo.auditLog.useQuery(
    { limit: 14, changesOnly: true },
    { refetchInterval: 30_000 }
  );
  const peopleQ = trpc.employees.list.useQuery(
    { includeInactive: true },
    { staleTime: 5 * 60_000 }
  );
  const nameOf = (id: unknown) => {
    const p = (peopleQ.data ?? []).find(e => e.id === Number(id));
    return p?.fullName ?? `#${id}`;
  };
  const entries = (auditQ.data ?? []).slice(0, 12);
  return (
    <HudPanel
      title="System log"
      meta="every change, as it happens"
      actions={
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onOpenLog}>
          Full log
        </Button>
      }
    >
      {auditQ.isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : auditQ.isError && !auditQ.data ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the log just now.
        </p>
      ) : entries.length === 0 ? (
        <p className="hud-log hud-cursor px-4 py-6 text-muted-foreground">
          No changes recorded yet. Listening
        </p>
      ) : (
        <ul className="hud-log py-1.5">
          {entries.map(e => {
            const d = parseDetail(e.detail);
            const summary = summarize(e, d, nameOf);
            const failed = e.action.includes("failed");
            return (
              <li key={e.id}>
                <time dateTime={new Date(e.createdAt).toISOString()} title={fmtDateTime(e.createdAt)}>
                  {logStamp(e.createdAt)}
                </time>
                <span className="min-w-0 break-words">
                  {/* "Automatic · Automatic clock-out" would say it twice. */}
                  {e.actorScope === "system" ? null : (
                    <>
                      <span className="text-muted-foreground">{actorName(e.actorScope, d)}</span>{" "}
                    </>
                  )}
                  <span className={failed ? "text-[var(--bad-fg)]" : "text-foreground"}>
                    {ACTION_LABELS[e.action] ?? e.action}
                  </span>
                  {summary ? <span className="text-muted-foreground"> · {summary}</span> : null}
                </span>
              </li>
            );
          })}
          <li aria-hidden="true">
            <time>{fmtTime(new Date())}</time>
            <span className="hud-cursor text-muted-foreground">listening</span>
          </li>
        </ul>
      )}
    </HudPanel>
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
  elapsed,
  weekStart,
  showGroups,
  focusLabel,
  loading,
  isError,
  onRetry,
}: {
  rows: WeeklyRow[];
  isLiveWeek: boolean;
  /** Share of this week gone by (1 once it is closed): set pay accrues with it. */
  elapsed: number;
  weekStart: Date;
  showGroups: boolean;
  focusLabel: string;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const colSpan = isLiveWeek ? 5 : 7;
  // The estimate rates are set in Control; say the ones in force right now.
  const rulesQ = trpc.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const pctOf = (rate: number | undefined, fallback: number) =>
    `${Math.round((rate ?? fallback) * 10000) / 100}%`;
  const fedPct = pctOf(rulesQ.data?.rules.estFederalRate, 0.18);
  const statePct = pctOf(rulesQ.data?.rules.estStateRate, 0.05);

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
      return { store, list, totals: totalsOf(list, elapsed) };
    });
  }, [rows, isLiveWeek, elapsed]);

  const grand = useMemo(() => totalsOf(rows, elapsed), [rows, elapsed]);

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
            ? "Earned so far is clocked hours × each person's pay rate; anyone on set pay counts at their weekly amount for the share of the week gone by. Saved pay and tax estimates appear once the week closes and it is saved."
            : `Taxes are estimates on saved payroll: federal (income tax and FICA) about ${fedPct}, state about ${statePct}. Change the rates in Control.`}
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
                    <TableHead className="hidden sm:table-cell text-right">
                      Status
                    </TableHead>
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
                                {/* On a phone the exceptions sit under the
                                    name; the status column is for wider screens. */}
                                {isLiveWeek ? (
                                  r.overClocked ? (
                                    <span className="chip-warn mt-1 sm:hidden">
                                      <AlertTriangle className="h-3 w-3" /> Over
                                      schedule
                                    </span>
                                  ) : null
                                ) : isUnsaved(r) || r.overClocked ? (
                                  <span className="mt-1 flex flex-wrap gap-1 sm:hidden">
                                    {isUnsaved(r) ? (
                                      <span className="chip-warn">
                                        <AlertTriangle className="h-3 w-3" /> Not saved
                                      </span>
                                    ) : null}
                                    {r.overClocked ? (
                                      <span className="chip-warn">
                                        <AlertTriangle className="h-3 w-3" /> Over schedule
                                      </span>
                                    ) : null}
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
                                {onSetPay(r) ? (
                                  <>
                                    {fmtMoney(laborSoFar(r, elapsed))}
                                    <span className="block text-[11px] font-normal text-muted-foreground">
                                      of {fmtMoney(r.weeklyPay!)} set pay
                                    </span>
                                  </>
                                ) : r.clockHours > 0 ? (
                                  fmtMoney(laborSoFar(r, elapsed))
                                ) : (
                                  "—"
                                )}
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
                              <TableCell className="hidden sm:table-cell text-right">
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
                      <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">
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

function totalsOf(list: WeeklyRow[], elapsed: number) {
  return list.reduce(
    (t, r) => ({
      scheduled: t.scheduled + r.scheduledHours,
      clock: t.clock + r.clockHours,
      saved: t.saved + r.hoursWorked,
      earned: t.earned + laborSoFar(r, elapsed),
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
  "settings.rules": "Changed the rules",
  "settings.addStore": "Added a store",
  "settings.addRole": "Added a role",
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
      case "settings.rules":
        return (
          join(
            d?.estFederalPct !== undefined && `federal estimate ${d.estFederalPct}%`,
            d?.estStatePct !== undefined && `state estimate ${d.estStatePct}%`,
            d?.longShiftHours !== undefined &&
              `long-shift alert after ${d.longShiftHours} h`
          ) || null
        );
      case "settings.addStore":
        return d?.store ? String(d.store) : null;
      case "settings.addRole":
        return d?.role ? String(d.role) : null;
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
