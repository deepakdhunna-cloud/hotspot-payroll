/**
 * One-tap punch fixes, usable anywhere a punch appears — plus the store-time
 * date + time field the Punches tab shares.
 *
 * ClockOutDialog — clock somebody out from the website: "now" by default,
 * one tap for "at scheduled end" when the shift's printed end time is
 * already in the past (the forgot-to-clock-out case), or a custom time.
 *
 * FixTimeDialog — adjust a punch's clock-in (and clock-out, when closed)
 * without hunting through the Punches tab.
 *
 * Every time here is STORE time (America/Chicago) — what the kiosk recorded,
 * whatever time zone the viewing device is in. Both dialogs ride the
 * store-scoped, audited `clock.update` procedure; the server refuses future
 * times and overlapping punches, and its message shows inline.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import {
  BUSINESS_TIME_ZONE,
  fmtDuration,
  fmtTime,
  fromStoreInput,
  storeDayKey,
  storeTzLabel,
  toStoreInput,
} from "@/lib/payweek";
import { CalendarClock, Check, Clock, LogOut } from "lucide-react";
import { toast } from "sonner";

export type QuickPunch = {
  id: number;
  employeeName: string;
  clockInAt: string | Date;
  clockOutAt?: string | Date | null;
  /** Printed schedule end for the clock-in day, e.g. "5:00pm" (optional). */
  shiftEndLabel?: string | null;
};

/** How far past "now" a punch time may be (device clock skew) — matches the server. */
export const FUTURE_TOLERANCE_MS = 2 * 60_000;
/** Shifts longer than this get a "double-check the dates" warning. */
export const LONG_SHIFT_HOURS = 16;
/** Amber text dark enough to read on a white card (the raw token is too light). */
export const WARN_TEXT = "text-[color-mix(in_oklab,var(--warning)_68%,black)]";

/* ------------------------------------------------------------------ */
/* Store-time helpers                                                  */
/* ------------------------------------------------------------------ */

/** "Sun, Nov 8" in store time. */
export function fmtShortDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Calendar arithmetic on store-local "YYYY-MM-DD" day strings. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** An instant as store-time form fields: { day: "2026-11-04", time: "21:00" }. */
export function splitStoreTime(d: Date | string): {
  day: string;
  time: string;
} {
  const [day, time] = toStoreInput(d).split("T");
  return { day, time };
}

/** Store-time day + time fields → the real instant (null while incomplete). */
export function joinStoreTime(day: string, time: string): Date | null {
  if (!day || !time) return null;
  return fromStoreInput(`${day}T${time}`);
}

/**
 * "5:00pm" / "5 PM" / "17:30" → that clock time on the same STORE-local day
 * as `base` (schedules are printed in store time).
 */
export function parseTimeLabel(label: string, base: Date): Date | null {
  const m = label
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toLowerCase();
  if (h > 23 || min > 59) return null;
  if (mer?.startsWith("p") && h < 12) h += 12;
  if (mer?.startsWith("a") && h === 12) h = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return fromStoreInput(`${storeDayKey(base)}T${pad(h)}:${pad(min)}`);
}

/** A `Date` that re-renders every `everyMs` while `active` (live "now"). */
export function useNow(active: boolean, everyMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs]);
  return now;
}

/**
 * A store-time moment as two native fields — a date and a time — which are
 * far easier to work than one cramped date-time box. The label names the
 * store's time zone so nobody types device time by mistake.
 */
