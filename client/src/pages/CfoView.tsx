/**
 * CFO portal — labor cost analytics, and nothing else.
 *
 * Research-driven scope: a CFO reads COST, TREND and RATIOS. Included:
 * weekly payroll (last 5 closed Thu–Wed weeks) with week-over-week
 * movement, cost per worked hour, store economics, position mix, labor
 * discipline (scheduled vs worked) and the current week's projection.
 * Deliberately excluded: employee PII (names, phones, individual rates),
 * punch-level detail, operational alerts, and every editing control —
 * this page is read-only and aggregate-only by construction (the API it
 * calls never ships person-level records).
 */
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { BlockState } from "@/components/QueryStates";
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
import { useAuth } from "@/_core/hooks/useAuth";
import {
  STORE_ABBR,
  fmtHours,
  fmtHoursLabel,
  fmtMoney,
  fmtWeekRange,
  storeColor,
} from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  CalendarClock,
  Clock,
  Landmark,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

type CfoWeek = {
  weekStart: Date | string;
  gross: number;
  hours: number;
  scheduledHours: number;
  clockHours: number;
  peoplePaid: number;
  estimated: boolean;
  estFederal: number;
  estState: number;
  estNet: number;
  byStore: Record<string, { gross: number; hours: number }>;
};

/** Whole dollars for chart labels and averages: "$27,381". */
const fmtMoneyWhole = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

