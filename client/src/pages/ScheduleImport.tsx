/**
 * Schedule import — upload a Homebase schedule (PDF or photo), read every
 * employee's shifts day by day, review totals, quick-add anyone new, and
 * commit the week's schedule to payroll in one step.
 */
import { PageHeader } from "@/components/PageHeader";
import { WeekNavigator } from "@/components/WeekNavigator";
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
  CheckCircle2,
  FileImage,
  FileText,
  History,
  Upload,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ParsedDay = {
  ref: string;
  date: Date | null;
  startLabel: string | null;
  endLabel: string | null;
  hours: number;
};

type ParsedRow = {
  extractedName: string;
  scheduledHours: number;
  days: ParsedDay[];
  matchedEmployeeId: number | null;
  matchedFullName: string | null;
  matchedStore: string | null;
};

const ROLE_OPTIONS = [
  "Manager",
  "Assistant Manager",
  "Cashier",
  "Kitchen Manager",
  "Cook",
  "Janitorial",
];

export default function ScheduleImport() {
  const [weekStart, setWeekStart] = useState<Date>(() => inProgressPayWeekStart());
  const [schedStore, setSchedStore] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [hourOverrides, setHourOverrides] = useState<Record<number, string>>({});
  const [qaRole, setQaRole] = useState<Record<number, string>>({});
  const [qaRate, setQaRate] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        `Read ${data.totalExtracted} employees, ${data.totalHours.toFixed(1)} scheduled hours — ${matched} auto-matched.`,
      );
      utils.schedule.imports.invalidate();
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
    commitM.mutate({ weekStart, importId, entries });
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
    for (const i of unmatchedIndices) {
      const r = rows[i];
      const rate = Number(qaRate[i]);
      try {
        await quickCreateM.mutateAsync({
          fullName: r.extractedName.trim(),
          storeLocation: effectiveStore as any,
          role: (qaRole[i] ?? "Cashier") as any,
          payRate: isNaN(rate) || rate < 0 ? undefined : rate,
        });
      } catch {
        /* surfaced via toast onError */
      }
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Schedule import"
        icon={<Upload className="h-5 w-5" />}
        title="Import Homebase schedule"
        description="Drop a PDF or photo. Every employee's shifts are read day by day, hours are totalled, and new names can be added in one click."
        actions={
          <>
            <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
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

      {/* Step 1 — upload */}
      <Card className="surface-card border-0">
        <CardContent className="p-6">
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
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
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
              <Upload className="h-4 w-4 mr-2" />
              {parseM.isPending ? "Reading schedule…" : "Extract schedule"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — new employees found */}
      {rows && unmatchedIndices.length > 0 ? (
        <Card className="surface-card border-0 border-l-4 border-l-warning rise-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-warning" />
              {unmatchedIndices.length} new name{unmatchedIndices.length === 1 ? "" : "s"} on this
              schedule
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These people aren't on the roster yet. Set a role and pay rate (both can be edited
              later on their profile) and add them — their scheduled hours import automatically.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {unmatchedIndices.map((i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2"
              >
                <span className="font-medium text-sm min-w-40">{rows[i].extractedName}</span>
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
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add
                  </Button>
                </div>
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
                  <Zap className="h-4 w-4 mr-1.5 text-primary" />
                  {quickCreateM.isPending
                    ? "Adding…"
                    : `Add all ${unmatchedIndices.length} to ${effectiveStore || "store"}`}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Step 3 — review & commit */}
      {rows && (
        <Card className="surface-card border-0 rise-in">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Review extracted schedule</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.length} row{rows.length === 1 ? "" : "s"} ·{" "}
                <span className="text-success font-medium">{matchedCount} matched</span> ·{" "}
                <span className={rows.length - matchedCount > 0 ? "text-warning font-medium" : ""}>
                  {rows.length - matchedCount} need review
                </span>{" "}
                · <span className="font-medium tabular-nums">{totalHours.toFixed(1)}h total</span>
              </p>
            </div>
            <Button onClick={commit} disabled={commitM.isPending || matchedCount === 0}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {commitM.isPending
                ? "Committing…"
                : `Commit schedule (${matchedCount} employee${matchedCount === 1 ? "" : "s"})`}
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead>Extracted name</TableHead>
                    <TableHead>Match to employee</TableHead>
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
                              <CheckCircle2 className="h-3 w-3" /> Matched
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
      )}

      {/* How it works + import history */}
      {!rows && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="surface-card border-0">
            <CardContent className="p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">How this works</p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Export the weekly schedule from Homebase as PDF, or take a clear photo.</li>
                <li>
                  Drop the file above and click{" "}
                  <span className="text-foreground font-medium">Extract schedule</span> — every
                  shift is read day by day and hours are totalled per person.
                </li>
                <li>New names get flagged so you can add them to the roster in one click.</li>
                <li>
                  Commit: scheduled hours flow to the dashboard and payroll, and daily coverage
                  shows on the dashboard's day strip.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card className="surface-card border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
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
