/**
 * Stores — every store side by side, the way a CEO compares them.
 *
 * One card per store with the same few facts in the same places: who is
 * there, this week's hours against the schedule and labor so far, how last
 * week's payroll stands, what it cost per hour, and whether its time clock
 * is alive. Each card can focus the whole portal on that store, send its
 * unsaved payroll to Autopilot, or open the store's desk (the manager's own
 * pages) when a manager's task needs doing.
 *
 * Every figure is passed in from the page, which already has it — this
 * board has no math of its own.
 */
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtHours, fmtMoney, fmtWeekRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Crosshair, Store, Users } from "lucide-react";
import { HudPanel, Led } from "./hud";

export type StoreCard = {
  name: string;
  short: string;
  color: string;
  people: number;
  onClock: number;
  alerts: number;
  /** This week so far. */
  clockHours: number;
  scheduled: number;
  labor: number;
  /** Last closed week: what is saved, and how many worked but aren't saved. */
  lastGross: number | null;
  lastSaved: number;
  lastUnsaved: number;
  /** Saved gross ÷ saved hours for the last closed week, or null. */
  costPerHour: number | null;
  lastPunchAt: Date | string | null;
};

/** Whole dollars, for the headline figures. */
const whole = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function ago(at: Date | string | null): { text: string; fresh: boolean } {
  if (!at) return { text: "no punches yet", fresh: false };
  const mins = Math.max(0, (Date.now() - new Date(at).getTime()) / 60_000);
  const fresh = mins <= 24 * 60;
  if (mins < 2) return { text: "a moment ago", fresh };
  if (mins < 60) return { text: `${Math.round(mins)} min ago`, fresh };
  if (mins < 48 * 60) return { text: `${Math.round(mins / 60)} h ago`, fresh };
  return { text: `${Math.round(mins / 1440)} days ago`, fresh };
}

export function StoresBoard({
  stores,
  loading,
  lastWeek,
  lastWeekLoading,
  focus,
  onFocus,
  onDesk,
  onReview,
}: {
  stores: StoreCard[];
  loading: boolean;
  /** Start of the last closed pay week (the one being paid). */
  lastWeek: Date;
  lastWeekLoading: boolean;
  focus: string;
  /** Focus the portal on a store and show it live. */
  onFocus: (store: string) => void;
  /** Open the store's desk: the manager's pages for that store. */
  onDesk: (store: string) => void;
  /** Take the store's last week to Autopilot. */
  onReview: (store: string) => void;
}) {
  if (loading) {
    return (
      <div className="cc-cols">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-72 rounded-lg" />
        ))}
      </div>
    );
  }
  const companyCph = (() => {
    const withCost = stores.filter((s) => s.costPerHour !== null);
    return withCost.length ? withCost.reduce((t, s) => t + s.costPerHour!, 0) / withCost.length : null;
  })();

  return (
    <div className="cc-cols">
      {stores.map((s) => {
        const staffed = s.people > 0;
        const over = s.scheduled > 0 && s.clockHours > s.scheduled;
        const pct = s.scheduled > 0 ? Math.min(1, s.clockHours / s.scheduled) : 0;
        const punch = ago(s.lastPunchAt);
        const paid = s.lastSaved + s.lastUnsaved;
        return (
          <HudPanel
            key={s.name}
            title={s.short}
            meta={s.name}
            className={cn(focus === s.name && "ring-1 ring-[var(--hud-accent)]")}
            actions={
              s.alerts > 0 ? (
                <span className="chip-bad">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {s.alerts} {s.alerts === 1 ? "alert" : "alerts"}
                </span>
              ) : staffed ? (
                <span className="chip-good">
                  <CheckCircle2 className="h-3 w-3" aria-hidden /> Clear
                </span>
              ) : null
            }
          >
            <div className="space-y-4 p-4 sm:p-5">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                  <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {staffed ? `${s.people} ${s.people === 1 ? "person" : "people"}` : "No team yet"}
                </span>
                {staffed ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Led tone={s.onClock > 0 ? "ok" : "off"} pulse={s.onClock > 0} />
                    {s.onClock} on the clock now
                  </span>
                ) : null}
              </p>

              {staffed ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="hud-label">This week</p>
                    <p className="hud-value mt-1 text-[1.4rem]">{whole(s.labor)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">labor so far</p>
                    <div className="mt-2.5">
                      <span
                        className="hud-meter block"
                        style={{ ["--meter" as string]: over ? "var(--warning)" : s.color }}
                        aria-hidden
                      >
                        <i style={{ width: `${pct * 100}%` }} />
                      </span>
                      <p className="mono mt-1.5 text-[11px] text-muted-foreground">
                        <span className={cn("text-foreground", over && "text-[var(--warn-fg)]")}>
                          {fmtHours(s.clockHours)}
                        </span>{" "}
                        / {s.scheduled > 0 ? `${fmtHours(s.scheduled)} h scheduled` : "no schedule"}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="hud-label">Last week</p>
                    {lastWeekLoading ? (
                      <Skeleton className="mt-1 h-7 w-24" />
                    ) : (
                      <p className="hud-value mt-1 text-[1.4rem]">
                        {s.lastGross && s.lastGross > 0 ? whole(s.lastGross) : "—"}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      payroll saved · {fmtWeekRange(lastWeek)}
                    </p>
                    <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {lastWeekLoading ? null : s.lastUnsaved > 0 ? (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {s.lastUnsaved} of {paid} not saved
                        </span>
                      ) : paid > 0 ? (
                        <span className="chip-good">
                          <CheckCircle2 className="h-3 w-3" aria-hidden /> All {paid} saved
                        </span>
                      ) : (
                        <span className="text-muted-foreground">nothing to pay</span>
                      )}
                    </p>
                    {s.costPerHour !== null ? (
                      <p className="mono mt-1.5 text-[11px] text-muted-foreground">
                        <span className="text-foreground">{fmtMoney(s.costPerHour)}</span>/h
                        {companyCph !== null && Math.abs(s.costPerHour - companyCph) >= 0.25
                          ? ` · ${s.costPerHour > companyCph ? "+" : "−"}${fmtMoney(
                              Math.abs(s.costPerHour - companyCph),
                            )} vs stores' average`
                          : " · in line with the others"}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The store exists and its manager can sign in. Add its people to start scheduling,
                  clocking and paying here.
                </p>
              )}

              {staffed ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Time clock: last punch {punch.text}
                  {punch.fresh ? null : (
                    <span className="chip-warn">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> silent
                    </span>
                  )}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[var(--hud-line)] pt-3.5">
                {staffed ? (
                  <Button size="sm" variant="tint" className="h-9" onClick={() => onFocus(s.name)}>
                    <Crosshair className="h-3.5 w-3.5" aria-hidden /> See it live
                  </Button>
                ) : null}
                {staffed && s.lastUnsaved > 0 ? (
                  <Button size="sm" variant="tint" className="h-9" onClick={() => onReview(s.name)}>
                    Approve its payroll <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" className="h-9" onClick={() => onDesk(s.name)}>
                  <Store className="h-3.5 w-3.5" aria-hidden /> {staffed ? "Open store desk" : "Add its people"}
                </Button>
                <a
                  href={`/clock/${encodeURIComponent(s.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Open the time clock for ${s.name} in a new tab`}
                  title="Open this store's time clock"
                >
                  <Clock className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </div>
          </HudPanel>
        );
      })}
    </div>
  );
}
