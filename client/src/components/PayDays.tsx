/**
 * Which days a week's payroll pays — the notice, and the calendar to change it.
 *
 * Payroll normally pays Thursday → Wednesday. When it has to go out before
 * the week is over (a holiday, an early deadline), the CEO picks the last day
 * to pay on a calendar. The days after it are paid with NEXT week's payroll,
 * which starts early to take them in, so every hour is paid exactly once.
 *
 * Only the end is picked. A payroll's first day is always the day after the
 * previous payroll's last day: it is shown on the calendar, but locked.
 *
 * Each store can end its own week early. A store's manager changes their own
 * store; the CEO changes the store on screen, or every store at once from an
 * all-stores view (which lines them all up). Everyone sees the notice when a
 * week doesn't pay its normal days; an all-stores view lists any store whose
 * days differ.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/useMobile";
import { errorMessage } from "@/lib/errors";
import {
  STORE_ABBR,
  fmtDayRange,
  fmtDayShort,
  fmtDaySpan,
  fmtWeekRange,
  fmtWeekday,
} from "@/lib/format";
import {
  addDaysMarker,
  localToMarker,
  markerToLocal,
  todayMarker,
  type PayPeriod,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { Store } from "@shared/hotspot";
import { AlertTriangle, CalendarRange, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const plural = (n: number, one: string, many = `${one}s`) =>
  n === 1 ? one : many;
const same = (a: Date, b: Date) => a.getTime() === b.getTime();
const asDate = (d: Date | string) => new Date(d);

/** A run of days as words, and whether it is more than one ("is" / "are"). */
function daySpan(from: Date, to: Date) {
  return { text: fmtDaySpan(from, to), many: !same(from, to) };
}

const abbr = (store: string) => STORE_ABBR[store] ?? store;
const isNormal = (p: PayPeriod) => !p.endsEarly && !p.startsEarly;

/** One store's days in a few words, for the all-stores list. */
function shortDays(weekStart: Date, p: PayPeriod): string {
  const range = `${fmtDayShort(p.firstDay)} – ${fmtDayShort(p.lastDay)}`;
  if (!p.endsEarly) return range;
  const moved = daySpan(addDaysMarker(asDate(p.lastDay), 1), addDaysMarker(weekStart, 6));
  return `${range} (${moved.text} paid next week)`;
}

/** The sentence(s) describing a payroll that doesn't pay its normal week. */
function describe(weekStart: Date, period: PayPeriod) {
  const first = asDate(period.firstDay);
  const last = asDate(period.lastDay);
  const wednesday = addDaysMarker(weekStart, 6);
  const range = `${fmtDayShort(first)} – ${fmtDayShort(last)}`;
  const days = `${period.days} ${plural(period.days, "day")}`;
  const title =
    period.endsEarly && !period.startsEarly
      ? `Ends early: pays ${range} (${days}).`
      : period.startsEarly && !period.endsEarly
        ? `Starts early: pays ${range} (${days}).`
        : `Pays ${range} (${days}).`;
  const lines: string[] = [];
  if (period.startsEarly) {
    const moved = daySpan(first, addDaysMarker(weekStart, -1));
    lines.push(
      `${moved.text} ${moved.many ? "were" : "was"} left off last week's payroll, so ${moved.many ? "they are" : "it is"} paid here.`
    );
  }
  if (period.endsEarly) {
    const moved = daySpan(addDaysMarker(last, 1), wednesday);
    lines.push(
      `${moved.text} ${moved.many ? "are" : "is"} paid with next week's payroll.`
    );
  }
  return { title, body: lines.join(" ") };
}

