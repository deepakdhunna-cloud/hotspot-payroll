/**
 * Financial numeral treatment (the Mercury/Ramp signature): dollars carry
 * the weight, cents step down in size and tone. Purely presentational —
 * always fed the same numbers fmtMoney would have shown.
 */
import { cn } from "@/lib/utils";

export function Money({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const neg = value < 0;
  // Let Intl do ALL the rounding, then split its output — guarantees the
  // digits are always identical to what fmtMoney showed before this
  // component existed (carry, half-up cases, grouping — everything).
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dot = formatted.lastIndexOf(".");
  const dollars = formatted.slice(0, dot);
  const cents = formatted.slice(dot + 1);
  return (
    <span className={cn("tabular-nums", className)}>
      {neg ? "−" : ""}${dollars}
      <span className="text-[0.58em] font-semibold opacity-55">.{cents}</span>
    </span>
  );
}
