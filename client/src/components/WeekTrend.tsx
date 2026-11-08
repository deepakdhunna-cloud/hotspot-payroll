/**
 * Eight-week filmstrip: one bar per pay week (clocked hours), a notch on
 * each bar marking that week's SCHEDULED hours on the same scale (over or
 * under plan is visible at a glance), a dot under weeks whose payroll has
 * been saved, and the selected week highlighted. Clicking a bar drives the
 * dashboard to that week — older payroll is always one click away.
 */
import { fmtHours, fmtHoursLabel, fmtMoney, fmtWeekRange } from "@/lib/format";
import { inProgressPayWeekStart } from "@/lib/payweek";
import { cn } from "@/lib/utils";

export type TrendWeek = {
  weekStart: Date | string;
  savedHours: number;
  savedGross: number;
  scheduledHours: number;
  clockHours: number;
};

const BAR_AREA = 64;

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
  // One scale for clocked bars AND scheduled notches, so they compare.
  const max = Math.max(
    1,
    ...weeks.map(w => Math.max(w.clockHours, w.scheduledHours))
  );
  const hasSchedule = weeks.some(w => w.scheduledHours > 0);
  const hasSaved = weeks.some(w => w.savedGross > 0);

  return (
    <div>
      <div className="flex items-end gap-1 sm:gap-1.5 h-[6.5rem] sm:h-24">
        {weeks.map(w => {
          const ws = new Date(w.weekStart);
          const isSelected = ws.getTime() === selected.getTime();
          const isLive = ws.getTime() === live;
          const h = Math.max(
            w.clockHours > 0 ? 8 : 3,
            (w.clockHours / max) * BAR_AREA
          );
          const schedH =
            w.scheduledHours > 0 ? (w.scheduledHours / max) * BAR_AREA : null;
          // "Oct 30" — the same short date every other screen uses.
          const label = ws.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          const facts = `${fmtHoursLabel(w.clockHours)} clocked${
            w.scheduledHours > 0
              ? ` of ${fmtHoursLabel(w.scheduledHours)} scheduled`
              : ""
          }, ${
            w.savedGross > 0
              ? `${fmtMoney(w.savedGross)} payroll saved`
              : isLive
                ? "week in progress"
                : "payroll not saved"
          }`;
          return (
            <button
              key={ws.toISOString()}
              type="button"
              onClick={() => onSelect(ws)}
              title={`${fmtWeekRange(ws)}: ${facts}`}
              className={cn(
                "group flex flex-col items-center justify-end gap-1 flex-1 min-w-0 h-full rounded-md px-0.5 pt-1 transition-colors",
                isSelected ? "bg-muted" : "hover:bg-muted/60"
              )}
              aria-pressed={isSelected}
              aria-label={`${isLive ? "This week, " : ""}${fmtWeekRange(ws)}: ${facts}`}
            >
              <span
                className={cn(
                  "text-[10px] tabular-nums leading-none",
                  isSelected
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {w.clockHours > 0 ? fmtHours(w.clockHours, 0) : ""}
              </span>
              <div
                className="relative w-full max-w-8 flex items-end"
                style={{ height: `${BAR_AREA}px` }}
              >
                <div
                  className="sk-bar w-full rounded-[4px] transition-all"
                  style={{
                    height: `${h}px`,
                    background:
                      w.clockHours <= 0
                        ? "var(--border)"
                        : isSelected
                          ? "var(--chart-1)"
                          : "color-mix(in oklab, var(--chart-1) 38%, var(--card))",
                  }}
                />
                {schedH !== null ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-[-2px] right-[-2px] rounded-full"
                    style={{
                      bottom: `${Math.min(schedH, BAR_AREA - 1)}px`,
                      height: "2px",
                      background: "oklch(0.35 0.02 255)",
                      boxShadow: "0 0 0 1px oklch(1 0 0 / 0.65)",
                      opacity: isSelected || isLive ? 0.9 : 0.55,
                    }}
                  />
                ) : null}
              </div>
              {/* Phones stack the saved dot under the date so neighbours never collide. */}
              <span className="flex flex-col items-center gap-0.5 leading-none sm:flex-row sm:gap-1">
                <span
                  className={cn(
                    "text-[10px] tabular-nums whitespace-nowrap",
                    isSelected
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground"
                  )}
                >
                  {isLive ? "Now" : label}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    w.savedGross > 0 ? "bg-success" : "bg-transparent"
                  )}
                />
              </span>
            </button>
          );
        })}
      </div>
      {(hasSchedule || hasSaved) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground leading-none">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2.5 rounded-[2px]"
              style={{ background: "var(--chart-1)" }}
            />
            Hours clocked
          </span>
          {hasSchedule && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-[2px] w-3 rounded-full"
                style={{ background: "oklch(0.35 0.02 255)" }}
              />
              Scheduled level
            </span>
          )}
          {hasSaved && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              Payroll saved
            </span>
          )}
        </p>
      )}
    </div>
  );
}
