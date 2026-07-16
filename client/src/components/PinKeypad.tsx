import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ArrowRight, Delete, Lock, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

  const verify = trpc.auth.verifyPin.useMutation({
    onSuccess: async (data) => {
      toast.success(
        data.role === "admin" ? "Welcome, CEO" : `Signed in to ${data.store}`,
      );
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

  const submit = useCallback(() => {
    if (pin.length >= MIN_PIN && !verify.isPending) {
      verify.mutate({ pin });
    }
  }, [pin, verify]);

  const push = useCallback(
    (d: string) => {
      if (verify.isPending) return;
      setPin((p) => (p.length >= MAX_PIN ? p : p + d));
    },
    [verify.isPending],
  );

  const back = useCallback(() => {
    if (verify.isPending) return;
    setPin((p) => p.slice(0, -1));
  }, [verify.isPending]);

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background via-background to-primary/5">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <BrandMark size="lg" />
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="eyebrow flex items-center gap-2">
            <Lock className="h-3 w-3" /> Secure access
          </span>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            Enter your PIN
          </h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Use your store PIN, or the CEO master PIN for full access.
          </p>
        </div>

        {/* PIN dots */}
        <div
          className={`flex items-center gap-3 ${shake ? "animate-shake" : ""}`}
          style={{ minHeight: 32 }}
          aria-label={`${pin.length} digits entered`}
        >
          {Array.from({ length: dotCount }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                pin.length > i
                  ? "bg-primary border-primary scale-110"
                  : "border-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <KeypadKey key={d} onClick={() => push(d)} disabled={verify.isPending}>
              {d}
            </KeypadKey>
          ))}
          <KeypadKey onClick={back} disabled={verify.isPending || pin.length === 0} variant="ghost" aria-label="Delete digit">
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
            className="h-16 text-lg font-semibold"
          >
            {verify.isPending ? "…" : <ArrowRight className="h-6 w-6" />}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground text-center flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" /> Hotspot Market 11 &middot; 13 &middot; 14 &middot; Travel Center
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.45s cubic-bezier(0.23, 1, 0.32, 1); }
      `}</style>
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
      className="h-16 text-2xl font-semibold tabular-nums"
      {...rest}
    >
      {children}
    </Button>
  );
}
