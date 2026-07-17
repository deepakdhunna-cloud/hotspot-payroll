/**
 * Eight-week filmstrip: one bar per pay week (clocked hours), a notch on
 * each bar marking that week's SCHEDULED hours on the same scale (over or
 * under plan is visible at a glance), a dot under weeks whose payroll has
 * been saved, and the selected week highlighted. Clicking a bar drives the
 * dashboard to that week — older payroll is always one click away.
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
    ...weeks.map((w) => Math.max(w.clockHours, w.scheduledHours)),
  );
  const hasSchedule = weeks.some((w) => w.scheduledHours > 0);
  const hasSaved = weeks.some((w) => w.savedGross > 0);

  return (
    <div>
      <div className="flex items-end gap-1.5 h-24">
        {weeks.map((w) => {
          const ws = new Date(w.weekStart);
          const isSelected = ws.getTime() === selected.getTime();
          const isLive = ws.getTime() === live;
          const h = Math.max(
            w.clockHours > 0 ? 8 : 3,
            (w.clockHours / max) * BAR_AREA,
          );
          const schedH =
            w.scheduledHours > 0 ? (w.scheduledHours / max) * BAR_AREA : null;
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
                w.scheduledHours > 0
                  ? ` of ${w.scheduledHours.toFixed(1)}h scheduled`
                  : ""
              }${
                w.savedGross > 0
                  ? ` · ${fmtMoney(w.savedGross)} payroll saved`
                  : " · payroll not saved"
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
                  isSelected
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {w.clockHours > 0 ? w.clockHours.toFixed(0) : ""}
              </span>
              <div
                className="relative w-full max-w-8 flex items-end"
                style={{ height: `${BAR_AREA}px` }}
              >
                <div
                  className={cn(
                    "w-full rounded-t-[5px] transition-all group-hover:opacity-100",
                    isSelected &&
                      "ring-2 ring-primary ring-offset-1 ring-offset-card",
                  )}
                  style={{
                    height: `${h}px`,
                    background:
                      w.clockHours > 0
                        ? "linear-gradient(180deg, #5b9be0, var(--chart-1) 60%)"
                        : "var(--border)",
                    opacity: isSelected || isLive ? 1 : 0.55,
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
              <span className="flex items-center gap-1 leading-none">
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isSelected
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground",
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
      {(hasSchedule || hasSaved) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground leading-none">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2.5 rounded-[2px]"
              style={{
                background: "linear-gradient(180deg, #5b9be0, var(--chart-1))",
              }}
            />
            hours clocked
          </span>
          {hasSchedule && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-[2px] w-3 rounded-full"
                style={{ background: "oklch(0.35 0.02 255)" }}
              />
              scheduled level
            </span>
          )}
          {hasSaved && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              payroll saved
            </span>
          )}
        </p>
      )}
    </div>
  );
}
