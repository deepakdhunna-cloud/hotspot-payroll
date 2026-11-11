/**
 * Pull-to-refresh for the home-screen app. A standalone app has no reload
 * button and no browser pull gesture, so pulling down from the very top of
 * a page refetches every query on screen (no full reload, no lost state).
 *
 * Only active when launched from the home screen on a touch device, and it
 * steps aside for open dialogs, form fields and sideways-scrolling tables.
 */
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isStandalone } from "@/lib/installApp";
import { cn } from "@/lib/utils";

const TRIGGER = 72; // px of pull (after damping) that commits a refresh
const MAX = 110;

export function PullToRefresh() {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef({ startY: 0, startX: 0, active: false, pull: 0 });
  const busy = useRef(false);

  useEffect(() => {
    if (!isStandalone() || !("ontouchstart" in window)) return;

    const blocked = (target: EventTarget | null) => {
      if (document.body.hasAttribute("data-scroll-locked")) return true;
      const el = target instanceof Element ? target : null;
      return !!el?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-no-pull]'
      );
    };

    const onStart = (e: TouchEvent) => {
      if (
        busy.current ||
        e.touches.length !== 1 ||
        window.scrollY > 0 ||
        blocked(e.target)
      ) {
        state.current.active = false;
        return;
      }
      state.current = {
        startY: e.touches[0].clientY,
        startX: e.touches[0].clientX,
        active: true,
        pull: 0,
      };
    };

    const onMove = (e: TouchEvent) => {
      const s = state.current;
      if (!s.active) return;
      const dy = e.touches[0].clientY - s.startY;
      const dx = Math.abs(e.touches[0].clientX - s.startX);
      if (window.scrollY > 0 || dy <= 0 || dx > dy) {
        if (s.pull !== 0) {
          s.pull = 0;
          setPull(0);
        }
        if (dx > dy) s.active = false;
        return;
      }
      // Rubber-band damping so the indicator trails the finger.
      s.pull = Math.min(MAX, dy * 0.5);
      setPull(s.pull);
    };

    const onEnd = () => {
      const s = state.current;
      if (!s.active) return;
      s.active = false;
      if (s.pull >= TRIGGER) {
        busy.current = true;
        setRefreshing(true);
        setPull(TRIGGER);
        queryClient
          .refetchQueries({ type: "active" })
          .catch(() => undefined)
          .finally(() => {
            busy.current = false;
            setRefreshing(false);
            setPull(0);
          });
      } else {
        setPull(0);
      }
      s.pull = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [queryClient]);

  if (pull === 0 && !refreshing) return null;
  const progress = Math.min(1, pull / TRIGGER);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{
        top: `calc(var(--app-header-h, 3.5rem) + ${Math.max(8, pull - 36)}px)`,
      }}
      role="status"
      aria-live="polite"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
    >
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-transform",
          !refreshing && "duration-0"
        )}
        style={{ opacity: Math.max(0.35, progress) }}
      >
        <RefreshCw
          className={cn(
            "h-4 w-4",
            progress >= 1 ? "text-primary" : "text-muted-foreground",
            refreshing && "animate-spin"
          )}
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${progress * 270}deg)` }
          }
        />
      </div>
    </div>
  );
}
