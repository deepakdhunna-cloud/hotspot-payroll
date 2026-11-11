/**
 * The side navigation's width.
 *
 * From 768px wide the app has a side navigation. It is either the compact
 * RAIL (icons with small labels) or the FULL sidebar (labels, search, the
 * appearance switch), and the person using it decides: drag its edge, or tap
 * the grip, and the choice is remembered on that device.
 *
 * With no choice made it is the rail up to 1360px and the full sidebar from
 * there. A chosen width is always trimmed so the page beside it keeps at
 * least 640px — which is why a foldable held sideways can open the full
 * sidebar while a small tablet held upright stays on the rail.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const NAV_RAIL = 76;
export const NAV_FULL_DEFAULT = 240;
export const NAV_FULL_MIN = 200;
export const NAV_FULL_MAX = 340;
/** Dragging narrower than this snaps to the rail. */
const SNAP_TO_RAIL = 150;
/** The page beside the navigation never gets narrower than this. */
const MIN_PAGE = 640;
/** Width at which the full sidebar is the default. */
const AUTO_FULL_FROM = 1360;
const STORAGE_KEY = "hotspot.nav-width";

/** What the person chose: "rail", a full width in px, or null (automatic). */
export type NavPref = "rail" | number | null;

function readPref(): NavPref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "rail") return "rail";
    const n = Number(raw);
    if (raw && Number.isFinite(n) && n >= NAV_FULL_MIN && n <= NAV_FULL_MAX) return n;
  } catch {
    /* storage unavailable — automatic */
  }
  return null;
}

function writePref(pref: NavPref) {
  try {
    if (pref === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(pref));
  } catch {
    /* storage unavailable — the choice lasts for this visit */
  }
}

/** The widest the full sidebar may be at this window width (0 = not at all). */
export function maxFullWidth(viewport: number): number {
  const room = Math.min(NAV_FULL_MAX, viewport - MIN_PAGE);
  return room >= NAV_FULL_MIN ? room : 0;
}

/** The width actually used, given the window and the choice. */
export function resolveNavWidth(viewport: number, pref: NavPref): number {
  // Below 768px there is no side navigation at all (phones use the tab bar).
  if (viewport < 768) return 0;
  const max = maxFullWidth(viewport);
  if (pref === "rail" || max === 0) return NAV_RAIL;
  if (pref === null) {
    return viewport >= AUTO_FULL_FROM ? Math.min(NAV_FULL_DEFAULT, max) : NAV_RAIL;
  }
  return Math.max(NAV_FULL_MIN, Math.min(pref, max));
}

/** Width and mode for a first render (also used by the loading skeleton). */
export function initialNav(): { width: number; mode: "rail" | "full" } {
  const viewport = typeof window === "undefined" ? AUTO_FULL_FROM : window.innerWidth;
  const width = resolveNavWidth(viewport, typeof window === "undefined" ? null : readPref());
  return { width, mode: width > NAV_RAIL ? "full" : "rail" };
}

export function useNavSize() {
  const [pref, setPref] = useState<NavPref>(readPref);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [dragging, setDragging] = useState(false);
  // The last full width used, so a tap on the grip reopens to the same size.
  const lastFull = useRef<number>(typeof pref === "number" ? pref : NAV_FULL_DEFAULT);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const width = resolveNavWidth(viewport, pref);
  const mode: "rail" | "full" = width > NAV_RAIL ? "full" : "rail";
  const max = maxFullWidth(viewport);
  const resizable = max > 0 && viewport >= 768;

  const commit = useCallback((next: NavPref) => {
    if (typeof next === "number") lastFull.current = next;
    setPref(next);
    writePref(next);
  }, []);

  const toggle = useCallback(() => {
    if (!resizable) return;
    commit(mode === "full" ? "rail" : Math.min(lastFull.current, max));
  }, [commit, mode, max, resizable]);

  /** Nudge from the keyboard: arrows on the grip. */
  const nudge = useCallback(
    (delta: number) => {
      if (!resizable) return;
      if (mode === "rail") {
        if (delta > 0) commit(NAV_FULL_MIN);
        return;
      }
      const next = width + delta;
      commit(next < NAV_FULL_MIN ? "rail" : Math.min(next, max));
    },
    [commit, mode, width, max, resizable],
  );

  /** Pointer handlers for the grip: drag to size, tap to open or close. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!resizable || (e.pointerType === "mouse" && e.button !== 0)) return;
      const startX = e.clientX;
      const fullBefore = lastFull.current;
      let moved = false;
      let latest: NavPref = pref;
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) < 4) return;
        if (!moved) {
          moved = true;
          setDragging(true);
        }
        latest = ev.clientX < SNAP_TO_RAIL ? "rail" : Math.max(NAV_FULL_MIN, Math.min(ev.clientX, max));
        if (typeof latest === "number") lastFull.current = latest;
        setPref(latest);
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        setDragging(false);
        // Dragged shut: reopening later returns to the width it had before.
        if (latest === "rail") lastFull.current = fullBefore;
        if (moved) writePref(latest);
        else toggle();
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [max, pref, resizable, toggle],
  );

  return { width, mode, resizable, dragging, toggle, nudge, onPointerDown, max };
}
