/**
 * Optimize — what the numbers say could be done better, and what to do.
 *
 * Every finding is arithmetic on figures the site already shows elsewhere
 * (the time clock, the schedule, saved payroll, the attention list). Nothing
 * is guessed or modelled, and each finding states how it was worked out, so
 * it can be checked against the page it came from. Findings that put a
 * dollar figure on something use the person's own hourly rate.
 *
 *   ACT   — costing money or blocking payroll right now.
 *   WATCH — worth a look; not urgent.
 *   GOOD  — checked, and fine.
 */
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STORE_ABBR, fmtHours, fmtHoursLabel, fmtMoney, fmtWeekRange, storeColor, storeIndex } from "@/lib/format";
import { inProgressPayWeekStart } from "@/lib/payweek";
import { DESK_HOME } from "@/lib/portal";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Eye } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { HudPanel, Led } from "./hud";

type Tone = "act" | "watch" | "good";
type Finding = {
  key: string;
  tone: Tone;
  /** What area it is about: "This week", "Last week", "Time clock"… */
  kicker: string;
  title: string;
  /** The headline figure, if the finding has one. */
  metric?: string;
  body: string;
  /** How it was worked out, in one line. */
  basis: string;
  action?: { label: string; href?: string; onClick?: () => void; newTab?: boolean };
};

const short = (store: string) => STORE_ABBR[store] ?? store;
const pct = (n: number, digits = 1) => `${(Math.abs(n) * 100).toFixed(digits)}%`;
const list = (names: string[], max = 3) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

const TONE_ORDER: Record<Tone, number> = { act: 0, watch: 1, good: 2 };

