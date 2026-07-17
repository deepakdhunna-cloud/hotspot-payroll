/**
 * Schedule import — drop the Homebase schedule (PDF or photo) and the app
 * reads every shift day by day, totals the hours, and scans the roster:
 * known people auto-link, near-misses get one-click "same person?"
 * suggestions (typos, nicknames, initials), and genuinely new names can be
 * added to the roster inline. Nothing touches payroll until commit.
 */
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STORE_ABBR, fmtWeekRange } from "@/lib/format";
import { fmtDateTime, inProgressPayWeekStart, shortDayLabel } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileImage,
  FileText,
  History,
  Link2,
  ScanSearch,
  Sparkles,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ParsedDay = {
  ref: string;
  date: Date | null;
  startLabel: string | null;
  endLabel: string | null;
  hours: number;
};

type Suggestion = {
  employeeId: number;
  fullName: string;
  storeLocation: string;
  score: number;
};

type ParsedRow = {
  extractedName: string;
  scheduledHours: number;
  days: ParsedDay[];
  matchedEmployeeId: number | null;
  matchedFullName: string | null;
  matchedStore: string | null;
  matchScore: number | null;
  suggestions: Suggestion[];
};

const ROLE_OPTIONS = [
  "Manager",
  "Assistant Manager",
  "Cashier",
  "Kitchen Manager",
  "Cook",
  "Janitorial",
];

/** Cosmetic progress stages while the model reads the file (~20-40s). */
const PARSE_STAGES = [
  "Uploading file…",
  "Reading names & shifts…",
  "Totalling hours per person…",
  "Scanning your roster for matches…",
];

