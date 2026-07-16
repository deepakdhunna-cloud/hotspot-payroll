import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Public kiosk page. Behaves in two ways:
 *  - If launched from a logged-in manager session, the store is detected from
 *    the session scope and the picker is skipped entirely.
 *  - Otherwise (cold tablet, CEO, or no session) it falls back to a manual
 *    store picker. We intentionally do NOT render any link back into the app:
 *    this tab is meant to live on the counter, and the only way "out" is to
 *    close the tab.
 *
 * After every punch the kiosk shows the employee's week so far — hours worked
 * against hours scheduled — and flags over-clocked time on the spot.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STORES, type Store } from "../../../shared/hotspot";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Clock,
  Delete,
  LogIn,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";

function isStore(value: string | undefined): value is Store {
  return !!value && (STORES as readonly string[]).includes(value);
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

function formatClock(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}
function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

type WeekSummary = {
  workedHours: number;
  scheduledHours: number;
  overClocked: boolean;
  overClockedBy: number;
  todayShifts: { startLabel: string | null; endLabel: string | null; hours: number }[];
};

type FlashState =
  | {
      kind: "success";
      action: "in" | "out";
      name: string;
      at: Date;
      durationHours?: number | null;
      week?: WeekSummary;
    }
  | { kind: "error"; message: string };

export default function ClockKiosk() {
  const [, params] = useRoute<{ store?: string }>("/clock/:store");
  const [, navigate] = useLocation();
  const initialStore = decodeStoreFromUrl(params?.store);

  const scopeQ = trpc.meta.myScope.useQuery(undefined, {
    retry: false,
    throwOnError: false,
  });
  const sessionStore =
    scopeQ.data && !scopeQ.data.isAdmin && scopeQ.data.stores.length === 1
      ? scopeQ.data.stores[0]
      : null;

  const [store, setStore] = useState<Store | null>(initialStore);
  useEffect(() => {
    if (!store && sessionStore && isStore(sessionStore)) {
      setStore(sessionStore as Store);
      navigate(`/clock/${encodeURIComponent(sessionStore)}`, { replace: true });
    }
  }, [sessionStore, store, navigate]);

  // Trap browser-back so the counter tablet can't navigate into the app.
  useEffect(() => {
    const sentinel = () => window.history.pushState({ kiosk: true }, "");
    sentinel();
    const onPop = () => sentinel();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [code, setCode] = useState("");
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [now, setNow] = useState(new Date());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const punch = trpc.clock.punch.useMutation({
    onSuccess: (data) => {
      setCode("");
      setFlash({
        kind: "success",
        action: data.action,
        name: data.employee.fullName,
        at: new Date(data.at),
        durationHours: data.durationHours,
        week: data.week,
      });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      // Punch-out shows the week summary — give people time to read it.
      flashTimer.current = setTimeout(() => setFlash(null), data.action === "out" ? 9000 : 6000);
    },
    onError: (err) => {
      setCode("");
      setFlash({ kind: "error", message: err.message ?? "Code not recognized." });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 5000);
    },
  });

  const submit = (full: string) => {
    if (!store) return;
    if (full.length !== 4) return;
    punch.mutate({ store, code: full });
  };

  const handleKey = (digit: string) => {
    if (punch.isPending) return;
    if (code.length >= 4) return;
    const next = code + digit;
    setCode(next);
    if (next.length === 4) {
      setTimeout(() => submit(next), 80);
    }
  };
  const handleBackspace = () => {
    if (punch.isPending) return;
    setCode((c) => c.slice(0, -1));
  };

  // Hardware keyboard support so a USB number pad on the tablet works too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!store) return;
      if (/^[0-9]$/.test(e.key)) handleKey(e.key);
      else if (e.key === "Backspace") handleBackspace();
      else if (e.key === "Enter" && code.length === 4) submit(code);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, code, punch.isPending]);

  const dots = useMemo(() => Array.from({ length: 4 }, (_, i) => i < code.length), [code]);

  if (!store) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-5xl pt-12 pb-16">
          <div className="flex flex-col items-center text-center">
            <BrandMark size="lg" />
            <div className="mt-8 eyebrow flex items-center gap-2">
              <Clock className="h-4 w-4" /> Time Clock Kiosk
            </div>
            <h1
              className="mt-2 text-3xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Select your store
            </h1>
            <p className="mt-2 text-muted-foreground">
              Tap your location to start the time clock. The choice is remembered on this device.
            </p>
            <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              {STORES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStore(s);
                    navigate(`/clock/${encodeURIComponent(s)}`);
                  }}
                  className="group flex items-center justify-between rounded-2xl border-2 border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary group-hover:bg-primary/15 transition-colors">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">{s}</div>
                      <div className="text-sm text-muted-foreground">Open kiosk</div>
                    </div>
                  </div>
                  <div className="text-muted-foreground transition-transform group-hover:translate-x-1">
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
        ? "from-emerald-600/95 to-emerald-700/95"
        : "from-sky-600/95 to-sky-700/95"
      : "from-red-600/95 to-red-700/95";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Header */}
      <div className="container max-w-3xl pt-8">
        <div className="flex items-center justify-between">
          <BrandMark size="md" className="items-start" />
          <div className="text-right">
            <div
              className="text-3xl font-semibold tabular-nums"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {formatClock(now)}
            </div>
            <div className="text-xs text-muted-foreground">{formatDate(now)}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="kpi-label">Punching at</div>
              <div className="font-semibold">{store}</div>
            </div>
          </div>
          {sessionStore ? (
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Locked
            </span>
          ) : (
            <button
              onClick={() => {
                setStore(null);
                setCode("");
                navigate("/clock");
              }}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Change store
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="container max-w-3xl pt-8 pb-12">
        <Card className="surface-card border-0">
          <CardContent className="px-6 py-8">
            <div className="flex flex-col items-center">
              <div className="eyebrow flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Enter your 4-digit code
              </div>
              <h1
                className="mt-2 text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Clock In or Out
              </h1>
              <p className="mt-1 text-muted-foreground">
                The system punches you in if you're out, or out if you're in.
              </p>

              <div className="mt-6 flex items-center gap-4">
                {dots.map((filled, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-5 w-5 rounded-full border-2 transition-all duration-150",
                      filled ? "scale-110 border-primary bg-primary" : "border-input bg-card",
                    )}
                  />
                ))}
              </div>

              <div className="mt-8 grid w-full max-w-sm grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <KeyButton key={d} onClick={() => handleKey(d)}>
                    {d}
                  </KeyButton>
                ))}
                <div />
                <KeyButton onClick={() => handleKey("0")}>0</KeyButton>
                <KeyButton onClick={handleBackspace} variant="muted" aria-label="Backspace">
                  <Delete className="h-6 w-6" />
                </KeyButton>
              </div>
              {punch.isPending && (
                <div className="mt-4 text-sm text-muted-foreground">Checking…</div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Forget your code? Ask your manager — codes are managed from each employee profile.
        </p>
      </div>

      {/* Flash overlay */}
      {flash && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className={cn(
              "pointer-events-auto w-full max-w-md rounded-3xl bg-gradient-to-br p-8 text-white shadow-2xl",
              overlayClass,
            )}
            style={{ animation: "kiosk-flash 220ms cubic-bezier(0.23, 1, 0.32, 1)" }}
          >
            {flash.kind === "success" ? (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
                  {flash.action === "in" ? (
                    <LogIn className="h-7 w-7" />
                  ) : (
                    <LogOut className="h-7 w-7" />
                  )}
                </div>
                <div className="mt-4 text-sm font-semibold uppercase tracking-[0.18em]">
                  {flash.action === "in" ? "Clocked In" : "Clocked Out"}
                </div>
                <div className="mt-1 text-2xl font-bold">{flash.name}</div>
                <div className="mt-2 text-white/90 tabular-nums">
                  {formatClock(flash.at)} · {formatDate(flash.at)}
                </div>

                {flash.action === "out" &&
                flash.durationHours !== undefined &&
                flash.durationHours !== null ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm tabular-nums">
                    This shift: {flash.durationHours.toFixed(2)} h
                  </div>
                ) : null}

                {flash.action === "in" && flash.week && flash.week.todayShifts.length > 0 ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
                    <CalendarClock className="h-4 w-4" />
                    Today:{" "}
                    {flash.week.todayShifts
                      .map((s) =>
                        s.startLabel && s.endLabel
                          ? `${s.startLabel} – ${s.endLabel}`
                          : `${s.hours.toFixed(1)}h`,
                      )
                      .join(", ")}
                  </div>
                ) : null}

                {flash.week && flash.week.scheduledHours > 0 ? (
                  <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between tabular-nums">
                      <span className="text-white/85">This week</span>
                      <span className="font-semibold">
                        {flash.week.workedHours.toFixed(1)}h of{" "}
                        {flash.week.scheduledHours.toFixed(1)}h scheduled
                      </span>
                    </div>
                    {flash.week.overClocked ? (
                      <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {flash.week.overClockedBy.toFixed(1)}h over schedule — your manager can
                        see this
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-center">
                <div className="text-sm font-semibold uppercase tracking-[0.18em]">Try Again</div>
                <div className="mt-1 text-xl font-semibold">{flash.message}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes kiosk-flash {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
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
        variant === "primary"
          ? "bg-secondary hover:bg-accent border-border"
          : "bg-card hover:bg-secondary border-border text-muted-foreground",
      )}
      {...rest}
    >
      {children}
    </Button>
  );
}
