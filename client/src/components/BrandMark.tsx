/**
 * Hotspot Market brand mark — the real logo, bundled with the app so it
 * never depends on external storage. It comes in two versions of the same
 * artwork, and the right one shows for the surface it sits on:
 *
 *  - on dark  (/brand/hotspot-logo.png)     white lettering — the original.
 *  - on light (/brand/hotspot-logo-ink.png) the same logo with the HOTSPOT
 *    lettering in solid ink, so it never washes out on a white page, and the
 *    red stripes as flat red bars: the original's black edge on each stripe
 *    disappears into a dark page but reads as a heavy outline on a white
 *    one, so it is left off here. The MARKET pill is identical.
 *
 * Which one shows is plain CSS (the `dark:` variant), so it follows the
 * theme — and any always-dark surface such as the time clock — without
 * JavaScript and without a flash.
 *
 * `BrandGlyph` is the compact form for tight places (the navigation rail,
 * the app icon): the speed stripes and the H, cut from the same artwork.
 *
 * A styled text mark remains as a last-resort fallback if an image somehow
 * fails to load.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

const LOGO = { onDark: "/brand/hotspot-logo.png", onLight: "/brand/hotspot-logo-ink.png" };
const GLYPH = { onDark: "/brand/hotspot-mark.png", onLight: "/brand/hotspot-mark-ink.png" };

const SIZES = {
  sm: { img: "h-9", text: "text-lg" },
  md: { img: "h-12", text: "text-2xl" },
  lg: { img: "h-16", text: "text-3xl" },
} as const;

/** Both versions of one mark; CSS shows the one that suits the surface. */
function ThemedImage({
  sources,
  width,
  height,
  className,
  onError,
}: {
  sources: { onDark: string; onLight: string };
  width: number;
  height: number;
  className?: string;
  onError: () => void;
}) {
  const img = "h-full w-auto max-w-full object-contain select-none";
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <img
        width={width}
        height={height}
        src={sources.onLight}
        alt="Hotspot Market"
        draggable={false}
        className={cn(img, "block dark:hidden")}
        onError={onError}
      />
      <img
        width={width}
        height={height}
        src={sources.onDark}
        alt="Hotspot Market"
        draggable={false}
        className={cn(img, "hidden dark:block")}
        onError={onError}
      />
    </span>
  );
}

export function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  /** @deprecated the mark picks its own version; kept so call sites compile. */
  tone?: "paper" | "ink";
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const s = SIZES[size];

  if (imgFailed) {
    return (
      <span
        className={cn(
          "font-extrabold italic tracking-tight leading-none text-foreground",
          s.text,
          className,
        )}
        role="img"
        aria-label="Hotspot Market"
      >
        HOT<span className="text-brand-text">SPOT</span>
      </span>
    );
  }

  return (
    <ThemedImage
      sources={LOGO}
      width={1201}
      height={289}
      className={cn(s.img, className)}
      onError={() => setImgFailed(true)}
    />
  );
}

/** The compact mark: speed stripes + H. */
export function BrandGlyph({ className }: { className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (imgFailed) {
    return (
      <span
        className={cn("font-extrabold italic leading-none text-foreground", className)}
        role="img"
        aria-label="Hotspot Market"
      >
        H
      </span>
    );
  }
  return (
    <ThemedImage
      sources={GLYPH}
      width={600}
      height={362}
      className={cn("h-7", className)}
      onError={() => setImgFailed(true)}
    />
  );
}