/** "Oct 29" for a pay-week marker (stored as a UTC date). */
const weekLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Percent change with a real minus sign; tiny moves read as flat. */
function fmtPct(pct: number): string {
  if (Math.abs(pct) < 0.05) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

/**
 * For labor COST, down is good and up is bad. Changes under 0.05% are flat
 * and carry no color.
 */
function costDeltaClass(pct: number | null): string | undefined {
  if (pct === null || Math.abs(pct) < 0.05) return undefined;
  return pct > 0 ? "delta-bad" : "delta-good";
}

/** Stacked weekly payroll bars — every bar carries its exact total. */
function WeeklyPayrollChart({
  weeks,
  storeNames,
  projected,
}: {
  weeks: CfoWeek[];
  storeNames: string[];
  projected: number | null;
}) {
  const W = 780;
  const H = 330;
  const M = { top: 30, right: 12, bottom: 52, left: 58 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const cols = weeks.length + (projected !== null ? 1 : 0);
  const rawMax = Math.max(1, ...weeks.map(w => w.gross), projected ?? 0);
  // Round the axis top up to a clean step so gridline labels stay honest.
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil((rawMax * 1.08) / (step / 2)) * (step / 2);
  const y = (v: number) => M.top + plotH - (v / niceMax) * plotH;
  const slot = plotW / cols;
  const barW = Math.min(84, slot * 0.58);
  const xOf = (i: number) => M.left + slot * i + (slot - barW) / 2;
  const ticks = [0.25, 0.5, 0.75, 1].map(f => niceMax * f);

  const summary = weeks
    .map(
      w =>
        `${weekLabel(w.weekStart)}: ${w.gross > 0 ? fmtMoneyWhole(w.gross) : "no payroll"}`
    )
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Weekly payroll, stacked by store. ${summary}${
        projected !== null
          ? `. This week projected ${fmtMoneyWhole(projected)}`
          : ""
      }.`}
    >
      {ticks.map(t => (
        <g key={t}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(t)}
            y2={y(t)}
            style={{ stroke: "var(--border)" }}
            strokeWidth="1"
          />
          <text
            x={M.left - 8}
            y={y(t) + 4}
            textAnchor="end"
            fontSize="11"
            style={{ fill: "var(--muted-foreground)" }}
            className="tabular-nums"
          >
            {fmtMoneyWhole(t)}
          </text>
        </g>
      ))}
      <line
        x1={M.left}
        x2={W - M.right}
        y1={y(0)}
        y2={y(0)}
        style={{ stroke: "var(--input)" }}
        strokeWidth="1.25"
      />

      {weeks.map((w, i) => {
        const x = xOf(i);
        let acc = 0;
        const prev = i > 0 ? weeks[i - 1] : null;
        const delta =
          prev && prev.gross > 0 && w.gross > 0
            ? ((w.gross - prev.gross) / prev.gross) * 100
            : null;
        return (
          <g key={String(w.weekStart)}>
            {storeNames.map(s => {
              const g = w.byStore[s]?.gross ?? 0;
              if (g <= 0) return null;
              const y0 = y(acc);
              acc += g;
              const y1 = y(acc);
              return (
                <rect
                  key={s}
                  x={x}
                  y={y1}
                  width={barW}
                  height={Math.max(0, y0 - y1)}
                  style={{ fill: storeColor(s) }}
                  opacity={w.estimated ? 0.75 : 1}
                >
                  <title>{`${STORE_ABBR[s] ?? s} · ${weekLabel(w.weekStart)} · ${fmtMoney(g)}`}</title>
                </rect>
              );
            })}
            <text
              x={x + barW / 2}
              y={y(w.gross) - 7}
              textAnchor="middle"
              fontSize={w.gross > 0 ? 12.5 : 11.5}
              fontWeight={w.gross > 0 ? 700 : 500}
              style={{
                fill:
                  w.gross > 0 ? "var(--foreground)" : "var(--muted-foreground)",
              }}
              className="tabular-nums"
            >
              {w.gross > 0 ? fmtMoneyWhole(w.gross) : "No payroll"}
              {w.gross > 0 && w.estimated ? " est." : ""}
            </text>
            <text
              x={x + barW / 2}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="600"
              style={{ fill: "var(--muted-foreground)" }}
            >
              {weekLabel(w.weekStart)}
            </text>
            {delta !== null ? (
              <text
                x={x + barW / 2}
                y={H - M.bottom + 34}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                className={cn("tabular-nums", costDeltaClass(delta))}
                style={{
                  fill: costDeltaClass(delta)
                    ? "currentColor"
                    : "var(--muted-foreground)",
                }}
              >
                {Math.abs(delta) < 0.05
                  ? "flat"
                  : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%`}
              </text>
            ) : null}
          </g>
        );
      })}

      {projected !== null ? (
        <g>
          <rect
            x={xOf(weeks.length)}
            y={y(projected)}
            width={barW}
            height={Math.max(0, y(0) - y(projected))}
            style={{ fill: "var(--chart-1)", stroke: "var(--chart-1)" }}
            opacity={0.3}
            strokeDasharray="5 4"
            strokeWidth="1.5"
          >
            <title>{`This week, projected · ${fmtMoney(projected)}`}</title>
          </rect>
          <text
            x={xOf(weeks.length) + barW / 2}
            y={y(projected) - 7}
            textAnchor="middle"
            fontSize="12.5"
            fontWeight="700"
            style={{ fill: "var(--muted-foreground)" }}
            className="tabular-nums"
          >
            {fmtMoneyWhole(projected)}
          </text>
          <text
            x={xOf(weeks.length) + barW / 2}
            y={H - M.bottom + 18}
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="600"
            style={{ fill: "var(--muted-foreground)" }}
          >
            This week
          </text>
          <text
            x={xOf(weeks.length) + barW / 2}
            y={H - M.bottom + 34}
            textAnchor="middle"
            fontSize="11"
            style={{ fill: "var(--muted-foreground)" }}
          >
            projected
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/**
 * The same weeks as a stacked list for phones — the SVG chart's labels are
 * unreadable at 390px. One row per week: total, store mix bar, change.
 */
function WeeklyPayrollList({
  weeks,
  storeNames,
  projected,
}: {
  weeks: CfoWeek[];
  storeNames: string[];
  projected: number | null;
}) {
  const max = Math.max(1, ...weeks.map(w => w.gross), projected ?? 0);
  return (
    <ul className="space-y-3.5">
      {weeks.map((w, i) => {
        const prev = i > 0 ? weeks[i - 1] : null;
        const delta =
          prev && prev.gross > 0 && w.gross > 0
            ? ((w.gross - prev.gross) / prev.gross) * 100
            : null;
        return (
          <li key={String(w.weekStart)}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {fmtWeekRange(new Date(w.weekStart))}
                {w.estimated ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    est.
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  w.gross > 0 ? "font-semibold" : "text-muted-foreground"
                )}
              >
                {w.gross > 0 ? fmtMoneyWhole(w.gross) : "No payroll"}
              </span>
            </div>
            <div
              className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              {storeNames.map(s => {
                const g = w.byStore[s]?.gross ?? 0;
                if (g <= 0) return null;
                return (
                  <span
                    key={s}
                    className="h-full"
                    style={{
                      width: `${(g / max) * 100}%`,
                      background: storeColor(s),
                    }}
                  />
                );
              })}
            </div>
            {delta !== null ? (
              <p
                className={cn(
                  "mt-1 text-xs tabular-nums",
                  costDeltaClass(delta) ?? "text-muted-foreground"
                )}
              >
                {fmtPct(delta)} vs the week before
              </p>
            ) : null}
          </li>
        );
      })}
      {projected !== null ? (
        <li>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">
              This week{" "}
              <span className="text-xs font-normal text-muted-foreground">
                projected
              </span>
            </span>
            <span className="tabular-nums font-semibold text-muted-foreground">
              {fmtMoneyWhole(projected)}
            </span>
          </div>
          <div
            className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full border border-dashed"
              style={{
                width: `${(projected / max) * 100}%`,
                background:
                  "color-mix(in oklab, var(--chart-1) 30%, transparent)",
                borderColor: "var(--chart-1)",
              }}
            />
          </div>
        </li>
      ) : null}
    </ul>
  );
}

/** The shared card header: hairline strip, brand icon badge, title. */
function SectionHead({
  icon,
  title,
  sub,
}: {
  icon: ReactNode;
  title: string;
  sub?: ReactNode;
}) {
  return (
    <CardHeader className="card-head px-4 sm:px-5 py-3">
      <CardTitle className="section-title">
        <span className="icon-badge icon-badge-sm">{icon}</span>
        {title}
      </CardTitle>
      {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
    </CardHeader>
  );
}

export default function CfoView({
  eyebrow,
  actions,
}: {
  eyebrow?: ReactNode;
  /** The Overview / Register switch, supplied by the portal. */
  actions?: ReactNode;
} = {}) {
  usePageTitle("Finance");
  const { user } = useAuth();
  const canView = user?.role === "admin" || user?.role === "cfo";

  const cfoQ = trpc.cfo.summary.useQuery(
    { weeks: 5 },
    { enabled: !!canView, refetchInterval: 5 * 60_000 }
  );
  const liveQ = trpc.dashboard.summary.useQuery(undefined, {
    enabled: !!canView,
    refetchInterval: 5 * 60_000,
  });

  const weeks = (cfoQ.data?.weeks ?? []) as CfoWeek[];
  const storeNames = useMemo(
    () => (weeks[0] ? Object.keys(weeks[0].byStore) : []),
    [weeks]
  );

  const m = useMemo(() => {
    if (weeks.length === 0) return null;
    const last = weeks[weeks.length - 1];
    const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
    const totalGross = weeks.reduce((s, w) => s + w.gross, 0);
    const totalHours = weeks.reduce((s, w) => s + w.hours, 0);
    const wow = prev ? last.gross - prev.gross : null;
    const wowPct =
      prev && prev.gross > 0
        ? ((last.gross - prev.gross) / prev.gross) * 100
        : null;
    const grosses = weeks.map(w => w.gross);
    const paidWeeks = grosses.filter(g => g > 0);
    return {
      last,
      prev,
      wow,
      wowPct,
      // Average only weeks that actually had payroll — a week with no data
      // yet is not a $0 week, and counting it would drag the average down.
      avg: paidWeeks.length
        ? paidWeeks.reduce((sum, g) => sum + g, 0) / paidWeeks.length
        : 0,
      paidWeekCount: paidWeeks.length,
      totalGross,
      totalHours,
      avgCostPerHour: totalHours > 0 ? totalGross / totalHours : 0,
      lastCostPerHour: last.hours > 0 ? last.gross / last.hours : 0,
      high: Math.max(...grosses),
      low: paidWeeks.length ? Math.min(...paidWeeks) : 0,
    };
  }, [weeks]);

  const loading = cfoQ.isPending && !cfoQ.isError;
  const projected = liveQ.data?.totals?.totalProjectedGross ?? null;
  const scheduledCost = liveQ.data?.totals?.totalScheduledCost ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        actions={actions}
        title="Finance"
        description="Labor cost for the last five closed pay weeks (Thursday to Wednesday). Read-only."
      />

      {cfoQ.isError ? (
        <Card className="surface-card gap-0 py-0">
          <CardContent className="p-4 sm:p-5">
            <BlockState isError onRetry={() => cfoQ.refetch()}>
              {null}
            </BlockState>
          </CardContent>
        </Card>
      ) : loading ? (
        <>
          <Skeleton className="h-[396px] xl:h-[252px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-2xl" />
          <Skeleton className="h-[280px] rounded-2xl" />
        </>
      ) : !m ? (
        <Card className="surface-card gap-0 py-0">
          <CardContent className="p-4 sm:p-5">
            <BlockState
              isEmpty
              emptyTitle="No payroll history yet"
              emptyHint="Weeks appear here once managers save payroll or the time clock records hours."
            >
              {null}
            </BlockState>
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiBand className="grid-cols-2 md:grid-cols-3">
            <KpiCell
              hero
              icon={<Wallet />}
              label="Last week's payroll"
              value={<Money value={m.last.gross} />}
              sub={`${fmtWeekRange(new Date(m.last.weekStart))}${
                m.last.estimated
                  ? " · estimated from the time clock"
                  : " · saved payroll"
              }`}
            />
            <KpiCell
              hue="teal"
              icon={<TrendingUp />}
              label="Week over week"
              value={
                m.wow === null ? (
                  "—"
                ) : Math.abs(m.wow) < 0.005 ? (
                  <Money value={0} />
                ) : (
                  <span
                    className={cn(
                      "tabular-nums",
                      costDeltaClass(m.wowPct ?? m.wow)
                    )}
                  >
                    {m.wow > 0 ? "+" : "−"}
                    <Money value={Math.abs(m.wow)} />
                  </span>
                )
              }
              sub={
                m.wowPct === null
                  ? "no prior week to compare"
                  : Math.abs(m.wowPct) < 0.05
                    ? "about the same as the week before"
                    : `${m.wowPct > 0 ? "up" : "down"} ${Math.abs(m.wowPct).toFixed(1)}% on the week before`
              }
            />
            <KpiCell
              hue="violet"
              icon={<BarChart3 />}
              label="Average week"
              value={<Money value={m.avg} />}
              sub={
                m.paidWeekCount === weeks.length
                  ? `last ${weeks.length} closed pay weeks`
                  : `over the ${m.paidWeekCount} of ${weeks.length} closed weeks with payroll`
              }
            />
            <KpiCell
              hue="blue"
              icon={<Clock />}
              label="Cost per worked hour"
              value={
                m.lastCostPerHour > 0 ? (
                  <Money value={m.lastCostPerHour} />
                ) : (
                  "—"
                )
              }
              sub={`5-week average ${fmtMoney(m.avgCostPerHour)}`}
            />
            <KpiCell
              hue="green"
              icon={<CalendarClock />}
              label="This week, projected"
              value={projected !== null ? <Money value={projected} /> : "—"}
              sub={
                liveQ.isError
                  ? "couldn't load the live week"
                  : projected === null
                    ? "loading the live week…"
                    : scheduledCost > 0
                      ? `vs ${fmtMoney(scheduledCost)} if worked exactly to schedule`
                      : "updates live as the week is worked"
              }
            />
            <KpiCell
              hue="amber"
              icon={<Users />}
              label="People paid last week"
              value={m.last.peoplePaid}
              sub={
                m.last.peoplePaid > 0
                  ? `averaging ${fmtHoursLabel(m.last.hours / m.last.peoplePaid)} each`
                  : "no hours recorded"
              }
            />
          </KpiBand>

          <Card className="surface-card gap-0 py-0">
            <SectionHead
              icon={<BarChart3 />}
              title="Weekly payroll, last 5 closed weeks"
              sub="Stacked by store, with the change from the week before under each bar. The dashed bar is this week's projection."
            />
            <CardContent className="px-4 sm:px-5 py-4">
              <div className="hidden sm:block">
                <WeeklyPayrollChart
                  weeks={weeks}
                  storeNames={storeNames}
                  projected={projected}
                />
              </div>
              <div className="sm:hidden">
                <WeeklyPayrollList
                  weeks={weeks}
                  storeNames={storeNames}
                  projected={projected}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                {storeNames.map(s => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ background: storeColor(s) }}
                      aria-hidden="true"
                    />
                    {STORE_ABBR[s] ?? s}
                  </span>
                ))}
                <span className="w-full text-xs text-muted-foreground tabular-nums sm:ml-auto sm:w-auto">
                  5-week total {fmtMoneyWhole(m.totalGross)} · high{" "}
                  {fmtMoneyWhole(m.high)} · low {fmtMoneyWhole(m.low)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="surface-card gap-0 py-0">
            <SectionHead icon={<CalendarClock />} title="Week by week" />
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pay week</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="hidden sm:table-cell text-right">
                        Hours paid
                      </TableHead>
                      <TableHead className="text-right">Cost / hour</TableHead>
                      <TableHead className="hidden md:table-cell text-right">
                        People
                      </TableHead>
                      <TableHead className="hidden md:table-cell text-right">
                        Hours / person
                      </TableHead>
                      <TableHead className="hidden sm:table-cell text-right">
                        Vs schedule
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeks.map((w, i) => {
                      const prev = i > 0 ? weeks[i - 1] : null;
                      const d =
                        prev && prev.gross > 0 && w.gross > 0
                          ? ((w.gross - prev.gross) / prev.gross) * 100
                          : null;
                      const schedVar =
                        w.scheduledHours > 0
                          ? ((w.hours - w.scheduledHours) / w.scheduledHours) *
                            100
                          : null;
                      return (
                        <TableRow key={String(w.weekStart)}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {fmtWeekRange(new Date(w.weekStart))}
                            {w.estimated ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                est.
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {w.gross > 0 ? fmtMoney(w.gross) : "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              costDeltaClass(d)
                            )}
                          >
                            {d === null ? "—" : fmtPct(d)}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-right tabular-nums">
                            {w.hours > 0 ? fmtHours(w.hours) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {w.hours > 0 ? fmtMoney(w.gross / w.hours) : "—"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right tabular-nums">
                            {w.peoplePaid > 0 ? w.peoplePaid : "—"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right tabular-nums">
                            {w.peoplePaid > 0
                              ? fmtHours(w.hours / w.peoplePaid)
                              : "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "hidden sm:table-cell text-right tabular-nums",
                              schedVar === null
                                ? "text-muted-foreground"
                                : Math.abs(schedVar) > 5
                                  ? "delta-bad"
                                  : "delta-good"
                            )}
                          >
                            {schedVar === null
                              ? "No schedule"
                              : fmtPct(schedVar)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="hover:bg-transparent">
                      <TableCell className="font-semibold">
                        5-week total
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(m.totalGross)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="hidden sm:table-cell text-right tabular-nums font-semibold">
                        {fmtHours(m.totalHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {m.avgCostPerHour > 0
                          ? fmtMoney(m.avgCostPerHour)
                          : "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell" />
                      <TableCell className="hidden md:table-cell" />
                      <TableCell className="hidden sm:table-cell" />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              <p className="px-4 sm:px-5 py-3 text-xs text-muted-foreground border-t border-border">
                Change is against the week before; for labor cost, green means
                it went down. Vs schedule is hours paid against hours scheduled
                — within 5% reads green.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <Card className="surface-card gap-0 py-0">
              <SectionHead
                icon={<Store />}
                title="Store economics"
                sub={
                  <>
                    Last closed week ({fmtWeekRange(new Date(m.last.weekStart))}
                    ) beside each store&apos;s average week (weeks with payroll
                    only). A store whose time clock isn&apos;t sending data reads $0.
                  </>
                }
              />
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Store</TableHead>
                        <TableHead>Time clock</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="hidden sm:table-cell text-right">
                          Share
                        </TableHead>
                        <TableHead className="hidden sm:table-cell text-right">
                          Cost / hour
                        </TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="hidden sm:table-cell text-right">
                          Avg week
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {storeNames.map(s => {
                        const cur = m.last.byStore[s] ?? { gross: 0, hours: 0 };
                        const prevG = m.prev?.byStore[s]?.gross ?? 0;
                        const d =
                          prevG > 0 && cur.gross > 0
                            ? ((cur.gross - prevG) / prevG) * 100
                            : null;
                        // Same rule as the headline average: only weeks
                        // in which this store had payroll.
                        const storeWeeks = weeks
                          .map(w => w.byStore[s]?.gross ?? 0)
                          .filter(g => g > 0);
                        const avg5 = storeWeeks.length
                          ? storeWeeks.reduce((sum, g) => sum + g, 0) /
                            storeWeeks.length
                          : 0;
                        const lastPunchAt = cfoQ.data?.feeds?.find(
                          f => f.store === s
                        )?.lastPunchAt;
                        const silentH = lastPunchAt
                          ? (Date.now() - new Date(lastPunchAt).getTime()) /
                            3_600_000
                          : null;
                        return (
                          <TableRow key={s}>
                            <TableCell className="font-medium whitespace-nowrap">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-[3px]"
                                  style={{ background: storeColor(s) }}
                                  aria-hidden="true"
                                />
                                {STORE_ABBR[s] ?? s}
                              </span>
                            </TableCell>
                            <TableCell>
                              {silentH === null ? (
                                <span className="chip-warn">No data yet</span>
                              ) : silentH < 24 ? (
                                <span className="chip-good">Live</span>
                              ) : (
                                <span
                                  className="chip-bad"
                                  title={`Last punch ${Math.floor(silentH)} hours ago`}
                                >
                                  Silent {Math.floor(silentH / 24)}d
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {fmtMoney(cur.gross)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-right tabular-nums">
                              {m.last.gross > 0
                                ? `${((cur.gross / m.last.gross) * 100).toFixed(0)}%`
                                : "—"}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-right tabular-nums">
                              {cur.hours > 0
                                ? fmtMoney(cur.gross / cur.hours)
                                : "—"}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                costDeltaClass(d)
                              )}
                            >
                              {d === null ? "—" : fmtPct(d)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-right tabular-nums">
                              {fmtMoney(avg5)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <PositionBreakdown
                items={(cfoQ.data?.latestWeekPeople ?? []).filter(
                  p => p.hours > 0 || p.gross > 0
                )}
                sub={`Last closed week, ${fmtWeekRange(new Date(m.last.weekStart))}`}
              />
              <Card className="surface-card gap-0 py-0">
                <SectionHead
                  icon={<Landmark />}
                  title="Withholding snapshot"
                  sub={`Last closed week, ${fmtWeekRange(new Date(m.last.weekStart))}`}
                />
                <CardContent className="px-4 sm:px-5 py-4 text-sm">
                  <dl className="space-y-1.5 tabular-nums">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Est. federal withholding
                      </dt>
                      <dd className="font-semibold">
                        {fmtMoney(m.last.estFederal)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Est. state withholding
                      </dt>
                      <dd className="font-semibold">
                        {fmtMoney(m.last.estState)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-border pt-1.5">
                      <dt className="text-muted-foreground">
                        Est. net paid out
                      </dt>
                      <dd className="font-semibold">
                        {fmtMoney(m.last.estNet)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground pt-3">
                    Estimates for planning. Actual withholding comes from your
                    payroll processor.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Totals only. Personal details, individual pay rates and punches are
        never sent to this page.
      </p>
    </div>
  );
}
