/**
 * Autopilot — payroll for every store, run from one place.
 *
 * For the pay week on screen it sorts every person into one of three lanes:
 *
 *   SAVED  — already on payroll.
 *   READY  — hours came straight from the time clock (or a standing set pay)
 *            and nothing about them is waiting on a person. One button saves
 *            all of these, across every store.
 *   HOLD   — something the site itself has flagged for a human: a shift that
 *            ran past the long-shift limit, a clock-out the system had to
 *            make, hours that don't match the schedule, or a value that
 *            can't be saved as it stands. Each one says why and offers its
 *            fix, or can be approved as it is.
 *
 * It never invents a number. Rows are built by the same functions as the
 * weekly timesheet (lib/payrollRow) and saved with the same request, so the
 * autopilot can only save what the timesheet would have saved for a row
 * nobody touched. "Flagged" is exactly the open items of the attention list
 * for that person and week — the site's one definition of "needs a person".
 */
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InitialsBadge } from "@/components/InitialsBadge";
import { ShareDialog, sharePayload, type SharePayload } from "@/components/SharePayroll";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import {
  STORE_ABBR,
  fmtHours,
  fmtHoursLabel,
  fmtMoney,
  fmtWeekRange,
  storeColor,
  storeIndex,
} from "@/lib/format";
import { freshView, saveInputFor, type FreshView } from "@/lib/payrollRow";
import { buildWeekSheet, type WeekSheetRow } from "@/lib/payrollSheet";
import {
  currentPayPeriodStart,
  fromDateInput,
  inProgressPayWeekStart,
  payWeekBounds,
  startOfPayWeek,
  storeDayKey,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { buildXlsx, exportXlsx, prefetchXlsx } from "@/lib/xlsx";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Check,
  FileSpreadsheet,
  Loader2,
  Rocket,
  RotateCw,
  Share,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { CountMoney, CountNumber, HudPanel, Led } from "./hud";

type Flag = {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
};

type Lane = "saved" | "ready" | "hold" | "empty";

type Row = FreshView & {
  lane: Lane;
  store: string;
  flags: Flag[];
  /** Why the row can't be saved as it stands (a missing rate, bad hours). */
  blocker: string | null;
};

const FLAG_KINDS = new Set(["long_punch", "auto_clockout", "hours_mismatch"]);
const FLAG_WORD: Record<string, string> = {
  long_punch: "Long shift",
  auto_clockout: "Auto clock-out",
  hours_mismatch: "Hours vs schedule",
};

/**
 * A row's dollars: for a row already on payroll, exactly the amount that was
 * saved; otherwise what saving it now would write. (For anything this site
 * saved the two are the same number — this keeps the console tied to the
 * stored payroll even for a row that was changed some other way.)
 */
const payOf = (r: Row) =>
  r.lane === "saved" && r.row.entry ? Number(r.row.entry.grossPay) : r.calc.gross;

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const rowsWord = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;

export function Autopilot({
  weekStart,
  storeFocus,
  soFar,
  children,
}: {
  weekStart: Date;
  /** "all" or one store — the command center's focus. */
  storeFocus: string;
  /**
   * For a week still running: the "so far" dollars, total and per store,
   * worked out by the page from the very rows the ledger below shows — so
   * the figures up here and the ledger's totals are one set of numbers.
   */
  soFar?: { total: number; byStore: Map<string, number> } | null;
  /** The saved-payroll ledger, shown under the lanes. */
  children?: ReactNode;
}) {
  const utils = trpc.useUtils();
  const weekQ = trpc.payroll.week.useQuery({ weekStart });
  const clockQ = trpc.clock.weekHoursBulk.useQuery({ weekStart });
  const attentionQ = trpc.attention.list.useQuery(undefined, { refetchInterval: 60_000 });
  const saveM = trpc.payroll.saveHours.useMutation();
  const resolveM = trpc.attention.resolve.useMutation();

  const range = fmtWeekRange(weekStart);
  const weekIso = toDateInput(weekStart);
  const liveWeek = weekStart.getTime() >= inProgressPayWeekStart().getTime();
  const olderWeek = weekStart.getTime() < currentPayPeriodStart().getTime();
  const ready = weekQ.isSuccess && clockQ.isSuccess;
  const failed = (weekQ.isError && !weekQ.data) || (clockQ.isError && !clockQ.data);

  /** Open flags per person for THIS week. */
  const flagsByEmp = useMemo(() => {
    const m = new Map<number, Flag[]>();
    for (const item of attentionQ.data?.items ?? []) {
      if (!FLAG_KINDS.has(item.kind) || item.employeeId == null) continue;
      // Which pay week the item belongs to: its own week, or — for a shift —
      // the week that shift started in.
      const week = item.weekStart
        ? toDateInput(new Date(item.weekStart))
        : item.punchClockInAt
          ? toDateInput(startOfPayWeek(fromDateInput(storeDayKey(item.punchClockInAt))))
          : null;
      if (week !== weekIso) continue;
      const list = m.get(item.employeeId) ?? [];
      list.push({ id: item.id, kind: item.kind, title: item.title, detail: item.detail });
      m.set(item.employeeId, list);
    }
    return m;
  }, [attentionQ.data, weekIso]);

  const rows: Row[] = useMemo(() => {
    const clock = new Map<number, number>();
    for (const e of clockQ.data?.entries ?? []) clock.set(e.employeeId, e.hours);
    return (weekQ.data?.employees ?? [])
      .map((r) => {
        const v = freshView(r, clock.get(r.employee.id));
        const flags = flagsByEmp.get(v.id) ?? [];
        const built = saveInputFor({
          employeeId: v.id,
          weekStart,
          scheduled: v.scheduled,
          calc: v.calc,
          rateChanged: false,
          olderWeek,
        });
        const blocker = built.ok ? null : built.message;
        const lane: Lane = v.isSaved
          ? "saved"
          : !v.hasWork
            ? "empty"
            : flags.length > 0 || blocker
              ? "hold"
              : "ready";
        return { ...v, lane, store: r.employee.storeLocation, flags, blocker };
      })
      .filter((r) => storeFocus === "all" || r.store === storeFocus)
      .sort(
        (a, b) => storeIndex(a.store) - storeIndex(b.store) || a.name.localeCompare(b.name),
      );
  }, [weekQ.data, clockQ.data, flagsByEmp, weekStart, olderWeek, storeFocus]);

  const lane = (l: Lane) => rows.filter((r) => r.lane === l);
  const savedRows = lane("saved");
  const readyRows = lane("ready");
  const holdRows = lane("hold");
  const payable = savedRows.length + readyRows.length + holdRows.length;
  const sum = (list: Row[]) => list.reduce((t, r) => t + payOf(r), 0);
  // While the week is still running the figures on screen are "so far":
  // someone on set pay counts at their weekly amount for the share of the
  // week gone by — the same rule as the Live tab and the ledger below, so
  // all three show one number. (Saving, and the export, always use the full
  // amount: that is what payroll will be.)
  const elapsed = useMemo(() => {
    if (!liveWeek) return 1;
    const { start, end } = payWeekBounds(weekStart);
    return Math.min(1, Math.max(0, (Date.now() - start.getTime()) / (end.getTime() - start.getTime())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveWeek, weekStart, weekQ.dataUpdatedAt, clockQ.dataUpdatedAt]);
  const shownPay = (r: Row) =>
    liveWeek && r.lane !== "saved" && r.calc.isFixed ? payOf(r) * elapsed : payOf(r);
  const shownSum = (list: Row[]) => list.reduce((t, r) => t + shownPay(r), 0);
  const live = liveWeek && soFar ? soFar : null;
  const grossAll = live
    ? live.total
    : shownSum(savedRows) + shownSum(readyRows) + shownSum(holdRows);
  const hoursAll = [...savedRows, ...readyRows, ...holdRows].reduce(
    (t, r) => t + r.calc.hoursOk,
    0,
  );
  const scheduledAll = rows.reduce((t, r) => t + r.scheduled, 0);
  const pct = payable > 0 ? savedRows.length / payable : 0;
  const complete = ready && payable > 0 && savedRows.length === payable;

  const byStore = useMemo(() => {
    const m = new Map<string, { saved: number; ready: number; hold: number; gross: number }>();
    for (const r of rows) {
      if (r.lane === "empty") continue;
      const cur = m.get(r.store) ?? { saved: 0, ready: 0, hold: 0, gross: 0 };
      cur[r.lane] += 1;
      cur.gross += shownPay(r);
      m.set(r.store, cur);
    }
    return Array.from(m.entries()).sort(([a], [b]) => storeIndex(a) - storeIndex(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, elapsed, liveWeek]);

  /* ------------------------------- saving ------------------------------- */

  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const refreshAll = () => {
    utils.payroll.week.invalidate();
    utils.payroll.range.invalidate();
    utils.employees.list.invalidate();
    utils.dashboard.summary.invalidate();
    utils.dashboard.trend.invalidate();
    utils.attention.list.invalidate();
    utils.ceo.weekly.invalidate();
    utils.cfo.summary.invalidate();
  };

  const saveOne = async (r: Row) => {
    const built = saveInputFor({
      employeeId: r.id,
      weekStart,
      scheduled: r.scheduled,
      calc: r.calc,
      rateChanged: false,
      olderWeek,
    });
    if (!built.ok) throw new Error(built.message);
    await saveM.mutateAsync(built.input);
  };

  const approveReady = async () => {
    const targets = readyRows;
    if (targets.length === 0 || run) return;
    const problems: string[] = [];
    let saved = 0;
    setRun({ done: 0, total: targets.length });
    for (const r of targets) {
      try {
        await saveOne(r);
        saved++;
      } catch (err) {
        problems.push(`${r.name}: ${errorMessage(err)}`);
      }
      setRun({ done: saved + problems.length, total: targets.length });
    }
    setRun(null);
    refreshAll();
    if (problems.length > 0) {
      toast.error(
        `${rowsWord(saved)} saved. ${problems.length} could not be saved.`,
        { description: problems.slice(0, 3).join(" · ") },
      );
    } else {
      toast.success(`${rowsWord(saved)} saved to payroll for ${range}.`);
    }
  };

  const approveAsIs = async (r: Row) => {
    setBusyRow(r.id);
    try {
      await saveOne(r);
      refreshAll();
      toast.success(`${r.name} saved to payroll.`, {
        description:
          r.flags.length > 0 ? "Its flag stays open until it is signed off." : undefined,
      });
    } catch (err) {
      toast.error(`${r.name}: ${errorMessage(err)}`);
    } finally {
      setBusyRow(null);
    }
  };

  const markReviewed = async (r: Row, flag: Flag) => {
    setBusyRow(r.id);
    try {
      await resolveM.mutateAsync({ id: flag.id, resolution: "reviewed" });
      utils.attention.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Marked reviewed.", { description: `${r.name} is ready to approve.` });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyRow(null);
    }
  };

  /* --------------------------- export and share --------------------------- */

  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareDialog, setShareDialog] = useState<SharePayload | null>(null);

  const weekFile = () => {
    const status = (r: Row) =>
      r.lane === "saved" ? "Saved" : r.lane === "empty" ? "No hours" : "Not saved";
    const sheetRows: WeekSheetRow[] = rows.map((r) => ({
      employee: r.former ? `${r.name} (former)` : r.name,
      store: r.store,
      role: r.row.employee.role,
      payType: r.calc.isFixed ? "Set pay" : "Hourly",
      rate: r.calc.rateOk,
      scheduled: r.scheduled,
      hours: r.calc.hoursOk,
      gross: payOf(r),
      status: status(r),
    }));
    return buildWeekSheet({
      weekStart,
      scopeStore: storeFocus === "all" ? null : storeFocus,
      rows: sheetRows,
      totals: {
        scheduled: scheduledAll,
        hours: rows.reduce((t, r) => t + r.calc.hoursOk, 0),
        gross: rows.reduce((t, r) => t + payOf(r), 0),
      },
    });
  };
  const buildFailed = (err: unknown) => {
    console.error("[Export] failed:", err);
    toast.error("Couldn't build the spreadsheet. Refresh the page and try again.");
  };
  const onExport = async () => {
    const { filename, sheet } = weekFile();
    setExporting(true);
    try {
      await exportXlsx(filename, sheet);
      toast.success("Spreadsheet downloaded.", { description: filename });
    } catch (err) {
      buildFailed(err);
    } finally {
      setExporting(false);
    }
  };
  const onShare = async () => {
    const { filename, sheet, title, text } = weekFile();
    setSharing(true);
    try {
      const payload: SharePayload = { filename, blob: await buildXlsx(sheet), title, text };
      const result = await sharePayload(payload);
      if (result === "shared") toast.success("Payroll shared.");
      else if (result === "dialog") setShareDialog(payload);
    } catch (err) {
      buildFailed(err);
    } finally {
      setSharing(false);
    }
  };
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(prefetchXlsx, 1500);
    return () => window.clearTimeout(t);
  }, [ready]);

  /* -------------------------------- render -------------------------------- */

  const timesheetHref = `/payroll?week=${weekIso}`;
  const R = 54;
  const ringLen = 2 * Math.PI * R;

  const headline = !ready
    ? "Reading the time clocks…"
    : payable === 0
      ? `Nobody has hours for ${range}.`
      : complete
        ? `Payroll for ${range} is complete.`
        : liveWeek
          ? "This week is still running. Autopilot engages once it closes on Wednesday night."
          : readyRows.length > 0
            ? `${rowsWord(readyRows.length)} ${readyRows.length === 1 ? "is" : "are"} clean and ready to approve.`
            : `${rowsWord(holdRows.length)} ${holdRows.length === 1 ? "is" : "are"} waiting on a decision.`;

  return (
    <div className="space-y-4 sm:space-y-5">
      <HudPanel
        title="Autopilot"
        meta={`Pay week ${range}${storeFocus === "all" ? " · all stores" : ` · ${STORE_ABBR[storeFocus] ?? storeFocus}`}`}
        actions={
          <span className="hud-chip">
            <Led
              tone={failed ? "bad" : complete ? "ok" : liveWeek ? "off" : holdRows.length > 0 ? "warn" : "ok"}
              pulse={!!run}
            />
            {failed
              ? "Offline"
              : run
                ? "Saving"
                : complete
                  ? "Complete"
                  : liveWeek
                    ? "Standby"
                    : readyRows.length > 0
                      ? "Ready"
                      : holdRows.length > 0
                        ? "Holding"
                        : "Idle"}
          </span>
        }
      >
        {failed ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <AlertTriangle className="h-6 w-6 text-warning" aria-hidden />
            <p className="text-sm font-medium">Couldn&apos;t load this pay week.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                weekQ.refetch();
                clockQ.refetch();
              }}
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : (
          <div className="cc-hero p-4 sm:p-5">
            {/* How much of the week is on payroll */}
            <div className="flex items-center gap-5">
              <svg viewBox="0 0 128 128" className="h-28 w-28 shrink-0 sm:h-32 sm:w-32" aria-hidden="true">
                <circle
                  cx="64"
                  cy="64"
                  r={R}
                  fill="none"
                  strokeWidth="9"
                  stroke="color-mix(in oklab, var(--foreground) 9%, transparent)"
                />
                <circle
                  cx="64"
                  cy="64"
                  r={R}
                  fill="none"
                  strokeWidth="9"
                  strokeLinecap="round"
                  stroke={complete ? "var(--success)" : "var(--hud-accent)"}
                  strokeDasharray={ringLen}
                  strokeDashoffset={ringLen * (1 - pct)}
                  transform="rotate(-90 64 64)"
                  style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.23, 1, 0.32, 1)" }}
                />
                <text
                  x="64"
                  y="62"
                  textAnchor="middle"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 26,
                    fontWeight: 500,
                    letterSpacing: "-0.04em",
                    fill: "var(--foreground)",
                  }}
                >
                  {Math.round(pct * 100)}%
                </text>
                <text
                  x="64"
                  y="80"
                  textAnchor="middle"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    fill: "var(--muted-foreground)",
                  }}
                >
                  SAVED
                </text>
              </svg>
              <div className="min-w-0">
                <p className="hud-label">{liveWeek ? "So far this week" : "Payroll for the week"}</p>
                <p className="hud-value hud-value-lg mt-1">
                  {ready ? <CountMoney value={grossAll} cents /> : "—"}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {ready
                    ? `${people(payable)} · ${fmtHoursLabel(hoursAll, 2)}${
                        scheduledAll > 0 ? ` · ${fmtHoursLabel(scheduledAll)} scheduled` : ""
                      }`
                    : " "}
                </p>
                {/* Partly saved: say how much is on payroll and how much is still to come. */}
                {ready && !liveWeek && !complete && payable > 0 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="text-foreground">{fmtMoney(sum(savedRows))}</span> saved ·{" "}
                    <span className="text-foreground">
                      {fmtMoney(sum(readyRows) + sum(holdRows))}
                    </span>{" "}
                    still to save
                  </p>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              {/* The three lanes */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {/* Nothing is "ready" until the week closes; until then rows are
                    simply clean so far, or flagged. */}
                <LaneCount
                  label={liveWeek ? "Clean" : "Ready"}
                  value={readyRows.length}
                  tone="accent"
                  loading={!ready}
                />
                <LaneCount
                  label={liveWeek ? "Flagged" : "On hold"}
                  value={holdRows.length}
                  tone="warn"
                  loading={!ready}
                />
                <LaneCount label="Saved" value={savedRows.length} tone="ok" loading={!ready} />
              </div>

              <p className="text-sm leading-relaxed" role="status">
                {headline}
              </p>

              {run ? (
                <div>
                  <div className="hud-meter" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done}>
                    <i style={{ width: `${(run.done / run.total) * 100}%` }} />
                  </div>
                  <p className="mono mt-1.5 text-[11px] text-muted-foreground">
                    Saving {run.done} of {run.total}…
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {!liveWeek && readyRows.length > 0 ? (
                    <ConfirmDialog
                      destructive={false}
                      title={`Approve ${rowsWord(readyRows.length)}?`}
                      description={
                        <>
                          <span className="block">
                            {people(readyRows.length)} · {fmtMoney(sum(readyRows))} for {range}. Their
                            hours come straight from the time clock (or their set pay) and nothing
                            about them is flagged.
                          </span>
                          {holdRows.length > 0 ? (
                            <span className="mt-1.5 block">
                              The {rowsWord(holdRows.length)} on hold {holdRows.length === 1 ? "is" : "are"} not
                              touched.
                            </span>
                          ) : null}
                        </>
                      }
                      confirmLabel={`Approve ${readyRows.length}`}
                      onConfirm={() => void approveReady()}
                      trigger={
                        <Button className="h-10">
                          <Rocket className="h-4 w-4" aria-hidden /> Approve {rowsWord(readyRows.length)}
                        </Button>
                      }
                    />
                  ) : null}
                  <Button variant="outline" className="h-10" asChild>
                    <Link href={timesheetHref}>
                      Open the timesheet <ArrowUpRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => void onShare()}
                    disabled={!ready || payable === 0 || sharing}
                  >
                    {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share className="h-4 w-4" />}
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => void onExport()}
                    disabled={!ready || payable === 0 || exporting}
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4" />
                    )}
                    Export
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </HudPanel>

      {/* Every store's pipeline */}
      {ready && byStore.length > 0 ? (
        <HudPanel
          title="Pipeline"
          meta={liveWeek ? "saved · clean · flagged, by store" : "saved · ready · on hold, by store"}
        >
          <ul className="divide-y divide-[var(--hud-line)]">
            {byStore.map(([store, s]) => {
              const total = s.saved + s.ready + s.hold;
              const seg = (n: number) => `${(n / total) * 100}%`;
              return (
                <li
                  key={store}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto_7rem] sm:px-5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: storeColor(store) }}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium" title={store}>
                      {STORE_ABBR[store] ?? store}
                    </span>
                  </span>
                  <span className="mono text-right text-sm tabular-nums sm:order-last">
                    {fmtMoney(live ? (live.byStore.get(store) ?? 0) : s.gross)}
                  </span>
                  <span
                    className="col-span-2 flex h-2 overflow-hidden rounded-full sm:col-span-1"
                    style={{ background: "color-mix(in oklab, var(--foreground) 9%, transparent)" }}
                    role="img"
                    aria-label={`${s.saved} saved, ${s.ready} ready, ${s.hold} on hold`}
                  >
                    <i className="h-full" style={{ width: seg(s.saved), background: "var(--success)" }} />
                    <i className="h-full" style={{ width: seg(s.ready), background: "var(--hud-accent)" }} />
                    <i className="h-full" style={{ width: seg(s.hold), background: "var(--warning)" }} />
                  </span>
                  <span className="mono col-span-2 text-[11px] text-muted-foreground sm:col-span-1 sm:text-right">
                    {s.saved} saved · {s.ready} {liveWeek ? "clean" : "ready"} · {s.hold}{" "}
                    {liveWeek ? "flagged" : "hold"}
                  </span>
                </li>
              );
            })}
          </ul>
        </HudPanel>
      ) : null}

      {/* What is waiting on a person */}
      {ready && holdRows.length > 0 ? (
        <HudPanel
          title={liveWeek ? "Flagged" : "On hold"}
          meta={
            liveWeek
              ? `${rowsWord(holdRows.length)} to sort out before the week closes`
              : `${rowsWord(holdRows.length)} waiting on a decision`
          }
        >
          <ul className="divide-y divide-[var(--hud-line)]">
            {holdRows.map((r) => {
              const busy = busyRow === r.id;
              const mismatch = r.flags.find((f) => f.kind === "hours_mismatch");
              const punchFlag = r.flags.find((f) => f.kind !== "hours_mismatch");
              return (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <InitialsBadge name={r.name} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                        <Link href={`/employees/${r.id}`} className="hover:underline underline-offset-2">
                          {r.name}
                        </Link>
                        <span className="text-xs font-normal text-muted-foreground">
                          {STORE_ABBR[r.store] ?? r.store} · {r.row.employee.role}
                        </span>
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {r.flags.map((f) => (
                          <li key={f.id} className="text-[13px] leading-snug text-muted-foreground">
                            <span className="chip-warn mr-1.5 align-middle">
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                              {FLAG_WORD[f.kind] ?? "Check"}
                            </span>
                            {f.detail ?? f.title}
                          </li>
                        ))}
                        {r.blocker ? (
                          <li className="text-[13px] leading-snug text-muted-foreground">
                            <span className="chip-bad mr-1.5 align-middle">Can&apos;t save yet</span>
                            {r.blocker}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  </div>
                  <div className="mono shrink-0 text-right text-sm tabular-nums sm:w-28">
                    <span className="block font-medium">{fmtMoney(shownPay(r))}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {r.calc.isFixed ? "set pay" : `${fmtHours(r.calc.hoursOk, 2)} h`}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:w-[17.5rem] sm:justify-end">
                    {mismatch ? (
                      <ConfirmDialog
                        destructive={false}
                        disabled={busy}
                        title="Mark this as reviewed?"
                        description={
                          <>
                            <span className="block font-medium text-foreground">{mismatch.title}</span>
                            <span className="mt-1.5 block">
                              Do this once the hours have been checked against the schedule. It
                              clears the flag and doesn&apos;t change any hours or pay; the row then
                              moves to Ready.
                            </span>
                          </>
                        }
                        confirmLabel="Mark reviewed"
                        onConfirm={() => void markReviewed(r, mismatch)}
                        trigger={
                          <Button size="sm" variant="tint" className="h-9">
                            <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Mark reviewed
                          </Button>
                        }
                      />
                    ) : null}
                    {punchFlag || r.blocker ? (
                      <Button size="sm" variant="tint" className="h-9" asChild>
                        <Link
                          href={
                            punchFlag
                              ? `/payroll?tab=punches&week=${weekIso}&who=${r.id}`
                              : timesheetHref
                          }
                        >
                          {punchFlag ? "Fix the punch" : "Open the timesheet"}
                        </Link>
                      </Button>
                    ) : null}
                    {!r.blocker && !liveWeek ? (
                      <ConfirmDialog
                        destructive={false}
                        disabled={busy}
                        title={`Approve ${r.name} as it is?`}
                        description={`${
                          r.calc.isFixed ? "Set pay" : fmtHoursLabel(r.calc.hoursOk, 2)
                        } · ${fmtMoney(r.calc.gross)} is saved to payroll for ${range} exactly as shown. The flag stays open until it is signed off.`}
                        confirmLabel="Approve as is"
                        onConfirm={() => void approveAsIs(r)}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-9 text-muted-foreground">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            Approve as is
                          </Button>
                        }
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </HudPanel>
      ) : null}

      {ready && complete ? (
        <div className="callout-good flex items-center gap-3 px-4 py-3">
          <span className="icon-badge" aria-hidden="true">
            <Check />
          </span>
          <p className="text-sm">
            <span className="callout-title font-semibold">Nothing left to do for {range}.</span>{" "}
            <span className="text-muted-foreground">
              {people(payable)} saved · {fmtMoney(grossAll)}. Share or export it above.
            </span>
          </p>
        </div>
      ) : null}

      {!ready && !failed ? <Skeleton className="h-40 rounded-lg" /> : null}

      {children}

      <ShareDialog payload={shareDialog} onOpenChange={(open) => !open && setShareDialog(null)} />
    </div>
  );
}

function LaneCount({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number;
  tone: "accent" | "warn" | "ok";
  loading: boolean;
}) {
  const color =
    tone === "accent" ? "var(--hud-accent)" : tone === "warn" ? "var(--warning)" : "var(--success)";
  return (
    <div
      className={cn("rounded-md border px-3 py-2.5")}
      style={{ borderColor: "var(--hud-line)", background: "color-mix(in oklab, var(--foreground) 2.5%, transparent)" }}
    >
      <p className="hud-label flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </p>
      <p className="hud-value mt-1">{loading ? "—" : <CountNumber value={value} />}</p>
    </div>
  );
}