export function StoreDateTimeField({
  id,
  label,
  day,
  time,
  onDayChange,
  onTimeChange,
  invalid,
  maxDay,
  disabled,
  children,
}: {
  id: string;
  label: string;
  day: string;
  time: string;
  onDayChange: (day: string) => void;
  onTimeChange: (time: string) => void;
  invalid?: boolean;
  maxDay?: string;
  disabled?: boolean;
  /** Hint or status line under the fields. */
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-time`} className={cn(disabled && "opacity-60")}>
        {label}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          ({storeTzLabel()})
        </span>
      </Label>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)] gap-2">
        <Input
          id={`${id}-day`}
          type="date"
          value={day}
          max={maxDay}
          onChange={e => onDayChange(e.target.value)}
          aria-label={`${label} date`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="tabular-nums"
        />
        <Input
          id={`${id}-time`}
          type="time"
          value={time}
          onChange={e => onTimeChange(e.target.value)}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="tabular-nums"
        />
      </div>
      {children}
    </div>
  );
}

/** The inline problem line every punch dialog uses (validation or server). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

function useClockUpdate() {
  const utils = trpc.useUtils();
  return trpc.clock.update.useMutation({
    onSuccess: () => {
      utils.dashboard.summary.invalidate();
      utils.clock.list.invalidate();
      utils.clock.weekHoursBulk.invalidate();
      utils.payroll.week.invalidate();
      utils.attention.list.invalidate();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Clock out                                                           */
/* ------------------------------------------------------------------ */

/** One selectable way to end the shift. Lives outside the dialog so a
 *  choice never remounts the buttons (and keyboard focus stays put). */
function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  sub,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-input"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-muted-foreground"
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      {selected ? (
        <Check className="ml-auto h-4 w-4 shrink-0 text-primary" aria-hidden />
      ) : null}
    </button>
  );
}

export function ClockOutDialog({
  punch,
  onOpenChange,
}: {
  punch: QuickPunch | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!punch;
  const [choice, setChoice] = useState<"now" | "scheduled" | "custom">("now");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const now = useNow(open);

  const clockIn = punch ? new Date(punch.clockInAt) : null;

  // "At scheduled end" is only offered when the printed end time already
  // passed and lands after the clock-in — exactly the forgotten-punch case.
  const scheduledEnd = useMemo(() => {
    if (!punch?.shiftEndLabel || !clockIn) return null;
    let d = parseTimeLabel(punch.shiftEndLabel, clockIn);
    if (!d) return null;
    if (d.getTime() <= clockIn.getTime())
      d = new Date(d.getTime() + 86_400_000);
    if (d.getTime() > Date.now()) return null;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id, punch?.clockInAt, punch?.shiftEndLabel]);

  // Fresh state every time the dialog opens for a punch.
  useEffect(() => {
    if (!punch) return;
    setChoice(scheduledEnd ? "scheduled" : "now");
    const s = splitStoreTime(new Date());
    setDay(s.day);
    setTime(s.time);
    setTried(false);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id]);

  const update = useClockUpdate();

  if (!punch || !clockIn) return null;

  const chosenFor = (at: Date) =>
    choice === "now"
      ? at
      : choice === "scheduled" && scheduledEnd
        ? scheduledEnd
        : joinStoreTime(day, time);
  const chosen = chosenFor(now);

  const problemFor = (at: Date | null, nowAt: Date): string | null => {
    if (!at || isNaN(at.getTime()))
      return "Pick the date and time they clocked out.";
    if (at.getTime() <= clockIn.getTime())
      return `Clock-out must be after the ${fmtTime(clockIn)} clock-in (${fmtShortDay(clockIn)}).`;
    if (at.getTime() > nowAt.getTime() + FUTURE_TOLERANCE_MS)
      return "That time hasn't happened yet. Pick a time before now, or choose Now.";
    return null;
  };
  const problem = problemFor(chosen, now);
  // Empty fields only complain after a save attempt; a complete-but-wrong
  // time says so right away.
  const showProblem =
    !!problem && (tried || (choice === "custom" && !!day && !!time));

  const submit = () => {
    setTried(true);
    setServerError(null);
    const at = chosenFor(new Date()); // "Now" means the moment of the click
    if (problemFor(at, new Date()) || !at) return;
    update.mutate(
      { id: punch.id, clockOutAt: at },
      {
        onSuccess: () => {
          toast.success(`Clocked out ${punch.employeeName} at ${fmtTime(at)}.`);
          onOpenChange(false);
        },
        onError: e => setServerError(errorMessage(e)),
      }
    );
  };

  const hrsSoFar = Math.max(0, (now.getTime() - clockIn.getTime()) / 3_600_000);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clock out {punch.employeeName}</DialogTitle>
          <DialogDescription>
            On the clock since {fmtTime(clockIn)} ({fmtShortDay(clockIn)}) ·{" "}
            {fmtDuration(hrsSoFar)} so far.
          </DialogDescription>
        </DialogHeader>

        <form
          id="clock-out-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-2"
        >
          <div
            role="radiogroup"
            aria-label="When did they clock out?"
            className="flex flex-col gap-2"
          >
            {scheduledEnd ? (
              <ChoiceCard
                selected={choice === "scheduled"}
                onSelect={() => setChoice("scheduled")}
                icon={<CalendarClock />}
                title={`At scheduled end — ${fmtTime(scheduledEnd)}`}
                sub={`${fmtShortDay(scheduledEnd)} · from the imported schedule (“${punch.shiftEndLabel}”)`}
              />
            ) : null}
            <ChoiceCard
              selected={choice === "now"}
              onSelect={() => setChoice("now")}
              icon={<LogOut />}
              title={`Now — ${fmtTime(now)}`}
              sub="Ends the shift at the moment you confirm"
            />
            <ChoiceCard
              selected={choice === "custom"}
              onSelect={() => setChoice("custom")}
              icon={<Clock />}
              title="A specific time"
              sub="Pick the exact clock-out moment"
            />
          </div>
          {choice === "custom" ? (
            <div className="mt-1">
              <StoreDateTimeField
                id="clock-out-custom"
                label="Clock out"
                day={day}
                time={time}
                onDayChange={v => {
                  setDay(v);
                  setServerError(null);
                }}
                onTimeChange={v => {
                  setTime(v);
                  setServerError(null);
                }}
                maxDay={storeDayKey(now)}
                invalid={showProblem}
              />
            </div>
          ) : null}
          {showProblem ? <FormAlert>{problem}</FormAlert> : null}
          {serverError ? <FormAlert>{serverError}</FormAlert> : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="clock-out-form"
            disabled={update.isPending}
          >
            {update.isPending
              ? "Clocking out…"
              : chosen && !problem
                ? `Clock out at ${fmtTime(chosen)}`
                : "Clock out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Fix a punch's times                                                 */
/* ------------------------------------------------------------------ */

export function FixTimeDialog({
  punch,
  onOpenChange,
}: {
  punch: QuickPunch | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!punch;
  const [inDay, setInDay] = useState("");
  const [inTime, setInTime] = useState("");
  const [outDay, setOutDay] = useState("");
  const [outTime, setOutTime] = useState("");
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const now = useNow(open);

  const isOpenPunch = !punch?.clockOutAt;

  // Fresh state every time the dialog opens for a punch.
  useEffect(() => {
    if (!punch) return;
    const i = splitStoreTime(punch.clockInAt);
    setInDay(i.day);
    setInTime(i.time);
    if (punch.clockOutAt) {
      const o = splitStoreTime(punch.clockOutAt);
      setOutDay(o.day);
      setOutTime(o.time);
    } else {
      setOutDay("");
      setOutTime("");
    }
    setTried(false);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id]);

  const update = useClockUpdate();

  if (!punch) return null;

  const inAt = joinStoreTime(inDay, inTime);
  const outAt = isOpenPunch ? null : joinStoreTime(outDay, outTime);
  const limit = now.getTime() + FUTURE_TOLERANCE_MS;

  let inProblem: string | null = null;
  let outProblem: string | null = null;
  if (!inAt) inProblem = "Enter the clock-in date and time.";
  else if (inAt.getTime() > limit)
    inProblem = "Clock-in can't be in the future.";
  if (!isOpenPunch) {
    if (!outAt) outProblem = "Enter the clock-out date and time.";
    else if (inAt && outAt.getTime() <= inAt.getTime())
      outProblem = "Clock-out must be after clock-in.";
    else if (outAt.getTime() > limit)
      outProblem = "Clock-out can't be in the future.";
  }
  // Empty fields only complain after a save attempt.
  const showIn = !!inProblem && (tried || (!!inDay && !!inTime));
  const showOut = !!outProblem && (tried || (!!outDay && !!outTime));
  const problem = (showIn && inProblem) || (showOut && outProblem) || null;

  const hours =
    inAt && (isOpenPunch || outAt)
      ? Math.max(0, ((outAt ?? now).getTime() - inAt.getTime()) / 3_600_000)
      : null;
  const long = hours !== null && hours > LONG_SHIFT_HOURS && !problem;

  const submit = () => {
    setTried(true);
    setServerError(null);
    if (inProblem || outProblem || !inAt) return;
    update.mutate(
      {
        id: punch.id,
        clockInAt: inAt,
        ...(isOpenPunch ? {} : { clockOutAt: outAt }),
      },
      {
        onSuccess: () => {
          toast.success(`Updated ${punch.employeeName}'s punch.`);
          onOpenChange(false);
        },
        onError: e => setServerError(errorMessage(e)),
      }
    );
  };

  const clearServer = () => setServerError(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix {punch.employeeName}&apos;s time</DialogTitle>
          <DialogDescription>
            {isOpenPunch
              ? "They're still on the clock — adjust when the shift started. Use Clock out to end it."
              : "Adjust the recorded shift. The change is audit-logged."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="fix-time-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-4"
        >
          <StoreDateTimeField
            id="fix-in"
            label="Clock in"
            day={inDay}
            time={inTime}
            onDayChange={v => {
              setInDay(v);
              clearServer();
            }}
            onTimeChange={v => {
              setInTime(v);
              clearServer();
            }}
            maxDay={storeDayKey(now)}
            invalid={showIn}
          />
          {!isOpenPunch ? (
            <StoreDateTimeField
              id="fix-out"
              label="Clock out"
              day={outDay}
              time={outTime}
              onDayChange={v => {
                setOutDay(v);
                clearServer();
              }}
              onTimeChange={v => {
                setOutTime(v);
                clearServer();
              }}
              maxDay={storeDayKey(now)}
              invalid={showOut}
            />
          ) : null}
          {hours !== null && !problem ? (
            <p
              className={cn(
                "text-sm",
                long ? cn("font-medium", WARN_TEXT) : "text-muted-foreground"
              )}
            >
              {isOpenPunch
                ? `${fmtDuration(hours)} on the clock so far.`
                : long
                  ? `That's a ${fmtDuration(hours)} shift — double-check the dates.`
                  : `${fmtDuration(hours)} shift.`}
            </p>
          ) : null}
          {problem ? <FormAlert>{problem}</FormAlert> : null}
          {serverError ? <FormAlert>{serverError}</FormAlert> : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="fix-time-form"
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save times"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
