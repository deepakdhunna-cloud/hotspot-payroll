/**
 * Pay-week command control: one-tap jumps to the live week and last closed
 * week, chevrons for stepping, and a calendar popover for anything older.
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
import { fmtWeekRange, fmtWeekRangeCompact } from "@/lib/format";
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

  return (
    <div
      className={cn(
        "flex w-full sm:inline-flex sm:w-auto items-center rounded-lg border border-border bg-card shadow-sm overflow-hidden",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 sm:h-9 sm:w-8 shrink-0 rounded-none"
        onClick={() => onChange(shiftPayWeek(weekStart, -1))}
        aria-label="Previous pay week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <button
        onClick={() => onChange(new Date(live))}
        className={cn(
          "h-10 sm:h-9 shrink-0 whitespace-nowrap px-2.5 sm:px-3 text-xs font-semibold border-x border-border transition-colors",
          isLive
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent text-muted-foreground",
        )}
      >
        This week
      </button>
      <button
        onClick={() => onChange(new Date(lastClosed))}
        className={cn(
          "h-10 sm:h-9 shrink-0 whitespace-nowrap px-2.5 sm:px-3 text-xs font-semibold transition-colors",
          isLastClosed
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent text-muted-foreground",
        )}
      >
        Last week
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex h-10 sm:h-9 min-w-0 flex-1 sm:flex-none items-center justify-center gap-2 whitespace-nowrap border-l border-border px-2.5 sm:px-3 text-sm font-medium tabular-nums hover:bg-accent transition-colors"
            aria-label={`Pick pay week (showing ${fmtWeekRange(weekStart)})`}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {fmtWeekRangeCompact(weekStart)}
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
        className="h-10 w-10 sm:h-9 sm:w-8 shrink-0 rounded-none border-l border-border"
        onClick={() => onChange(shiftPayWeek(weekStart, 1))}
        disabled={isLive}
        aria-label="Next pay week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
