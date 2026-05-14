import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STORES, type Store } from "../../../shared/hotspot";
import { Building2, Clock, Delete, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const LOGO_URL = "/manus-storage/hotspot-wordmark_de6a4f29.png";

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

type FlashState =
  | { kind: "success"; action: "in" | "out"; name: string; at: Date; durationHours?: number }
  | { kind: "error"; message: string };

export default function ClockKiosk() {
  const [, params] = useRoute<{ store?: string }>("/clock/:store");
  const [, navigate] = useLocation();
  const initialStore = decodeStoreFromUrl(params?.store);

  const [store, setStore] = useState<Store | null>(initialStore);
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
        durationHours: "durationHours" in data ? (data.durationHours as number | undefined) : undefined,
      });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 6000);
    },
    onError: (err) => {
      setCode("");
      setFlash({ kind: "error", message: err.message ?? "Code not recognized." });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 4000);
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
      <div className="min-h-screen bg-gradient-to-b from-white via-zinc-50 to-zinc-100">
        <div className="container max-w-5xl pt-12 pb-16">
          <div className="flex flex-col items-center text-center">
            <div className="flex flex-col items-center gap-2">
              <img src={LOGO_URL} alt="Hotspot Market" className="h-16 w-auto" />
              <span className="inline-flex items-center rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
                MARKET
              </span>
            </div>
            <div className="mt-8 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
              <Clock className="h-4 w-4" /> Time Clock Kiosk
            </div>
            <h1 className="mt-2 text-3xl font-bold">Select your store</h1>
            <p className="mt-2 text-zinc-600">
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
                  className="group flex items-center justify-between rounded-2xl border-2 border-zinc-200 bg-white p-6 text-left shadow-sm transition-all hover:border-red-500 hover:shadow-md active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-red-50 p-3 text-red-600 group-hover:bg-red-100">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-zinc-900">{s}</div>
                      <div className="text-sm text-zinc-500">Open kiosk</div>
                    </div>
                  </div>
                  <div className="text-zinc-400 transition-transform group-hover:translate-x-1">
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
        ? "from-emerald-500/95 to-emerald-600/95"
        : "from-sky-500/95 to-sky-600/95"
      : "from-red-500/95 to-red-600/95";

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-white via-zinc-50 to-zinc-100">
      {/* Header */}
      <div className="container max-w-3xl pt-8">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-start gap-1">
            <img src={LOGO_URL} alt="Hotspot Market" className="h-10 w-auto" />
            <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-white">
              MARKET
            </span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-zinc-900">
              {formatClock(now)}
            </div>
            <div className="text-xs text-zinc-500">{formatDate(now)}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-50 p-2 text-red-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500">Punching at</div>
              <div className="font-semibold text-zinc-900">{store}</div>
            </div>
          </div>
          <button
            onClick={() => {
              setStore(null);
              setCode("");
              navigate("/clock");
            }}
            className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
          >
            Change store
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="container max-w-3xl pt-8 pb-12">
        <Card className="border-zinc-200 shadow-md">
          <CardContent className="px-6 py-8">
            <div className="flex flex-col items-center">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
                <ShieldCheck className="h-4 w-4" /> Enter your 4-digit code
              </div>
              <h1 className="mt-2 text-3xl font-bold">Clock In or Out</h1>
              <p className="mt-1 text-zinc-600">
                The system will punch you in if you're out, or out if you're in.
              </p>

              <div className="mt-6 flex items-center gap-4">
                {dots.map((filled, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-5 w-5 rounded-full border-2 transition-all",
                      filled
                        ? "scale-110 border-red-500 bg-red-500"
                        : "border-zinc-300 bg-white",
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
                <div className="mt-4 text-sm text-zinc-500">Checking…</div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-zinc-400">
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
            style={{
              animation:
                "kiosk-flash 220ms cubic-bezier(0.23, 1, 0.32, 1)",
            }}
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
                {flash.action === "out" && flash.durationHours !== undefined && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
                    Shift: {flash.durationHours.toFixed(2)} h
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center">
                <div className="text-sm font-semibold uppercase tracking-[0.18em]">
                  Try Again
                </div>
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
        "h-16 text-2xl font-semibold transition-transform active:scale-95 select-none",
        variant === "primary"
          ? "bg-zinc-50 hover:bg-zinc-100 border-zinc-200"
          : "bg-white hover:bg-zinc-50 border-zinc-200 text-zinc-600",
      )}
      {...rest}
    >
      {children}
    </Button>
  );
}
