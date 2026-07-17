/**
 * Eight-week filmstrip: one bar per pay week (clocked hours), a dot under
 * weeks whose payroll has been saved, and the selected week highlighted.
 * Clicking a bar drives the dashboard to that week — older payroll is
 * always one click away.
 */
import { fmtMoney, fmtWeekRange } from "@/lib/format";
import { inProgressPayWeekStart } from "@/lib/payweek";
import { cn } from "@/lib/utils";

export type TrendWeek = {
  weekStart: Date | string;
  savedHours: number;
  savedGross: number;
  scheduledHours: number;
  clockHours: number;
};

export function WeekTrend({
  weeks,
  selected,
  onSelect,
}: {
  weeks: TrendWeek[];
  selected: Date;
  onSelect: (week: Date) => void;
}) {
  const live = inProgressPayWeekStart().getTime();
  const max = Math.max(1, ...weeks.map((w) => w.clockHours));

  return (
    <div className="flex items-end gap-1.5 h-24">
      {weeks.map((w) => {
        const ws = new Date(w.weekStart);
        const isSelected = ws.getTime() === selected.getTime();
        const isLive = ws.getTime() === live;
        const h = Math.max(w.clockHours > 0 ? 8 : 3, (w.clockHours / max) * 64);
        const label = ws.toLocaleDateString("en-US", {
          month: "numeric",
          day: "numeric",
          timeZone: "UTC",
        });
        return (
          <button
            key={ws.toISOString()}
            onClick={() => onSelect(ws)}
            title={`${fmtWeekRange(ws)} — ${w.clockHours.toFixed(1)}h clocked${
              w.savedGross > 0 ? ` · ${fmtMoney(w.savedGross)} payroll saved` : " · payroll not saved"
            }`}
            className={cn(
              "group flex flex-col items-center justify-end gap-1 flex-1 h-full rounded-md px-0.5 pt-1 transition-colors",
              isSelected ? "bg-primary/8" : "hover:bg-accent",
            )}
            aria-label={`Week of ${fmtWeekRange(ws)}`}
          >
            <span
              className={cn(
                "text-[10px] tabular-nums leading-none",
                isSelected ? "text-foreground font-semibold" : "text-muted-foreground",
              )}
            >
              {w.clockHours > 0 ? w.clockHours.toFixed(0) : ""}
            </span>
            <div
              className={cn(
                "w-full max-w-8 rounded-t-[4px] transition-all",
                isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
              )}
              style={{
                height: `${h}px`,
                background: w.clockHours > 0 ? "var(--chart-1)" : "var(--border)",
                opacity: isSelected || isLive ? 1 : 0.55,
              }}
            />
            <span className="flex items-center gap-1 leading-none">
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  isSelected ? "text-foreground font-semibold" : "text-muted-foreground",
                )}
              >
                {isLive ? "now" : label}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  w.savedGross > 0 ? "bg-success" : "bg-transparent",
                )}
                title={w.savedGross > 0 ? "Payroll saved" : undefined}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
