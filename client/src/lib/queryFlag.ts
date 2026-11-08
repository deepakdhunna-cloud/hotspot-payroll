import { useEffect, useRef } from "react";

/**
 * Read-once URL flags for deep links such as `/employees?add=1`, which open a
 * dialog straight from a dashboard shortcut or the command bar. The flag is
 * stripped from the address bar as it's read, so a refresh or the Back button
 * never reopens it.
 */
export function consumeQueryFlag(name: string): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get(name) !== "1") return false;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url.toString());
  return true;
}

/** Fired after in-app navigation that may carry a flag for a page already on screen. */
export const FLAG_EVENT = "hotspot:flags";

/** Tell a page that is already mounted to look for new URL flags. */
export function announceQueryFlags() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLAG_EVENT));
}

/**
 * Run `onFlag` when `?name=1` is in the URL: on mount, and again whenever
 * in-app navigation announces new flags (so "Add a punch" from the command
 * bar works even while the Punches tab is already open).
 */
export function useQueryFlag(name: string, onFlag: () => void) {
  const handler = useRef(onFlag);
  handler.current = onFlag;
  useEffect(() => {
    const check = () => {
      if (consumeQueryFlag(name)) handler.current();
    };
    check();
    window.addEventListener(FLAG_EVENT, check);
    return () => window.removeEventListener(FLAG_EVENT, check);
  }, [name]);
}
