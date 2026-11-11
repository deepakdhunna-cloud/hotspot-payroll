import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { fmtDayHeading, fmtDuration, fmtTime } from "@/lib/payweek";
import { fmtHoursLabel } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import {
  clearKioskLock,
  getKioskStore,
  kioskPath,
  lockKioskToStore,
  markKioskTab,
} from "@/lib/kioskLock";

/**
 * Public kiosk page. Behaves in two ways:
 *  - If launched from a logged-in manager session, the store is detected from
 *    the session scope and the picker is skipped entirely.
 *  - Otherwise (cold tablet, CEO, or no session) it falls back to a manual
 *    store picker. The kiosk renders NO link back into the app for anyone —
 *    the only way "out" is closing the tab. A person's browser still can't
 *    be trapped by the tablet lock: the router releases signed-in browsers
 *    automatically, and ?exit is the escape for signed-out ones.
 *
 * After every punch the kiosk shows the employee's week so far — hours worked
 * against hours scheduled — and flags over-clocked time on the spot. The
 * result card can be tapped away (or the next person just starts typing),
 * so a line at shift change never waits on it. Times are store time.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STORES, type Store } from "../../../shared/hotspot";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Delete,
  LogIn,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";

// Stores can be added from the command center, so a store name in the URL
// or session is first taken as given (any plausible name) and then checked
// against the server's list once that has loaded — see the effect below.
function isStore(value: string | undefined): value is Store {
  return !!value && value.trim().length >= 3 && value.length <= 64;
}

function decodeStoreFromUrl(raw: string | undefined): Store | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return isStore(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// Derive the week-summary shape from the server so the contract has exactly
// one source of truth.
type PunchResult = inferRouterOutputs<AppRouter>["clock"]["punch"];
type WeekSummary = PunchResult["week"];

type FlashState =
  | {
      kind: "success";
      action: "in" | "out";
      /** A second tap inside the server's repeat window — nothing changed. */
      repeat: boolean;
      name: string;
      at: Date;
      durationHours?: number | null;
      week?: WeekSummary;
    }
  | { kind: "error"; message: string };

/** How long each result stays up unless it's tapped away. */
const FLASH_MS = { in: 6000, out: 9000, repeat: 5000, error: 5000 } as const;

function announce(flash: FlashState | null): string {
  if (!flash) return "";
  if (flash.kind === "error") return `Try again. ${flash.message}`;
  const time = fmtTime(flash.at);
  if (flash.repeat) {
    return flash.action === "in"
      ? `${flash.name} is already clocked in, since ${time}.`
      : `${flash.name} is already clocked out, at ${time}.`;
  }
  return flash.action === "in"
    ? `Clocked in: ${flash.name} at ${time}.`
    : `Clocked out: ${flash.name} at ${time}.`;
}

