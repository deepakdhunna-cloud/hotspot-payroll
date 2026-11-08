/**
 * Pay-week control: a segmented track with one-tap jumps to the live week and
 * the last closed week, chevrons for stepping, and a calendar popover for
 * anything older (the date segment lights up when an older week is picked).
 * Weeks are always Thursday → Wednesday; picking any date snaps to its
 * pay-week Thursday.
 */
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
}: {
  weekStart: Date;
  onChange: (next: Date) => void;
  className?: string;
}) {
  const live = inProgressPayWeekStart();
  const lastClosed = currentPayPeriodStart();
  const isLive = weekStart.getTime() === live.getTime();
  const isLastClosed = weekStart.getTime() === lastClosed.getTime();

  const seg = (active: boolean) =>
    cn(
      "h-8 rounded-md px-2.5 sm:px-3 text-xs font-medium whitespace-nowrap transition-colors",
      active
        ? "sk-seg-on bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div
      className={cn(
        "sk-track inline-flex max-w-full items-center gap-0.5 rounded-lg bg-muted p-0.5",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-card/70"
        onClick={() => onChange(shiftPayWeek(weekStart, -1))}
        aria-label="Previous pay week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <button onClick={() => onChange(new Date(live))} className={seg(isLive)}>
        This week
      </button>
      <button onClick={() => onChange(new Date(lastClosed))} className={seg(isLastClosed)}>
        Last week
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              seg(!isLive && !isLastClosed),
              "flex items-center gap-1.5 tabular-nums",
            )}
            aria-label="Pick pay week"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {fmtWeekRange(weekStart)}
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
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(startOfPayWeek(fromDateInput(e.target.value)));
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
        className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-card/70"
        onClick={() => onChange(shiftPayWeek(weekStart, 1))}
        disabled={isLive}
        aria-label="Next pay week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
