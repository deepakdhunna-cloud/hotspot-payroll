/**
 * Pay-week stepper: ‹ [ May 7 – May 13 ▾ ] ›
 * The popover date input snaps any chosen date to its pay-week Thursday.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtWeekRange } from "@/lib/format";
import { fromDateInput, shiftPayWeek, startOfPayWeek, toDateInput } from "@/lib/payweek";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function WeekNavigator({
  weekStart,
  onChange,
  className,
}: {
  weekStart: Date;
  onChange: (next: Date) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-r-none"
        onClick={() => onChange(shiftPayWeek(weekStart, -1))}
        aria-label="Previous pay week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex h-9 items-center gap-2 border-x border-border px-3 text-sm font-medium tabular-nums hover:bg-accent transition-colors"
            aria-label="Pick pay week"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {fmtWeekRange(weekStart)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64 space-y-2">
          <Label htmlFor="week-start-input" className="text-xs">
            Pay-period start
          </Label>
          <Input
            id="week-start-input"
            type="date"
            value={toDateInput(weekStart)}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(startOfPayWeek(fromDateInput(e.target.value)));
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Snaps to the Thursday of the chosen week (pay weeks run Thu–Wed).
          </p>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-l-none"
        onClick={() => onChange(shiftPayWeek(weekStart, 1))}
        aria-label="Next pay week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