export function PayDays({
  weekStart,
  period,
  periods,
  scopeStore,
  savedCount,
  className,
}: {
  weekStart: Date;
  /**
   * The days the payroll on screen pays (from payroll.week) — for several
   * stores, the span of them all, `mixed` when they differ. Nothing renders
   * until it is known.
   */
  period: (PayPeriod & { mixed?: boolean }) | null | undefined;
  /** Each store's own days, for listing stores that differ. */
  periods?: { store: string; period: PayPeriod }[] | null;
  /** The one store on screen (a change applies to it), or null for all stores. */
  scopeStore: string | null;
  /** Rows already saved for this week on screen — they were priced with the current days. */
  savedCount: number;
  className?: string;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // A manager changes their own store; the CEO the store on screen or all.
  const canChange = isAdmin || (user?.role === "manager" && scopeStore !== null);
  if (!period) return null;
  const mixed = !!period.mixed && scopeStore === null;
  const normal = !mixed && isNormal(period);
  if (normal && !canChange) return null;

  const picker = canChange ? (
    <DaysPicker
      weekStart={weekStart}
      period={period}
      mixed={mixed}
      scopeStore={scopeStore}
      savedCount={savedCount}
    />
  ) : null;

  if (normal) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-border/70 px-3.5 py-2 text-sm sm:px-4",
          className
        )}
      >
        <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Pays{" "}
            <span className="font-medium text-foreground tabular-nums">
              {fmtDayShort(period.firstDay)} – {fmtDayShort(period.lastDay)}
            </span>
            <span className="hidden sm:inline">
              {" "}
              · the normal Thursday–Wednesday week
            </span>
          </span>
        </p>
        {picker}
      </div>
    );
  }

  // Stores on screen paying different days: say which ones, and how.
  if (mixed) {
    const differ = (periods ?? []).filter((p) => !isNormal(p.period));
    return (
      <div
        role="status"
        className={cn(
          "callout-warn flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          className
        )}
      >
        <p className="flex min-w-0 items-start gap-2 text-sm">
          <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="callout-title font-semibold">
              Stores pay different days this week.
            </span>{" "}
            <span className="text-muted-foreground">
              {differ
                .map((p) => `${abbr(p.store)}: ${shortDays(weekStart, p.period)}`)
                .join(" · ")}
              {differ.length > 0 ? ". " : ""}
              The rest pay {fmtDayShort(weekStart)} – {fmtDayShort(addDaysMarker(weekStart, 6))}.
            </span>
          </span>
        </p>
        {picker}
      </div>
    );
  }

  const { title, body } = describe(weekStart, period);
  // The CEO looking at one store: say which store this is about.
  const who = isAdmin && scopeStore ? `${abbr(scopeStore)} · ` : "";
  return (
    <div
      role="status"
      className={cn(
        "callout-warn flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <span className="callout-title font-semibold">
            {who}
            {title}
          </span>{" "}
          <span className="text-muted-foreground">{body}</span>
        </span>
      </p>
      {picker}
    </div>
  );
}

const PICKER_TITLE = "Days in this payroll";
const PICKER_HINT =
  "Tap the last day to pay. The days after it are paid with next week's payroll.";

/**
 * The CEO's "Change days" button and its calendar: a popover beside the
 * button, or a dialog on a phone (a popover this tall can't fit beside it).
 */
function DaysPicker({
  weekStart,
  period,
  mixed,
  scopeStore,
  savedCount,
}: {
  weekStart: Date;
  period: PayPeriod;
  /** The stores on screen pay different days now (saving lines them up). */
  mixed: boolean;
  /** The one store this changes, or null for every store (CEO). */
  scopeStore: string | null;
  savedCount: number;
}) {
  const utils = trpc.useUtils();
  const setDays = trpc.payroll.setDays.useMutation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const firstDay = asDate(period.firstDay);
  const currentEnd = asDate(period.lastDay);
  const wednesday = addDaysMarker(weekStart, 6);
  const [end, setEnd] = useState<Date>(currentEnd);

  const today = todayMarker();
  const yesterday = addDaysMarker(today, -1);
  // "Leave out today" works when today is one of this week's days and the
  // payroll would still have a day of its own (it can't end before Thursday).
  const canLeaveOutToday =
    today.getTime() > weekStart.getTime() &&
    today.getTime() <= wednesday.getTime();
  // With stores paying different days, saving lines them all up — a change
  // even when the last day picked is the latest one already in use.
  const changed = mixed || !same(end, currentEnd);
  const draftDays =
    Math.round((end.getTime() - firstDay.getTime()) / 86_400_000) + 1;
  const twoMonths = firstDay.getUTCMonth() !== wednesday.getUTCMonth();
  const nextWeek = addDaysMarker(weekStart, 7);
  const leftOff =
    end.getTime() < wednesday.getTime()
      ? daySpan(addDaysMarker(end, 1), wednesday)
      : null;

  /** Open (starting from the days as they are now) or close the picker. */
  const openWith = (next: boolean) => {
    if (next) setEnd(currentEnd);
    setOpen(next);
  };

  const pick = (day: Date | undefined) => {
    if (!day) return;
    const marker = localToMarker(day);
    if (
      marker.getTime() < weekStart.getTime() ||
      marker.getTime() > wednesday.getTime()
    )
      return;
    setEnd(marker);
  };

  const save = async () => {
    try {
      const res = await setDays.mutateAsync({
        weekStart,
        lastDay: same(end, wednesday) ? null : end,
        // Stores are checked against the live list on the server.
        ...(scopeStore ? { store: scopeStore as Store } : {}),
      });
      await Promise.all([
        utils.payroll.week.invalidate(),
        utils.clock.weekHoursBulk.invalidate(),
        utils.ceo.weekly.invalidate(),
      ]);
      setOpen(false);
      const p = res.period;
      const left = daySpan(addDaysMarker(asDate(p.lastDay), 1), wednesday);
      const moved = p.endsEarly
        ? `${left.text} ${left.many ? "move" : "moves"} to next week's payroll.`
        : "Back to the normal Thursday–Wednesday week.";
      const whose = scopeStore === null ? "Every store's payroll" : `${abbr(scopeStore)}'s payroll`;
      toast.success(
        `${whose} now pays ${fmtDayRange(p.firstDay, p.lastDay)}.`,
        {
          description:
            res.savedHere > 0
              ? `${moved} ${res.savedHere} ${plural(res.savedHere, "row was", "rows were")} already saved with the old days — each one now shows the new clock hours beside it; save them again.`
              : moved,
          duration: res.savedHere > 0 ? 12_000 : undefined,
        }
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const trigger = (
    <Button
      variant="outline"
      size="sm"
      className="h-9 shrink-0 bg-card sm:h-8"
      onClick={isMobile ? () => openWith(true) : undefined}
    >
      <CalendarRange className="h-4 w-4" />
      Change days
    </Button>
  );

  const body = (
    <>
      <Calendar
        mode="range"
        selected={{ from: markerToLocal(firstDay), to: markerToLocal(end) }}
        onSelect={(_range, clicked) => pick(clicked)}
        defaultMonth={markerToLocal(firstDay)}
        numberOfMonths={twoMonths ? 2 : 1}
        hideNavigation
        showOutsideDays={false}
        today={markerToLocal(today)}
        disabled={[
          { before: markerToLocal(weekStart) },
          { after: markerToLocal(wednesday) },
        ]}
        modifiers={
          leftOff
            ? {
                moved: {
                  from: markerToLocal(addDaysMarker(end, 1)),
                  to: markerToLocal(wednesday),
                },
              }
            : undefined
        }
        modifiersClassNames={{
          // Days moving to next week's payroll: struck through.
          moved:
            "[&_button]:line-through [&_button]:decoration-2 [&_button]:text-muted-foreground",
        }}
        classNames={{
          // Today gets a ring, not an underline, so a struck-through
          // "today" still reads as moving to next week.
          today:
            "[&_button]:font-bold [&_button]:ring-1 [&_button]:ring-inset [&_button]:ring-foreground/40",
        }}
        className="mx-auto"
      />
      <div className="space-y-2.5 border-t px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {canLeaveOutToday ? (
            <Button
              type="button"
              variant={same(end, yesterday) ? "secondary" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => setEnd(yesterday)}
            >
              Leave out today
            </Button>
          ) : null}
          <Button
            type="button"
            variant={same(end, wednesday) ? "secondary" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setEnd(wednesday)}
          >
            Full week, through {fmtWeekday(wednesday).slice(0, 3)}
          </Button>
        </div>
        <div className="text-xs leading-relaxed" aria-live="polite">
          <p>
            Pays{" "}
            <span className="font-semibold tabular-nums">
              {fmtDayShort(firstDay)} – {fmtDayShort(end)}
            </span>{" "}
            · {draftDays} {plural(draftDays, "day")}
          </p>
          {leftOff ? (
            <p className="text-muted-foreground">
              {leftOff.text} {leftOff.many ? "move" : "moves"} to next
              week&apos;s payroll ({fmtWeekRange(nextWeek)}).
            </p>
          ) : null}
          {end.getTime() >= today.getTime() &&
          today.getTime() >= firstDay.getTime() ? (
            <p className="text-muted-foreground">
              Still counting hours until {fmtWeekday(end)} ends.
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {scopeStore === null
            ? "Applies to every store, replacing any store's own choice for this week."
            : `Applies to ${abbr(scopeStore)} only.`}
        </p>
        {changed && savedCount > 0 ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {savedCount}{" "}
              {plural(savedCount, "person is", "people are")} already saved
              with the current days. Their saved hours stay until you save
              them again.
            </span>
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={() => void save()}
            disabled={!changed || setDays.isPending}
          >
            {setDays.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save days
          </Button>
        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={openWith}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0">
            <DialogHeader className="border-b px-4 pt-4 pb-3 pr-10 text-left">
              <DialogTitle className="text-base">{PICKER_TITLE}</DialogTitle>
              <DialogDescription className="text-xs">
                {PICKER_HINT}
              </DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={openWith}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      >
        <div className="space-y-1 border-b px-4 pt-3 pb-2.5">
          <p className="text-sm font-semibold">{PICKER_TITLE}</p>
          <p className="text-xs text-muted-foreground">{PICKER_HINT}</p>
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}
