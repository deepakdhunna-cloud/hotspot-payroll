/**
 * Payroll grouped by position — answers "where do the labor dollars go?"
 * at a glance. Fed the exact per-person numbers the host view shows, so
 * the two always agree. Bars are proportional to gross, biggest first.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export function PositionBreakdown({
  items,
  sub,
  className,
}: {
  items: { role: string; hours: number; gross: number }[];
  sub?: string;
  className?: string;
}) {
  const byRole = new Map<string, { people: number; hours: number; gross: number }>();
  for (const it of items) {
    const key = it.role?.trim() || "No role set";
    const agg = byRole.get(key) ?? { people: 0, hours: 0, gross: 0 };
    agg.people += 1;
    agg.hours += it.hours;
    agg.gross += it.gross;
    byRole.set(key, agg);
  }
  const rows = Array.from(byRole.entries())
    .map(([role, v]) => ({ role, ...v }))
    .sort((a, b) => b.gross - a.gross);
  if (rows.length === 0) return null;
  const maxGross = rows.reduce((m, r) => Math.max(m, r.gross), 0);
  const total = rows.reduce((s, r) => s + r.gross, 0);

  return (
    <Card className={cn("surface-card border-0 gap-0 py-0", className)}>
      <CardHeader className="px-4 sm:px-5 pt-4 pb-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <Wallet />
          </span>
          Pay by role
        </CardTitle>
        {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3.5 px-4 sm:px-5 pb-5">
        {rows.map((r) => (
          <div key={r.role} className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{r.role}</span>
              <span className="text-xs text-muted-foreground">
                {r.people} {r.people === 1 ? "person" : "people"} ·{" "}
                <span className="tabular-nums">{r.hours.toFixed(1)}h</span>
              </span>
              <span className="ml-auto tabular-nums font-medium">
                {fmtMoney(r.gross)}
              </span>
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                {total > 0 ? Math.round((r.gross / total) * 100) : 0}%
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-muted overflow-hidden"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${maxGross > 0 ? Math.max(2, (r.gross / maxGross) * 100) : 0}%`,
                  background: "var(--chart-1)",
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
