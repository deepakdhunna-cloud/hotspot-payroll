/**
 * KPI band: the page's numbers in ONE strip, cells divided by hairlines.
 * Pass `hero` on the cell that is the page's headline — it reads larger,
 * establishing a single dominant number per screen.
 */
import { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KpiBand({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cn("kpi-band rise-in", className)} style={style}>
      {children}
    </section>
  );
}

export function KpiCell({
  label,
  value,
  sub,
  footer,
  hero = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("kpi-cell", hero && "kpi-cell-hero", className)}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      {footer ? <span className="mt-auto pt-1.5">{footer}</span> : null}
    </div>
  );
}