export function Insights({
  storeFocus,
  onOpenAutopilot,
}: {
  /** "all" or one store. */
  storeFocus: string;
  onOpenAutopilot: () => void;
}) {
  const live = useMemo(() => inProgressPayWeekStart(), []);
  const store = storeFocus === "all" ? undefined : (storeFocus as any);
  const ceoQ = trpc.ceo.weekly.useQuery({ weekStart: live }, { refetchInterval: 60_000 });
  const summaryQ = trpc.dashboard.summary.useQuery(
    { weekStart: live, store },
    { refetchInterval: 60_000 },
  );
  const cfoQ = trpc.cfo.summary.useQuery({ weeks: 5 }, { refetchInterval: 5 * 60_000 });
  const attentionQ = trpc.attention.list.useQuery(undefined, { refetchInterval: 60_000 });
  const settingsQ = trpc.settings.get.useQuery(undefined, { staleTime: 60_000 });

  const loading =
    ceoQ.isLoading || summaryQ.isLoading || cfoQ.isLoading || attentionQ.isLoading;
  const longShiftHours = settingsQ.data?.rules.longShiftHours ?? 12;

  const inFocus = (s: string | null | undefined) => storeFocus === "all" || s === storeFocus;

  const { findings, costPerHour, hoursVsSchedule } = useMemo(() => {
    const out: Finding[] = [];
    const rows = (ceoQ.data?.rows ?? []).filter((r) => inFocus(r.storeLocation));
    const totals = summaryQ.data?.totals;
    const clockedIn = summaryQ.data?.clockedInNow ?? [];
    const weeks = cfoQ.data?.weeks ?? [];
    const allFeeds = (cfoQ.data?.feeds ?? []).filter((f) => inFocus(f.store));
    // Only a store with a team has a clock to report.
    const feeds = allFeeds.filter((f) => f.people > 0);
    const unstaffed = allFeeds.filter((f) => f.people === 0);
    const items = (attentionQ.data?.items ?? []).filter((i) => inFocus(i.storeLocation));

    // Shifts still running past the long-shift limit: almost always a
    // forgotten clock-out. Their hours aren't trustworthy yet, so those
    // people are reported on their own and left out of the schedule math.
    const now = Date.now();
    const long = clockedIn
      .map((c) => ({ ...c, hrs: (now - new Date(c.clockInAt).getTime()) / 3_600_000 }))
      .filter((c) => c.hrs > longShiftHours)
      .sort((a, b) => b.hrs - a.hrs);
    const runningLong = new Set(long.map((c) => c.employeeId));

    /* ---------- This week: hours beyond the schedule ---------- */
    if (ceoQ.data) {
      // Only people paid by the hour: extra hours don't change what someone
      // on set pay is paid, so they cost nothing here.
      const hourly = rows.filter((r) => !(r.weeklyPay != null && r.weeklyPay > 0));
      const over = hourly
        .filter(
          (r) =>
            !runningLong.has(r.id) &&
            r.scheduledHours > 0 &&
            r.clockHours - r.scheduledHours > 0.25,
        )
        .map((r) => ({ ...r, extra: r.clockHours - r.scheduledHours }))
        .sort((a, b) => b.extra * b.payRate - a.extra * a.payRate);
      if (over.length > 0) {
        const hours = over.reduce((t, r) => t + r.extra, 0);
        const cost = over.reduce((t, r) => t + r.extra * r.payRate, 0);
        out.push({
          key: "over-schedule",
          tone: cost >= 100 ? "act" : "watch",
          kicker: "This week",
          title: `${over.length} ${over.length === 1 ? "person is" : "people are"} past their scheduled hours`,
          metric: fmtMoney(cost),
          body: `${fmtHoursLabel(hours)} beyond the schedule so far. Most: ${list(
            over.map((r) => `${r.fullName} (+${fmtHours(r.extra)} h, ${short(r.storeLocation)})`),
          )}.`,
          basis: `Time-clock hours above each person's scheduled hours for the week, at their hourly rate. People on set pay aren't counted — extra hours don't change their pay.${
            runningLong.size > 0
              ? ` Not counting the ${runningLong.size} ${runningLong.size === 1 ? "person" : "people"} whose shift is still running too long.`
              : ""
          }`,
          action: { label: "See this week by employee", href: DESK_HOME },
        });
      } else if (hourly.some((r) => r.scheduledHours > 0)) {
        out.push({
          key: "over-schedule",
          tone: "good",
          kicker: "This week",
          title: "Everyone is within their scheduled hours",
          body: "Nobody has clocked more than their schedule for the week.",
          basis: "Time-clock hours against scheduled hours, per person.",
        });
      }

      /* ---------- This week: on the clock but not on the schedule ---------- */
      const scheduledStores = new Set(
        rows.filter((r) => r.scheduledHours > 0).map((r) => r.storeLocation),
      );
      const offSchedule = hourly.filter(
        (r) => r.scheduledHours === 0 && r.clockHours > 0.25 && scheduledStores.has(r.storeLocation),
      );
      if (offSchedule.length > 0) {
        const cost = offSchedule.reduce((t, r) => t + r.clockHours * r.payRate, 0);
        out.push({
          key: "off-schedule",
          tone: "watch",
          kicker: "This week",
          title: `${offSchedule.length} ${offSchedule.length === 1 ? "person has" : "people have"} worked without being on the schedule`,
          metric: fmtMoney(cost),
          body: `${list(offSchedule.map((r) => `${r.fullName} (${short(r.storeLocation)})`))}. Their hours aren't in the plan, so the projection can't see them coming.`,
          basis:
            "People paid by the hour with time-clock hours and no scheduled hours, in stores that do have a schedule this week.",
          action: { label: "Open the schedule", href: "/schedule-import" },
        });
      }
    }

    /* ---------- This week: projection against the plan ---------- */
    if (totals && totals.totalScheduledCost > 0) {
      const delta = totals.totalProjectedGross - totals.totalScheduledCost;
      const share = delta / totals.totalScheduledCost;
      if (delta > 25) {
        out.push({
          key: "projection",
          tone: share > 0.05 ? "act" : "watch",
          kicker: "This week",
          title: "The week is heading over the schedule's cost",
          metric: `+${fmtMoney(delta)}`,
          body: `Projected ${fmtMoney(totals.totalProjectedGross)} against ${fmtMoney(
            totals.totalScheduledCost,
          )} planned — ${pct(share)} over.`,
          basis:
            "Finished days at what they actually cost, plus today and the days ahead at their scheduled cost. The same projection as the dashboard.",
        });
      } else {
        out.push({
          key: "projection",
          tone: "good",
          kicker: "This week",
          title: "On plan",
          metric: fmtMoney(totals.totalProjectedGross),
          body: `Projected payroll is within ${fmtMoney(25)} of the ${fmtMoney(
            totals.totalScheduledCost,
          )} the schedule costs.`,
          basis: "Finished days at actual cost plus the rest of the week at scheduled cost.",
        });
      }
    }

    /* ---------- Right now: shifts running too long ---------- */
    if (long.length > 0) {
      out.push({
        key: "long-shifts",
        tone: "act",
        kicker: "Right now",
        title: `${long.length} shift${long.length === 1 ? " is" : "s are"} still running past ${longShiftHours} hours`,
        metric: fmtHoursLabel(long.reduce((t, c) => t + c.hrs, 0), 0),
        body: `${list(long.map((c) => `${c.fullName} (${fmtHours(c.hrs, 0)} h, ${short(c.storeLocation)})`))}. Almost always a forgotten clock-out — each keeps adding hours to payroll until it is closed.`,
        basis: `Open punches older than the long-shift limit (${longShiftHours} h, set in Control).`,
        action: { label: "Fix in punches", href: "/payroll?tab=punches" },
      });
    }

    /* ---------- Last closed week: cost per hour, store against store ---------- */
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    // Is last week fully on payroll? If a real share of its clocked hours
    // isn't saved yet, its totals are short and comparing them would mislead.
    const lastIncomplete =
      !!last && last.clockHours > 0 && (last.clockHours - last.hours) / last.clockHours > 0.03;
    const cph: { store: string; value: number; hours: number }[] = [];
    let companyCph = 0;
    if (last && last.hours > 0) {
      companyCph = last.gross / last.hours;
      for (const [s, v] of Object.entries(last.byStore)) {
        if (v.hours > 0) cph.push({ store: s, value: v.gross / v.hours, hours: v.hours });
      }
      cph.sort((a, b) => storeIndex(a.store) - storeIndex(b.store));
      for (const c of cph.filter((c) => inFocus(c.store))) {
        const diff = c.value - companyCph;
        if (diff >= 0.25) {
          out.push({
            key: `cph:${c.store}`,
            tone: "watch",
            kicker: "Last week",
            title: `${short(c.store)} pays ${fmtMoney(diff)} more per hour than the company average`,
            metric: `${fmtMoney(c.value)}/h`,
            body: `Company average ${fmtMoney(companyCph)}/h. Across its ${fmtHoursLabel(
              c.hours,
            )} that difference is about ${fmtMoney(diff * c.hours)} for the week.`,
            basis: `Gross pay ÷ hours paid, ${fmtWeekRange(new Date(last.weekStart))}. Set pay counts in full, whatever hours were logged${
              last.estimated
                ? " (that week isn't saved, so it is estimated from the clock)"
                : lastIncomplete
                  ? " (saved payroll only; the average leaves out stores that haven't saved that week)"
                  : ""
            }.`,
          });
        }
      }
    }

    /* ---------- Last closed week against the one before ---------- */
    if (storeFocus === "all" && last && prev && prev.gross > 0 && last.gross > 0 && !lastIncomplete) {
      const change = (last.gross - prev.gross) / prev.gross;
      const hoursChange = prev.hours > 0 ? (last.hours - prev.hours) / prev.hours : 0;
      if (Math.abs(change) >= 0.05) {
        const up = change > 0;
        out.push({
          key: "week-over-week",
          tone: up || last.estimated ? "watch" : "good",
          kicker: "Last week",
          title: `Payroll ${up ? "rose" : "fell"} ${pct(change)} against the week before`,
          metric: `${up ? "+" : "−"}${fmtMoney(Math.abs(last.gross - prev.gross))}`,
          body: `${fmtMoney(prev.gross)} → ${fmtMoney(last.gross)}. Hours ${
            hoursChange >= 0 ? "rose" : "fell"
          } ${pct(hoursChange)} (${fmtHours(prev.hours)} → ${fmtHours(last.hours)}).${
            last.estimated ? " Part of last week isn't saved yet, so it is estimated from the time clock." : ""
          }`,
          basis: "Gross payroll of the last two closed pay weeks.",
        });
      }
    }

    /* ---------- Last closed week: how well the schedule predicted it ---------- */
    // Measured on the time clock, so it holds even before payroll is saved.
    if (storeFocus === "all" && last && last.scheduledHours > 0 && last.clockHours > 0) {
      const diff = last.clockHours - last.scheduledHours;
      const share = diff / last.scheduledHours;
      if (Math.abs(share) >= 0.05) {
        out.push({
          key: "schedule-accuracy",
          tone: "watch",
          kicker: "Last week",
          title: `Stores worked ${pct(share)} ${diff > 0 ? "more" : "less"} than was scheduled`,
          metric: `${diff > 0 ? "+" : "−"}${fmtHoursLabel(Math.abs(diff))}`,
          body: `${fmtHours(last.clockHours)} h on the time clock against ${fmtHours(
            last.scheduledHours,
          )} h scheduled. A schedule that matches what happens makes the plan and the projection worth trusting.`,
          basis: `Time-clock hours against scheduled hours, ${fmtWeekRange(new Date(last.weekStart))}.`,
          action: { label: "Open the schedule", href: "/schedule-import" },
        });
      } else {
        out.push({
          key: "schedule-accuracy",
          tone: "good",
          kicker: "Last week",
          title: "The schedule matched what was worked",
          body: `${fmtHours(last.clockHours)} h on the time clock against ${fmtHours(last.scheduledHours)} h scheduled — within 5%.`,
          basis: "Time-clock hours against scheduled hours, last closed week.",
        });
      }
    }

    /* ---------- Things that block clean payroll ---------- */
    const unsavedWeeks = items.filter((i) => i.kind === "unsaved_payroll");
    if (unsavedWeeks.length > 0) {
      out.push({
        key: "unsaved-payroll",
        tone: "act",
        kicker: "Payroll",
        title: `${unsavedWeeks.length} closed pay week${unsavedWeeks.length === 1 ? " has" : "s have"} hours that aren't saved`,
        body: list(
          unsavedWeeks.map((i) =>
            i.storeLocation && i.weekStart
              ? `${short(i.storeLocation)} · ${fmtWeekRange(new Date(i.weekStart))}`
              : i.title,
          ),
          4,
        ),
        basis: `Closed weeks where people have time-clock hours and no saved payroll entry.${
          lastIncomplete
            ? " Until last week is saved, its totals are short, so week-on-week comparisons are left out below."
            : ""
        }`,
        action: { label: "Open Autopilot", onClick: onOpenAutopilot },
      });
    }
    const silent = feeds.filter(
      (f) => !f.lastPunchAt || now - new Date(f.lastPunchAt).getTime() > 24 * 3_600_000,
    );
    if (cfoQ.data && silent.length > 0) {
      out.push({
        key: "silent-clocks",
        tone: "act",
        kicker: "Time clock",
        title: `${silent.length} store time clock${silent.length === 1 ? " has" : "s have"} sent nothing for over a day`,
        body: `${list(silent.map((f) => short(f.store)))}. Until punches arrive, that store's hours and labor read as zero everywhere on the site.`,
        basis: "The newest punch seen from each store in the last five weeks.",
        action: { label: "Open the time clock", href: "/clock", newTab: true },
      });
    } else if (cfoQ.data && feeds.length > 0) {
      out.push({
        key: "silent-clocks",
        tone: "good",
        kicker: "Time clock",
        title: `${feeds.length === 1 ? "The time clock is" : `All ${feeds.length} time clocks are`} reporting`,
        body: "Every store has sent punches in the last day.",
        basis: "The newest punch seen from each store.",
      });
    }
    if (cfoQ.data && unstaffed.length > 0) {
      out.push({
        key: "unstaffed-stores",
        tone: "watch",
        kicker: "Setup",
        title: `${list(unstaffed.map((f) => short(f.store)))} ${unstaffed.length === 1 ? "has" : "have"} no team yet`,
        body: "The store exists and its manager can sign in, but nobody is on its team, so there is nothing to schedule, clock or pay there.",
        basis: "Stores with no active employees.",
        action: { label: "Add its people", href: "/employees" },
      });
    }
    const missingCodes = summaryQ.data?.missingClockCodes ?? 0;
    if (missingCodes > 0) {
      out.push({
        key: "missing-codes",
        tone: "watch",
        kicker: "Time clock",
        title: `${missingCodes} ${missingCodes === 1 ? "person has" : "people have"} no clock code`,
        body: "They can't clock in, so their hours have to be typed in by hand — slower, and easier to get wrong.",
        basis: "Active employees without a 4-digit time-clock code.",
        action: { label: "Set codes", href: "/employees" },
      });
    }
    const noSchedule = items.filter((i) => i.kind === "missing_schedule");
    if (noSchedule.length > 0) {
      out.push({
        key: "missing-schedule",
        tone: "watch",
        kicker: "Schedule",
        title: `${noSchedule.length} store${noSchedule.length === 1 ? " has" : "s have"} no schedule this week`,
        body: `${list(noSchedule.map((i) => (i.storeLocation ? short(i.storeLocation) : i.title)))}. Without one there is no plan to measure hours or cost against.`,
        basis: "Stores with no shifts imported for the pay week in progress.",
        action: { label: "Import a schedule", href: "/schedule-import" },
      });
    }

    out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

    /* ---------- The two comparison charts ---------- */
    const byStore = ceoQ.data?.byStore ?? {};
    const hvs = Object.entries(byStore)
      .filter(([s]) => inFocus(s))
      .map(([s, v]) => ({ store: s, hours: v.totalClockHours, scheduled: v.totalScheduled }))
      // A store with nothing clocked and nothing scheduled has no bar to draw.
      .filter((v) => v.hours > 0 || v.scheduled > 0)
      .sort((a, b) => storeIndex(a.store) - storeIndex(b.store));

    return {
      findings: out,
      costPerHour: {
        rows: cph.filter((c) => inFocus(c.store)),
        company: companyCph,
        week: last?.weekStart,
        // Stores with clocked hours that week but nothing saved yet.
        partial: lastIncomplete,
      },
      hoursVsSchedule: hvs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceoQ.data, summaryQ.data, cfoQ.data, attentionQ.data, storeFocus, longShiftHours]);

  const count = (t: Tone) => findings.filter((f) => f.tone === t).length;
  const acting = findings.filter((f) => f.tone !== "good");
  const healthy = findings.filter((f) => f.tone === "good");

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-lg" />
        <div className="cc-cols">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    );
  }

  const maxCph = Math.max(costPerHour.company, ...costPerHour.rows.map((r) => r.value), 1);
  const maxHours = Math.max(1, ...hoursVsSchedule.map((r) => Math.max(r.hours, r.scheduled)));

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* The scan result */}
      <HudPanel
        title="Scan"
        meta={storeFocus === "all" ? "all stores" : short(storeFocus)}
        actions={
          <span className="hud-chip">
            <Led tone={count("act") > 0 ? "bad" : count("watch") > 0 ? "warn" : "ok"} />
            {count("act") > 0 ? "Action needed" : count("watch") > 0 ? "Worth a look" : "All clear"}
          </span>
        }
      >
        <div className="grid grid-cols-3 divide-x divide-[var(--hud-line)]">
          <ScanCount label="Act on" value={count("act")} color="var(--brand-red)" />
          <ScanCount label="Watch" value={count("watch")} color="var(--warning)" />
          <ScanCount label="Healthy" value={count("good")} color="var(--success)" />
        </div>
      </HudPanel>

      {acting.length > 0 ? (
        <div className="cc-cols">
          {acting.map((f, i) => (
            <FindingCard key={f.key} finding={f} index={i + 1} />
          ))}
        </div>
      ) : (
        <div className="callout-good flex items-center gap-3 px-4 py-3">
          <span className="icon-badge" aria-hidden="true">
            <CheckCircle2 />
          </span>
          <p className="text-sm">
            <span className="callout-title font-semibold">Nothing to act on.</span>{" "}
            <span className="text-muted-foreground">Every check below came back healthy.</span>
          </p>
        </div>
      )}

      <div className="cc-cols">
        {costPerHour.rows.length > 0 ? (
          <HudPanel
            title="Cost per worked hour"
            meta={costPerHour.week ? `last closed week · ${fmtWeekRange(new Date(costPerHour.week))}` : undefined}
          >
            <ul className="space-y-3 p-4 sm:p-5">
              {costPerHour.rows.map((r) => (
                <li key={r.store} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.75rem] items-center gap-3">
                  <span className="truncate text-sm font-medium" title={r.store}>
                    {short(r.store)}
                  </span>
                  <span className="relative block">
                    <span className="hud-meter block" style={{ ["--meter" as string]: storeColor(r.store) }}>
                      <i style={{ width: `${(r.value / maxCph) * 100}%` }} />
                    </span>
                    {/* The company average, as a tick every bar is read against. */}
                    <span
                      className="absolute -top-1 h-[calc(100%+0.5rem)] w-px"
                      style={{ left: `${(costPerHour.company / maxCph) * 100}%`, background: "var(--hud-line-strong)" }}
                      aria-hidden
                    />
                  </span>
                  <span className="mono text-right text-sm tabular-nums">{fmtMoney(r.value)}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-[var(--hud-line)] px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
              The line is the company average, {fmtMoney(costPerHour.company)} per hour.
              {costPerHour.partial
                ? " Saved payroll only — a store that hasn't saved that week yet isn't shown."
                : ""}
            </p>
          </HudPanel>
        ) : null}

        {hoursVsSchedule.length > 0 ? (
          <HudPanel title="Hours against the schedule" meta={`this week · ${fmtWeekRange(live)}`}>
            <ul className="space-y-3 p-4 sm:p-5">
              {hoursVsSchedule.map((r) => {
                const over = r.scheduled > 0 && r.hours > r.scheduled;
                return (
                  <li key={r.store} className="grid grid-cols-[4.5rem_minmax(0,1fr)_7.5rem] items-center gap-3">
                    <span className="truncate text-sm font-medium" title={r.store}>
                      {short(r.store)}
                    </span>
                    <span className="relative block">
                      <span
                        className="hud-meter block"
                        style={{ ["--meter" as string]: over ? "var(--warning)" : storeColor(r.store) }}
                      >
                        <i style={{ width: `${(r.hours / maxHours) * 100}%` }} />
                      </span>
                      {r.scheduled > 0 ? (
                        <span
                          className="absolute -top-1 h-[calc(100%+0.5rem)] w-px"
                          style={{ left: `${(r.scheduled / maxHours) * 100}%`, background: "var(--hud-line-strong)" }}
                          aria-hidden
                        />
                      ) : null}
                    </span>
                    <span className="mono text-right text-xs tabular-nums text-muted-foreground">
                      <span className={cn("text-sm text-foreground", over && "text-[var(--warn-fg)]")}>
                        {fmtHours(r.hours)}
                      </span>{" "}
                      / {fmtHours(r.scheduled)} h
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-[var(--hud-line)] px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
              The line on each bar is that store&apos;s scheduled hours for the whole week.
            </p>
          </HudPanel>
        ) : null}
      </div>

      {healthy.length > 0 ? (
        <HudPanel title="Healthy" meta={`${healthy.length} check${healthy.length === 1 ? "" : "s"} passed`}>
          <ul className="divide-y divide-[var(--hud-line)]">
            {healthy.map((f) => (
              <li key={f.key} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok-fg)]" aria-hidden />
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{f.title}.</span>{" "}
                  <span className="text-muted-foreground">{f.body}</span>
                </p>
              </li>
            ))}
          </ul>
        </HudPanel>
      ) : null}
    </div>
  );
}

function ScanCount({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5 sm:px-5">
      <span className="hud-label flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </span>
      <span className="hud-value">{value}</span>
    </div>
  );
}

function FindingCard({ finding: f, index }: { finding: Finding; index: number }) {
  const act = f.tone === "act";
  const Icon = act ? AlertTriangle : Eye;
  const actionBody = f.action ? (
    <>
      {f.action.label}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </>
  ) : null;
  return (
    <article className="hud hud-rise flex flex-col">
      <header className="hud-head">
        <span className="hud-title">
          {String(index).padStart(2, "0")} · {f.kicker}
        </span>
        <span className={cn("ml-auto", act ? "chip-bad" : "chip-warn")}>
          <Icon className="h-3 w-3" aria-hidden />
          {act ? "Act" : "Watch"}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        {f.metric ? <p className="hud-value">{f.metric}</p> : null}
        <h3 className="text-[15px] font-semibold leading-snug">{f.title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
        <p className="mt-auto border-t border-dashed border-[var(--hud-line)] pt-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="mono mr-1.5 uppercase tracking-wider text-[10px]">How</span>
          {f.basis}
        </p>
        {f.action ? (
          <div className="pt-1">
            {f.action.onClick ? (
              <Button size="sm" variant="tint" className="h-9" onClick={f.action.onClick}>
                {actionBody}
              </Button>
            ) : f.action.newTab ? (
              <Button size="sm" variant="tint" className="h-9" asChild>
                <a href={f.action.href} target="_blank" rel="noopener noreferrer">
                  {actionBody}
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="tint" className="h-9" asChild>
                <Link href={f.action.href!}>{actionBody}</Link>
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
