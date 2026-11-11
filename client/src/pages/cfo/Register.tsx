/**
 * Payroll register — one line per pay week, ready to hand to the books.
 *
 * The same closed weeks as Finance, as a ledger: what was paid, to how many
 * people, for how many hours, what it cost per hour and the withholding
 * estimates, with each store's share in the export. Read-only, like the
 * rest of Finance. Up to twelve weeks; Export downloads the spreadsheet and
 * Share sends it.
 */
import { PageHeader } from "@/components/PageHeader";
import { BlockState } from "@/components/QueryStates";
import { ShareDialog, sharePayload, type SharePayload } from "@/components/SharePayroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { STORE_ABBR, fmtHours, fmtMoney, fmtWeekRange, storeIndex } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { buildXlsx, exportXlsx, prefetchXlsx, type XlsxSheet } from "@/lib/xlsx";
import { cn } from "@/lib/utils";
import { FileSpreadsheet, Loader2, Share } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const SPANS = [5, 8, 12] as const;
type RegisterRow = Record<string, string | number>;
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default function PayrollRegister({
  eyebrow,
  actions,
}: {
  eyebrow?: ReactNode;
  /** The Overview / Register switch, supplied by the portal. */
  actions?: ReactNode;
} = {}) {
  usePageTitle("Payroll register");
  const { user } = useAuth();
  const canView = user?.role === "admin" || user?.role === "cfo";
  const [span, setSpan] = useState<(typeof SPANS)[number]>(12);
  const q = trpc.cfo.summary.useQuery({ weeks: span }, { enabled: !!canView });

  // The register starts at the first week that has anything in it: weeks
  // from before the site was in use are not "$0 weeks", they are no weeks.
  const weeks = useMemo(() => {
    const all = q.data?.weeks ?? [];
    const first = all.findIndex((w) => w.gross > 0 || w.hours > 0);
    return first < 0 ? [] : all.slice(first);
  }, [q.data]);
  const stores = useMemo(
    () =>
      (weeks[0] ? Object.keys(weeks[0].byStore) : []).sort(
        (a, b) => storeIndex(a) - storeIndex(b),
      ),
    [weeks],
  );
  // Newest first on screen: the week just paid is the one being looked for.
  const shown = useMemo(() => [...weeks].reverse(), [weeks]);
  const total = useMemo(
    () =>
      weeks.reduce(
        (t, w) => ({
          gross: t.gross + w.gross,
          hours: t.hours + w.hours,
          estFederal: t.estFederal + w.estFederal,
          estState: t.estState + w.estState,
          estNet: t.estNet + w.estNet,
        }),
        { gross: 0, hours: 0, estFederal: 0, estState: 0, estNet: 0 },
      ),
    [weeks],
  );
  const estimatedN = weeks.filter((w) => w.estimated).length;

  /* ------------------------------ the file ------------------------------ */

  const registerFile = () => {
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    const rows: RegisterRow[] = weeks.map((w) => ({
      week: fmtWeekRange(new Date(w.weekStart)),
      start: iso(w.weekStart),
      people: w.peoplePaid,
      hours: Number(w.hours.toFixed(2)),
      gross: Number(w.gross.toFixed(2)),
      cph: w.hours > 0 ? Number((w.gross / w.hours).toFixed(2)) : 0,
      federal: Number(w.estFederal.toFixed(2)),
      state: Number(w.estState.toFixed(2)),
      net: Number(w.estNet.toFixed(2)),
      basis: w.estimated ? "Estimated from the time clock" : "Saved payroll",
      ...Object.fromEntries(
        stores.map((s) => [`store:${s}`, Number((w.byStore[s]?.gross ?? 0).toFixed(2))]),
      ),
    }));
    const money = { numFmt: "$#,##0.00", align: "right" as const };
    const sheet: XlsxSheet<RegisterRow> = {
      name: "Register",
      title: "Payroll register",
      subtitle: `${weeks.length} closed pay weeks · ${iso(first.weekStart)} to ${iso(last.weekStart)}`,
      summary: [
        { label: "Gross pay", value: fmtMoney(total.gross) },
        { label: "Hours paid", value: fmtHours(total.hours, 2) },
        { label: "Cost per hour", value: fmtMoney(total.hours > 0 ? total.gross / total.hours : 0) },
        { label: "Est. net pay", value: fmtMoney(total.estNet) },
      ],
      columns: [
        { header: "Pay week", key: "week", width: 18 },
        { header: "Week starts", key: "start", width: 13 },
        { header: "People paid", key: "people", width: 12, numFmt: "#,##0", align: "right" },
        { header: "Hours paid", key: "hours", width: 12, numFmt: "#,##0.00", align: "right" },
        { header: "Gross pay", key: "gross", width: 14, ...money },
        { header: "Cost per hour", key: "cph", width: 13, ...money },
        { header: "Est. federal", key: "federal", width: 13, ...money },
        { header: "Est. state", key: "state", width: 12, ...money },
        { header: "Est. net", key: "net", width: 14, ...money },
        ...stores.map((s) => ({
          header: STORE_ABBR[s] ?? s,
          key: `store:${s}`,
          width: 13,
          ...money,
        })),
        {
          header: "Basis",
          key: "basis",
          width: 28,
          tone: (r: RegisterRow) => (r.basis === "Saved payroll" ? ("good" as const) : ("warn" as const)),
        },
      ],
      rows,
      totals: {
        hours: Number(total.hours.toFixed(2)),
        gross: Number(total.gross.toFixed(2)),
        cph: total.hours > 0 ? Number((total.gross / total.hours).toFixed(2)) : 0,
        federal: Number(total.estFederal.toFixed(2)),
        state: Number(total.estState.toFixed(2)),
        net: Number(total.estNet.toFixed(2)),
        ...Object.fromEntries(
          stores.map((s) => [
            `store:${s}`,
            Number(weeks.reduce((t, w) => t + (w.byStore[s]?.gross ?? 0), 0).toFixed(2)),
          ]),
        ),
      },
      totalsLabelKey: "week",
      totalsLabel: "Total",
    };
    return {
      filename: `Hotspot-Payroll-Register-${iso(first.weekStart)}_to_${iso(last.weekStart)}.xlsx`,
      sheet,
      title: "Hotspot payroll register",
      text: [
        `Payroll register — ${weeks.length} closed pay weeks, ${iso(first.weekStart)} to ${iso(last.weekStart)}`,
        `${fmtMoney(total.gross)} gross · ${fmtHours(total.hours, 2)} hours · ${fmtMoney(
          total.hours > 0 ? total.gross / total.hours : 0,
        )} per hour`,
        estimatedN > 0
          ? `${estimatedN} ${estimatedN === 1 ? "week is" : "weeks are"} estimated from the time clock (not saved)`
          : "Every week is saved payroll",
      ].join("\n"),
    };
  };

  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareDialog, setShareDialog] = useState<SharePayload | null>(null);
  const failed = (err: unknown) => {
    console.error("[Register] export failed:", err);
    toast.error("Couldn't build the spreadsheet. Refresh the page and try again.");
  };
  const onExport = async () => {
    const { filename, sheet } = registerFile();
    setExporting(true);
    try {
      await exportXlsx(filename, sheet);
      toast.success("Spreadsheet downloaded.", { description: filename });
    } catch (err) {
      failed(err);
    } finally {
      setExporting(false);
    }
  };
  const onShare = async () => {
    const { filename, sheet, title, text } = registerFile();
    setSharing(true);
    try {
      const payload: SharePayload = { filename, blob: await buildXlsx(sheet), title, text };
      const result = await sharePayload(payload);
      if (result === "shared") toast.success("Register shared.");
      else if (result === "dialog") setShareDialog(payload);
    } catch (err) {
      failed(err);
    } finally {
      setSharing(false);
    }
  };
  useEffect(() => {
    if (weeks.length === 0) return;
    const t = window.setTimeout(prefetchXlsx, 1200);
    return () => window.clearTimeout(t);
  }, [weeks.length]);

  const empty = !q.isLoading && !q.isError && weeks.length === 0;
  const num = "text-right tabular-nums";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title="Payroll register"
        description="Every closed pay week on one line, newest first. Read-only."
        actions={actions}
      />

      <Card className="surface-card gap-0 py-0">
        <div className="card-head flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <div
            className="inline-flex rounded-lg border border-border p-0.5"
            role="group"
            aria-label="How many weeks"
          >
            {SPANS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSpan(n)}
                aria-pressed={span === n}
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                  span === n
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n} weeks
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9"
              onClick={() => void onShare()}
              disabled={weeks.length === 0 || empty || sharing}
            >
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share className="h-4 w-4" />}
              Share
            </Button>
            <Button
              variant="outline"
              className="h-9"
              onClick={() => void onExport()}
              disabled={weeks.length === 0 || empty || exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Export
            </Button>
          </div>
        </div>
        <CardContent className="px-0">
          {q.isError || q.isLoading || empty ? (
            <div className="p-4 sm:p-5">
              <BlockState
                isLoading={q.isLoading}
                isError={q.isError}
                onRetry={() => q.refetch()}
                isEmpty={empty}
                emptyTitle="No payroll history yet"
                emptyHint="Weeks appear here once payroll is saved or the time clock records hours."
              >
                {null}
              </BlockState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pay week</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">People</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Cost / hour</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Est. federal</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Est. state</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Est. net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((w) => (
                    <TableRow key={iso(w.weekStart)}>
                      <TableCell className="font-medium">
                        {fmtWeekRange(new Date(w.weekStart))}
                        {w.estimated ? (
                          <span
                            className="chip-warn ml-2 align-middle"
                            title="Not saved to payroll: estimated from the time clock"
                          >
                            est.
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn(num, "hidden sm:table-cell")}>{w.peoplePaid}</TableCell>
                      <TableCell className={num}>{fmtHours(w.hours)}</TableCell>
                      <TableCell className={cn(num, "font-semibold")}>{fmtMoney(w.gross)}</TableCell>
                      <TableCell className={cn(num, "hidden sm:table-cell")}>
                        {w.hours > 0 ? fmtMoney(w.gross / w.hours) : "—"}
                      </TableCell>
                      <TableCell className={cn(num, "hidden text-muted-foreground lg:table-cell")}>
                        {fmtMoney(w.estFederal)}
                      </TableCell>
                      <TableCell className={cn(num, "hidden text-muted-foreground lg:table-cell")}>
                        {fmtMoney(w.estState)}
                      </TableCell>
                      <TableCell className={cn(num, "hidden md:table-cell")}>{fmtMoney(w.estNet)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold">
                      {weeks.length}-week total
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className={cn(num, "font-semibold")}>{fmtHours(total.hours)}</TableCell>
                    <TableCell className={cn(num, "font-semibold")}>{fmtMoney(total.gross)}</TableCell>
                    <TableCell className={cn(num, "hidden font-semibold sm:table-cell")}>
                      {total.hours > 0 ? fmtMoney(total.gross / total.hours) : "—"}
                    </TableCell>
                    <TableCell className={cn(num, "hidden text-muted-foreground lg:table-cell")}>
                      {fmtMoney(total.estFederal)}
                    </TableCell>
                    <TableCell className={cn(num, "hidden text-muted-foreground lg:table-cell")}>
                      {fmtMoney(total.estState)}
                    </TableCell>
                    <TableCell className={cn(num, "hidden font-semibold md:table-cell")}>
                      {fmtMoney(total.estNet)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
            Withholding figures are planning estimates at the rates set by the CEO; real withholding
            comes from your payroll processor.
            {estimatedN > 0
              ? ` Weeks marked "est." aren't saved to payroll yet and are estimated from the time clock.`
              : ""}{" "}
            The export adds each store&apos;s gross as its own column.
          </p>
        </CardContent>
      </Card>

      <ShareDialog payload={shareDialog} onOpenChange={(open) => !open && setShareDialog(null)} />
    </div>
  );
}
