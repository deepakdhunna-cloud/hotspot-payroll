import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Delete, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LOGO_URL = "/manus-storage/hotspot-wordmark_ddfb64c0.png";
const PIN_LENGTH = 4;

export default function PinKeypad() {
  const utils = trpc.useUtils();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  const verify = trpc.auth.verifyPin.useMutation({
    onSuccess: async (data) => {
      toast.success(
        data.role === "admin"
          ? "Welcome, CEO"
          : `Signed in to ${data.store}`,
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

  const submit = (next: string) => {
    if (next.length === PIN_LENGTH) {
      verify.mutate({ pin: next });
    }
  };

  const push = (d: string) => {
    if (pin.length >= PIN_LENGTH || verify.isPending) return;
    const next = pin + d;
    setPin(next);
    submit(next);
  };

  const back = () => {
    if (verify.isPending) return;
    setPin((p) => p.slice(0, -1));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background via-background to-primary/5">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <img
            src={LOGO_URL}
            alt="Hotspot"
            className="h-14 w-auto object-contain"
          />
          <span className="inline-flex items-center bg-neutral-950 text-white text-[10px] font-semibold tracking-[0.32em] uppercase px-4 py-1 rounded-full">
            Market
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold flex items-center gap-2">
            <Lock className="h-3 w-3" /> Secure access
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Enter your PIN</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Use your store PIN, or the CEO master PIN for full access.
          </p>
        </div>

        {/* PIN dots */}
        <div
          className={`flex items-center gap-4 ${shake ? "animate-shake" : ""}`}
          style={{ minHeight: 32 }}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all ${
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
          <div />
          <KeypadKey onClick={() => push("0")} disabled={verify.isPending}>
            0
          </KeypadKey>
          <KeypadKey onClick={back} disabled={verify.isPending} variant="ghost">
            <Delete className="h-5 w-5" />
          </KeypadKey>
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "ghost";
}) {
  return (
    <Button
      type="button"
      variant={variant === "ghost" ? "ghost" : "secondary"}
      onClick={onClick}
      disabled={disabled}
      className="h-16 text-2xl font-semibold tabular-nums active:scale-95 transition-transform"
    >
      {children}
    </Button>
  );
}
