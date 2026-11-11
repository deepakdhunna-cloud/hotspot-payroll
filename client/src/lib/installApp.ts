/**
 * Home-screen install support.
 *
 * Android/Chrome fire `beforeinstallprompt`; we hold on to it so the account
 * menu can offer a one-tap "Install app". iPhone/iPad Safari never fire it —
 * there the menu shows the Share → "Add to Home Screen" steps instead.
 * Once running from the home screen (standalone), nothing is offered.
 */
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** True when the app was launched from the home screen. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; touch support gives it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useInstallApp() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const standalone = isStandalone();
  const ios = isIosDevice();
  return {
    /** Show an install entry at all? */
    available: !standalone && (deferred !== null || ios),
    /** Android/Chrome: the browser's own install sheet is ready. */
    canPrompt: deferred !== null,
    ios,
    async prompt(): Promise<boolean> {
      const evt = deferred;
      if (!evt) return false;
      deferred = null;
      notify();
      await evt.prompt();
      const choice = await evt.userChoice.catch(() => null);
      return choice?.outcome === "accepted";
    },
  };
}
