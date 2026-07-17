/**
 * Hotspot Market brand mark — the real logo, bundled with the app
 * (client/public/brand/hotspot-logo.png) so it never depends on external
 * storage. White lettering with a black outline and red stripes reads on
 * both the paper and ink surfaces, and the artwork already includes the
 * MARKET pill.
 *
 * A styled text mark remains as a last-resort fallback if the image
 * somehow fails to load; `tone="ink"` only affects that fallback's color.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

const LOGO_URL = "/brand/hotspot-logo.png";

const SIZES = {
  sm: { img: "h-9", text: "text-lg" },
  md: { img: "h-12", text: "text-2xl" },
  lg: { img: "h-16", text: "text-3xl" },
} as const;

export function BrandMark({
  size = "md",
  tone = "paper",
  className,
}: {
  size?: keyof typeof SIZES;
  tone?: "paper" | "ink";
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const s = SIZES[size];
  const onInk = tone === "ink";

  if (imgFailed) {
    return (
      <span
        className={cn(
          "font-extrabold tracking-tight leading-none",
          onInk ? "text-white" : "text-foreground",
          s.text,
          className,
        )}
        style={{ fontFamily: "var(--font-display)" }}
      >
        HOT<span className={onInk ? "text-[oklch(0.68_0.21_27)]" : "text-primary"}>SPOT</span>
      </span>
    );
  }

  return (
    <img
      width={1201}
      height={289}
      src={LOGO_URL}
      alt="Hotspot Market"
      className={cn("w-auto object-contain", s.img, className)}
      onError={() => setImgFailed(true)}
    />
  );
}
