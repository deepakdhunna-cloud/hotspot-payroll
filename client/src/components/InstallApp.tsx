/**
 * "Add to Home Screen" — managers save the site to their phone's home
 * screen and use it full screen, like an app.
 *
 * Browsers differ in how that is done, so this file hides the difference:
 *  - Chrome / Edge / Android hand us an install prompt we can trigger from a
 *    button.
 *  - iPhone and iPad have no prompt; the steps are Share → Add to Home
 *    Screen, so we show them.
 *
 * `useInstallState` says which of those applies and whether the app is
 * already running from the home screen. `InstallDialog` is the guide;
 * `InstallNudge` is the one-time reminder on the dashboard for phones.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandGlyph } from "@/components/BrandMark";
import { MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// The browser fires its install prompt once, early — often before any
// component has mounted — so it is captured here, at module load.
let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isAppleTouch() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; a Mac has no touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useInstallState() {
  const canPrompt = useSyncExternalStore(
    subscribe,
    () => deferredPrompt !== null,
    () => false,
  );
  const wasInstalled = useSyncExternalStore(
    subscribe,
    () => installed,
    () => false,
  );
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    if (!mq) return;
    const onChange = () => setStandalone(isStandalone());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const promptInstall = async () => {
    const event = deferredPrompt;
    if (!event) return false;
    await event.prompt();
    const choice = await event.userChoice;
    deferredPrompt = null;
    notify();
    return choice.outcome === "accepted";
  };

  return {
    /** Already running from the home screen (or just installed). */
    standalone: standalone || wasInstalled,
    /** The browser offered a one-tap install. */
    canPrompt,
    /** iPhone / iPad: installing is done from the Share menu. */
    apple: isAppleTouch(),
    promptInstall,
  };
}

function Step({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="min-w-0 text-sm leading-relaxed">{children}</span>
    </li>
  );
}

const inlineIcon = "mx-0.5 inline h-4 w-4 align-[-3px]";

export function InstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { canPrompt, apple, promptInstall } = useInstallState();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex justify-center sm:justify-start">
            <span className="ink flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ink)] shadow-sm">
              <BrandGlyph className="h-6" />
            </span>
          </div>
          <DialogTitle>Add Hotspot to your Home Screen</DialogTitle>
          <DialogDescription>
            It opens full screen like an app, with its own icon — no browser
            bars, and you stay signed in.
          </DialogDescription>
        </DialogHeader>

        {canPrompt ? (
          <p className="text-sm text-muted-foreground">
            This browser can install it for you in one step.
          </p>
        ) : apple ? (
          <ol className="space-y-3">
            <Step n={1}>
              Tap <Share className={inlineIcon} aria-hidden />
              <span className="font-medium">Share</span> in Safari&apos;s toolbar.
            </Step>
            <Step n={2}>
              Scroll down and tap <PlusSquare className={inlineIcon} aria-hidden />
              <span className="font-medium">Add to Home Screen</span>.
            </Step>
            <Step n={3}>
              Tap <span className="font-medium">Add</span>, then open{" "}
              <span className="font-medium">Hotspot</span> from your Home Screen.
            </Step>
          </ol>
        ) : (
          <ol className="space-y-3">
            <Step n={1}>
              Open your browser&apos;s menu{" "}
              <MoreVertical className={inlineIcon} aria-hidden />.
            </Step>
            <Step n={2}>
              Choose <span className="font-medium">Install app</span> or{" "}
              <span className="font-medium">Add to Home screen</span>.
            </Step>
            <Step n={3}>
              Open <span className="font-medium">Hotspot</span> from your home
              screen or app list.
            </Step>
          </ol>
        )}

        <DialogFooter>
          {canPrompt ? (
            <Button
              onClick={async () => {
                const ok = await promptInstall();
                if (ok) onOpenChange(false);
              }}
            >
              <Smartphone className="h-4 w-4" /> Install
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NUDGE_KEY = "hotspot.install-nudge";

/**
 * One quiet line on the dashboard, on phones and tablets only, until the
 * app is on the home screen or the manager dismisses it.
 */
export function InstallNudge() {
  const { standalone } = useInstallState();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === "dismissed";
    } catch {
      return false;
    }
  });
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

  if (standalone || hidden || !touch) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(NUDGE_KEY, "dismissed");
    } catch {
      /* storage unavailable — it will ask again next visit */
    }
  };

  return (
    <>
      <div className="surface-card flex items-center gap-3 py-2 pl-3 pr-1.5">
        <span className="ink flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem] bg-[var(--ink)]">
          <BrandGlyph className="h-4" />
        </span>
        <p className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">Add Hotspot to your Home Screen</span>
          <span className="block truncate text-xs text-muted-foreground">
            Opens full screen, like an app
          </span>
        </p>
        <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setOpen(true)}>
          How
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <InstallDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
