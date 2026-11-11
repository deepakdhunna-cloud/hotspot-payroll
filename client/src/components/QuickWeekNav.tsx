/**
 * Pay-week control: a segmented track with one-tap jumps (the live week plus
 * last week, or next week where planning ahead is the job), chevrons for
 * stepping, and a calendar popover for anything else (the date segment
 * lights up when another week is picked). Weeks are always Thursday →
 * Wednesday in store time; picking any date snaps to its pay-week Thursday.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  currentPayPeriodStart,
  fromDateInput,
  inProgressPayWeekStart,
  shiftPayWeek,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { fmtWeekRange } from "@/lib/format";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function QuickWeekNav({
  weekStart,
  onChange,
  className,
  allowFutureWeeks = 0,
}: {
  weekStart: Date;
  onChange: (next: Date) => void;
  className?: string;
  /**
   * How many weeks past the live week may be picked. 0 (payroll, history)
   * stops at the live week; the schedule page plans ahead, so it allows a
   * few and offers "Next week" in place of "Last week".
   */
  allowFutureWeeks?: number;
}) {
  const [open, setOpen] = useState(false);
  const live = inProgressPayWeekStart();
  const lastClosed = currentPayPeriodStart();
  const next = shiftPayWeek(live, 1);
  const maxWeek = shiftPayWeek(live, Math.max(0, allowFutureWeeks));
  const planning = allowFutureWeeks > 0;
  const isLive = weekStart.getTime() === live.getTime();
  const isLastClosed = weekStart.getTime() === lastClosed.getTime();
  const isNext = weekStart.getTime() === next.getTime();
  const atMax = weekStart.getTime() >= maxWeek.getTime();
  const secondActive = planning ? isNext : isLastClosed;
  const range = fmtWeekRange(weekStart);

  // Latest selectable calendar day: the Wednesday that closes the last
  // allowed week.
  const maxDay = new Date(maxWeek);
  maxDay.setUTCDate(maxDay.getUTCDate() + 6);

  const go = (d: Date) => {
    const snapped = startOfPayWeek(d);
    onChange(snapped.getTime() > maxWeek.getTime() ? new Date(maxWeek) : snapped);
  };

  const seg = (active: boolean) =>
    cn(
      "h-9 sm:h-8 rounded-md px-2.5 sm:px-3 text-xs font-medium whitespace-nowrap transition-colors",
      active
        ? "sk-seg-on bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );
  const chevron =
    "h-9 w-9 sm:h-8 sm:w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-card/70";

  return (
    <div
      role="group"
      aria-label="Pay week"
      className={cn(
        "sk-track inline-flex max-w-full items-center gap-0.5 rounded-lg bg-muted p-0.5",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={chevron}
        onClick={() => go(shiftPayWeek(weekStart, -1))}
        aria-label="Previous pay week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <button
        type="button"
        onClick={() => go(live)}
        className={seg(isLive)}
        aria-pressed={isLive}
      >
        This week
      </button>
      {planning ? (
        <button
          type="button"
          onClick={() => go(next)}
          className={seg(isNext)}
          aria-pressed={isNext}
        >
          Next week
        </button>
      ) : (
        <button
          type="button"
          onClick={() => go(lastClosed)}
          className={seg(isLastClosed)}
          aria-pressed={isLastClosed}
        >
          Last week
        </button>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              seg(!isLive && !secondActive),
              "flex items-center gap-1.5 tabular-nums",
            )}
            aria-label={`Pay week ${range}. Pick another week`}
            title="Pick a pay week"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {range}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64 space-y-2">
          <Label htmlFor="qwn-date" className="text-xs">
            Jump to any pay week
          </Label>
          <Input
            id="qwn-date"
            type="date"
            value={toDateInput(weekStart)}
            max={toDateInput(maxDay)}
            onChange={(e) => {
              if (!e.target.value) return;
              go(fromDateInput(e.target.value));
              setOpen(false);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Snaps to that week's Thursday (pay weeks run Thu–Wed).
          </p>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className={chevron}
        onClick={() => go(shiftPayWeek(weekStart, 1))}
        disabled={atMax}
        aria-label="Next pay week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
