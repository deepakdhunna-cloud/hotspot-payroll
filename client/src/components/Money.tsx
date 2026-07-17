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
  const abs = Math.abs(value);
  const dollars = Math.floor(abs);
  const cents = Math.round((abs - dollars) * 100);
  return (
    <span className={cn("tabular-nums", className)}>
      {neg ? "−" : ""}${dollars.toLocaleString("en-US")}
      <span className="text-[0.58em] font-semibold opacity-55">
        .{String(cents === 100 ? 0 : cents).padStart(2, "0")}
      </span>
    </span>
  );
}
