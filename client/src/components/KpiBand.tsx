/**
 * KPI band: the page's numbers in ONE strip, cells divided by hairlines.
 * Pass `hero` on the cell that is the page's headline: it sits on the deep
 * brand ground and reads larger, one dominant number per screen. Give the
 * other cells an `icon` and a `hue` for what they measure.
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

export type Hue = "blue" | "green" | "violet" | "amber" | "teal" | "red";

export function KpiCell({
  label,
  value,
  sub,
  footer,
  hero = false,
  icon,
  hue,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  hero?: boolean;
  /** Small icon shown in a badge beside the label, colored by `hue`. */
  icon?: ReactNode;
  /** What the number is about: hours = blue, pay = green, schedule = violet… */
  hue?: Hue;
  className?: string;
}) {
  return (
    <div className={cn("kpi-cell", hero && "kpi-cell-hero", hue && `hue-${hue}`, className)}>
      <span className="flex items-center gap-2">
        {icon ? <span className="icon-badge icon-badge-sm">{icon}</span> : null}
        <span className="kpi-label">{label}</span>
      </span>
      <span className="kpi-value">{value}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
      {footer ? <span className="mt-auto pt-1.5">{footer}</span> : null}
    </div>
  );
}
