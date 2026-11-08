import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ArrowRight, Delete } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { BrandMark } from "@/components/BrandMark";

const MIN_PIN = 4;
const MAX_PIN = 8;

/**
 * Full-screen PIN sign-in. Accepts 4–8 digit PINs (matching what the CEO can
 * set), via touch keypad or hardware keyboard. Submit is explicit — no
 * auto-fire — so longer PINs never trigger a premature failed attempt.
 */
export default function PinKeypad() {
  const utils = trpc.useUtils();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [location, setLocation] = useLocation();

  const verify = trpc.auth.verifyPin.useMutation({
    onSuccess: async (data) => {
      toast.success(
        data.role === "admin"
          ? "Welcome, CEO"
          : data.role === "cfo"
            ? "Welcome, CFO"
            : `Signed in to ${data.store}`,
      );
      // Land each role on its own ground BEFORE the session hydrates, so
      // switching accounts never flashes a page the new role can't use.
      if (data.role === "cfo" && location !== "/cfo") {
        setLocation("/cfo", { replace: true });
      } else if (
        data.role === "manager" &&
        (location === "/ceo" || location === "/cfo")
      ) {
        setLocation("/", { replace: true });
      }
      await utils.auth.me.invalidate();
    },
    onError: (e) => {
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      toast.error(e.message || "Incorrect PIN");
    },
  });

  const canSubmit = pin.length >= MIN_PIN && !verify.isPending;

  // verify.mutate is stable across renders (react-query); depending on it +
  // primitives keeps these callbacks (and the keydown effect below) stable.
  const { mutate, isPending } = verify;

  const submit = useCallback(() => {
    if (pin.length >= MIN_PIN && !isPending) {
      mutate({ pin });
    }
  }, [pin, isPending, mutate]);

  const push = useCallback(
    (d: string) => {
      if (isPending) return;
      setPin((p) => (p.length >= MAX_PIN ? p : p + d));
    },
    [isPending],
  );

  const back = useCallback(() => {
    if (isPending) return;
    setPin((p) => p.slice(0, -1));
  }, [isPending]);

  // Hardware keyboard: digits, Backspace, Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) push(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, back, submit]);

  // 4 base dots; dots 5–8 appear as the PIN grows past 4.
  const dotCount = Math.max(MIN_PIN, pin.length);

  return (
    <div className="ink-panel min-h-svh flex items-center justify-center p-4">
      <div className="w-full max-w-[22rem] flex flex-col items-center gap-8">
        <BrandMark size="lg" tone="ink" />

        <div className="relative w-full overflow-hidden rounded-2xl bg-card text-card-foreground p-6 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.7)]">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1"
            style={{
              background:
                "linear-gradient(90deg, var(--brand-red-bright), oklch(0.7 0.18 45) 55%, oklch(0.78 0.15 75))",
            }}
          />
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Enter your store PIN, or the CEO PIN.
            </p>
          </div>

          {/* PIN dots */}
          <div
            className={`flex items-center justify-center gap-3 my-6 ${shake ? "animate-shake" : ""}`}
            role="status"
            style={{ minHeight: 24 }}
            aria-label={`${pin.length} digits entered`}
          >
            {Array.from({ length: dotCount }).map((_, i) => (
              <div
                key={i}
                className={`h-3 w-3 rounded-full border-2 transition-all duration-150 ${
                  pin.length > i
                    ? "bg-foreground border-foreground scale-110"
                    : "border-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2.5 w-full">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadKey key={d} onClick={() => push(d)} disabled={verify.isPending}>
                {d}
              </KeypadKey>
            ))}
            <KeypadKey
              onClick={back}
              disabled={verify.isPending || pin.length === 0}
              variant="ghost"
              aria-label="Delete digit"
            >
              <Delete className="h-5 w-5" />
            </KeypadKey>
            <KeypadKey onClick={() => push("0")} disabled={verify.isPending}>
              0
            </KeypadKey>
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              aria-label="Sign in"
              className="h-14 text-lg font-semibold rounded-xl"
            >
              {verify.isPending ? "…" : <ArrowRight className="h-6 w-6" />}
            </Button>
          </div>
        </div>

        <p className="text-xs text-white/45 text-center">
          Hotspot Market · Payroll &amp; time clock
        </p>
      </div>
    </div>
  );
}

function KeypadKey({
  children,
  onClick,
  disabled,
  variant = "default",
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "ghost";
} & React.AriaAttributes) {
  return (
    <Button
      type="button"
      variant={variant === "ghost" ? "ghost" : "secondary"}
      onClick={onClick}
      disabled={disabled}
      className="h-14 text-2xl font-medium tabular-nums rounded-xl"
      {...rest}
    >
      {children}
    </Button>
  );
}
