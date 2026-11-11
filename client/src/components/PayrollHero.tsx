/**
 * The dashboard's headline: the pay week that just closed, and the one thing
 * left to do about it.
 *
 *  - Hours are in but not saved  → the page's one highlighted card, with the
 *    hours to pay, how many people are saved, and one button: review and
 *    save. (White with a warm brand glow in light mode, inked in dark.)
 *  - Everyone is saved           → one quiet green line with Export.
 *  - Nobody worked that week     → nothing at all.
 *
 * It reads the same dashboard summary the rest of the page uses, for the
 * last closed week, and counts "saved" exactly the way the dashboard does.
 * The headline is HOURS, not dollars: hours are a fact from the time clock,
 * while the dollars depend on rates and set pay that are only final on the
 * Payroll page — the one place that does that math.
 */
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtHours, fmtWeekRange } from "@/lib/format";
import { currentPayPeriodStart, toDateInput } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";

export function PayrollHero({ store }: { store?: string }) {
  const weekStart = useMemo(() => currentPayPeriodStart(), []);
  const summaryQ = trpc.dashboard.summary.useQuery(
    { weekStart, store: store as any },
    { refetchInterval: 5 * 60_000 },
  );

  if (summaryQ.isLoading) {
    return <Skeleton className="h-[11.5rem] rounded-[1.125rem]" />;
  }
  // A failed load says nothing here; the page's own cards report it.
  const data = summaryQ.data;
  if (!data) return null;

  const employees = data.employees;
  // One definition of "saved" everywhere: hours or pay on the saved entry.
  const isSaved = (e: (typeof employees)[number]) => e.hoursWorked > 0 || e.grossPay > 0;
  const saved = employees.filter(isSaved).length;
  const unsaved = employees.filter((e) => e.clockHours > 0.25 && !isSaved(e)).length;
  const payable = employees.filter((e) => isSaved(e) || e.clockHours > 0.25).length;
  if (payable === 0) return null;

  const range = fmtWeekRange(weekStart);
  const href = `/payroll?week=${toDateInput(weekStart)}`;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  if (unsaved === 0) {
    return (
      <div className="callout-good flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:px-4">
        <span className="icon-badge" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <span className="callout-title font-semibold">Payroll for {range} is saved.</span>{" "}
          <span className="text-muted-foreground">
            {people(saved)} ·{" "}
            <Money value={data.totals.totalSavedGross} className="font-medium text-foreground" />
          </span>
        </p>
        <Button size="sm" variant="outline" className="h-9 shrink-0" asChild>
          <Link href={href}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Export
          </Link>
        </Button>
      </div>
    );
  }

  const pct = Math.round((saved / payable) * 100);
  return (
    <section
      className="hero-card rise-in px-5 py-5 sm:px-6 sm:py-6"
      aria-labelledby="payroll-hero-title"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h2
            id="payroll-hero-title"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-muted-foreground"
          >
            Payroll to run
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{range}</span>
          </h2>
          <p className="hero-value mt-2.5">
            {fmtHours(data.totals.totalHours)}
            <span className="ml-1.5 text-[0.42em] font-medium tracking-normal text-muted-foreground">
              hours
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Worked by {people(payable)}, straight from the time clock
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 sm:w-72">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium">
                {saved} of {payable} saved
              </span>
              <span className="text-muted-foreground">{unsaved} to review</span>
            </div>
            <div
              className="hero-meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={payable}
              aria-valuenow={saved}
              aria-label="People saved to payroll"
            >
              <i style={{ width: `${Math.max(pct, saved > 0 ? 4 : 0)}%` }} />
            </div>
          </div>
          <Button size="lg" className="h-11 w-full text-[15px]" asChild>
            <Link href={href}>
              Review and save payroll <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
