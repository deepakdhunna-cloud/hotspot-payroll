/**
 * Schedule import — drop the Homebase schedule (PDF or photo) and the app
 * reads every shift day by day, totals the hours, and scans the roster:
 * known people auto-link, near-misses get one-click "same person?"
 * suggestions (typos, nicknames, initials), and genuinely new names can be
 * added to the roster inline. Nothing touches payroll until commit.
 */
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InitialsBadge } from "@/components/InitialsBadge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STORE_ABBR, fmtWeekRange } from "@/lib/format";
import {
  fmtDateTime,
  fromDateInput,
  inProgressPayWeekStart,
  payWeekDays,
  shortDayLabel,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ExternalLink,
  FileImage,
  FileText,
  History,
  Link2,
  Pencil,
  Plus,
  ScanSearch,
  Sparkles,
  Trash2,
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
  // Set when the uploaded file's printed dates belong to a different pay
  // week than the selected one — committing anyway would land every shift
  // on the wrong dates.
  const [weekWarning, setWeekWarning] = useState<{
    printedWeekStart: Date | null;
    unresolvedDatedDays: number;
  } | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [hourOverrides, setHourOverrides] = useState<Record<number, string>>({});
  const [qaRole, setQaRole] = useState<Record<number, string>>({});
  const [qaRate, setQaRate] = useState<Record<number, string>>({});
  const [qaPhone, setQaPhone] = useState<Record<number, string>>({});
  const [qaCode, setQaCode] = useState<Record<number, string>>({});
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
  const scheduleWeekQ = trpc.schedule.week.useQuery({
    weekStart,
    store: effectiveStore ? (effectiveStore as any) : undefined,
  });
  const utils = trpc.useUtils();

  const parseM = trpc.schedule.parseUpload.useMutation({
    onSuccess: (data) => {
      setRows(data.rows as ParsedRow[]);
      setImportId(data.importId);
      setParsedWeek(new Date(data.weekStart));
      setWeekWarning(
        data.weekMismatch || data.unresolvedDatedDays > 0
          ? {
              printedWeekStart: data.printedWeekStart
                ? new Date(data.printedWeekStart)
                : null,
              unresolvedDatedDays: data.unresolvedDatedDays,
            }
          : null,
      );
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
      setQaPhone({});
      setQaCode({});
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

  const parseWithWeek = async (week: Date) => {
    if (!file) return;
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/jpg",
      "application/pdf",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const byExt = /\.(pdf|png|jpe?g|webp|csv|xlsx)$/i.test(file.name);
    if (!allowed.includes(file.type) && !byExt) {
      toast.error("Upload a PDF, a photo (PNG/JPG), or a spreadsheet (.xlsx/.csv).");
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
      weekStart: week,
      store: effectiveStore ? (effectiveStore as any) : undefined,
    });
  };
  const startParse = () => parseWithWeek(weekStart);

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
    const code = (qaCode[idx] ?? "").trim();
    if (code && !/^\d{4}$/.test(code)) {
      toast.error("Clock code must be exactly 4 digits (or leave it blank).");
      return;
    }
    quickCreateM.mutate({
      fullName: r.extractedName.trim(),
      storeLocation: effectiveStore as any,
      role: (qaRole[idx] ?? "Cashier") as any,
      payRate: isNaN(rate) || rate < 0 ? undefined : rate,
      phone: (qaPhone[idx] ?? "").trim() || undefined,
      clockCode: code || undefined,
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
        const code = (qaCode[i] ?? "").trim();
        return quickCreateM.mutateAsync({
          fullName: r.extractedName.trim(),
          storeLocation: effectiveStore as any,
          role: (qaRole[i] ?? "Cashier") as any,
          payRate: isNaN(rate) || rate < 0 ? undefined : rate,
          phone: (qaPhone[i] ?? "").trim() || undefined,
          clockCode: /^\d{4}$/.test(code) ? code : undefined,
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
        description="Drop the Homebase PDF, a spreadsheet, or a photo — even a handwritten grid. Shifts are read day by day, hours totalled, and every name is checked against your roster."
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
                  accept="image/*,application/pdf,.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                        PDF · photo (even handwritten) · spreadsheet (.xlsx/.csv) &nbsp;·&nbsp; up to 8MB &nbsp;·&nbsp; week of{" "}
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
          {/* Wrong-week guard: the file's printed dates vs the selected week */}
          {weekWarning && (
            <Card className="surface-card border-0 border-l-4 border-l-primary rise-in">
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <AlertCircle className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-60">
                  <p className="text-sm font-semibold">
                    {weekWarning.printedWeekStart
                      ? `This file is printed for the week of ${fmtWeekRange(
                          weekWarning.printedWeekStart,
                        )} — you're importing it into ${fmtWeekRange(
                          parsedWeek ?? weekStart,
                        )}.`
                      : `${weekWarning.unresolvedDatedDays} dated shift${
                          weekWarning.unresolvedDatedDays === 1 ? "" : "s"
                        } on this file fall outside the selected week and would be skipped.`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Committing into the wrong week puts every shift on the wrong
                    dates.{" "}
                    {weekWarning.printedWeekStart
                      ? "Switch to the printed week — or carry on only if you genuinely mean to reuse this schedule for a different week."
                      : "Double-check the pay week selected above, then read the file again."}
                  </p>
                </div>
                {weekWarning.printedWeekStart && (
                  <Button
                    size="sm"
                    disabled={parseM.isPending}
                    onClick={() => {
                      const w = weekWarning.printedWeekStart!;
                      setWeekStart(w);
                      parseWithWeek(w);
                    }}
                  >
                    <CalendarRange className="h-4 w-4 mr-1.5" />
                    Use printed week
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

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
                  If they're genuinely new, set a role and rate — phone and a 4-digit kiosk
                  code are optional here and can be added anytime from their profile. Their
                  scheduled hours import automatically; unlinked names are skipped.
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
                        <Input
                          type="tel"
                          placeholder="phone (optional)"
                          value={qaPhone[i] ?? ""}
                          onChange={(e) => setQaPhone((m) => ({ ...m, [i]: e.target.value }))}
                          className="h-8 w-36 text-xs"
                          title="Optional — can be added later on the profile"
                        />
                        <Input
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="kiosk code"
                          value={qaCode[i] ?? ""}
                          onChange={(e) =>
                            setQaCode((m) => ({
                              ...m,
                              [i]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4),
                            }))
                          }
                          className="h-8 w-24 text-xs text-center tabular-nums tracking-widest"
                          title="Optional 4-digit clock-in code — can be set later on the profile"
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

      {/* The committed schedule — always visible, editable, original file a click away */}
      <WeekScheduleBoard
        weekStart={weekStart}
        shifts={(scheduleWeekQ.data?.shifts ?? []) as BoardShift[]}
        loading={scheduleWeekQ.isLoading}
        imports={importsQ.data ?? []}
        employees={employeesList}
        onMoved={setWeekStart}
      />

      {/* How it works + import history */}
      {!rows && !parseM.isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="surface-card border-0">
            <CardContent className="p-6 text-sm text-muted-foreground">
              <p className="section-title text-foreground mb-3">How this works</p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Grab the schedule in any form — Homebase PDF export, a spreadsheet (.xlsx/.csv from Google Sheets or Excel), or a clear photo of a printed or handwritten grid.</li>
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
                        {imp.fileUrl ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              window.open(imp.fileUrl, "_blank", "noopener,noreferrer")
                            }
                            title="Open the original uploaded file"
                          >
                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> File
                          </Button>
                        ) : null}
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

/* ------------------------------------------------------------------ */
/* The committed schedule board: always on screen for the selected     */
/* week — who works which day, per-day coverage totals, one click to   */
/* the original uploaded file, and inline editing per employee.        */
/* ------------------------------------------------------------------ */

type BoardShift = {
  id: number;
  employeeId: number;
  employeeName: string;
  storeLocation: string;
  shiftDate: Date | string;
  startLabel: string | null;
  endLabel: string | null;
  hours: number;
  importId: number | null;
};

type ImportRow = {
  id: number;
  filename: string;
  fileUrl: string | null;
  status: string;
};

type EditableShift = {
  date: string; // yyyy-mm-dd within the week
  startLabel: string;
  endLabel: string;
  hours: string;
};

function WeekScheduleBoard({
  weekStart,
  shifts,
  loading,
  imports,
  employees,
  onMoved,
}: {
  weekStart: Date;
  shifts: BoardShift[];
  loading: boolean;
  imports: ImportRow[];
  employees: { id: number; fullName: string }[];
  onMoved?: (to: Date) => void;
}) {
  const utils = trpc.useUtils();
  const [editFor, setEditFor] = useState<{ id: number; name: string } | null>(null);
  const [addPick, setAddPick] = useState<string>("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const moveWeekM = trpc.schedule.moveWeek.useMutation({
    onSuccess: ({ moved, toWeek }) => {
      const to = new Date(toWeek);
      toast.success(
        `Moved ${moved} shift${moved === 1 ? "" : "s"} to the week of ${fmtWeekRange(to)}.`,
      );
      setMoveOpen(false);
      setMoveTarget("");
      utils.schedule.week.invalidate();
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
      onMoved?.(to);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteWeekM = trpc.schedule.deleteWeek.useMutation({
    onSuccess: ({ deleted }) => {
      toast.success(
        `Deleted this week's schedule (${deleted} shift${deleted === 1 ? "" : "s"}). A snapshot is kept in the activity log.`,
      );
      utils.schedule.week.invalidate();
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const days = payWeekDays(weekStart);
  // Today in store time, for the highlighted column.
  const todayKey = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  const byEmployee = useMemo(() => {
    const m = new Map<number, { name: string; total: number; byDay: Map<string, BoardShift[]> }>();
    for (const s of shifts) {
      const rec = m.get(s.employeeId) ?? {
        name: s.employeeName,
        total: 0,
        byDay: new Map<string, BoardShift[]>(),
      };
      rec.total += s.hours;
      const key = toDateInput(new Date(s.shiftDate));
      rec.byDay.set(key, [...(rec.byDay.get(key) ?? []), s]);
      m.set(s.employeeId, rec);
    }
    return m;
  }, [shifts]);

  const dayTotals = days.map((d) => {
    const key = toDateInput(d);
    let total = 0;
    byEmployee.forEach((rec) => {
      for (const s of rec.byDay.get(key) ?? []) total += s.hours;
    });
    return total;
  });
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  // The uploaded file behind this week's schedule (most shifts carry the
  // committing import's id).
  const sourceImport = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of shifts) {
      if (s.importId) counts.set(s.importId, (counts.get(s.importId) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestCount = 0;
    counts.forEach((count, id) => {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    });
    return best ? (imports.find((i) => i.id === best) ?? null) : null;
  }, [shifts, imports]);

  const scheduledIds = new Set(Array.from(byEmployee.keys()));
  const addable = employees.filter((e) => !scheduledIds.has(e.id));

  return (
    <Card className="surface-card border-0 rise-in">
      <CardHeader className="pb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="section-title flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            Schedule on file · {fmtWeekRange(weekStart)}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1.5">
            {shifts.length > 0
              ? `${byEmployee.size} people · ${weekTotal.toFixed(1)} hours committed. Click a row's pencil to edit — changes flow to payroll and the dashboards.`
              : "What's committed for this week will show here — who works which day, with per-day coverage."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sourceImport?.fileUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(sourceImport.fileUrl!, "_blank", "noopener,noreferrer")
              }
              title={`Open the original upload (${sourceImport.filename})`}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" /> View uploaded schedule
            </Button>
          ) : null}
          {shifts.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveOpen(true)}
              title="Slide this whole schedule to a different pay week (wrong dates uploaded)"
            >
              <CalendarRange className="h-4 w-4 mr-1.5" /> Move week
            </Button>
          ) : null}
          {shifts.length > 0 ? (
            <ConfirmDialog
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                  title="Remove this week's committed schedule (wrong week uploaded, etc.)"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete week
                </Button>
              }
              title={`Delete the schedule for ${fmtWeekRange(weekStart)}?`}
              description={`Removes all ${shifts.length} shift${shifts.length === 1 ? "" : "s"} across ${byEmployee.size} ${byEmployee.size === 1 ? "person" : "people"} and clears their scheduled hours for this week — use this when a schedule was uploaded against the wrong week. Worked hours and pay are untouched, the original file stays in Recent imports, and a full snapshot is kept in the activity log. You can re-import or rebuild the week afterwards.`}
              confirmLabel="Delete this week's schedule"
              onConfirm={() => deleteWeekM.mutate({ weekStart })}
              disabled={deleteWeekM.isPending}
            />
          ) : null}
          {addable.length > 0 && shifts.length > 0 ? (
            <Select
              value={addPick || undefined}
              onValueChange={(v) => {
                setAddPick("");
                const emp = addable.find((e) => String(e.id) === v);
                if (emp) setEditFor({ id: emp.id, name: emp.fullName });
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs bg-card">
                <SelectValue placeholder="+ Add person to week" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading schedule…</p>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No schedule committed for this week yet — upload one above, or use{" "}
            <span className="font-medium text-foreground">+ Add person</span> after the first
            commit.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Employee</TableHead>
                  {days.map((d) => {
                    const isToday = toDateInput(d) === todayKey;
                    return (
                      <TableHead
                        key={d.toISOString()}
                        className={`text-center min-w-[96px] ${isToday ? "bg-primary/5" : ""}`}
                      >
                        <span className="block leading-tight">
                          {shortDayLabel(d).split(" ")[0]}
                        </span>
                        <span
                          className={`block text-[15px] leading-tight font-bold tabular-nums normal-case tracking-normal ${
                            isToday ? "text-primary" : "text-foreground"
                          }`}
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          {d.getUTCDate()}
                        </span>
                      </TableHead>
                    );
                  })}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-[52px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(byEmployee.entries())
                  .sort((a, b) => a[1].name.localeCompare(b[1].name))
                  .map(([empId, rec]) => (
                    <TableRow key={empId} className="group">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <InitialsBadge name={rec.name} size="sm" />
                          <span className="font-medium">{rec.name}</span>
                        </div>
                      </TableCell>
                      {days.map((d) => {
                        const cell = rec.byDay.get(toDateInput(d)) ?? [];
                        const isToday = toDateInput(d) === todayKey;
                        return (
                          <TableCell
                            key={d.toISOString()}
                            className={`text-center ${isToday ? "bg-primary/[0.03]" : ""}`}
                          >
                            {cell.length === 0 ? (
                              <span className="text-muted-foreground/30">·</span>
                            ) : (
                              <div className="flex flex-col items-center gap-1 py-0.5">
                                {cell.map((s) => (
                                  <div
                                    key={s.id}
                                    className="inline-flex flex-col items-center rounded-lg border px-2 py-1 leading-tight"
                                    style={{
                                      background: "#2a78d612",
                                      borderColor: "#2a78d630",
                                    }}
                                  >
                                    {s.startLabel && s.endLabel ? (
                                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {s.startLabel}–{s.endLabel}
                                      </span>
                                    ) : null}
                                    <span className="text-xs font-bold tabular-nums text-[#1d5eae]">
                                      {s.hours.toFixed(1)}h
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums font-bold">
                        {rec.total.toFixed(1)}h
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-40 group-hover:opacity-100 transition-opacity"
                          onClick={() => setEditFor({ id: empId, name: rec.name })}
                          aria-label={`Edit ${rec.name}'s week`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Coverage
                  </TableCell>
                  {dayTotals.map((t, i) => {
                    const maxDay = Math.max(1, ...dayTotals);
                    return (
                      <TableCell
                        key={i}
                        className="text-center tabular-nums text-xs font-bold"
                        style={{
                          background: t > 0 ? `rgba(42,120,214,${(t / maxDay) * 0.16})` : undefined,
                        }}
                      >
                        {t > 0 ? `${t.toFixed(1)}h` : "—"}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right tabular-nums font-bold">
                    {weekTotal.toFixed(1)}h
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {moveOpen ? (
        <Dialog open onOpenChange={(open) => (!open ? setMoveOpen(false) : null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Move this schedule to a different week</DialogTitle>
              <DialogDescription>
                Every shift slides with its day of the week ({shifts.length} shift
                {shifts.length === 1 ? "" : "s"}, {byEmployee.size}{" "}
                {byEmployee.size === 1 ? "person" : "people"}) and scheduled hours follow.
                The target week must be empty — delete or move it first if not.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                type="date"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {moveTarget
                  ? `Snaps to the pay week of ${fmtWeekRange(startOfPayWeek(fromDateInput(moveTarget)))} (Thu–Wed).`
                  : "Pick any date — it snaps to that pay week's Thursday."}
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setMoveOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!moveTarget || moveWeekM.isPending}
                onClick={() =>
                  moveWeekM.mutate({
                    fromWeek: weekStart,
                    toWeek: startOfPayWeek(fromDateInput(moveTarget)),
                  })
                }
              >
                {moveWeekM.isPending
                  ? "Moving…"
                  : moveTarget
                    ? `Move to ${fmtWeekRange(startOfPayWeek(fromDateInput(moveTarget)))}`
                    : "Move schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {editFor ? (
        <EditWeekDialog
          weekStart={weekStart}
          employeeId={editFor.id}
          employeeName={editFor.name}
          existing={shifts.filter((s) => s.employeeId === editFor.id)}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null);
            utils.schedule.week.invalidate();
            utils.payroll.week.invalidate();
            utils.dashboard.summary.invalidate();
            utils.attention.list.invalidate();
          }}
        />
      ) : null}
    </Card>
  );
}

/** Per-employee week editor — every shift is a row; saving replaces the
 *  employee's week via the same single-writer commit path as imports. */
function EditWeekDialog({
  weekStart,
  employeeId,
  employeeName,
  existing,
  onClose,
  onSaved,
}: {
  weekStart: Date;
  employeeId: number;
  employeeName: string;
  existing: BoardShift[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const days = payWeekDays(weekStart);
  const [rows, setRows] = useState<EditableShift[]>(() =>
    existing
      .slice()
      .sort(
        (a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime(),
      )
      .map((s) => ({
        date: toDateInput(new Date(s.shiftDate)),
        startLabel: s.startLabel ?? "",
        endLabel: s.endLabel ?? "",
        hours: String(s.hours),
      })),
  );

  const commitM = trpc.schedule.commit.useMutation({
    onSuccess: () => {
      toast.success(`${employeeName}'s week updated.`);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const total = rows.reduce((sum, r) => {
    const h = Number(r.hours);
    return sum + (isNaN(h) ? 0 : h);
  }, 0);

  const save = () => {
    for (const r of rows) {
      const h = Number(r.hours);
      if (isNaN(h) || h < 0 || h > 24) {
        toast.error("Every shift needs valid hours (0–24).");
        return;
      }
    }
    commitM.mutate({
      weekStart,
      importId: null,
      entries: [
        {
          employeeId,
          scheduledHours: Math.round(total * 100) / 100,
          shifts: rows.map((r) => ({
            date: fromDateInput(r.date),
            startLabel: r.startLabel.trim() || null,
            endLabel: r.endLabel.trim() || null,
            hours: Number(r.hours),
          })),
        },
      ],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        {/* Ink masthead — the editor opens like a focused work surface */}
        <DialogHeader className="ink-panel px-6 pt-5 pb-4 space-y-0">
          <div className="flex items-center gap-3">
            <InitialsBadge name={employeeName} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-white section-title normal-case tracking-normal text-[1.15rem]">
                {employeeName}
              </DialogTitle>
              <DialogDescription className="text-white/60 text-xs mt-0.5">
                Week of {fmtWeekRange(weekStart)} · edits flow to payroll and every dashboard
              </DialogDescription>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-semibold">
                Week total
              </div>
              <div
                className="text-[1.6rem] leading-none font-bold text-white tabular-nums"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {total.toFixed(1)}h
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 pb-2">
          {/* Column voice — labels once, not per row */}
          <div className="grid grid-cols-[7.5rem_1fr_1fr_5rem_2rem] gap-2 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span>Day</span>
            <span>Start</span>
            <span>End</span>
            <span className="text-right">Hours</span>
            <span />
          </div>

          <div className="space-y-1.5 max-h-[42vh] overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No shifts this week — add the first one below.
              </p>
            ) : (
              rows.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[7.5rem_1fr_1fr_5rem_2rem] items-center gap-2 rounded-lg border border-border bg-muted/30 px-1.5 py-1.5 transition-colors hover:bg-muted/50"
                >
                  <Select
                    value={r.date}
                    onValueChange={(v) =>
                      setRows((rs) => rs.map((x, j) => (j === i ? { ...x, date: v } : x)))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs font-semibold bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {days.map((d) => (
                        <SelectItem key={d.toISOString()} value={toDateInput(d)}>
                          {shortDayLabel(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="9:00am"
                    value={r.startLabel}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, startLabel: e.target.value } : x)),
                      )
                    }
                    className="h-9 text-xs bg-card"
                  />
                  <Input
                    placeholder="5:00pm"
                    value={r.endLabel}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, endLabel: e.target.value } : x)),
                      )
                    }
                    className="h-9 text-xs bg-card"
                  />
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    placeholder="0"
                    value={r.hours}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)),
                      )
                    }
                    className="h-9 text-xs text-right tabular-nums font-semibold bg-card"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground/60 hover:text-destructive"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    aria-label="Remove shift"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full border-dashed"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { date: toDateInput(days[0]), startLabel: "", endLabel: "", hours: "" },
              ])
            }
          >
            <Plus className="h-4 w-4 mr-1.5" /> Add shift
          </Button>
        </div>

        <DialogFooter className="px-6 py-4 mt-2 border-t border-border bg-muted/30">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={commitM.isPending}>
            {commitM.isPending ? "Saving…" : `Save week · ${total.toFixed(1)}h`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
