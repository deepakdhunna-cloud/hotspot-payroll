/**
 * Deterministic initials avatar — the detail that turns a generic roster
 * table into a designed one (Stripe/Gusto do exactly this). Hue is derived
 * from the name so each person keeps their color everywhere; the palette is
 * the muted series set, never brand red (red = actions, not people).
 */
import { cn } from "@/lib/utils";

// The muted series palette (see --chart-* in index.css), one lightness
// and chroma, so no person's badge shouts louder than another's.
const PALETTE = [
  { bg: "oklch(0.56 0.11 252 / 0.13)", fg: "oklch(0.42 0.1 252)" }, // steel blue
  { bg: "oklch(0.6 0.09 185 / 0.15)", fg: "oklch(0.42 0.07 185)" }, // teal
  { bg: "oklch(0.55 0.11 340 / 0.13)", fg: "oklch(0.44 0.1 340)" }, // plum
  { bg: "oklch(0.7 0.12 75 / 0.18)", fg: "oklch(0.47 0.09 70)" }, // ochre
  { bg: "oklch(0.58 0.09 145 / 0.15)", fg: "oklch(0.42 0.07 145)" }, // sage
  { bg: "oklch(0.55 0.07 40 / 0.13)", fg: "oklch(0.43 0.07 40)" }, // clay
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
        "sk-avatar inline-flex shrink-0 items-center justify-center rounded-full font-bold select-none",
        size === "sm" ? "h-6 w-6 text-[9.5px]" : "h-8 w-8 text-[11px]",
        className,
      )}
      style={{ background: c.bg, color: c.fg }}
    >
      {initials}
    </span>
  );
}
