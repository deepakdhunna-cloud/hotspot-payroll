/**
 * The attention center — the assistant that watches the whole operation.
 * Renders the persistent, dated task stack from attention.list: 12h+ shifts
 * needing physical approval, schedule-vs-worked mismatches needing review,
 * and operational gaps with a direct route to each fix. Items keep their
 * first-detected date so everyone can see how long a task has been pending.
 * When there's nothing to do it collapses to one quiet line; when there is,
 * it's the first card on the page and each item carries its own fix.
 *
 * Sign-offs (approve hours, mark reviewed, keep an automatic clock-out) ask
 * once before they clear an item, and a failed check never reads as
 * "all clear".
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  RotateCw,
  Scale,
  ShieldAlert,
  TimerOff,
  Wallet,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { STORE_ABBR } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  BUSINESS_TIME_ZONE,
  fromStoreInput,
  storeTzLabel,
  toDateInput,
  toStoreInput,
} from "@/lib/payweek";

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

/** Shared target for the top-bar bell: it scrolls here instead of leaving. */
const ANCHOR = {
  id: "attention",
  tabIndex: -1,
} as const;

function pendingFor(createdAt: Date | string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const since = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
  return {
    label: days >= 1 ? `Waiting ${days}d` : hours >= 1 ? `Waiting ${hours}h` : "New today",
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
      // The time clock is a full-screen page with no way back — never
      // navigate the manager's own tab into it.
      return {
        href: item.storeLocation
          ? `/clock/${encodeURIComponent(item.storeLocation)}`
          : "/clock",
        label: "Open time clock",
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

/** What each one-tap sign-off says before it clears an item. */
const SIGN_OFF: Record<
  string,
  { button: string; title: string; explain: string; confirm: string; resolution: "approved" | "reviewed" }
> = {
  long_punch: {
    button: "Approve hours",
    title: "Approve these hours?",
    explain:
      "This signs the shift off as correct and clears it from the list. To change the times instead, open punches.",
    confirm: "Approve hours",
    resolution: "approved",
  },
  hours_mismatch: {
    button: "Mark reviewed",
    title: "Mark this as reviewed?",
    explain:
      "Do this once you've checked the hours against the schedule. It clears the item from the list and doesn't change any hours or pay.",
    confirm: "Mark reviewed",
    resolution: "reviewed",
  },
  auto_clockout: {
    button: "Times are right",
    title: "Keep the automatic clock-out?",
    explain:
      "The punch keeps the clock-out time the system set, and the item clears from the list.",
    confirm: "Keep these times",
    resolution: "reviewed",
  },
};

export function AttentionCenter({ className }: { className?: string }) {
  const utils = trpc.useUtils();
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [clockOutFormFor, setClockOutFormFor] = useState<number | null>(null);
  const [clockOutValue, setClockOutValue] = useState("");
  const [clockOutError, setClockOutError] = useState<string | null>(null);

  const closeForm = () => {
    setClockOutFormFor(null);
    setClockOutValue("");
    setClockOutError(null);
  };

  const resolveM = trpc.attention.resolve.useMutation({
    onSuccess: (data) => {
      if ((data as { alreadyResolved?: boolean }).alreadyResolved) {
        toast.info("Already handled elsewhere — the list is up to date.");
      } else {
        toast.success("Signed off and cleared from the list.");
      }
      utils.attention.list.invalidate();
      utils.dashboard.summary.invalidate();
      closeForm();
    },
    onError: (e) => {
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code === "NOT_FOUND") {
        toast.info("Someone already handled that one — the list is up to date.");
        utils.attention.list.invalidate();
        closeForm();
        return;
      }
      if (clockOutFormFor !== null) setClockOutError(errorMessage(e));
      else toast.error(errorMessage(e));
    },
  });

  const items = (listQ.data?.items ?? []) as Item[];
  const oldest = items.reduce(
    (max, i) => Math.max(max, pendingFor(i.createdAt).days),
    0,
  );

  if (listQ.isLoading) {
    return (
      <div
        {...ANCHOR}
        className={cn("h-11 rounded-xl border border-border bg-card animate-pulse scroll-mt-24 outline-none", className)}
        aria-label="Checking for issues"
      />
    );
  }

  // A failed check must never read as "all clear".
  if (listQ.isError && !listQ.data) {
    return (
      <div
        {...ANCHOR}
        role="status"
        className={cn(
          "callout-warn flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm scroll-mt-24 outline-none",
          className,
        )}
      >
        <span className="icon-badge icon-badge-sm" aria-hidden="true">
          <AlertTriangle />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold callout-title">Couldn&apos;t check for issues.</span>{" "}
          Punches, schedules and payroll weren&apos;t checked just now.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-9 bg-card"
          onClick={() => listQ.refetch()}
          disabled={listQ.isFetching}
        >
          <RotateCw className={cn("mr-1.5 h-3.5 w-3.5", listQ.isFetching && "animate-spin")} aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p
        {...ANCHOR}
        className={cn(
          "callout-good flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted-foreground scroll-mt-24 outline-none",
          className,
        )}
      >
        <span className="icon-badge icon-badge-sm" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <span>
          <span className="font-semibold callout-title">All clear.</span> Punches,
          schedules and payroll all check out.
        </span>
      </p>
    );
  }

  const submitClockOut = (e: FormEvent, item: Item) => {
    e.preventDefault();
    const at = fromStoreInput(clockOutValue);
    if (!at) {
      setClockOutError("Enter the date and time they actually clocked out.");
      return;
    }
    if (at.getTime() > Date.now() + 60_000) {
      setClockOutError("That time is in the future.");
      return;
    }
    setClockOutError(null);
    resolveM.mutate({ id: item.id, resolution: "approved", clockOutAt: at });
  };

  return (
    <section
      {...ANCHOR}
      className={cn("attention-card rise-in scroll-mt-24 outline-none", className)}
      aria-labelledby="attention-title"
    >
      <header className="attention-head flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 pt-4 pb-3">
        <span className="attention-beacon attention-icon" aria-hidden="true">
          <ShieldAlert />
        </span>
        <div className="min-w-0">
          <h2 id="attention-title" className="text-[15px] font-semibold leading-tight flex items-center gap-2">
            Needs attention
            <span className="attention-count" aria-hidden="true">
              {items.length}
            </span>
            <span className="sr-only">, {items.length} open</span>
          </h2>
          <p className="text-xs text-muted-foreground leading-snug">
            Each stays here until someone signs it off
          </p>
        </div>
        {oldest >= 1 ? (
          <span className="ml-auto attention-age">Oldest waiting {oldest}d</span>
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
          const signOff = isManual && !isOpenLongPunch ? SIGN_OFF[item.kind] : null;
          const stale = p.days >= 3;
          const meta = KIND_META[item.kind] ?? { label: "Check", icon: AlertTriangle };
          const KindIcon = meta.icon;
          const formOpen = clockOutFormFor === item.id;
          const inputId = `attention-clockout-${item.id}`;
          // The item's main fix is its filled button, at the top of its column.
          const hasFormButton = isManual && showsClockOutForm;
          const signOffIsPrimary = !hasFormButton && !!signOff;
          const linkIsPrimary = !hasFormButton && !signOff;
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
                        <span className="chip-neutral" title={item.storeLocation}>
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

                    {formOpen ? (
                      <form
                        className="mt-3 rounded-xl bg-card p-3 shadow-[inset_0_0_0_1px_var(--sk-ring)]"
                        onSubmit={(e) => submitClockOut(e, item)}
                        noValidate
                      >
                        <Label htmlFor={inputId} className="text-xs font-medium">
                          Actual clock-out{" "}
                          <span className="font-normal text-muted-foreground">
                            · store time ({storeTzLabel()})
                          </span>
                        </Label>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Input
                            id={inputId}
                            type="datetime-local"
                            value={clockOutValue}
                            max={toStoreInput(new Date())}
                            onChange={(e) => {
                              setClockOutValue(e.target.value);
                              setClockOutError(null);
                            }}
                            className="h-9 w-full text-sm sm:w-60"
                            aria-invalid={clockOutError ? true : undefined}
                            aria-describedby={clockOutError ? `${inputId}-error` : undefined}
                            autoFocus
                          />
                          <div className="flex w-full gap-2 sm:w-auto">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-9 flex-1 sm:flex-none"
                              onClick={closeForm}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              size="sm"
                              className="h-9 flex-1 sm:flex-none"
                              disabled={resolveM.isPending}
                            >
                              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                              Save clock-out & approve
                            </Button>
                          </div>
                        </div>
                        {clockOutError ? (
                          <p
                            id={`${inputId}-error`}
                            role="alert"
                            className="mt-1.5 text-xs font-medium text-destructive"
                          >
                            {clockOutError}
                          </p>
                        ) : null}
                      </form>
                    ) : null}
                  </div>
                </div>

                {/* The fix: one column of equal-width buttons, main action first */}
                <div className="grid grid-cols-2 gap-2 shrink-0 [&>*:only-child]:col-span-2 sm:flex sm:w-44 sm:flex-col sm:items-stretch">
                  {hasFormButton ? (
                    <Button
                      size="sm"
                      variant="tint"
                      className="h-9"
                      onClick={() => {
                        setClockOutFormFor(item.id);
                        setClockOutValue("");
                        setClockOutError(null);
                      }}
                      disabled={resolveM.isPending || formOpen}
                    >
                      {item.kind === "auto_clockout" ? "Fix time" : "Fix & approve"}
                    </Button>
                  ) : null}
                  {signOff ? (
                    <ConfirmDialog
                      destructive={false}
                      disabled={resolveM.isPending}
                      title={signOff.title}
                      description={
                        <>
                          <span className="block font-medium text-foreground">
                            {item.title}
                          </span>
                          <span className="mt-1.5 block">{signOff.explain}</span>
                        </>
                      }
                      confirmLabel={signOff.confirm}
                      onConfirm={() =>
                        resolveM.mutate({ id: item.id, resolution: signOff.resolution })
                      }
                      trigger={
                        <Button
                          size="sm"
                          variant={signOffIsPrimary ? "tint" : "outline"}
                          className="h-9"
                        >
                          {signOff.button}
                        </Button>
                      }
                    />
                  ) : null}
                  {fix ? (
                    <Button
                      size="sm"
                      variant={linkIsPrimary ? "tint" : "outline"}
                      className="h-9"
                      asChild
                    >
                      {fix.newTab ? (
                        <a
                          href={fix.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${fix.label} (opens in a new tab)`}
                        >
                          {fix.label}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      ) : (
                        <Link href={fix.href}>{fix.label}</Link>
                      )}
                    </Button>
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