function ParseProgress() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStage((s) => Math.min(s + 1, PARSE_STAGES.length - 1)),
      6000,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        <ScanSearch className="absolute inset-0 m-auto h-5 w-5 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold">{PARSE_STAGES[stage]}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Usually takes under a minute. Keep this tab open.
        </p>
      </div>
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {PARSE_STAGES.map((_, i) => (
          <li
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i <= stage ? "w-6 bg-primary" : "w-3 bg-border"
            }`}
          />
        ))}
      </ol>
    </div>
  );
}

export default function ScheduleImport() {
  const [weekStart, setWeekStart] = useState<Date>(() => inProgressPayWeekStart());
  const [schedStore, setSchedStore] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  // The week the rows were parsed against. Shift dates are resolved into THIS
  // week server-side, so commit must use it even if the navigator has since
  // moved — otherwise scheduled hours and shift dates would land in
  // different weeks.
  const [parsedWeek, setParsedWeek] = useState<Date | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [hourOverrides, setHourOverrides] = useState<Record<number, string>>({});
  const [qaRole, setQaRole] = useState<Record<number, string>>({});
  const [qaRate, setQaRate] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const scopeQ = trpc.meta.myScope.useQuery();
  const stores = scopeQ.data?.stores ?? [];
  // Single-store managers are always importing for their store.
  const effectiveStore = stores.length === 1 ? stores[0] : schedStore;

  const employeesQ = trpc.employees.list.useQuery({
    store: effectiveStore ? (effectiveStore as any) : undefined,
  });
  const employeesList = employeesQ.data ?? [];

  const importsQ = trpc.schedule.imports.useQuery({ limit: 8 });
  const utils = trpc.useUtils();

  const parseM = trpc.schedule.parseUpload.useMutation({
    onSuccess: (data) => {
      setRows(data.rows as ParsedRow[]);
      setImportId(data.importId);
      setParsedWeek(new Date(data.weekStart));
      const initialOverrides: Record<number, number | null> = {};
      const initialHours: Record<number, string> = {};
      data.rows.forEach((r, i) => {
        initialOverrides[i] = r.matchedEmployeeId;
        initialHours[i] = String(r.scheduledHours);
      });
      setOverrides(initialOverrides);
      setHourOverrides(initialHours);
      setQaRole({});
      setQaRate({});
      const matched = data.rows.filter((r) => r.matchedEmployeeId).length;
      toast.success(
        `Read ${data.totalExtracted} people and ${data.totalHours.toFixed(1)} hours — ${matched} matched your roster automatically.`,
      );
      utils.schedule.imports.invalidate();
      setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        150,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const quickCreateM = trpc.employees.quickCreate.useMutation({
    onSuccess: async (data) => {
      await utils.employees.list.invalidate();
      // Link every unmatched row with this exact name to the new employee.
      setOverrides((o) => {
        const next = { ...o };
        (rows ?? []).forEach((r, i) => {
          if (!next[i] && r.extractedName.trim() === data.fullName) next[i] = data.id;
        });
        return next;
      });
      toast.success(`Added ${data.fullName} to ${data.storeLocation}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const commitM = trpc.schedule.commit.useMutation({
    onSuccess: ({ saved, skipped }) => {
      toast.success(
        `Schedule committed for ${saved} employee${saved === 1 ? "" : "s"}.` +
          (skipped.length > 0 ? ` ${skipped.length} skipped (out of scope).` : ""),
      );
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
      utils.schedule.imports.invalidate();
      utils.schedule.week.invalidate();
      setRows(null);
      setFile(null);
      setImportId(null);
      setParsedWeek(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const startParse = async () => {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Upload a PDF, PNG, JPG or WEBP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("File too large (max 8MB).");
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk)),
      );
    }
    parseM.mutate({
      fileBase64: btoa(binary),
      mimeType: file.type,
      filename: file.name,
      weekStart,
      store: effectiveStore ? (effectiveStore as any) : undefined,
    });
  };

  const commit = () => {
    if (!rows) return;
    const entries = rows
      .map((r, i) => {
        const empId = overrides[i];
        const hrs = Number(hourOverrides[i] ?? String(r.scheduledHours));
        if (!empId || isNaN(hrs) || hrs < 0 || hrs > 168) return null;
        return {
          employeeId: empId,
          scheduledHours: hrs,
          shifts: r.days.map((d) => ({
            date: d.date ? new Date(d.date) : null,
            startLabel: d.startLabel,
            endLabel: d.endLabel,
            hours: Math.min(24, Math.max(0, d.hours)),
          })),
        };
      })
      .filter(Boolean) as {
      employeeId: number;
      scheduledHours: number;
      shifts: { date: Date | null; startLabel: string | null; endLabel: string | null; hours: number }[];
    }[];
    if (entries.length === 0) {
      toast.error("Nothing to import — match at least one employee.");
      return;
    }
    // Commit against the week the file was parsed for, not the navigator's
    // current position.
    commitM.mutate({ weekStart: parsedWeek ?? weekStart, importId, entries });
  };

  const matchedCount = useMemo(
    () => Object.values(overrides).filter(Boolean).length,
    [overrides],
  );

  const totalHours = useMemo(() => {
    if (!rows) return 0;
    return rows.reduce((sum, r, i) => {
      if (!overrides[i]) return sum;
      const hrs = Number(hourOverrides[i] ?? String(r.scheduledHours));
      return sum + (isNaN(hrs) ? 0 : hrs);
    }, 0);
  }, [rows, overrides, hourOverrides]);

  const unmatchedIndices = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((_, i) => i)
      .filter((i) => !overrides[i] && (rows[i].extractedName ?? "").trim().length > 0);
  }, [rows, overrides]);

  const linkSuggestion = (idx: number, s: Suggestion) => {
    setOverrides((o) => ({ ...o, [idx]: s.employeeId }));
    toast.success(`Linked "${rows?.[idx]?.extractedName}" to ${s.fullName}`);
  };

  const quickAddOne = (idx: number) => {
    if (!rows || !effectiveStore) return;
    const r = rows[idx];
    const rate = Number(qaRate[idx]);
    quickCreateM.mutate({
      fullName: r.extractedName.trim(),
      storeLocation: effectiveStore as any,
      role: (qaRole[idx] ?? "Cashier") as any,
      payRate: isNaN(rate) || rate < 0 ? undefined : rate,
    });
  };

  const quickAddAll = async () => {
    if (!rows || !effectiveStore) return;
    // Fire all creates in parallel — each success re-links its rows via the
    // mutation's onSuccess; failures surface via the onError toast.
    await Promise.allSettled(
      unmatchedIndices.map((i) => {
        const r = rows[i];
        const rate = Number(qaRate[i]);
        return quickCreateM.mutateAsync({
          fullName: r.extractedName.trim(),
          storeLocation: effectiveStore as any,
          role: (qaRole[i] ?? "Cashier") as any,
          payRate: isNaN(rate) || rate < 0 ? undefined : rate,
        });
      }),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Schedule"
        icon={<Upload className="h-5 w-5" />}
        title="Import the week's schedule"
        description="Drop the Homebase PDF or a photo. Shifts are read day by day, hours totalled, and every name is checked against your roster."
        actions={
          <>
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />
            {stores.length > 1 ? (
              <Select value={schedStore || undefined} onValueChange={setSchedStore}>
                <SelectTrigger className="h-9 w-52 bg-card shadow-sm">
                  <SelectValue placeholder="Schedule is for store…" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </>
        }
      />

      {/* Step 1 — upload (the page's hero until a file is parsed) */}
      <Card className="surface-card border-0">
        <CardContent className="p-6">
          {parseM.isPending ? (
            <ParseProgress />
          ) : (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer p-10 text-center ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/60 hover:bg-accent/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {!file ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Drop your Homebase schedule here</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        PDF, PNG, JPG or WEBP &nbsp;·&nbsp; up to 8MB &nbsp;·&nbsp; week of{" "}
                        {fmtWeekRange(weekStart)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    {file.type === "application/pdf" ? (
                      <FileText className="h-8 w-8 text-primary" />
                    ) : (
                      <FileImage className="h-8 w-8 text-primary" />
                    )}
                    <div className="text-left">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        setRows(null);
                        setImportId(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 mt-4">
                <p className="text-xs text-muted-foreground">
                  {stores.length > 1 && !effectiveStore
                    ? "Pick which store this schedule is for so new names land in the right place."
                    : effectiveStore
                      ? `New names will be added to ${effectiveStore}.`
                      : ""}
                </p>
                <Button onClick={startParse} disabled={!file || parseM.isPending}>
                  <ScanSearch className="h-4 w-4 mr-2" />
                  Read schedule
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {rows && (
        <div ref={resultsRef} className="space-y-6 scroll-mt-20">
          {/* Scan summary — the numbers a manager needs before committing */}
          <div className="kpi-band rise-in">
            <div className="kpi-cell">
              <span className="kpi-label">People on schedule</span>
              <span className="kpi-value">{rows.length}</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Matched to roster</span>
              <span className="kpi-value text-[oklch(0.4_0.11_160)]">{matchedCount}</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Need review</span>
              <span
                className={`kpi-value ${unmatchedIndices.length > 0 ? "text-[oklch(0.46_0.13_60)]" : ""}`}
              >
                {unmatchedIndices.length}
              </span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Hours to commit</span>
              <span className="kpi-value">{totalHours.toFixed(1)}</span>
            </div>
          </div>

          {/* Roster scan — near-misses link with one click, new people get added */}
          {unmatchedIndices.length > 0 ? (
            <Card className="surface-card border-0 border-l-4 border-l-warning rise-in">
              <CardHeader className="pb-3">
                <CardTitle className="section-title flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-warning" />
                  {unmatchedIndices.length} name{unmatchedIndices.length === 1 ? "" : "s"} need
                  {unmatchedIndices.length === 1 ? "s" : ""} a decision
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  If it's a familiar face under a different spelling, use the one-click link.
                  If they're genuinely new, set a role and rate (editable later) and add them —
                  their scheduled hours import automatically. Unlinked names are skipped.
                </p>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {unmatchedIndices.map((i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-background/50 px-3 py-2.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm min-w-40">
                        {rows[i].extractedName}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Number(hourOverrides[i] ?? rows[i].scheduledHours).toFixed(1)}h scheduled
                      </span>
                      <div className="flex items-center gap-2 ml-auto">
                        <Select
                          value={qaRole[i] ?? "Cashier"}
                          onValueChange={(v) => setQaRole((m) => ({ ...m, [i]: v }))}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          placeholder="$/hr"
                          value={qaRate[i] ?? ""}
                          onChange={(e) => setQaRate((m) => ({ ...m, [i]: e.target.value }))}
                          className="h-8 w-24 text-xs text-right tabular-nums"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={quickCreateM.isPending || !effectiveStore}
                          onClick={() => quickAddOne(i)}
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add as new
                        </Button>
                      </div>
                    </div>
                    {rows[i].suggestions.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-0.5">
                          Same person?
                        </span>
                        {rows[i].suggestions.map((s) => (
                          <button
                            key={s.employeeId}
                            onClick={() => linkSuggestion(i, s)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                            title={`${s.fullName} · ${s.storeLocation} · ${s.score}% name match`}
                          >
                            <Link2 className="h-3 w-3" />
                            {s.fullName}
                            <span className="text-primary/60 tabular-nums">{s.score}%</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {unmatchedIndices.length > 1 ? (
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={quickAddAll}
                      disabled={quickCreateM.isPending || !effectiveStore}
                    >
                      <Sparkles className="h-4 w-4 mr-1.5 text-primary" />
                      {quickCreateM.isPending
                        ? "Adding…"
                        : `Add all ${unmatchedIndices.length} as new to ${effectiveStore || "store"}`}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 rise-in">
              <span className="chip-good">
                <CheckCircle2 className="h-3 w-3" /> Everyone on this schedule is matched to
                your roster
              </span>
            </div>
          )}

          {/* Review & commit */}
          <Card className="surface-card border-0 rise-in">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="section-title">Review &amp; commit</CardTitle>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Commits <span className="font-semibold tabular-nums">{totalHours.toFixed(1)}h</span>{" "}
                  for <span className="font-semibold">{matchedCount}</span> employee
                  {matchedCount === 1 ? "" : "s"} to the week of{" "}
                  <span className="font-semibold">{fmtWeekRange(parsedWeek ?? weekStart)}</span> —
                  scheduled hours flow to the dashboard, payroll and kiosk.
                </p>
              </div>
              <Button onClick={commit} disabled={commitM.isPending || matchedCount === 0}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {commitM.isPending ? "Committing…" : "Commit schedule"}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead>Name on schedule</TableHead>
                      <TableHead>Imports as</TableHead>
                      <TableHead>Shifts (day by day)</TableHead>
                      <TableHead className="text-right w-[130px]">Week total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const matchedId = overrides[i];
                      const unresolvedDays = row.days.filter((d) => !d.date).length;
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            {matchedId ? (
                              <span className="chip-good">
                                <CheckCircle2 className="h-3 w-3" /> Ready
                              </span>
                            ) : (
                              <span className="chip-warn">
                                <AlertCircle className="h-3 w-3" /> Review
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{row.extractedName}</TableCell>
                          <TableCell>
                            <Select
                              value={matchedId ? String(matchedId) : "skip"}
                              onValueChange={(v) =>
                                setOverrides((o) => ({
                                  ...o,
                                  [i]: v === "skip" ? null : Number(v),
                                }))
                              }
                            >
                              <SelectTrigger className="max-w-[240px] h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">— Skip this row —</SelectItem>
                                {employeesList.map((e) => (
                                  <SelectItem key={e.id} value={String(e.id)}>
                                    {e.fullName} · {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5 max-w-[380px]">
                              {row.days.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  no shift detail
                                </span>
                              ) : (
                                row.days.map((d, di) => (
                                  <Badge
                                    key={di}
                                    variant="secondary"
                                    className="font-normal tabular-nums text-[11px]"
                                    title={
                                      d.startLabel && d.endLabel
                                        ? `${d.startLabel} – ${d.endLabel}`
                                        : undefined
                                    }
                                  >
                                    {d.date ? shortDayLabel(new Date(d.date)) : d.ref}
                                    {" · "}
                                    {d.hours.toFixed(1)}h
                                  </Badge>
                                ))
                              )}
                              {unresolvedDays > 0 ? (
                                <span
                                  className="chip-warn"
                                  title="These days couldn't be placed in the selected week — check the week selector."
                                >
                                  <AlertCircle className="h-3 w-3" />
                                  {unresolvedDays} day{unresolvedDays === 1 ? "" : "s"} unresolved
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.25"
                              min="0"
                              max="168"
                              value={hourOverrides[i] ?? String(row.scheduledHours)}
                              onChange={(e) =>
                                setHourOverrides((h) => ({ ...h, [i]: e.target.value }))
                              }
                              className="text-right h-9 tabular-nums"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* How it works + import history */}
      {!rows && !parseM.isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="surface-card border-0">
            <CardContent className="p-6 text-sm text-muted-foreground">
              <p className="section-title text-foreground mb-3">How this works</p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Export the weekly schedule from Homebase as PDF, or take a clear photo.</li>
                <li>
                  Drop the file above and click{" "}
                  <span className="text-foreground font-medium">Read schedule</span> — every
                  shift is read day by day and hours are totalled per person.
                </li>
                <li>
                  Every name is scanned against your roster: close spellings get one-click
                  linking, real newcomers can be added on the spot.
                </li>
                <li>
                  Commit: scheduled hours flow to the dashboard, payroll and the kiosk's daily
                  shift hints.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card className="surface-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="section-title flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" /> Recent imports
              </CardTitle>
            </CardHeader>
            <CardContent>
              {importsQ.isLoading ? (
                <p className="text-sm text-muted-foreground py-3 text-center">Loading…</p>
              ) : (importsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-3 text-center">
                  No imports yet — your upload history will appear here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {(importsQ.data ?? []).map((imp) => (
                    <li key={imp.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{imp.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          week of {fmtWeekRange(new Date(imp.weekStart))} ·{" "}
                          {imp.storeLocation
                            ? (STORE_ABBR[imp.storeLocation] ?? imp.storeLocation)
                            : "all stores"}{" "}
                          · {fmtDateTime(imp.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Number(imp.totalHours).toFixed(0)}h
                        </span>
                        {imp.status === "committed" ? (
                          <span className="chip-good">
                            <CheckCircle2 className="h-3 w-3" /> committed
                          </span>
                        ) : (
                          <span className="chip-neutral">parsed only</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
