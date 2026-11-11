import { trpc } from "@/lib/trpc";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { ArrowRight, Delete, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { errorMessage } from "@/lib/errors";

import { BrandMark } from "@/components/BrandMark";
import { ThemeMenu } from "@/components/ThemeSwitch";

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
  usePageTitle("Sign in");
  const [shake, setShake] = useState(false);
  // Said in place, under the dots, so a wrong PIN is never silent.
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useLocation();

  const verify = trpc.auth.verifyPin.useMutation({
    onSuccess: async (data) => {
      // No "signed in" toast: the dashboard greeting and scope already say
      // it, and a toast here sat on top of the account menu on phones.
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
      setError(
        /incorrect pin/i.test(e.message ?? "")
          ? "That PIN didn't match. Try again."
          : errorMessage(e, "That PIN didn't match. Try again."),
      );
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
      setError(null);
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
    <div className="auth-screen relative flex items-center justify-center px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <ThemeMenu className="chrome-btn absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))]" />
      <div className="flex w-full max-w-[21rem] flex-col items-center">
        <BrandMark size="lg" className="h-14 sm:h-16" />

        <div className="mt-8 flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Enter your PIN to open payroll.</p>
        </div>

        {/* PIN dots */}
        <div
          className={`mt-6 flex items-center justify-center gap-3.5 ${shake ? "animate-shake" : ""}`}
          role="status"
          style={{ minHeight: 24 }}
          aria-label={`${pin.length} digits entered`}
        >
          {Array.from({ length: dotCount }).map((_, i) => (
            <div
              key={i}
              className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
                pin.length > i
                  ? "scale-110 bg-foreground"
                  : "bg-[var(--border-strong)]"
              }`}
            />
          ))}
        </div>

        <p
          role="alert"
          className={`mt-3 mb-4 min-h-5 text-center text-sm font-medium ${
            error ? "text-destructive" : "text-transparent"
          }`}
        >
          {error ?? "."}
        </p>

        {/* Keypad */}
        <div className="grid w-full grid-cols-3 gap-3">
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
            <Delete className="h-6 w-6" />
          </KeypadKey>
          <KeypadKey onClick={() => push("0")} disabled={verify.isPending}>
            0
          </KeypadKey>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Sign in"
            className="h-16 rounded-2xl text-lg font-semibold"
          >
            {verify.isPending ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ArrowRight className="h-6 w-6" />
            )}
          </Button>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
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
      className={
        variant === "ghost"
          ? "h-16 rounded-2xl text-muted-foreground"
          : "sk-keycap h-16 rounded-2xl text-[1.65rem] font-medium tabular-nums"
      }
      {...rest}
    >
      {children}
    </Button>
  );
}
