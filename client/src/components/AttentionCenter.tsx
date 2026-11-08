/**
 * The attention center — the assistant that watches the whole operation.
 * Renders the persistent, dated task stack from attention.list: 12h+ shifts
 * needing physical approval, schedule-vs-worked mismatches needing review,
 * and operational gaps with a direct route to each fix. Items keep their
 * first-detected date so everyone can see how long a task has been pending.
 * When there's nothing to do it collapses to one quiet line; when there is,
 * it's the first card on the page and each item carries its own fix.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CalendarX,
  CheckCircle2,
  Clock,
  KeyRound,
  Scale,
  ShieldAlert,
  TimerOff,
  Wallet,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { STORE_ABBR } from "@/lib/format";
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
    label: days >= 1 ? `waiting ${days}d` : hours >= 1 ? `waiting ${hours}h` : "new today",
    since,
    days,
  };
}

/** Deep link that routes each kind of task to its fix. */
function fixHref(
  item: Item,
): { href: string; label: string; newTab?: boolean } | null {
  switch (item.kind) {
    case "long_punch":
      return { href: "/payroll?tab=punches", label: "Open punches" };
    case "auto_clockout":
      return {
        href: item.weekStart
          ? `/payroll?tab=punches&week=${toDateInput(new Date(item.weekStart))}`
          : "/payroll?tab=punches",
        label: "Open punches",
      };
    case "hours_mismatch":
      return {
        href: item.weekStart
          ? `/payroll?week=${toDateInput(new Date(item.weekStart))}`
          : "/payroll",
        label: "Open payroll",
      };
    case "missing_schedule":
      return { href: "/schedule-import", label: "Import schedule" };
    case "missing_feed":
      // The kiosk is a full-screen page with no way back — never navigate
      // the manager's own tab into it.
      return {
        href: item.storeLocation
          ? `/clock/${encodeURIComponent(item.storeLocation)}`
          : "/clock",
        label: "Open kiosk",
        newTab: true,
      };
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

/** A plain name and icon for each kind of task, shown above its title. */
const KIND_META: Record<string, { label: string; icon: LucideIcon }> = {
  long_punch: { label: "Long shift", icon: Clock },
  auto_clockout: { label: "Auto clock-out", icon: TimerOff },
  hours_mismatch: { label: "Hours vs schedule", icon: Scale },
  missing_schedule: { label: "No schedule", icon: CalendarX },
  missing_feed: { label: "Time clock offline", icon: WifiOff },
  missing_codes: { label: "Missing clock codes", icon: KeyRound },
  unsaved_payroll: { label: "Payroll not saved", icon: Wallet },
};

const MANUAL_KINDS = new Set(["long_punch", "auto_clockout", "hours_mismatch"]);

export function AttentionCenter({ className }: { className?: string }) {
  const utils = trpc.useUtils();
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [clockOutFormFor, setClockOutFormFor] = useState<number | null>(null);
  const [clockOutValue, setClockOutValue] = useState("");

  const resolveM = trpc.attention.resolve.useMutation({
    onSuccess: (data) => {
      if ((data as { alreadyResolved?: boolean }).alreadyResolved) {
        toast.info("Already handled elsewhere — refreshing the stack.");
      } else {
        toast.success("Signed off — item cleared from the stack.");
      }
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

  if (listQ.isLoading) {
    return (
      <div className={cn("h-11 rounded-xl border border-border bg-card animate-pulse", className)} />
    );
  }

  if (items.length === 0) {
    return (
      <p
        className={cn(
          "callout-good flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted-foreground",
          className,
        )}
      >
        <span className="icon-badge icon-badge-sm">
          <CheckCircle2 />
        </span>
        <span>
          <span className="font-semibold callout-title">All clear.</span> Punches,
          schedules and payroll all check out.
        </span>
      </p>
    );
  }

  return (
    <section
      className={cn("attention-card rise-in", className)}
      aria-label="Needs attention"
    >
      <header className="attention-head flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 sm:px-5 py-3.5">
        <span className="attention-beacon icon-badge" aria-hidden="true">
          <ShieldAlert />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-white flex items-center gap-2">
            Needs attention
            <span className="attention-count">{items.length}</span>
          </h2>
          <p className="text-xs text-white/60 leading-snug">
            Each stays here until someone signs it off
          </p>
        </div>
        {oldest >= 1 ? (
          <span className="ml-auto attention-age">oldest waiting {oldest}d</span>
        ) : null}
      </header>

      <ul className="attention-list">
        {items.map((item) => {
          const p = pendingFor(item.createdAt);
          const fix = fixHref(item);
          const isManual = MANUAL_KINDS.has(item.kind);
          const isOpenLongPunch =
            item.kind === "long_punch" && item.title.includes("and counting");
          // Items where typing the real clock-out is the fix: an open
          // 12h+ punch, or a punch the system closed at the limit.
          const showsClockOutForm =
            isOpenLongPunch || item.kind === "auto_clockout";
          const stale = p.days >= 3;
          const meta = KIND_META[item.kind] ?? { label: "Check", icon: AlertTriangle };
          const KindIcon = meta.icon;
          return (
            <li key={item.id} className="attention-item">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex flex-1 min-w-0 items-start gap-3">
                  <span
                    className={cn("attention-marker", stale && "attention-marker-stale")}
                    aria-hidden="true"
                  >
                    <KindIcon />
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* What kind of issue, where, and how long it has waited */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="attention-kind">{meta.label}</span>
                      {item.storeLocation ? (
                        <span className="chip-neutral">
                          {STORE_ABBR[item.storeLocation] ?? item.storeLocation}
                        </span>
                      ) : null}
                      <span
                        className={stale ? "chip-bad" : "chip-neutral"}
                        title={`First flagged ${p.since}`}
                      >
                        {p.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[15px] font-semibold leading-snug">{item.title}</p>
                    {item.detail ? (
                      <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                        {item.detail}
                      </p>
                    ) : null}

                    {clockOutFormFor === item.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Input
                          type="datetime-local"
                          value={clockOutValue}
                          onChange={(e) => setClockOutValue(e.target.value)}
                          className="h-9 w-56 text-sm"
                          aria-label="Actual clock-out time"
                        />
                        <Button
                          size="sm"
                          className="h-9"
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
                          Save clock-out & approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9"
                          onClick={() => setClockOutFormFor(null)}
                          aria-label="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* The fix: one column of equal-width buttons, main action first */}
                <div className="grid grid-cols-2 gap-2 shrink-0 [&>*:only-child]:col-span-2 sm:flex sm:w-44 sm:flex-col sm:items-stretch">
                  {isManual && showsClockOutForm ? (
                    <Button
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        setClockOutFormFor(item.id);
                        setClockOutValue("");
                      }}
                      disabled={resolveM.isPending}
                    >
                      {item.kind === "auto_clockout" ? "Fix time" : "Fix & approve"}
                    </Button>
                  ) : null}
                  {isManual && !isOpenLongPunch ? (
                    <Button
                      size="sm"
                      variant={item.kind === "auto_clockout" ? "outline" : "default"}
                      className="h-9"
                      onClick={() =>
                        resolveM.mutate({
                          id: item.id,
                          resolution:
                            item.kind === "long_punch" ? "approved" : "reviewed",
                        })
                      }
                      disabled={resolveM.isPending}
                    >
                      {item.kind === "long_punch"
                        ? "Approve hours"
                        : item.kind === "auto_clockout"
                          ? "Times are right"
                          : "Mark reviewed"}
                    </Button>
                  ) : null}
                  {fix ? (
                    fix.newTab ? (
                      <Button size="sm" variant="outline" className="h-9" asChild>
                        <a href={fix.href} target="_blank" rel="noopener noreferrer">
                          {fix.label}
                          <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                        </a>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-9" asChild>
                        <Link href={fix.href}>
                          {fix.label}
                          <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                        </Link>
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