export default function ClockKiosk() {
  const [, params] = useRoute<{ store?: string }>("/clock/:store");
  const [, navigate] = useLocation();
  const routeStore = decodeStoreFromUrl(params?.store);
  const initialStore = getKioskStore() ?? routeStore;

  const scopeQ = trpc.meta.myScope.useQuery(undefined, {
    retry: false,
    throwOnError: false,
  });
  const sessionStore =
    scopeQ.data && !scopeQ.data.isAdmin && scopeQ.data.stores.length === 1
      ? scopeQ.data.stores[0]
      : null;

  const [store, setStore] = useState<Store | null>(initialStore);
  usePageTitle(store ? `Time clock · ${store}` : "Time clock");

  // The stores this business has right now (built-in ones until it loads).
  const optionsQ = trpc.meta.options.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const storeList: readonly string[] = optionsQ.data?.stores ?? STORES;
  // A store that doesn't exist — a mistyped link, or a tablet remembering a
  // name the business doesn't have — falls back to the store picker rather
  // than a keypad that refuses every code. Only once the server's list has
  // actually loaded: until then the remembered store is trusted.
  useEffect(() => {
    if (!optionsQ.data || !store) return;
    if (!optionsQ.data.stores.includes(store)) {
      if (getKioskStore() === store) clearKioskLock();
      setStore(null);
      navigate("/clock", { replace: true });
    }
  }, [optionsQ.data, store, navigate]);
  useEffect(() => {
    const lockedStore = getKioskStore();
    if (lockedStore) {
      if (store !== lockedStore) setStore(lockedStore);
      if (routeStore !== lockedStore) navigate(kioskPath(lockedStore), { replace: true });
      return;
    }

    // Select the store from the session or URL, but do NOT persist the
    // tablet lock here — merely opening a kiosk link must never lock a
    // manager's own browser. The lock is set only by the explicit store
    // picker tap below (tablet setup).
    const selectedStore = store ?? (sessionStore && isStore(sessionStore) ? sessionStore : null);
    if (!selectedStore) return;
    if (store !== selectedStore) setStore(selectedStore);
    if (routeStore !== selectedStore) navigate(kioskPath(selectedStore), { replace: true });
  }, [sessionStore, store, routeStore, navigate]);

  // Seal this TAB as a kiosk: the router bounces every non-kiosk route
  // (back button included) straight back to the clock from here on.
  useEffect(() => {
    if (store) markKioskTab(store);
  }, [store]);

  // Trap browser-back so the counter tablet can't navigate into the app.
  // Belt to the router seal's braces — a fast double-back can beat this
  // history trick alone, but the router check above catches whatever
  // slips through.
  useEffect(() => {
    const sentinel = () => window.history.pushState({ kiosk: true }, "");
    sentinel();
    const onPop = () => sentinel();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [code, setCodeState] = useState("");
  // The ref is the source of truth while typing, so two fast key presses
  // between renders (USB number pads) never drop a digit.
  const codeRef = useRef("");
  const setCode = useCallback((next: string) => {
    codeRef.current = next;
    setCodeState(next);
  }, []);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One punch at a time: a second submit while one is in flight (double
  // tap, a stray Enter) is dropped before it ever reaches the server.
  const inFlight = useRef(false);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const showFlash = useCallback((next: FlashState, ms: number) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(next);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

  const dismissFlash = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = null;
    setFlash(null);
  }, []);

  const punch = trpc.clock.punch.useMutation({
    onSuccess: (data) => {
      setCode("");
      const repeat = "repeat" in data && data.repeat === true;
      showFlash(
        {
          kind: "success",
          action: data.action,
          repeat,
          name: data.employee.fullName,
          at: new Date(data.at),
          durationHours: data.durationHours,
          week: data.week,
        },
        repeat ? FLASH_MS.repeat : FLASH_MS[data.action],
      );
    },
    onError: (err) => {
      setCode("");
      showFlash(
        { kind: "error", message: errorMessage(err, "Code not recognized at this store.") },
        FLASH_MS.error,
      );
    },
  });
  const isPending = punch.isPending;
  const { mutate } = punch;

  const submit = useCallback(
    (full: string) => {
      if (!store || full.length !== 4 || inFlight.current) return;
      inFlight.current = true;
      mutate(
        { store, code: full },
        {
          onSettled: () => {
            inFlight.current = false;
          },
        },
      );
    },
    [store, mutate],
  );

  const handleKey = useCallback(
    (digit: string) => {
      if (isPending || inFlight.current) return;
      // The next person can start typing right away; their first digit
      // clears the previous result.
      if (flash) dismissFlash();
      const current = codeRef.current;
      if (current.length >= 4) return;
      const next = current + digit;
      setCode(next);
      if (next.length === 4) {
        setTimeout(() => submit(next), 80);
      }
    },
    [isPending, flash, dismissFlash, submit, setCode],
  );
  const handleBackspace = useCallback(() => {
    if (isPending || inFlight.current) return;
    setCode(codeRef.current.slice(0, -1));
  }, [isPending, setCode]);

  // Hardware keyboard support so a USB number pad on the tablet works too.
  // Four digits submit on their own — there is deliberately no Enter key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!store) return;
      if (/^[0-9]$/.test(e.key)) handleKey(e.key);
      else if (e.key === "Backspace") handleBackspace();
      else if (e.key === "Escape") dismissFlash();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, handleKey, handleBackspace, dismissFlash]);

  const dots = useMemo(() => Array.from({ length: 4 }, (_, i) => i < code.length), [code]);

  if (!store) {
    return (
      <div className="ink-panel min-h-screen">
        <div className="container max-w-5xl pt-12 pb-16">
          <div className="flex flex-col items-center text-center">
            <BrandMark size="lg" tone="ink" />
            <h1 className="mt-10 text-3xl font-semibold tracking-tight text-white">
              Which store is this tablet at?
            </h1>
            <p className="mt-2 text-white/70">This device will remember it.</p>
            <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              {(storeList as Store[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    lockKioskToStore(s);
                    setStore(s);
                    navigate(kioskPath(s));
                  }}
                  className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition-all hover:border-white/25 hover:bg-white/[0.08]"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-white/[0.08] p-3 text-white/75" aria-hidden>
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="text-lg font-semibold text-white">{s}</div>
                  </div>
                  <div
                    className="text-white/50 transition-transform group-hover:translate-x-1 group-hover:text-white/80"
                    aria-hidden
                  >
                    →
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const overlayClass =
    flash?.kind === "success"
      ? flash.action === "in"
        ? "kiosk-flash-in"
        : "kiosk-flash-out"
      : "kiosk-flash-error";

  return (
    <div className="ink-panel relative min-h-screen overflow-hidden">
      {/* Screen readers hear every result, even though the card fades. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce(flash)}
      </div>

      {/* Header */}
      <div className="container max-w-3xl pt-8">
        <div className="flex items-center justify-between">
          <BrandMark size="md" className="items-start" tone="ink" />
          <LiveClock />
        </div>

        <p className="mt-5 flex items-center gap-2 text-sm text-white/70">
          <Building2 className="h-4 w-4" aria-hidden />
          <span className="font-medium text-white/90">{store}</span>
        </p>
      </div>

      {/* Body — the keypad floats on a paper card against the ink frame. */}
      <div className="container max-w-3xl pt-8 pb-12">
        <Card className="border-0 rounded-3xl bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.3),0_24px_60px_-24px_rgb(0_0_0/0.7)]">
          <CardContent className="px-6 py-8">
            <div className="flex flex-col items-center">
              <h1 className="text-3xl font-semibold tracking-tight">Clock in or out</h1>
              {/* Doubles as the status line, so checking a code adds no height. */}
              <p className="mt-1 text-muted-foreground" role="status" aria-live="polite">
                {isPending ? "Checking your code…" : "Enter your 4-digit code."}
              </p>

              <div className="mt-6 flex items-center gap-4" aria-hidden>
                {dots.map((filled, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-5 w-5 rounded-full border-2 transition-all duration-150",
                      filled ? "scale-110 border-foreground bg-foreground" : "border-input bg-card",
                    )}
                  />
                ))}
              </div>
              <p className="sr-only" aria-live="polite">
                {code.length > 0 ? `${code.length} of 4 digits entered` : ""}
              </p>

              <div className="mt-8 grid w-full max-w-sm grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <KeyButton key={d} onClick={() => handleKey(d)}>
                    {d}
                  </KeyButton>
                ))}
                <div />
                <KeyButton onClick={() => handleKey("0")}>0</KeyButton>
                <KeyButton onClick={handleBackspace} variant="muted" aria-label="Delete last digit">
                  <Delete className="h-6 w-6" aria-hidden />
                </KeyButton>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-sm text-white/70">
          Forgot your code? Ask your manager — codes are set on each employee&apos;s profile.
        </p>
      </div>

      {/* Result card: tap it (or start typing) to clear it early. */}
      {flash && (
        <div className="kiosk-scrim pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className={cn(
              "kiosk-flash-pop pointer-events-auto w-full max-w-md cursor-pointer rounded-3xl p-8 text-white shadow-2xl",
              overlayClass,
            )}
            onClick={dismissFlash}
          >
            {flash.kind === "success" ? (
              <div className="text-center">
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/20"
                  aria-hidden
                >
                  {flash.repeat ? (
                    <CheckCircle2 className="h-7 w-7" />
                  ) : flash.action === "in" ? (
                    <LogIn className="h-7 w-7" />
                  ) : (
                    <LogOut className="h-7 w-7" />
                  )}
                </div>
                <div className="mt-4 text-base font-semibold text-white/90">
                  {flash.repeat
                    ? flash.action === "in"
                      ? "Already clocked in"
                      : "Already clocked out"
                    : flash.action === "in"
                      ? "Clocked in"
                      : "Clocked out"}
                </div>
                <div className="mt-1 text-2xl font-bold">{flash.name}</div>
                <div className="mt-2 text-white/90 tabular-nums">
                  {flash.repeat ? (flash.action === "in" ? "Since " : "At ") : ""}
                  {fmtTime(flash.at)} · {fmtDayHeading(flash.at)}
                </div>

                {flash.repeat ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
                    You&apos;re all set — no need to tap again.
                  </div>
                ) : null}

                {!flash.repeat &&
                flash.action === "out" &&
                flash.durationHours !== undefined &&
                flash.durationHours !== null ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm tabular-nums">
                    This shift: {fmtDuration(flash.durationHours)}
                  </div>
                ) : null}

                {!flash.repeat &&
                flash.action === "in" &&
                flash.week &&
                flash.week.todayShifts.length > 0 ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
                    <CalendarClock className="h-4 w-4" aria-hidden />
                    Today:{" "}
                    {flash.week.todayShifts
                      .map((s) =>
                        s.startLabel && s.endLabel
                          ? `${s.startLabel} – ${s.endLabel}`
                          : fmtHoursLabel(s.hours),
                      )
                      .join(", ")}
                  </div>
                ) : null}

                {!flash.repeat && flash.week && flash.week.scheduledHours > 0 ? (
                  <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 tabular-nums">
                      <span className="text-white/85">This week</span>
                      <span className="font-semibold">
                        {fmtHoursLabel(flash.week.workedHours)} of{" "}
                        {fmtHoursLabel(flash.week.scheduledHours)} scheduled
                      </span>
                    </div>
                    {flash.week.overClocked ? (
                      <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        {fmtHoursLabel(flash.week.overClockedBy)} over schedule — your manager
                        can see this
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-center">
                <div className="text-base font-semibold text-white/90">Try again</div>
                <div className="mt-1 text-xl font-semibold">{flash.message}</div>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissFlash();
              }}
              className="mx-auto mt-5 block rounded-full px-4 py-2 text-sm font-medium text-white/85 underline-offset-4 hover:text-white hover:underline"
            >
              Tap to close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Ticking header clock, isolated in its own component so the once-per-second
 * re-render stays here instead of reconciling the whole kiosk tree — this
 * page runs 24/7 on the counter tablet.
 */
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right">
      <div className="text-3xl font-semibold tracking-tight tabular-nums text-white">
        {fmtTime(now)}
      </div>
      <div className="text-xs text-white/70">{fmtDayHeading(now)}</div>
    </div>
  );
}

function KeyButton({
  children,
  onClick,
  variant = "primary",
  ...rest
}: React.ComponentPropsWithoutRef<"button"> & { variant?: "primary" | "muted" }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="outline"
      size="lg"
      className={cn(
        "h-16 text-2xl font-semibold select-none",
        variant === "primary" ? "sk-keycap" : "sk-keycap text-muted-foreground",
      )}
      {...rest}
    >
      {children}
    </Button>
  );
}
