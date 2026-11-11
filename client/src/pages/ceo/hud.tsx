/**
 * Instrument primitives for the command center: framed panels, readouts,
 * numbers that count to their value, a live store-time clock, status lights.
 * The look comes from the `.cc` scope in index.css; these only give it
 * structure.
 */
import { cn } from "@/lib/utils";
import { BUSINESS_TIME_ZONE, storeTzLabel } from "@/lib/payweek";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** A framed panel with an optional console-style title row. */
export function HudPanel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  /** Quiet text after the title: a count, a date range. */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("hud hud-rise", className)}>
      {title ? (
        <header className="hud-head">
          {/* The title keeps its width; the quiet text after it is what gives way. */}
          <h2 className="hud-title min-w-0 truncate">{title}</h2>
          {meta ? (
            <span className="min-w-0 flex-1 basis-0 truncate normal-case tracking-normal">{meta}</span>
          ) : null}
          {actions ? <span className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</span> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Animate a number toward its value (instant when motion is reduced). */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (calm || !Number.isFinite(start) || !Number.isFinite(value)) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const next = start + (value - start) * eased;
      from.current = next;
      setShown(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** Whole dollars, counting up: "$27,290". */
export function CountMoney({ value, cents = false }: { value: number; cents?: boolean }) {
  const n = useCountUp(value);
  return (
    <>
      {n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      })}
    </>
  );
}

export function CountNumber({ value, digits = 0 }: { value: number; digits?: number }) {
  const n = useCountUp(value);
  return (
    <>
      {n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}
    </>
  );
}

/** One instrument: a small label over a large value. */
export function Readout({
  label,
  value,
  sub,
  footer,
  large = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  large?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 p-3.5 sm:p-4", className)}>
      <span className="hud-label">{label}</span>
      <span className={cn("hud-value truncate", large && "hud-value-lg")}>{value}</span>
      {sub ? <span className="text-xs leading-snug text-muted-foreground">{sub}</span> : null}
      {footer ? <span className="mt-auto pt-1.5">{footer}</span> : null}
    </div>
  );
}

export function Led({
  tone = "ok",
  pulse = false,
}: {
  tone?: "ok" | "warn" | "bad" | "off";
  pulse?: boolean;
}) {
  return (
    <span
      className="hud-led"
      data-tone={tone === "ok" ? undefined : tone}
      data-pulse={pulse || undefined}
      aria-hidden="true"
    />
  );
}

/** The time at the stores, ticking. */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
  return (
    <span className="hud-chip" title="Store time">
      <Led pulse />
      <b className="tabular-nums">{time}</b>
      {storeTzLabel()}
    </span>
  );
}
