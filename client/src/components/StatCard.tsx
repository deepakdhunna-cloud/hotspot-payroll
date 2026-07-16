/**
 * KPI stat tile. Hero number in ink (never brand color), muted uppercase
 * label, optional sub-line and footer slot for status chips.
 */
import { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  icon,
  footer,
  className,
  style,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("surface-card rise-in p-5 flex flex-col gap-2", className)} style={style}>
      <div className="flex items-center justify-between gap-2">
        <span className="kpi-label">{label}</span>
        {icon ? <span className="text-muted-foreground/70 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      </div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
    </div>
  );
}
