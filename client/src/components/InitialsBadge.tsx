/**
 * Deterministic initials avatar — the detail that turns a generic roster
 * table into a designed one (Stripe/Gusto do exactly this). Hue is derived
 * from the name so each person keeps their color everywhere; the palette is
 * the muted series set, never brand red (red = actions, not people).
 */
import { cn } from "@/lib/utils";

// Six muted hues (.avatar-h0 … .avatar-h5 in index.css), one lightness and
// chroma in each theme, so no person's badge shouts louder than another's.
const HUES = 6;

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
  const hue = hashName(name.toUpperCase()) % HUES;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "sk-avatar inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        `avatar-h${hue}`,
        size === "sm" ? "h-6 w-6 text-[9.5px]" : "h-8 w-8 text-[11px]",
        className,
      )}
    >
      {initials}
    </span>
  );
}
