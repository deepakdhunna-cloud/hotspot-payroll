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
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { STORE_ABBR, fmtMoney, fmtWeekRange } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { BarChart3, Landmark, ShieldCheck } from "lucide-react";
import { useMemo } from "react";

const STORE_COLORS = [
  "oklch(0.30 0.035 255)",
  "oklch(0.52 0.10 250)",
  "oklch(0.70 0.065 220)",
  "oklch(0.62 0.09 75)",
];
const UP = "oklch(0.52 0.14 155)";
const DOWN = "oklch(0.55 0.19 27)";

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

const fmtWholeMoney = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const weekLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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
  const rawMax = Math.max(
    1,
    ...weeks.map(w => w.gross),
    projected ?? 0,
  );
  // Round the axis top up to a clean step so gridline labels stay honest.
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil((rawMax * 1.08) / (step / 2)) * (step / 2);
  const y = (v: number) => M.top + plotH - (v / niceMax) * plotH;
  const slot = plotW / cols;
  const barW = Math.min(84, slot * 0.58);
  const xOf = (i: number) => M.left + slot * i + (slot - barW) / 2;
  const ticks = [0.25, 0.5, 0.75, 1].map(f => niceMax * f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Weekly payroll, stacked by store"
    >
      {ticks.map(t => (
        <g key={t}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(t)}
            y2={y(t)}
            stroke="oklch(0.9 0.005 250)"
            strokeWidth="1"
          />
          <text
            x={M.left - 8}
            y={y(t) + 4}
            textAnchor="end"
            fontSize="11"
            fill="oklch(0.55 0.01 250)"
            className="tabular-nums"
          >
            {fmtWholeMoney(t)}
          </text>
        </g>
      ))}
      <line
        x1={M.left}
        x2={W - M.right}
        y1={y(0)}
        y2={y(0)}
        stroke="oklch(0.75 0.01 250)"
        strokeWidth="1.25"
      />

      {weeks.map((w, i) => {
        const x = xOf(i);
        let acc = 0;
        const prev = i > 0 ? weeks[i - 1] : null;
        const delta =
          prev && prev.gross > 0 ? ((w.gross - prev.gross) / prev.gross) * 100 : null;
        return (
          <g key={String(w.weekStart)}>
            {storeNames.map((s, si) => {
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
                  fill={STORE_COLORS[si % STORE_COLORS.length]}
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
              fontSize="12.5"
              fontWeight="700"
              fill="oklch(0.25 0.02 255)"
              className="tabular-nums"
            >
              {fmtWholeMoney(w.gross)}
              {w.estimated ? " est." : ""}
            </text>
            <text
              x={x + barW / 2}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="600"
              fill="oklch(0.4 0.015 255)"
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
                fill={delta >= 0 ? DOWN : UP}
                className="tabular-nums"
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
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
            fill="oklch(0.52 0.10 250)"
            opacity={0.3}
            stroke="oklch(0.52 0.10 250)"
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
            fill="oklch(0.45 0.06 250)"
            className="tabular-nums"
          >
            {fmtWholeMoney(projected)}
          </text>
          <text
            x={xOf(weeks.length) + barW / 2}
            y={H - M.bottom + 18}
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="600"
            fill="oklch(0.45 0.06 250)"
          >
            this week
          </text>
          <text
            x={xOf(weeks.length) + barW / 2}
            y={H - M.bottom + 34}
            textAnchor="middle"
            fontSize="11"
            fill="oklch(0.55 0.03 250)"
          >
            projected
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export default function CfoView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const cfoQ = trpc.cfo.summary.useQuery(
    { weeks: 5 },
    { enabled: !!isAdmin, refetchInterval: 5 * 60_000 },
  );
  const liveQ = trpc.dashboard.summary.useQuery(undefined, {
    enabled: !!isAdmin,
    refetchInterval: 5 * 60_000,
  });

  const weeks = (cfoQ.data?.weeks ?? []) as CfoWeek[];
  const storeNames = useMemo(
    () => (weeks[0] ? Object.keys(weeks[0].byStore) : []),
    [weeks],
  );

  const m = useMemo(() => {
    if (weeks.length === 0) return null;
    const last = weeks[weeks.length - 1];
    const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
    const totalGross = weeks.reduce((s, w) => s + w.gross, 0);
    const totalHours = weeks.reduce((s, w) => s + w.hours, 0);
    const wow = prev ? last.gross - prev.gross : null;
    const wowPct = prev && prev.gross > 0 ? ((last.gross - prev.gross) / prev.gross) * 100 : null;
    const grosses = weeks.map(w => w.gross);
    return {
      last,
      prev,
      wow,
      wowPct,
      avg: totalGross / weeks.length,
      totalGross,
      totalHours,
      avgCostPerHour: totalHours > 0 ? totalGross / totalHours : 0,
      lastCostPerHour: last.hours > 0 ? last.gross / last.hours : 0,
      high: Math.max(...grosses),
      low: Math.min(...grosses),
    };
  }, [weeks]);

  if (user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">CEO access only</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          The CFO portal carries company-wide payroll financials and is
          restricted to the CEO login.
        </p>
      </div>
    );
  }

  const projected = liveQ.data?.totals?.totalProjectedGross ?? null;
  const scheduledCost = liveQ.data?.totals?.totalScheduledCost ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CFO portal"
        title="Labor cost & payroll analytics"
        description="Aggregated financials for the last five closed pay weeks (Thu – Wed). Read-only — no personal data, no operational controls."
        icon={<Landmark />}
      />

      {m ? (
        <KpiBand className="grid-cols-2 xl:grid-cols-3">
          <KpiCell
            hero
            label="Last week payroll"
            value={<Money value={m.last.gross} />}
            sub={`${fmtWeekRange(new Date(m.last.weekStart))}${m.last.estimated ? " · estimated from time clock" : " · saved payroll"}`}
          />
          <KpiCell
            label="Week over week"
            value={
              m.wow === null ? (
                "—"
              ) : (
                <span
                  style={{ color: m.wow >= 0 ? DOWN : UP }}
                  className="tabular-nums"
                >
                  {m.wow >= 0 ? "+" : "−"}
                  {fmtWholeMoney(Math.abs(m.wow))}
                </span>
              )
            }
            sub={
              m.wowPct === null
                ? "no prior week to compare"
                : `${m.wowPct >= 0 ? "up" : "down"} ${Math.abs(m.wowPct).toFixed(1)}% vs the week before`
            }
          />
          <KpiCell
            label="5-week average"
            value={<Money value={m.avg} />}
            sub="per closed pay week"
          />
          <KpiCell
            label="Cost per worked hour"
            value={`$${m.lastCostPerHour.toFixed(2)}`}
            sub={`5-week average $${m.avgCostPerHour.toFixed(2)}`}
          />
          <KpiCell
            label="This week, projected"
            value={<Money value={projected ?? 0} />}
            sub={
              scheduledCost > 0
                ? `vs ${fmtMoney(scheduledCost)} if worked exactly to schedule`
                : "updates live as the week is worked"
            }
          />
          <KpiCell
            label="People paid last week"
            value={m.last.peoplePaid}
            sub={
              m.last.peoplePaid > 0
                ? `averaging ${(m.last.hours / m.last.peoplePaid).toFixed(1)}h each`
                : "no hours recorded"
            }
          />
        </KpiBand>
      ) : null}

      <Card className="surface-card border-0">
        <CardHeader className="pb-2">
          <CardTitle className="section-title flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Weekly payroll — last 5 closed weeks
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Stacked by store; the exact total sits on every bar and the
            movement vs the prior week sits under it. The dashed bar is the
            current week's live projection.
          </p>
        </CardHeader>
        <CardContent>
          {cfoQ.isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Crunching five weeks of payroll…
            </p>
          ) : weeks.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No payroll history yet.
            </p>
          ) : (
            <>
              <WeeklyPayrollChart
                weeks={weeks}
                storeNames={storeNames}
                projected={projected}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {storeNames.map((s, i) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ background: STORE_COLORS[i % STORE_COLORS.length] }}
                    />
                    {STORE_ABBR[s] ?? s}
                  </span>
                ))}
                {m ? (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    5-week total {fmtWholeMoney(m.totalGross)} · high{" "}
                    {fmtWholeMoney(m.high)} · low {fmtWholeMoney(m.low)}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {weeks.length > 0 ? (
        <Card className="surface-card border-0">
          <CardHeader>
            <CardTitle className="section-title">Week by week</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pay week</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Δ vs prior</TableHead>
                    <TableHead className="text-right">Hours paid</TableHead>
                    <TableHead className="text-right">Cost / hr</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Avg h / person</TableHead>
                    <TableHead className="text-right">Sched. variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeks.map((w, i) => {
                    const prev = i > 0 ? weeks[i - 1] : null;
                    const d =
                      prev && prev.gross > 0
                        ? ((w.gross - prev.gross) / prev.gross) * 100
                        : null;
                    const schedVar =
                      w.scheduledHours > 0
                        ? ((w.hours - w.scheduledHours) / w.scheduledHours) * 100
                        : null;
                    return (
                      <TableRow key={String(w.weekStart)}>
                        <TableCell className="font-medium">
                          {fmtWeekRange(new Date(w.weekStart))}
                          {w.estimated ? (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                              est.
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmtMoney(w.gross)}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          style={
                            d === null ? undefined : { color: d >= 0 ? DOWN : UP }
                          }
                        >
                          {d === null
                            ? "—"
                            : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.hours.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.hours > 0 ? `$${(w.gross / w.hours).toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.peoplePaid}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.peoplePaid > 0
                            ? (w.hours / w.peoplePaid).toFixed(1)
                            : "—"}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          style={
                            schedVar === null
                              ? undefined
                              : { color: Math.abs(schedVar) > 5 ? DOWN : UP }
                          }
                        >
                          {schedVar === null
                            ? "no schedule"
                            : `${schedVar >= 0 ? "+" : "−"}${Math.abs(schedVar).toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {m ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">
                        5-week totals
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtMoney(m.totalGross)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums font-semibold">
                        {m.totalHours.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        ${m.avgCostPerHour.toFixed(2)}
                      </TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {m ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card className="surface-card border-0">
            <CardHeader>
              <CardTitle className="section-title">Store economics</CardTitle>
              <p className="text-xs text-muted-foreground">
                Last closed week ({fmtWeekRange(new Date(m.last.weekStart))}),
                with each store's 5-week average for context.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Cost / hr</TableHead>
                      <TableHead className="text-right">Δ vs prior wk</TableHead>
                      <TableHead className="text-right">5-wk avg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeNames.map((s, i) => {
                      const cur = m.last.byStore[s] ?? { gross: 0, hours: 0 };
                      const prevG = m.prev?.byStore[s]?.gross ?? 0;
                      const d =
                        prevG > 0 ? ((cur.gross - prevG) / prevG) * 100 : null;
                      const avg5 =
                        weeks.reduce((sum, w) => sum + (w.byStore[s]?.gross ?? 0), 0) /
                        weeks.length;
                      return (
                        <TableRow key={s}>
                          <TableCell className="font-medium">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-[3px]"
                                style={{
                                  background: STORE_COLORS[i % STORE_COLORS.length],
                                }}
                              />
                              {STORE_ABBR[s] ?? s}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {fmtMoney(cur.gross)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {m.last.gross > 0
                              ? `${((cur.gross / m.last.gross) * 100).toFixed(0)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cur.hours > 0
                              ? `$${(cur.gross / cur.hours).toFixed(2)}`
                              : "—"}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            style={
                              d === null ? undefined : { color: d >= 0 ? DOWN : UP }
                            }
                          >
                            {d === null
                              ? "—"
                              : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtWholeMoney(avg5)}
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
                p => p.hours > 0 || p.gross > 0,
              )}
              sub={`last closed week (${fmtWeekRange(new Date(m.last.weekStart))}) — where the payroll dollars go by role`}
            />
            <Card className="surface-card border-0">
              <CardHeader className="pb-2">
                <CardTitle className="section-title">
                  Withholding snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <p className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">
                    Est. federal withholding, last week
                  </span>
                  <span className="font-semibold">{fmtMoney(m.last.estFederal)}</span>
                </p>
                <p className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">
                    Est. state withholding, last week
                  </span>
                  <span className="font-semibold">{fmtMoney(m.last.estState)}</span>
                </p>
                <p className="flex justify-between tabular-nums border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Est. net paid out</span>
                  <span className="font-semibold">{fmtMoney(m.last.estNet)}</span>
                </p>
                <p className="text-xs text-muted-foreground pt-1">
                  Model estimates for planning only — actual withholding comes
                  from your payroll processor.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Data governance: this portal shows aggregated payroll financials only.
        Employee personal details, individual pay rates, punch records and
        operational alerts are deliberately excluded from both the page and
        the API behind it.
      </p>
    </div>
  );
}
