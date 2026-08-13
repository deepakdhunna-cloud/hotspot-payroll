/**
 * One-tap punch fixes, usable anywhere a punch appears.
 *
 * ClockOutDialog — clock somebody out from the website: "now" by default,
 * one tap for "at scheduled end" when the shift's printed end time is
 * already in the past (the forgot-to-clock-out case), or a custom time.
 *
 * FixTimeDialog — adjust a punch's clock-in (and clock-out, when closed)
 * without hunting through the Punches tab.
 *
 * Both ride the existing store-scoped, audited `clock.update` procedure.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
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
import { fmtDuration } from "@/lib/payweek";
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

const fmtClock = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "5:00pm" / "5 PM" / "17:30" → a Date on the same local day as `base`. */
export function parseTimeLabel(label: string, base: Date): Date | null {
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toLowerCase();
  if (h > 23 || min > 59) return null;
  if (mer?.startsWith("p") && h < 12) h += 12;
  if (mer?.startsWith("a") && h === 12) h = 0;
  const d = new Date(base);
  d.setHours(h, min, 0, 0);
  return d;
}

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function useClockUpdate(onDone: () => void) {
  const utils = trpc.useUtils();
  return trpc.clock.update.useMutation({
    onSuccess: () => {
      utils.dashboard.summary.invalidate();
      utils.clock.list.invalidate();
      utils.clock.weekHoursBulk.invalidate();
      utils.payroll.week.invalidate();
      utils.attention.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
}

/* ------------------------------------------------------------------ */
/* Clock out                                                           */
/* ------------------------------------------------------------------ */

export function ClockOutDialog({
  punch,
  onOpenChange,
}: {
  punch: QuickPunch | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [choice, setChoice] = useState<"now" | "scheduled" | "custom">("now");
  const [custom, setCustom] = useState("");

  const clockIn = punch ? new Date(punch.clockInAt) : null;

  // "At scheduled end" is only offered when the printed end time already
  // passed and lands after the clock-in — exactly the forgotten-punch case.
  const scheduledEnd = useMemo(() => {
    if (!punch?.shiftEndLabel || !clockIn) return null;
    let d = parseTimeLabel(punch.shiftEndLabel, clockIn);
    if (!d) return null;
    if (d.getTime() <= clockIn.getTime()) d = new Date(d.getTime() + 86_400_000);
    if (d.getTime() > Date.now()) return null;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id]);

  useEffect(() => {
    if (!punch) return;
    setChoice(scheduledEnd ? "scheduled" : "now");
    setCustom(toLocalInput(new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id]);

  const update = useClockUpdate(() => onOpenChange(false));

  if (!punch || !clockIn) return null;

  const chosen =
    choice === "now"
      ? new Date()
      : choice === "scheduled" && scheduledEnd
        ? scheduledEnd
        : custom
          ? new Date(custom)
          : null;
  const valid = !!chosen && !isNaN(chosen.getTime()) && chosen.getTime() > clockIn.getTime();
  const hrsSoFar = (Date.now() - clockIn.getTime()) / 3_600_000;

  const submit = () => {
    if (!valid || !chosen) return;
    update.mutate(
      { id: punch.id, clockOutAt: chosen },
      {
        onSuccess: () =>
          toast.success(`Clocked out ${punch.employeeName} at ${fmtClock(chosen)}.`),
      },
    );
  };

  const Option = ({
    value,
    icon,
    title,
    sub,
  }: {
    value: typeof choice;
    icon: React.ReactNode;
    title: string;
    sub: string;
  }) => (
    <button
      type="button"
      onClick={() => setChoice(value)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
        choice === value
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-input",
      )}
      aria-pressed={choice === value}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          choice === value ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      {choice === value ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
    </button>
  );

  return (
    <Dialog open={!!punch} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clock out {punch.employeeName}</DialogTitle>
          <DialogDescription>
            On the clock since {fmtClock(clockIn)} ({fmtDay(clockIn)}) ·{" "}
            {fmtDuration(hrsSoFar)} so far.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {scheduledEnd ? (
            <Option
              value="scheduled"
              icon={<CalendarClock className="h-4 w-4" />}
              title={`At scheduled end — ${fmtClock(scheduledEnd)}`}
              sub={`${fmtDay(scheduledEnd)} · from the imported schedule (“${punch.shiftEndLabel}”)`}
            />
          ) : null}
          <Option
            value="now"
            icon={<LogOut className="h-4 w-4" />}
            title={`Now — ${fmtClock(new Date())}`}
            sub="Ends the shift at the current time"
          />
          <Option
            value="custom"
            icon={<Clock className="h-4 w-4" />}
            title="A specific time"
            sub="Pick the exact clock-out moment"
          />
          {choice === "custom" ? (
            <Input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              max={toLocalInput(new Date())}
              className="tabular-nums"
              aria-label="Custom clock-out time"
            />
          ) : null}
          {!valid && choice === "custom" ? (
            <p className="text-xs text-destructive">
              Clock-out must be after the {fmtClock(clockIn)} clock-in.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || update.isPending}>
            {update.isPending
              ? "Clocking out…"
              : chosen
                ? `Clock out at ${fmtClock(chosen)}`
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
  const [inVal, setInVal] = useState("");
  const [outVal, setOutVal] = useState("");

  const isOpenPunch = !punch?.clockOutAt;

  useEffect(() => {
    if (!punch) return;
    setInVal(toLocalInput(new Date(punch.clockInAt)));
    setOutVal(punch.clockOutAt ? toLocalInput(new Date(punch.clockOutAt)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punch?.id]);

  const update = useClockUpdate(() => onOpenChange(false));

  if (!punch) return null;

  const inDate = inVal ? new Date(inVal) : null;
  const outDate = outVal ? new Date(outVal) : null;
  const valid =
    !!inDate &&
    !isNaN(inDate.getTime()) &&
    (isOpenPunch || (!!outDate && !isNaN(outDate.getTime()) && outDate > inDate));

  const submit = () => {
    if (!valid || !inDate) return;
    update.mutate(
      {
        id: punch.id,
        clockInAt: inDate,
        ...(isOpenPunch ? {} : { clockOutAt: outDate }),
      },
      { onSuccess: () => toast.success(`Updated ${punch.employeeName}'s punch.`) },
    );
  };

  return (
    <Dialog open={!!punch} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix {punch.employeeName}&apos;s time</DialogTitle>
          <DialogDescription>
            {isOpenPunch
              ? "They're still on the clock — adjust when the shift started. Use Clock out to end it."
              : "Adjust the recorded shift. The change is audit-logged."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="fix-in">Clock in</Label>
            <Input
              id="fix-in"
              type="datetime-local"
              value={inVal}
              onChange={(e) => setInVal(e.target.value)}
              className="tabular-nums"
            />
          </div>
          {!isOpenPunch ? (
            <div className="grid gap-1.5">
              <Label htmlFor="fix-out">Clock out</Label>
              <Input
                id="fix-out"
                type="datetime-local"
                value={outVal}
                onChange={(e) => setOutVal(e.target.value)}
                className="tabular-nums"
              />
              {!valid && inDate && outDate ? (
                <p className="text-xs text-destructive">
                  Clock-out must be after clock-in.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || update.isPending}>
            {update.isPending ? "Saving…" : "Save times"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
