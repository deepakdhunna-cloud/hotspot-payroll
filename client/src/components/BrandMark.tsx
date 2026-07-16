/**
 * Hotspot Market brand mark. Renders the uploaded wordmark image and falls
 * back to a styled text wordmark if the asset can't load, so the brand never
 * shows a broken image icon.
 *
 * `tone="ink"` renders the text mark in white for dark ("ink") surfaces —
 * the sidebar, login backdrop and kiosk — where the image (dark lettering)
 * and the black pill would vanish.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

const LOGO_URL = "/manus-storage/hotspot-wordmark_ddfb64c0.png";

const SIZES = {
  sm: { img: "h-7", text: "text-lg", pill: "text-[8px] px-2 py-0.5" },
  md: { img: "h-10", text: "text-2xl", pill: "text-[9px] px-2.5 py-0.5" },
  lg: { img: "h-14", text: "text-3xl", pill: "text-[10px] px-4 py-1" },
} as const;

export function BrandMark({
  size = "md",
  withPill = true,
  tone = "paper",
  className,
}: {
  size?: keyof typeof SIZES;
  withPill?: boolean;
  tone?: "paper" | "ink";
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const s = SIZES[size];
  const onInk = tone === "ink";
  // The wordmark image has dark lettering — on ink surfaces always use the
  // styled text mark instead.
  const useText = onInk || imgFailed;

  return (
    <span className={cn("inline-flex flex-col items-center gap-1", className)}>
      {useText ? (
        <span
          className={cn(
            "font-extrabold tracking-tight leading-none",
            onInk ? "text-white" : "text-foreground",
            s.text,
          )}
          style={{ fontFamily: "var(--font-display)" }}
        >
          HOT<span className={onInk ? "text-[oklch(0.68_0.21_27)]" : "text-primary"}>SPOT</span>
        </span>
      ) : (
        <img
          src={LOGO_URL}
          alt="Hotspot"
          className={cn("w-auto object-contain", s.img)}
          onError={() => setImgFailed(true)}
        />
      )}
      {withPill ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full font-semibold uppercase tracking-[0.28em]",
            onInk ? "bg-white/10 text-white/90" : "bg-neutral-950 text-white",
            s.pill,
          )}
        >
          Market
        </span>
      ) : null}
    </span>
  );
}
