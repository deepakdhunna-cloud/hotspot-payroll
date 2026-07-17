/**
 * Deterministic initials avatar — the detail that turns a generic roster
 * table into a designed one (Stripe/Gusto do exactly this). Hue is derived
 * from the name so each person keeps their color everywhere; the palette is
 * the validated categorical set, never brand red (red = state, not people).
 */
import { cn } from "@/lib/utils";

const PALETTE = [
  { bg: "#2a78d61f", fg: "#1d5eae" }, // blue
  { bg: "#0083001c", fg: "#046a04" }, // green
  { bg: "#e87ba42b", fg: "#a83a68" }, // magenta
  { bg: "#eda10026", fg: "#8a5f00" }, // amber
  { bg: "#1baf7a24", fg: "#0d7c55" }, // aqua
  { bg: "#6366f11f", fg: "#4649c9" }, // indigo
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function InitialsBadge({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const parts = name.trim().split(/\s+/);
  const initials =
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""))
      .toUpperCase() || "?";
  const c = PALETTE[hashName(name.toUpperCase()) % PALETTE.length];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold select-none",
        size === "sm" ? "h-6 w-6 text-[9.5px]" : "h-8 w-8 text-[11px]",
        className,
      )}
      style={{ background: c.bg, color: c.fg }}
    >
      {initials}
    </span>
  );
}
