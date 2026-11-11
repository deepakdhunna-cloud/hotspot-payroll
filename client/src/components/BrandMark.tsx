/**
 * Hotspot Market brand mark — the real logo, bundled with the app
 * (client/public/brand/hotspot-logo.png) so it never depends on external
 * storage. White lettering with a black outline and red stripes reads on
 * both the light and the dark theme, and the artwork already includes the
 * MARKET pill.
 *
 * `BrandGlyph` is the compact form for tight places (the navigation rail,
 * the app icon): the speed stripes and the H, cut from the same artwork.
 *
 * A styled text mark remains as a last-resort fallback if an image somehow
 * fails to load.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

const LOGO_URL = "/brand/hotspot-logo.png";
const GLYPH_URL = "/brand/hotspot-mark.png";

const SIZES = {
  sm: { img: "h-9", text: "text-lg" },
  md: { img: "h-12", text: "text-2xl" },
  lg: { img: "h-16", text: "text-3xl" },
} as const;

export function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  /** @deprecated the mark reads on every surface; kept so call sites compile. */
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
    <img
      width={1201}
      height={289}
      src={LOGO_URL}
      alt="Hotspot Market"
      draggable={false}
      className={cn("w-auto object-contain select-none", s.img, className)}
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
    <img
      width={600}
      height={362}
      src={GLYPH_URL}
      alt="Hotspot Market"
      draggable={false}
      className={cn("h-7 w-auto object-contain select-none", className)}
      onError={() => setImgFailed(true)}
    />
  );
}
