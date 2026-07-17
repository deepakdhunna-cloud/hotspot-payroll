/**
 * The attention center — the assistant that watches the whole operation.
 * Renders the persistent, dated task stack from attention.list: 12h+ shifts
 * needing physical approval, schedule-vs-worked mismatches needing review,
 * and operational gaps with a direct route to each fix. Items keep their
 * first-detected date so everyone can see how long a task has been pending.
 * Ink panel + signal red: this card outranks everything else on the page.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  ShieldAlert,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { toDateInput } from "@/lib/payweek";

type Item = {
  id: number;
  kind: string;
  storeLocation: string | null;
  punchId: number | null;
  weekStart: Date | string | null;
  title: string;
  detail: string | null;
  createdAt: Date | string;
};

function pendingFor(createdAt: Date | string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const since = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  return {
    label: days >= 1 ? `pending ${days}d` : hours >= 1 ? `pending ${hours}h` : "new today",
    since,
    days,
  };
}

/** Deep link that routes each kind of task to its fix. */
function fixHref(item: Item): { href: string; label: string } | null {
  switch (item.kind) {
    case "long_punch":
      return { href: "/payroll?tab=punches", label: "Open punches" };
    case "auto_clockout":
      return { href: "/payroll?tab=punches", label: "Fix punch time" };
    case "hours_mismatch":
      return {
        href: item.weekStart
          ? `/payroll?week=${toDateInput(new Date(item.weekStart))}`
          : "/payroll",
        label: "Open payroll",
      };
    case "missing_schedule":
      return { href: "/schedule-import", label: "Import schedule" };
    case "missing_codes":
      return { href: "/employees", label: "Set codes" };
    case "unsaved_payroll":
      return {
        href: item.weekStart
          ? `/payroll?week=${toDateInput(new Date(item.weekStart))}`
          : "/payroll",
        label: "Finalize payroll",
      };
    default:
      return null;
  }
}

const MANUAL_KINDS = new Set(["long_punch", "auto_clockout", "hours_mismatch"]);

export function AttentionCenter({ className }: { className?: string }) {
  const utils = trpc.useUtils();
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [clockOutFormFor, setClockOutFormFor] = useState<number | null>(null);
  const [clockOutValue, setClockOutValue] = useState("");

  const resolveM = trpc.attention.resolve.useMutation({
    onSuccess: () => {
      toast.success("Signed off — item cleared from the stack.");
      utils.attention.list.invalidate();
      utils.dashboard.summary.invalidate();
      setClockOutFormFor(null);
      setClockOutValue("");
    },
    onError: (e) => toast.error(e.message),
  });

  const items = (listQ.data?.items ?? []) as Item[];
  const oldest = items.reduce(
    (max, i) => Math.max(max, pendingFor(i.createdAt).days),
    0,
  );

  return (
    <section
      className={cn("ink-panel rounded-xl border border-white/10 rise-in overflow-hidden", className)}
    >
      <header className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3 border-b border-white/10">
        <ShieldAlert className={cn("h-5 w-5", items.length > 0 ? "text-[oklch(0.68_0.21_27)]" : "text-white/40")} />
        <h2 className="section-title text-white">Attention center</h2>
        {items.length > 0 ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold tabular-nums text-white">
            {items.length}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] uppercase tracking-[0.14em] text-white/60 font-semibold">
          {items.length === 0
            ? "live checks · all clear"
            : oldest >= 1
              ? `stacks until signed off · oldest ${oldest}d`
              : "live checks · stacks until signed off"}
        </span>
      </header>

      {listQ.isLoading ? (
        <p className="px-5 py-6 text-sm text-white/60">Scanning punches, schedules and payroll…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-5 text-sm text-white/75 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Nothing looks off — punches, schedules and payroll all check out.
        </p>
      ) : (
        <ul className="divide-y divide-white/8">
          {items.map((item) => {
            const p = pendingFor(item.createdAt);
            const fix = fixHref(item);
            const isManual = MANUAL_KINDS.has(item.kind);
            const isOpenLongPunch =
              item.kind === "long_punch" && item.title.includes("and counting");
            return (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[5px] border-2",
                      p.days >= 3
                        ? "border-[oklch(0.68_0.21_27)] bg-[oklch(0.68_0.21_27_/_0.25)]"
                        : "border-white/35 bg-white/5",
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">{item.title}</p>
                    {item.detail ? (
                      <p className="text-xs text-white/70 mt-0.5 leading-relaxed">{item.detail}</p>
                    ) : null}
                    <p className="text-[11px] mt-1.5 flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide",
                          p.days >= 3
                            ? "bg-[oklch(0.68_0.21_27)] text-white"
                            : "bg-white/10 text-white/75",
                        )}
                      >
                        {p.days >= 3 ? <AlertTriangle className="h-3 w-3" /> : null}
                        {p.label}
                      </span>
                      <span className="text-white/55">first flagged {p.since}</span>
                      {item.storeLocation ? (
                        <span className="text-white/55">· {item.storeLocation}</span>
                      ) : null}
                    </p>

                    {clockOutFormFor === item.id ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Input
                          type="datetime-local"
                          value={clockOutValue}
                          onChange={(e) => setClockOutValue(e.target.value)}
                          className="h-8 w-56 bg-white/10 border-white/20 text-white text-xs [color-scheme:dark]"
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={!clockOutValue || resolveM.isPending}
                          onClick={() =>
                            resolveM.mutate({
                              id: item.id,
                              resolution: "approved",
                              clockOutAt: new Date(clockOutValue),
                            })
                          }
                        >
                          <BadgeCheck className="h-3.5 w-3.5 mr-1" />
                          Register clock-out & approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-white/60 hover:text-white hover:bg-white/10"
                          onClick={() => setClockOutFormFor(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
                    {isManual ? (
                      isOpenLongPunch ? (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setClockOutFormFor(item.id);
                            setClockOutValue("");
                          }}
                          disabled={resolveM.isPending}
                        >
                          <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Fix & approve
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            resolveM.mutate({
                              id: item.id,
                              resolution:
                                item.kind === "long_punch" ? "approved" : "reviewed",
                            })
                          }
                          disabled={resolveM.isPending}
                        >
                          <BadgeCheck className="h-3.5 w-3.5 mr-1" />
                          {item.kind === "long_punch" ? "Approve hours" : "Mark reviewed"}
                        </Button>
                      )
                    ) : null}
                    {fix ? (
                      <Link href={fix.href}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-white/25 bg-transparent text-white/85 hover:bg-white/10 hover:text-white"
                        >
                          {fix.label}
                          <ArrowUpRight className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
