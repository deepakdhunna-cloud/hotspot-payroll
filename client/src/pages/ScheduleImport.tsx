/**
 * Schedule — the week's shifts for the store in scope, and the import flow
 * that fills it: drop the Homebase schedule (PDF, spreadsheet or photo) and
 * the app reads every shift day by day, totals the hours and links each name
 * to an employee. Confident matches link themselves, near-misses get
 * one-click "same person?" suggestions (typos, nicknames, initials), and new
 * names can be added inline. Nothing touches payroll until "Save schedule".
 */
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InitialsBadge } from "@/components/InitialsBadge";
import { PageHeader } from "@/components/PageHeader";
import { BlockState } from "@/components/QueryStates";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { errorMessage } from "@/lib/errors";
import { STORE_ABBR, fmtHours, fmtHoursLabel, fmtWeekRange, storeColor } from "@/lib/format";
import {
  fmtDateTime,
  fromDateInput,
  inProgressPayWeekStart,
  payWeekDays,
  shortDayLabel,
  startOfPayWeek,
  storeDayKey,
  toDateInput,
} from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ROLES, STORES, parseTimeLabelToMinutes, type Store } from "@shared/hotspot";
import {
  AlertCircle,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileImage,
  FileText,
  History,
  Link2,
  Merge,
  Pencil,
  Plus,
  ScanSearch,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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

type Employee = { id: number; fullName: string; storeLocation: string };

/** A new person typed into the review: role, pay rate and optional extras. */
type QuickAdd = { role: string; rate: string; phone: string; code: string };
const QUICK_ADD_DEFAULT: QuickAdd = { role: "Cashier", rate: "", phone: "", code: "" };

/** Upload-store picker value for a file that covers several stores. */
const MULTI_STORE = "__multi";

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/jpg",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Cosmetic progress stages while the file is read (~20–40 s). */
const PARSE_STAGES = [
  "Uploading file…",
  "Reading names and shifts…",
  "Totalling hours per person…",
  "Linking names to your employees…",
];

const storeShort = (s: string) => STORE_ABBR[s] ?? s;
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const shifts = (n: number) => `${n} shift${n === 1 ? "" : "s"}`;
/** "Ana, Ben and Cy" / "Ana, Ben, Cy and 4 more". */
function nameList(names: string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
/** Scheduled hours that will actually land: shifts placed in the week. */
const placedHours = (days: ParsedDay[]) =>
  days.reduce((sum, d) => sum + (d.date ? d.hours : 0), 0);
/** Board shorthand: "10:00 AM" → "10a", "2:30 PM" → "2:30p". */
function shortTime(label: string): string {
  const m = parseTimeLabelToMinutes(label);
  if (m === null) return label;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h24 < 12 ? "a" : "p"}`;
}
const storeOrder = (s: string) => {
  const i = (STORES as readonly string[]).indexOf(s);
  return i < 0 ? 99 : i;
};

function fileProblem(f: File): string | null {
  const byExt = /\.(pdf|png|jpe?g|webp|csv|xlsx)$/i.test(f.name);
  if (!ACCEPTED_TYPES.includes(f.type) && !byExt) {
    return "That file type can't be read. Use a PDF, a photo (PNG or JPG) or a spreadsheet (.xlsx or .csv).";
  }
  if (f.size > MAX_FILE_BYTES) {
    return `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`;
  }
  return null;
}

function quickAddProblem(v: QuickAdd): string | null {
  const rateText = v.rate.trim();
  const rate = Number(rateText);
  if (!rateText || !Number.isFinite(rate) || rate <= 0) return "Enter a pay rate above $0.";
  if (rate > 1000) return "That pay rate is too high — the most allowed is $1,000 an hour.";
  if (v.code && !/^\d{4}$/.test(v.code)) return "A clock code is 4 digits — or leave it blank.";
  return null;
}

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
    <div className="flex flex-col items-center gap-4 py-6" role="status" aria-live="polite">
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
  usePageTitle("Schedule");
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [weekStart, setWeekStart] = useState<Date>(() => inProgressPayWeekStart());

  // The board follows the top-bar store scope like every other page. A
  // manager has exactly one store; the CEO's "All stores" shows them all.
  const { scope, stores } = useStoreScope();
  const boardStore =
    stores.length === 1 ? stores[0] : scope !== "all" && stores.includes(scope) ? scope : "";
  // An upload is for ONE store — its new names are added there and
  // "Replace" only clears that store. With no store in scope, ask.
  const [storePick, setStorePick] = useState("");
  const needsStorePick = !boardStore && stores.length > 1;
  const uploadStore = boardStore || (storePick === MULTI_STORE ? "" : storePick);
  const storeChosen = !needsStorePick || storePick !== "";

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Review state — everything below describes ONE parsed file.
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  // The week (and store) the rows were read against. Shift dates were
  // resolved into THIS week server-side, so saving must use it even if the
  // week navigator has moved since.
  const [parsedWeek, setParsedWeek] = useState<Date | null>(null);
  const [parsedStore, setParsedStore] = useState("");
  // Set when the file's printed dates belong to a different pay week than
  // the selected one — saving anyway would land every shift on wrong dates.
  const [weekWarning, setWeekWarning] = useState<{
    printedWeekStart: Date | null;
    unresolvedDatedDays: number;
  } | null>(null);
  const [links, setLinks] = useState<Record<number, number | null>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  // Rows whose shifts were combined into another row (same person twice).
  const [merged, setMerged] = useState<Record<number, number>>({});
  // Week totals typed for rows that came with no day-by-day detail.
  const [totalEdits, setTotalEdits] = useState<Record<number, string>>({});
  // Shifts edited in the review (authoritative over the parsed days).
  const [dayEdits, setDayEdits] = useState<Record<number, ParsedDay[]>>({});
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [quickAdd, setQuickAdd] = useState<Record<number, QuickAdd>>({});
  const [quickTried, setQuickTried] = useState<Record<number, boolean>>({});
  const [addingAll, setAddingAll] = useState(false);
  const [editRow, setEditRow] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const employeesQ = trpc.employees.list.useQuery({});
  const allEmployees = (employeesQ.data ?? []) as Employee[];
  const empById = useMemo(
    () => new Map(allEmployees.map((e) => [e.id, e])),
    [allEmployees],
  );
  const reviewEmployees = parsedStore
    ? allEmployees.filter((e) => e.storeLocation === parsedStore)
    : allEmployees;
  const boardEmployees = boardStore
    ? allEmployees.filter((e) => e.storeLocation === boardStore)
    : allEmployees;

  const importsQ = trpc.schedule.imports.useQuery({ limit: 8 });
  const scheduleWeekQ = trpc.schedule.week.useQuery({
    weekStart,
    store: boardStore ? (boardStore as Store) : undefined,
  });
  // What a reviewed file would replace: the parsed week's current shifts.
  const existingQ = trpc.schedule.week.useQuery(
    {
      weekStart: parsedWeek ?? weekStart,
      store: parsedStore ? (parsedStore as Store) : undefined,
    },
    { enabled: !!rows && !!parsedWeek },
  );

  const resetReview = () => {
    setRows(null);
    setImportId(null);
    setParsedWeek(null);
    setParsedStore("");
    setWeekWarning(null);
    setLinks({});
    setSkipped({});
    setMerged({});
    setTotalEdits({});
    setDayEdits({});
    setMode("replace");
    setQuickAdd({});
    setQuickTried({});
    setEditRow(null);
  };
  /** A new file always starts a fresh review — never another file's rows. */
  const pickFile = (f: File | null) => {
    resetReview();
    setFileError(f ? fileProblem(f) : null);
    setFile(f);
  };

  // Moving to another week with the uploader idle closes it again.
  useEffect(() => {
    if (!file && !rows) setShowUpload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const parseM = trpc.schedule.parseUpload.useMutation({
    onSuccess: (data, vars) => {
      const parsed = data.rows as ParsedRow[];
      setRows(parsed);
      setImportId(data.importId);
      setParsedWeek(new Date(data.weekStart));
      setParsedStore(vars.store ?? "");
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
      const initial: Record<number, number | null> = {};
      parsed.forEach((r, i) => {
        initial[i] = r.matchedEmployeeId;
      });
      setLinks(initial);
      setSkipped({});
      setMerged({});
      setTotalEdits({});
      setDayEdits({});
      setMode("replace");
      setQuickAdd({});
      setQuickTried({});
      const matched = parsed.filter((r) => r.matchedEmployeeId).length;
      toast.success(
        `Read ${people(data.totalExtracted)} and ${fmtHoursLabel(data.totalHours)} — ${matched} linked to an employee automatically.`,
      );
      utils.schedule.imports.invalidate();
      setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        150,
      );
    },
    onError: (e) => setFileError(errorMessage(e)),
  });

  const quickCreateM = trpc.employees.quickCreate.useMutation();

  const commitM = trpc.schedule.commit.useMutation({
    onSuccess: ({ saved, skipped: outOfScope, cleared }, vars) => {
      const week = startOfPayWeek(vars.weekStart);
      const bits = [`Schedule saved for ${people(saved)}`];
      if (cleared > 0) bits.push(`${people(cleared)} came off the week`);
      if (outOfScope.length > 0) bits.push(`${outOfScope.length} skipped (outside your stores)`);
      toast.success(`${bits.join(" · ")}.`, {
        action: {
          label: "Open payroll",
          onClick: () => setLocation(`/payroll?week=${toDateInput(week)}`),
        },
      });
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
      utils.schedule.imports.invalidate();
      utils.schedule.week.invalidate();
      utils.attention.list.invalidate();
      resetReview();
      setFile(null);
      setFileError(null);
      setShowUpload(false);
      // Land on the week that was just saved so it's on screen.
      setWeekStart(week);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const parseWithWeek = async (week: Date) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setFileError(null);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    parseM.mutate({
      fileBase64: btoa(binary),
      mimeType: file.type,
      filename: file.name,
      weekStart: week,
      store: uploadStore ? (uploadStore as Store) : undefined,
    });
  };

  /* ---------------- review: derived per-row values ---------------- */

  const daysOf = (i: number): ParsedDay[] => dayEdits[i] ?? rows?.[i]?.days ?? [];
  const hasDetail = (i: number) =>
    dayEdits[i] !== undefined || (rows?.[i]?.days.length ?? 0) > 0;
  /** Week total: the placed shifts when the file has day detail (so the
   *  board, payroll and kiosk always agree), else the typed total. */
  const totalOf = (i: number): number => {
    if (!rows) return 0;
    if (hasDetail(i)) return placedHours(daysOf(i));
    const raw = totalEdits[i] ?? String(rows[i].scheduledHours);
    return raw.trim() === "" ? NaN : Number(raw);
  };
  const totalValid = (i: number) => {
    const t = totalOf(i);
    return Number.isFinite(t) && t >= 0 && t <= 168;
  };
  const quickOf = (i: number): QuickAdd => quickAdd[i] ?? QUICK_ADD_DEFAULT;
  const setQuick = (i: number, patch: Partial<QuickAdd>) =>
    setQuickAdd((m) => ({ ...m, [i]: { ...(m[i] ?? QUICK_ADD_DEFAULT), ...patch } }));

  const review = useMemo(() => {
    if (!rows) return null;
    const all = rows.map((_, i) => i);
    const linked = all.filter((i) => !!links[i]);
    const byEmp = new Map<number, number[]>();
    for (const i of linked) byEmp.set(links[i]!, [...(byEmp.get(links[i]!) ?? []), i]);
    const duplicates = Array.from(byEmp.entries()).filter(([, idx]) => idx.length > 1);
    const dupRows = new Set(duplicates.flatMap(([, idx]) => idx));
    const invalid = linked.filter((i) => !totalValid(i));
    const ready = linked.filter((i) => totalValid(i) && !dupRows.has(i));
    const unmatched = all.filter(
      (i) => !links[i] && !skipped[i] && rows[i].extractedName.trim().length > 0,
    );
    const skippedRows = all.filter((i) => !links[i] && skipped[i] && merged[i] === undefined);
    const hours = ready.reduce((sum, i) => sum + totalOf(i), 0);
    const linkedIds = new Set(linked.map((i) => links[i]!));
    return { linked, duplicates, dupRows, invalid, ready, unmatched, skippedRows, hours, linkedIds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, links, skipped, merged, totalEdits, dayEdits]);

  // Replace preview: who is on the current schedule for the covered store(s)
  // but not on this file. Same rule the server applies on save.
  const replacePreview = useMemo(() => {
    if (!review) return { replacing: false, comingOff: [] as string[], stores: [] as string[] };
    const covered = parsedStore
      ? [parsedStore]
      : Array.from(
          new Set(
            Array.from(review.linkedIds)
              .map((id) => empById.get(id)?.storeLocation)
              .filter((s): s is string => !!s),
          ),
        );
    const current = (existingQ.data?.shifts ?? []).filter((s) =>
      covered.includes(s.storeLocation),
    );
    const off = new Map<number, string>();
    for (const s of current) {
      if (!review.linkedIds.has(s.employeeId)) off.set(s.employeeId, s.employeeName);
    }
    return {
      replacing: current.length > 0,
      comingOff: Array.from(off.values()).sort((a, b) => a.localeCompare(b)),
      stores: covered,
    };
  }, [review, existingQ.data, parsedStore, empById]);

  const canSave =
    !!review &&
    review.ready.length > 0 &&
    review.duplicates.length === 0 &&
    review.invalid.length === 0;

  const save = () => {
    if (!rows || !review || !canSave) return;
    const entries = review.ready.map((i) => ({
      employeeId: links[i]!,
      scheduledHours: Math.round(totalOf(i) * 100) / 100,
      // Only shifts placed in the week are stored; the total above already
      // counts exactly these, so payroll and the board agree.
      shifts: daysOf(i)
        .filter((d) => d.date)
        .map((d) => ({
          date: new Date(d.date!),
          startLabel: d.startLabel,
          endLabel: d.endLabel,
          hours: Math.min(24, Math.max(0, d.hours)),
        })),
    }));
    commitM.mutate({
      weekStart: parsedWeek ?? weekStart,
      importId,
      entries,
      replace: mode === "replace",
      store: parsedStore ? (parsedStore as Store) : undefined,
    });
  };

  /* ---------------- review: actions ---------------- */

  const linkRow = (i: number, empId: number) => {
    setLinks((l) => ({ ...l, [i]: empId }));
    setSkipped((s) => ({ ...s, [i]: false }));
  };
  const skipRow = (i: number) => {
    setLinks((l) => ({ ...l, [i]: null }));
    setSkipped((s) => ({ ...s, [i]: true }));
  };
  /** One person on two rows (split roles, two spellings): merge the shifts
   *  into the first row and skip the rest. */
  const combineRows = (idxs: number[]) => {
    const [first, ...rest] = idxs;
    const merged = idxs.flatMap((i) => daysOf(i));
    setDayEdits((d) => ({ ...d, [first]: merged }));
    setLinks((l) => {
      const next = { ...l };
      rest.forEach((i) => (next[i] = null));
      return next;
    });
    setSkipped((s) => {
      const next = { ...s };
      rest.forEach((i) => (next[i] = true));
      return next;
    });
    setMerged((m) => {
      const next = { ...m };
      rest.forEach((i) => (next[i] = first));
      return next;
    });
  };
  /** Link every unlinked row with the new employee's exact name. */
  const linkCreated = (created: { id: number; fullName: string }) => {
    setLinks((l) => {
      const next = { ...l };
      (rows ?? []).forEach((r, i) => {
        if (!next[i] && r.extractedName.trim() === created.fullName) next[i] = created.id;
      });
      return next;
    });
  };
  const createInput = (i: number) => {
    const v = quickOf(i);
    return {
      fullName: rows![i].extractedName.trim(),
      storeLocation: parsedStore as Store,
      role: v.role as (typeof ROLES)[number],
      payRate: Number(v.rate),
      phone: v.phone.trim() || undefined,
      clockCode: v.code || undefined,
    };
  };
  const addOne = async (i: number) => {
    setQuickTried((t) => ({ ...t, [i]: true }));
    if (!rows || !parsedStore || quickAddProblem(quickOf(i))) return;
    try {
      const created = await quickCreateM.mutateAsync(createInput(i));
      await utils.employees.list.invalidate();
      linkCreated(created);
      toast.success(`Added ${created.fullName} to ${created.storeLocation}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const addAll = async () => {
    if (!rows || !review || !parsedStore) return;
    const targets = review.unmatched;
    setQuickTried((t) => {
      const next = { ...t };
      targets.forEach((i) => (next[i] = true));
      return next;
    });
    if (targets.some((i) => quickAddProblem(quickOf(i)))) return;
    setAddingAll(true);
    const results = await Promise.allSettled(
      targets.map((i) => quickCreateM.mutateAsync(createInput(i))),
    );
    await utils.employees.list.invalidate();
    setAddingAll(false);
    const created = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    created.forEach(linkCreated);
    const failed = results.flatMap((r, k) =>
      r.status === "rejected"
        ? [{ name: rows[targets[k]].extractedName, msg: errorMessage(r.reason) }]
        : [],
    );
    if (created.length > 0) {
      toast.success(`Added ${people(created.length)} to ${parsedStore}.`);
    }
    if (failed.length > 0) {
      toast.error(
        `${people(failed.length)} couldn't be added. ${failed[0].name}: ${failed[0].msg}`,
      );
    }
  };

  /* ---------------- page ---------------- */

  const weekShifts = (scheduleWeekQ.data?.shifts ?? []) as BoardShift[];
  const hasSchedule = weekShifts.length > 0;
  const weekPeople = new Set(weekShifts.map((s) => s.employeeId)).size;
  const weekHours = weekShifts.reduce((a, s) => a + Number(s.hours), 0);
  // The uploader is the page's hero while a week is empty. Once a week has
  // a schedule it steps aside until someone asks to replace it.
  const weekReady = !scheduleWeekQ.isLoading && !scheduleWeekQ.isError;
  const uploadOpen =
    weekReady && (!hasSchedule || showUpload || !!file || !!rows || parseM.isPending);
  const reviewWeek = parsedWeek ?? weekStart;
  const scopeLabel = boardStore || "All stores";

  const statusChip = (i: number) => {
    if (links[i]) {
      if (review?.dupRows.has(i)) {
        return (
          <span className="chip-bad">
            <AlertCircle className="h-3 w-3" /> Linked twice
          </span>
        );
      }
      if (!totalValid(i)) {
        return (
          <span className="chip-warn">
            <AlertCircle className="h-3 w-3" /> Check hours
          </span>
        );
      }
      return (
        <span className="chip-good">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </span>
      );
    }
    if (merged[i] !== undefined) {
      return (
        <span
          className="chip-neutral"
          title={`Shifts moved to the "${rows?.[merged[i]]?.extractedName}" row`}
        >
          <Merge className="h-3 w-3" /> Combined
        </span>
      );
    }
    if (skipped[i]) return <span className="chip-neutral">Skipped</span>;
    return (
      <span className="chip-warn">
        <AlertCircle className="h-3 w-3" /> Needs a decision
      </span>
    );
  };

  const linkSelect = (i: number, className?: string) => {
    const value = links[i] ? String(links[i]) : skipped[i] ? "skip" : undefined;
    return (
      <Select
        value={value}
        disabled={merged[i] !== undefined}
        onValueChange={(v) => (v === "skip" ? skipRow(i) : linkRow(i, Number(v)))}
      >
        <SelectTrigger
          className={cn("h-9 bg-card", className)}
          aria-label={`Employee for "${rows?.[i]?.extractedName}"`}
        >
          <SelectValue placeholder="Choose an employee…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="skip">Skip — don't import this name</SelectItem>
          {reviewEmployees.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.fullName} · {storeShort(e.storeLocation)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  const shiftPills = (i: number) => {
    const days = daysOf(i);
    if (days.length === 0) {
      return (
        <span className="text-xs text-muted-foreground">
          {hasDetail(i) ? "No shifts" : "No day-by-day detail — only the week total is saved"}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {days.map((d, di) =>
          d.date ? (
            <span
              key={di}
              className="pill-sched px-2 py-0.5 text-[11px] tabular-nums"
              title={d.startLabel && d.endLabel ? `${d.startLabel} – ${d.endLabel}` : undefined}
            >
              {shortDayLabel(new Date(d.date))} · {fmtHoursLabel(d.hours)}
            </span>
          ) : (
            <span
              key={di}
              className="chip-warn"
              title="This day isn't in the selected pay week, so it won't be saved. Edit the shifts to place it, or switch weeks."
            >
              <AlertCircle className="h-3 w-3" /> {d.ref} · {fmtHoursLabel(d.hours)} not placed
            </span>
          ),
        )}
      </div>
    );
  };

  const totalControl = (i: number) => {
    const name = rows?.[i]?.extractedName ?? "";
    if (hasDetail(i)) {
      return (
        <div className="flex items-center justify-end gap-1">
          <span className="tabular-nums font-semibold">{fmtHoursLabel(totalOf(i))}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setEditRow(i)}
            aria-label={`Edit shifts for ${name}`}
            title="Edit shifts"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    const id = `row-total-${i}`;
    return (
      <div className="flex items-center justify-end gap-1">
        <Label htmlFor={id} className="sr-only">
          Week total hours for {name}
        </Label>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          max="168"
          value={totalEdits[i] ?? String(rows?.[i]?.scheduledHours ?? "")}
          onChange={(e) => setTotalEdits((h) => ({ ...h, [i]: e.target.value }))}
          aria-invalid={!totalValid(i)}
          className="h-9 w-24 text-right tabular-nums"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setEditRow(i)}
          aria-label={`Add day-by-day shifts for ${name}`}
          title="Add shifts by day"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title="Schedule"
        description={
          !weekReady
            ? fmtWeekRange(weekStart)
            : hasSchedule
              ? `${fmtWeekRange(weekStart)} · ${people(weekPeople)} · ${fmtHoursLabel(weekHours)} scheduled`
              : `${fmtWeekRange(weekStart)} · no schedule yet`
        }
        actions={
          <>
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} allowFutureWeeks={4} />
            {hasSchedule && !uploadOpen ? (
              <Button variant="outline" className="h-9" onClick={() => setShowUpload(true)}>
                <Upload className="h-4 w-4 mr-2" /> Replace schedule
              </Button>
            ) : null}
          </>
        }
      />

      {/* Step 1 — upload (the page's hero while the week has no schedule) */}
      {uploadOpen ? (
        <Card className="surface-card gap-0 py-0">
          {hasSchedule ? (
            <CardHeader className="card-head flex flex-row items-center justify-between gap-3 px-4 sm:px-5 py-3">
              <div className="min-w-0">
                <CardTitle className="section-title">
                  <span className="icon-badge icon-badge-sm">
                    <Upload />
                  </span>
                  Replace the {uploadStore ? `${storeShort(uploadStore)} ` : ""}schedule for{" "}
                  {fmtWeekRange(weekStart)}
                </CardTitle>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  You review every name before anything changes.
                </p>
              </div>
              {!file && !rows && !parseM.isPending ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground"
                  onClick={() => setShowUpload(false)}
                  aria-label="Close the uploader"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </CardHeader>
          ) : null}
          <CardContent className="p-4 sm:p-6">
            {parseM.isPending ? (
              <ParseProgress />
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) pickFile(f);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0] ?? null);
                    // Let the same file be picked again after removing it.
                    e.target.value = "";
                  }}
                />
                {!file ? (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Choose the schedule file for ${fmtWeekRange(weekStart)}`}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={cn(
                      "relative cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                      dragOver
                        ? "border-primary/50 bg-primary/[0.04]"
                        : "border-input bg-muted/40 hover:border-primary/40 hover:bg-primary/[0.03]",
                    )}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <span className="icon-badge icon-badge-lg">
                        <Upload />
                      </span>
                      <div>
                        <p className="font-medium">
                          Drop the schedule for {fmtWeekRange(weekStart)}, or tap to choose a file
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Homebase PDF, a spreadsheet, or a photo (even handwritten) · up to 8 MB
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3",
                      dragOver ? "border-primary/50 bg-primary/[0.04]" : "border-border bg-muted/30",
                    )}
                  >
                    {file.type === "application/pdf" ? (
                      <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileImage className="h-8 w-8 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                        {rows ? ` · read for ${fmtWeekRange(reviewWeek)}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 sm:h-8"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground"
                      onClick={() => {
                        pickFile(null);
                        setFileError(null);
                      }}
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {fileError ? (
                  <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {fileError}
                  </p>
                ) : null}

                {needsStorePick ? (
                  <div className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <Label htmlFor="schedule-store" className="text-sm">
                      Store this schedule is for
                    </Label>
                    <Select value={storePick || undefined} onValueChange={setStorePick}>
                      <SelectTrigger id="schedule-store" className="h-9 bg-card sm:w-64">
                        <SelectValue placeholder="Pick a store" />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                        <SelectItem value={MULTI_STORE}>Several stores on one file</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {!rows ? (
                  <div className="flex flex-col-reverse gap-3 mt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      {!storeChosen
                        ? "Pick the store first — new names are added there, and Replace only changes that store."
                        : uploadStore
                          ? `Every shift is read and each name is linked to someone at ${storeShort(uploadStore)}. You review before anything is saved.`
                          : "Every shift is read and each name is linked to an employee. You review before anything is saved."}
                    </p>
                    <Button
                      onClick={() => parseWithWeek(weekStart)}
                      disabled={!file || !!fileError || !storeChosen || parseM.isPending}
                      className="h-10 shrink-0 sm:h-9"
                    >
                      <ScanSearch className="h-4 w-4 mr-2" />
                      Read schedule
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Step 2 — review the file, then save it */}
      {rows && review ? (
        <div ref={resultsRef} className="space-y-5 scroll-mt-24">
          {/* Wrong-week guard: the file's printed dates vs the selected week */}
          {weekWarning ? (
            <div className="callout-warn rise-in flex flex-wrap items-center gap-3 rounded-2xl p-4">
              <AlertCircle className="h-5 w-5 text-warning shrink-0" />
              <div className="flex-1 min-w-60">
                <p className="text-sm font-semibold">
                  {weekWarning.printedWeekStart
                    ? `This file is printed for ${fmtWeekRange(
                        weekWarning.printedWeekStart,
                      )} — you're importing it into ${fmtWeekRange(reviewWeek)}.`
                    : `${shifts(weekWarning.unresolvedDatedDays)} on this file ${
                        weekWarning.unresolvedDatedDays === 1 ? "falls" : "fall"
                      } outside ${fmtWeekRange(reviewWeek)} and won't be saved.`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {weekWarning.printedWeekStart
                    ? "Each shift was placed on the same weekday of the selected week — fine if you're reusing this schedule. If it's meant for its printed week, switch before saving."
                    : "Check the pay week above, then read the file again — or place those days by editing the shifts."}
                </p>
              </div>
              {weekWarning.printedWeekStart ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 sm:h-8"
                  disabled={parseM.isPending}
                  onClick={() => {
                    const w = weekWarning.printedWeekStart!;
                    setWeekStart(w);
                    parseWithWeek(w);
                  }}
                >
                  <CalendarRange className="h-4 w-4 mr-1.5" />
                  Use {fmtWeekRange(weekWarning.printedWeekStart)}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* The numbers to check before saving */}
          <div className="kpi-band rise-in">
            <div className="kpi-cell">
              <span className="kpi-label">People on the file</span>
              <span className="kpi-value">{rows.length}</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Linked to employees</span>
              <span className="kpi-value delta-good">{review.linked.length}</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Need a decision</span>
              <span className={cn("kpi-value", review.unmatched.length > 0 && "text-warning")}>
                {review.unmatched.length}
              </span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-label">Hours to save</span>
              <span className="kpi-value">{fmtHours(review.hours)}</span>
            </div>
          </div>

          {/* Names that need a decision: link a near-miss or add someone new */}
          {review.unmatched.length > 0 ? (
            <Card className="surface-card gap-0 py-0 rise-in">
              <CardHeader className="card-head px-4 sm:px-5 py-3">
                <CardTitle className="section-title">
                  <span className="icon-badge icon-badge-sm hue-amber">
                    <UserPlus />
                  </span>
                  {review.unmatched.length === 1
                    ? "1 name needs a decision"
                    : `${review.unmatched.length} names need a decision`}
                </CardTitle>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Someone already on staff under another spelling? Link them in one click. New?
                  Set a role and pay rate to add them
                  {parsedStore ? ` to ${parsedStore}` : ""} — phone and clock code can wait.
                  Skipped names aren't imported.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 px-4 sm:px-5 py-4">
                {!parsedStore ? (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    This file was read for several stores, so new people can't be added from
                    here. Link each name to an employee or skip it — or read the file again for
                    one store.
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {review.unmatched.map((i) => {
                    const row = rows[i];
                    const v = quickOf(i);
                    const problem = quickTried[i] ? quickAddProblem(v) : null;
                    const fid = (f: string) => `quick-${i}-${f}`;
                    return (
                      <li
                        key={i}
                        className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <p className="font-semibold">{row.extractedName}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {fmtHoursLabel(totalValid(i) ? totalOf(i) : 0)} scheduled
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.suggestions.length > 0 ? (
                            <>
                              <span className="text-xs font-medium text-muted-foreground mr-0.5">
                                Same person?
                              </span>
                              {row.suggestions.map((s) => (
                                <button
                                  key={s.employeeId}
                                  type="button"
                                  onClick={() => {
                                    linkRow(i, s.employeeId);
                                    toast.success(`Linked "${row.extractedName}" to ${s.fullName}.`);
                                  }}
                                  className="inline-flex h-9 sm:h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                  title={`${s.fullName} · ${s.storeLocation} · ${s.score}% name match`}
                                >
                                  <Link2 className="h-3 w-3" />
                                  {s.fullName}
                                  <span className="text-muted-foreground tabular-nums">
                                    {s.score}%
                                  </span>
                                </button>
                              ))}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No close match among your employees.
                            </span>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 sm:h-8 text-muted-foreground"
                            onClick={() => skipRow(i)}
                          >
                            Skip this name
                          </Button>
                        </div>
                        {parsedStore ? (
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
                            <div className="space-y-1 sm:w-44">
                              <Label htmlFor={fid("role")} className="text-xs text-muted-foreground">
                                Role
                              </Label>
                              <Select value={v.role} onValueChange={(role) => setQuick(i, { role })}>
                                <SelectTrigger id={fid("role")} className="h-9 w-full bg-card">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLES.map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {r}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1 sm:w-28">
                              <Label htmlFor={fid("rate")} className="text-xs text-muted-foreground">
                                Pay rate ($/hr)
                              </Label>
                              <Input
                                id={fid("rate")}
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min="0"
                                value={v.rate}
                                aria-invalid={!!problem && /pay rate/i.test(problem)}
                                onChange={(e) => setQuick(i, { rate: e.target.value })}
                                className="h-9 text-right tabular-nums"
                              />
                            </div>
                            <div className="space-y-1 sm:w-40">
                              <Label htmlFor={fid("phone")} className="text-xs text-muted-foreground">
                                Phone (optional)
                              </Label>
                              <Input
                                id={fid("phone")}
                                type="tel"
                                inputMode="tel"
                                value={v.phone}
                                onChange={(e) => setQuick(i, { phone: e.target.value })}
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1 sm:w-32">
                              <Label htmlFor={fid("code")} className="text-xs text-muted-foreground">
                                Clock code (optional)
                              </Label>
                              <Input
                                id={fid("code")}
                                inputMode="numeric"
                                maxLength={4}
                                placeholder="4 digits"
                                value={v.code}
                                aria-invalid={!!problem && /clock code/i.test(problem)}
                                onChange={(e) =>
                                  setQuick(i, {
                                    code: e.target.value.replace(/[^0-9]/g, "").slice(0, 4),
                                  })
                                }
                                className="h-9 text-center tabular-nums tracking-widest"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="col-span-2 h-9 sm:col-span-1"
                              disabled={quickCreateM.isPending || addingAll}
                              onClick={() => addOne(i)}
                            >
                              <UserPlus className="h-4 w-4 mr-1.5" /> Add as new
                            </Button>
                          </div>
                        ) : null}
                        {problem ? (
                          <p role="alert" className="text-xs font-medium text-destructive">
                            {problem}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {parsedStore && review.unmatched.length > 1 ? (
                  <div className="flex flex-col items-stretch gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
                    {(() => {
                      const missing = review.unmatched.filter((i) =>
                        quickAddProblem(quickOf(i)),
                      ).length;
                      return missing > 0 ? (
                        <p className="text-xs text-muted-foreground sm:mr-auto">
                          To add everyone at once, give each person a pay rate first —{" "}
                          {missing} still {missing === 1 ? "needs" : "need"} one.
                        </p>
                      ) : null;
                    })()}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={addAll}
                      disabled={quickCreateM.isPending || addingAll}
                    >
                      <UserPlus className="h-4 w-4 mr-1.5" />
                      {addingAll
                        ? "Adding…"
                        : `Add all ${review.unmatched.length} to ${storeShort(parsedStore)}`}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : review.linked.length > 0 ? (
            <div className="flex items-center gap-2 rise-in">
              <span className="chip-good">
                <CheckCircle2 className="h-3 w-3" /> Every name on the file is decided
              </span>
            </div>
          ) : null}

          {/* Review and save */}
          <Card className="surface-card gap-0 py-0 rise-in">
            <CardHeader className="card-head px-4 sm:px-5 py-3">
              <CardTitle className="section-title">
                <span className="icon-badge icon-badge-sm">
                  <ClipboardCheck />
                </span>
                Review and save
              </CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Check who each name is and their shifts for {fmtWeekRange(reviewWeek)}
                {parsedStore ? ` at ${parsedStore}` : ""}. Use the pencil to fix a misread shift.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {/* Phone: one card per name */}
              <ul className="divide-y divide-border md:hidden">
                {rows.map((row, i) => (
                  <li key={i} className="space-y-2.5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">On the file</p>
                        <p className="font-medium truncate">{row.extractedName}</p>
                      </div>
                      {statusChip(i)}
                    </div>
                    {linkSelect(i, "w-full")}
                    {shiftPills(i)}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">Week total</span>
                      {totalControl(i)}
                    </div>
                  </li>
                ))}
              </ul>
              {/* Tablet and up: the table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36 pl-5">Status</TableHead>
                      <TableHead>Name on the file</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Shifts</TableHead>
                      <TableHead className="w-[150px] pr-5 text-right">Week total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={i} className={cn(skipped[i] && !links[i] && "opacity-60")}>
                        <TableCell className="pl-5">{statusChip(i)}</TableCell>
                        <TableCell className="font-medium">{row.extractedName}</TableCell>
                        <TableCell>{linkSelect(i, "w-[240px] max-w-full")}</TableCell>
                        <TableCell>
                          <div className="max-w-[420px]">{shiftPills(i)}</div>
                        </TableCell>
                        <TableCell className="pr-5">{totalControl(i)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Summary, blockers and the one primary action */}
              <div className="space-y-3 rounded-b-2xl border-t border-border bg-card px-4 py-4 sm:px-5 md:sticky md:bottom-4 md:z-[3] md:shadow-[0_-10px_24px_-14px_rgb(40_12_6/0.25)]">
                {replacePreview.replacing ? (
                  <div className="space-y-1.5">
                    <div
                      role="radiogroup"
                      aria-label="How to save this file"
                      className="sk-track inline-flex max-w-full rounded-lg bg-muted p-0.5"
                    >
                      {(
                        [
                          ["replace", "Replace the current schedule"],
                          ["add", "Add to it"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={mode === key}
                          onClick={() => setMode(key)}
                          className={cn(
                            "h-9 sm:h-8 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors",
                            mode === key
                              ? "sk-seg-on bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {mode === "replace"
                        ? replacePreview.comingOff.length > 0
                          ? `Not on this file, so they come off the week: ${nameList(
                              replacePreview.comingOff,
                              6,
                            )}.`
                          : "Everyone on the current schedule is on this file."
                        : "Only the people on this file change. Everyone else keeps their shifts."}
                    </p>
                  </div>
                ) : null}

                {review.duplicates.map(([empId, idxs]) => {
                  const emp = empById.get(empId);
                  const canCombine = idxs.every((i) => hasDetail(i));
                  return (
                    <div
                      key={empId}
                      role="alert"
                      className="flex flex-wrap items-center gap-2 text-sm text-destructive"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span className="min-w-[14rem] flex-1">
                        {emp?.fullName ?? "One employee"} is linked to {idxs.length} rows (
                        {idxs.map((i) => `"${rows[i].extractedName}"`).join(", ")}). Combine their
                        shifts, or skip or relink one.
                      </span>
                      {canCombine ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 sm:h-8"
                          onClick={() => combineRows(idxs)}
                        >
                          <Merge className="h-3.5 w-3.5 mr-1.5" /> Combine shifts
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {review.invalid.length > 0 ? (
                  <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    Enter a week total between 0 and 168 hours for{" "}
                    {nameList(review.invalid.map((i) => rows[i].extractedName))}.
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 text-sm">
                    <p>
                      Saves{" "}
                      <span className="font-semibold tabular-nums">
                        {fmtHoursLabel(review.hours)}
                      </span>{" "}
                      for <span className="font-semibold">{people(review.ready.length)}</span> to{" "}
                      <span className="font-semibold">{fmtWeekRange(reviewWeek)}</span>. Scheduled
                      hours flow to the dashboard, payroll and the time clock.
                    </p>
                    {review.unmatched.length + review.skippedRows.length > 0 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Not imported:{" "}
                        {nameList(
                          [...review.unmatched, ...review.skippedRows].map(
                            (i) => rows[i].extractedName,
                          ),
                          4,
                        )}
                        .
                      </p>
                    ) : null}
                  </div>
                  <Button
                    onClick={save}
                    disabled={!canSave || commitM.isPending}
                    className="h-10 shrink-0 md:h-9"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {commitM.isPending ? "Saving…" : "Save schedule"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* The schedule on file for this week — editable per person */}
      <WeekScheduleBoard
        weekStart={weekStart}
        boardStore={boardStore}
        scopeLabel={scopeLabel}
        shifts={weekShifts}
        loading={scheduleWeekQ.isLoading}
        error={scheduleWeekQ.isError}
        onRetry={() => scheduleWeekQ.refetch()}
        imports={(importsQ.data ?? []) as ImportRow[]}
        employees={boardEmployees}
        onMoved={setWeekStart}
        compactEmpty={uploadOpen}
      />

      {/* Upload history: where the original files live */}
      {!rows && !parseM.isPending && (importsQ.data ?? []).length > 0 ? (
        <Card className="surface-card gap-0 py-0">
          <CardHeader className="card-head px-4 sm:px-5 py-3">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <History />
              </span>
              Recent uploads
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-5 pb-2">
            <ul className="divide-y divide-border">
              {(importsQ.data ?? []).map((imp) => (
                <li key={imp.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{imp.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtWeekRange(new Date(imp.weekStart))} ·{" "}
                      {imp.storeLocation ? storeShort(imp.storeLocation) : "Several stores"} ·{" "}
                      {fmtHoursLabel(Number(imp.totalHours))} · uploaded{" "}
                      {fmtDateTime(imp.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {imp.status === "committed" ? (
                      <span className="chip-good hidden sm:inline-flex">
                        <CheckCircle2 className="h-3 w-3" /> Saved
                      </span>
                    ) : (
                      <span className="chip-neutral hidden sm:inline-flex">Not saved</span>
                    )}
                    {imp.fileUrl ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 sm:h-8 px-2.5 text-xs"
                        onClick={() => window.open(imp.fileUrl!, "_blank", "noopener,noreferrer")}
                        aria-label={`Open ${imp.filename}`}
                        title="Open the original uploaded file"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> File
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {editRow !== null && rows ? (
        <ShiftEditorDialog
          name={rows[editRow].extractedName}
          weekStart={reviewWeek}
          description={`Shifts read from the file for ${fmtWeekRange(reviewWeek)}. Fix anything misread — nothing is saved until you save the schedule.`}
          initial={daysOf(editRow).map((d) => ({
            date: d.date ? toDateInput(new Date(d.date)) : "",
            startLabel: d.startLabel ?? "",
            endLabel: d.endLabel ?? "",
            hours: String(d.hours),
          }))}
          saveLabel={(total) => `Use these shifts · ${fmtHoursLabel(total)}`}
          onClose={() => setEditRow(null)}
          onSave={(list) => {
            setDayEdits((d) => ({
              ...d,
              [editRow]: list.map((s) => ({
                ref: shortDayLabel(fromDateInput(s.date)),
                date: fromDateInput(s.date),
                startLabel: s.startLabel,
                endLabel: s.endLabel,
                hours: s.hours,
              })),
            }));
            setEditRow(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The schedule board: who works which day, per-day totals, one click   */
/* to the original uploaded file, and per-person editing. Desktop and   */
/* tablet get the week grid; phones get one day at a time.              */
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

type EmpWeek = {
  name: string;
  store: string;
  total: number;
  byDay: Map<string, BoardShift[]>;
};

function WeekScheduleBoard({
  weekStart,
  boardStore,
  scopeLabel,
  shifts: weekShifts,
  loading,
  error,
  onRetry,
  imports,
  employees,
  onMoved,
  compactEmpty,
}: {
  weekStart: Date;
  boardStore: string;
  scopeLabel: string;
  shifts: BoardShift[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  imports: ImportRow[];
  employees: Employee[];
  onMoved?: (to: Date) => void;
  /** The uploader above is the hero — keep the empty board brief. */
  compactEmpty?: boolean;
}) {
  const utils = trpc.useUtils();
  const [editFor, setEditFor] = useState<{ id: number; name: string } | null>(null);
  const [addPick, setAddPick] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);

  const refreshAll = () => {
    utils.schedule.week.invalidate();
    utils.payroll.week.invalidate();
    utils.dashboard.summary.invalidate();
    utils.attention.list.invalidate();
  };

  const deleteWeekM = trpc.schedule.deleteWeek.useMutation({
    onSuccess: ({ deleted }) => {
      toast.success(
        `Deleted the ${fmtWeekRange(weekStart)} schedule${boardStore ? ` for ${storeShort(boardStore)}` : ""} (${shifts(deleted)}). A snapshot is kept in the activity log.`,
      );
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const days = payWeekDays(weekStart);
  const todayKey = storeDayKey(new Date());
  const byEmployee = useMemo(() => {
    const m = new Map<number, EmpWeek>();
    for (const s of weekShifts) {
      const rec = m.get(s.employeeId) ?? {
        name: s.employeeName,
        store: s.storeLocation,
        total: 0,
        byDay: new Map<string, BoardShift[]>(),
      };
      rec.total += s.hours;
      const key = toDateInput(new Date(s.shiftDate));
      rec.byDay.set(key, [...(rec.byDay.get(key) ?? []), s]);
      m.set(s.employeeId, rec);
    }
    return m;
  }, [weekShifts]);

  // One group per store (only labelled when the board shows several).
  const groups = useMemo(() => {
    const m = new Map<string, Array<[number, EmpWeek]>>();
    byEmployee.forEach((rec, id) => m.set(rec.store, [...(m.get(rec.store) ?? []), [id, rec]]));
    return Array.from(m.entries())
      .sort(([a], [b]) => storeOrder(a) - storeOrder(b))
      .map(([store, list]) => ({
        store,
        list: list.sort((a, b) => a[1].name.localeCompare(b[1].name)),
        hours: list.reduce((sum, [, r]) => sum + r.total, 0),
      }));
  }, [byEmployee]);
  const multiStore = groups.length > 1;

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
  // saving import's id).
  const sourceImport = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of weekShifts) {
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
  }, [weekShifts, imports]);

  const addable = employees
    .filter((e) => !byEmployee.has(e.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const storesInView = groups.map((g) => g.store);
  const whereText = boardStore
    ? boardStore
    : storesInView.length === 1
      ? storesInView[0]
      : `${storesInView.length} stores (${storesInView.map(storeShort).join(", ")})`;

  const addPerson =
    addable.length > 0 ? (
      <Select
        value={addPick || undefined}
        onValueChange={(v) => {
          setAddPick("");
          const emp = addable.find((e) => String(e.id) === v);
          if (emp) setEditFor({ id: emp.id, name: emp.fullName });
        }}
      >
        <SelectTrigger className="h-9 sm:h-8 w-44 bg-card text-sm" aria-label="Add a person to this week">
          <SelectValue placeholder="+ Add person" />
        </SelectTrigger>
        <SelectContent>
          {addable.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.fullName}
              {boardStore ? "" : ` · ${storeShort(e.storeLocation)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  const hasShifts = weekShifts.length > 0;

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head px-4 sm:px-5 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <CalendarDays />
            </span>
            {scopeLabel}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading
              ? "Loading the week…"
              : hasShifts
                ? `${people(byEmployee.size)} · ${fmtHoursLabel(weekTotal)} scheduled · use the pencil to change someone's week`
                : compactEmpty
                  ? "Or build the week by hand, one person at a time."
                  : `No shifts for ${fmtWeekRange(weekStart)} yet.`}
          </p>
        </div>
        {!loading && !error ? (
          <div className="flex flex-wrap items-center gap-2">
            {sourceImport?.fileUrl ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 sm:h-8"
                onClick={() => window.open(sourceImport.fileUrl!, "_blank", "noopener,noreferrer")}
                title={`Open the original upload (${sourceImport.filename})`}
              >
                <ExternalLink className="h-4 w-4 mr-1.5" /> Original file
              </Button>
            ) : null}
            {hasShifts ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 sm:h-8"
                onClick={() => setMoveOpen(true)}
                title="Slide this schedule to a different pay week (uploaded against the wrong dates)"
              >
                <CalendarRange className="h-4 w-4 mr-1.5" /> Move week
              </Button>
            ) : null}
            {hasShifts ? (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 sm:h-8 text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" /> Delete week
                  </Button>
                }
                title={`Delete the ${fmtWeekRange(weekStart)} schedule for ${
                  boardStore ? storeShort(boardStore) : "all stores"
                }?`}
                description={`Removes all ${shifts(weekShifts.length)} for ${people(
                  byEmployee.size,
                )} at ${whereText} and clears their scheduled hours for the week. Use this when a schedule was uploaded against the wrong week. Worked hours and pay aren't touched, the original file stays in Recent uploads, and a snapshot is kept in the activity log. You can upload or build the week again afterwards.`}
                confirmLabel={`Delete ${shifts(weekShifts.length)}`}
                onConfirm={() =>
                  deleteWeekM.mutate({
                    weekStart,
                    store: boardStore ? (boardStore as Store) : undefined,
                  })
                }
                disabled={deleteWeekM.isPending}
              />
            ) : null}
            {hasShifts ? addPerson : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {loading || error ? (
          <div className="p-4 sm:p-5">
            <BlockState
              isLoading={loading}
              isError={error}
              onRetry={onRetry}
              skeletonClassName="h-56 rounded-xl"
            >
              {null}
            </BlockState>
          </div>
        ) : !hasShifts ? (
          compactEmpty ? (
            <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm text-muted-foreground">
                {addPerson
                  ? `Pick someone to give them shifts for ${fmtWeekRange(weekStart)}.`
                  : "Add employees first, then give them shifts here."}
              </p>
              {addPerson}
            </div>
          ) : (
            <EmptyState
              icon={<CalendarDays />}
              title={`No shifts for ${fmtWeekRange(weekStart)} yet`}
              hint={
                addPerson
                  ? "Upload the schedule, or add people one at a time."
                  : "Add employees first, then give them shifts here."
              }
              action={addPerson}
            />
          )
        ) : (
          <>
            <DayAgenda
              key={weekStart.toISOString()}
              days={days}
              groups={groups}
              multiStore={multiStore}
              dayTotals={dayTotals}
              weekTotal={weekTotal}
              todayKey={todayKey}
              onEdit={(id, name) => setEditFor({ id, name })}
            />
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-[2] min-w-[168px] bg-[oklch(0.985_0.003_60)] pl-5">
                      Employee
                    </TableHead>
                    {days.map((d) => {
                      const isToday = toDateInput(d) === todayKey;
                      return (
                        <TableHead
                          key={d.toISOString()}
                          className={cn("min-w-[84px] text-center", isToday && "bg-muted text-foreground")}
                          aria-label={`${shortDayLabel(d)}${isToday ? " (today)" : ""}`}
                        >
                          <span className="block leading-tight">{shortDayLabel(d).split(" ")[0]}</span>
                          <span
                            className={cn(
                              "block text-[15px] leading-tight font-semibold tabular-nums",
                              isToday ? "text-foreground" : "text-foreground/80",
                            )}
                          >
                            {d.getUTCDate()}
                          </span>
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[52px] pr-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <Fragment key={g.store}>
                      {multiStore ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={days.length + 3} className="bg-muted/50 py-2">
                            <span className="sticky left-5 inline-flex items-center gap-2 text-xs font-semibold">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: storeColor(g.store) }}
                                aria-hidden="true"
                              />
                              {g.store}
                              <span className="font-normal text-muted-foreground">
                                · {people(g.list.length)} · {fmtHoursLabel(g.hours)}
                              </span>
                            </span>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {g.list.map(([empId, rec]) => (
                        <TableRow key={empId} className="group">
                          <TableCell className="sticky left-0 z-[1] bg-card pl-5">
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
                                className={cn("text-center", isToday && "bg-muted/50")}
                              >
                                {cell.length === 0 ? (
                                  <span className="text-muted-foreground/30" aria-label="Off">
                                    ·
                                  </span>
                                ) : (
                                  <div className="flex flex-col items-center gap-1 py-0.5">
                                    {cell.map((s) => (
                                      <div
                                        key={s.id}
                                        className="pill-sched inline-flex flex-col items-center px-2 py-1 leading-tight"
                                        title={
                                          s.startLabel && s.endLabel
                                            ? `${s.startLabel} – ${s.endLabel}`
                                            : undefined
                                        }
                                      >
                                        {s.startLabel && s.endLabel ? (
                                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                            {shortTime(s.startLabel)}–{shortTime(s.endLabel)}
                                          </span>
                                        ) : null}
                                        <span className="text-xs font-semibold tabular-nums">
                                          {fmtHoursLabel(s.hours)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">
                            {fmtHoursLabel(rec.total)}
                          </TableCell>
                          <TableCell className="pr-3 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                              onClick={() => setEditFor({ id: empId, name: rec.name })}
                              aria-label={`Edit ${rec.name}'s week`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell className="sticky left-0 z-[1] bg-[oklch(0.975_0.004_60)] pl-5 text-xs font-medium text-muted-foreground">
                      Day total
                    </TableCell>
                    {dayTotals.map((t, i) => {
                      const maxDay = Math.max(1, ...dayTotals);
                      return (
                        <TableCell
                          key={i}
                          className="text-center tabular-nums text-xs font-semibold whitespace-nowrap"
                          style={{
                            background:
                              t > 0
                                ? `color-mix(in oklab, var(--chart-1) ${Math.round(5 + (t / maxDay) * 14)}%, transparent)`
                                : undefined,
                          }}
                        >
                          {t > 0 ? fmtHoursLabel(t) : "—"}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular-nums font-bold whitespace-nowrap">
                      {fmtHoursLabel(weekTotal)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      {moveOpen ? (
        <MoveWeekDialog
          weekStart={weekStart}
          boardStore={boardStore}
          shiftCount={weekShifts.length}
          peopleCount={byEmployee.size}
          whereText={whereText}
          onClose={() => setMoveOpen(false)}
          onMoved={(to) => {
            setMoveOpen(false);
            refreshAll();
            onMoved?.(to);
          }}
        />
      ) : null}

      {editFor ? (
        <EditWeekDialog
          weekStart={weekStart}
          employeeId={editFor.id}
          employeeName={editFor.name}
          existing={weekShifts.filter((s) => s.employeeId === editFor.id)}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null);
            refreshAll();
          }}
        />
      ) : null}
    </Card>
  );
}

/** Phones: one day at a time — who works, when, and the day's hours. */
function DayAgenda({
  days,
  groups,
  multiStore,
  dayTotals,
  weekTotal,
  todayKey,
  onEdit,
}: {
  days: Date[];
  groups: { store: string; list: Array<[number, EmpWeek]> }[];
  multiStore: boolean;
  dayTotals: number[];
  weekTotal: number;
  todayKey: string;
  onEdit: (id: number, name: string) => void;
}) {
  const [sel, setSel] = useState(() => {
    const i = days.findIndex((d) => toDateInput(d) === todayKey);
    return i >= 0 ? i : 0;
  });
  const key = toDateInput(days[sel]);
  const start = (s: BoardShift) => parseTimeLabelToMinutes(s.startLabel) ?? 24 * 60;
  const dayGroups = groups
    .map((g) => ({
      store: g.store,
      list: g.list
        .map(([id, rec]) => ({ id, rec, cell: rec.byDay.get(key) ?? [] }))
        .filter((x) => x.cell.length > 0)
        .sort((a, b) => start(a.cell[0]) - start(b.cell[0]) || a.rec.name.localeCompare(b.rec.name)),
    }))
    .filter((g) => g.list.length > 0);
  const working = dayGroups.reduce((n, g) => n + g.list.length, 0);
  const dayName = days[sel].toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="md:hidden">
      <div
        className="grid grid-cols-7 gap-1 border-b border-border px-2 py-2.5"
        role="group"
        aria-label="Pick a day"
      >
        {days.map((d, i) => {
          const on = i === sel;
          const isToday = toDateInput(d) === todayKey;
          return (
            <button
              key={d.toISOString()}
              type="button"
              aria-pressed={on}
              aria-label={`${shortDayLabel(d)}${isToday ? ", today" : ""} · ${fmtHoursLabel(dayTotals[i])}`}
              onClick={() => setSel(i)}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center rounded-lg py-1.5 transition-colors",
                on ? "sk-seg-on bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground",
              )}
            >
              <span className="text-[11px] font-medium">{shortDayLabel(d).split(" ")[0]}</span>
              <span className={cn("text-base font-semibold tabular-nums leading-tight", isToday && "text-primary")}>
                {d.getUTCDate()}
              </span>
              <span className="text-[10px] tabular-nums">{fmtHours(dayTotals[i])}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
        <p className="text-sm font-semibold">{dayName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {people(working)} · {fmtHoursLabel(dayTotals[sel])}
        </p>
      </div>
      {working === 0 ? (
        <p className="px-4 pb-5 pt-2 text-sm text-muted-foreground">Nobody is scheduled this day.</p>
      ) : (
        dayGroups.map((g) => (
          <div key={g.store}>
            {multiStore ? (
              <p className="flex items-center gap-2 bg-muted/50 px-4 py-1.5 text-xs font-semibold">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: storeColor(g.store) }}
                  aria-hidden="true"
                />
                {g.store}
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {g.list.map(({ id, rec, cell }) => {
                const hours = cell.reduce((sum, s) => sum + s.hours, 0);
                return (
                  <li key={id} className="flex items-center gap-3 px-4 py-2.5">
                    <InitialsBadge name={rec.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{rec.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cell
                          .map((s) =>
                            s.startLabel && s.endLabel ? `${s.startLabel}–${s.endLabel}` : "Time not set",
                          )
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{fmtHoursLabel(hours)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground"
                      onClick={() => onEdit(id, rec.name)}
                      aria-label={`Edit ${rec.name}'s week`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">Week total</span>
        <span className="font-semibold tabular-nums">{fmtHoursLabel(weekTotal)}</span>
      </div>
    </div>
  );
}

/** Slide a week's schedule to another pay week (same day of the week). */
function MoveWeekDialog({
  weekStart,
  boardStore,
  shiftCount,
  peopleCount,
  whereText,
  onClose,
  onMoved,
}: {
  weekStart: Date;
  boardStore: string;
  shiftCount: number;
  peopleCount: number;
  whereText: string;
  onClose: () => void;
  onMoved: (to: Date) => void;
}) {
  const [target, setTarget] = useState("");
  const [tried, setTried] = useState(false);
  const toWeek = target ? startOfPayWeek(fromDateInput(target)) : null;
  const sameWeek = !!toWeek && toWeek.getTime() === weekStart.getTime();
  const problem = !toWeek
    ? "Pick a date in the week to move to."
    : sameWeek
      ? "That's this same week — pick a different one."
      : null;
  const moveWeekM = trpc.schedule.moveWeek.useMutation({
    onSuccess: ({ moved, toWeek: to }) => {
      const dest = new Date(to);
      toast.success(`Moved ${shifts(moved)} to ${fmtWeekRange(dest)}.`);
      onMoved(dest);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (problem || !toWeek) return;
            moveWeekM.mutate({
              fromWeek: weekStart,
              toWeek: toWeek,
              store: boardStore ? (boardStore as Store) : undefined,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Move this schedule to another week</DialogTitle>
            <DialogDescription>
              {shifts(shiftCount)} for {people(peopleCount)} at {whereText} slide to the same
              weekdays of the week you pick, and their scheduled hours follow. The target week
              must have no schedule for {boardStore ? "this store" : "these stores"} yet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="move-week-date">Any date in the new week</Label>
            <Input
              id="move-week-date"
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-invalid={tried && !!problem}
              aria-describedby="move-week-help"
            />
            <p
              id="move-week-help"
              role={tried && problem ? "alert" : undefined}
              className={cn("text-xs", tried && problem ? "text-destructive" : "text-muted-foreground")}
            >
              {tried && problem
                ? problem
                : toWeek
                  ? `Moves to the pay week ${fmtWeekRange(toWeek)} (Thu–Wed).`
                  : "Pick any date — it snaps to that pay week's Thursday."}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={moveWeekM.isPending}>
              {moveWeekM.isPending
                ? "Moving…"
                : toWeek && !sameWeek
                  ? `Move to ${fmtWeekRange(toWeek)}`
                  : "Move schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Per-employee week editor on the board — saving replaces that person's
 *  week through the same single-writer path as an import. */
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
  const commitM = trpc.schedule.commit.useMutation({
    onSuccess: () => {
      toast.success(`${employeeName}'s week is updated.`);
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ShiftEditorDialog
      name={employeeName}
      weekStart={weekStart}
      description={`Week of ${fmtWeekRange(weekStart)} · changes flow to payroll, the dashboard and the time clock.`}
      initial={existing
        .slice()
        .sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime())
        .map((s) => ({
          date: toDateInput(new Date(s.shiftDate)),
          startLabel: s.startLabel ?? "",
          endLabel: s.endLabel ?? "",
          hours: String(s.hours),
        }))}
      saving={commitM.isPending}
      saveLabel={(total) => `Save week · ${fmtHoursLabel(total)}`}
      onClose={onClose}
      onSave={(list, total) =>
        commitM.mutate({
          weekStart,
          importId: null,
          entries: [
            {
              employeeId,
              scheduledHours: Math.round(total * 100) / 100,
              shifts: list.map((s) => ({
                date: fromDateInput(s.date),
                startLabel: s.startLabel,
                endLabel: s.endLabel,
                hours: s.hours,
              })),
            },
          ],
        })
      }
    />
  );
}

type EditableShift = {
  date: string; // yyyy-mm-dd within the week ("" = not placed yet)
  startLabel: string;
  endLabel: string;
  hours: string;
  /** Hours were filled from start/end — keep following them. */
  auto?: boolean;
};

/** Hours between two printed times ("9:00am" → "5:30pm" = 8.5), or null. */
function hoursBetween(start: string, end: string): number | null {
  const a = parseTimeLabelToMinutes(start);
  let b = parseTimeLabelToMinutes(end);
  if (a === null || b === null) return null;
  if (b <= a) b += 24 * 60; // overnight
  return Math.round(((b - a) / 60) * 100) / 100;
}

function shiftProblem(r: EditableShift): string | null {
  if (!r.date) return "Pick a day";
  if (r.hours.trim() === "") return "Enter hours";
  const h = Number(r.hours);
  if (!Number.isFinite(h) || h < 0 || h > 24) return "Hours must be 0–24";
  return null;
}

/** The shift list editor shared by the board and the import review. */
function ShiftEditorDialog({
  name,
  weekStart,
  description,
  initial,
  saving,
  saveLabel,
  onClose,
  onSave,
}: {
  name: string;
  weekStart: Date;
  description: string;
  initial: EditableShift[];
  saving?: boolean;
  saveLabel: (total: number) => string;
  onClose: () => void;
  onSave: (
    shifts: { date: string; startLabel: string | null; endLabel: string | null; hours: number }[],
    total: number,
  ) => void;
}) {
  const days = payWeekDays(weekStart);
  const [rows, setRows] = useState<EditableShift[]>(initial);
  const [tried, setTried] = useState(false);
  const total = rows.reduce((sum, r) => {
    const h = Number(r.hours);
    return sum + (Number.isFinite(h) ? h : 0);
  }, 0);
  const problems = rows.map(shiftProblem);
  const firstProblem = problems.findIndex(Boolean);

  const update = (i: number, patch: Partial<EditableShift>) =>
    setRows((rs) =>
      rs.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...patch };
        if ("hours" in patch) return { ...next, auto: false };
        if ("startLabel" in patch || "endLabel" in patch) {
          const h = hoursBetween(next.startLabel, next.endLabel);
          if (h !== null && (next.auto || next.hours.trim() === "")) {
            return { ...next, hours: String(h), auto: true };
          }
        }
        return next;
      }),
    );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (firstProblem >= 0) return;
            onSave(
              rows.map((r) => ({
                date: r.date,
                startLabel: r.startLabel.trim() || null,
                endLabel: r.endLabel.trim() || null,
                hours: Number(r.hours),
              })),
              total,
            );
          }}
        >
          <DialogHeader className="text-left">
            <div className="flex items-center gap-3">
              <InitialsBadge name={name} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate">{name}</DialogTitle>
                <DialogDescription className="mt-0.5">{description}</DialogDescription>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <div className="text-xs font-medium text-muted-foreground">Week total</div>
                <div className="text-xl font-semibold tabular-nums">{fmtHoursLabel(total)}</div>
              </div>
            </div>
          </DialogHeader>

          <div>
            <div className="hidden grid-cols-[8.5rem_1fr_1fr_5.5rem_2.25rem] gap-2 px-2 pb-1.5 text-xs font-medium text-muted-foreground sm:grid">
              <span>Day</span>
              <span>Start</span>
              <span>End</span>
              <span className="text-right">Hours</span>
              <span />
            </div>
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No shifts this week — add the first one below.
                </p>
              ) : (
                rows.map((r, i) => {
                  const bad = tried ? problems[i] : null;
                  const fid = (f: string) => `shift-${i}-${f}`;
                  const remove = (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label={`Remove shift ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  );
                  return (
                    <div
                      key={i}
                      className={cn(
                        "grid gap-2 rounded-xl border bg-muted/30 p-2 sm:grid-cols-[8.5rem_1fr_1fr_5.5rem_2.25rem] sm:items-center",
                        bad ? "border-destructive/50" : "border-border",
                      )}
                    >
                      <div className="flex items-center gap-2 sm:contents">
                        <Label htmlFor={fid("day")} className="sr-only">
                          Day, shift {i + 1}
                        </Label>
                        <Select value={r.date || undefined} onValueChange={(v) => update(i, { date: v })}>
                          <SelectTrigger
                            id={fid("day")}
                            className="h-9 flex-1 bg-card text-sm font-medium"
                            aria-invalid={!!bad && !r.date}
                          >
                            <SelectValue placeholder="Pick a day" />
                          </SelectTrigger>
                          <SelectContent>
                            {days.map((d) => (
                              <SelectItem key={d.toISOString()} value={toDateInput(d)}>
                                {shortDayLabel(d)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="sm:hidden">{remove}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_5.5rem] gap-2 sm:contents">
                        <div>
                          <Label htmlFor={fid("start")} className="sr-only">
                            Start time, shift {i + 1}
                          </Label>
                          <Input
                            id={fid("start")}
                            placeholder="9:00am"
                            value={r.startLabel}
                            onChange={(e) => update(i, { startLabel: e.target.value })}
                            className="h-9 bg-card"
                          />
                        </div>
                        <div>
                          <Label htmlFor={fid("end")} className="sr-only">
                            End time, shift {i + 1}
                          </Label>
                          <Input
                            id={fid("end")}
                            placeholder="5:00pm"
                            value={r.endLabel}
                            onChange={(e) => update(i, { endLabel: e.target.value })}
                            className="h-9 bg-card"
                          />
                        </div>
                        <div>
                          <Label htmlFor={fid("hours")} className="sr-only">
                            Hours, shift {i + 1}
                          </Label>
                          <Input
                            id={fid("hours")}
                            type="number"
                            inputMode="decimal"
                            step="0.25"
                            min="0"
                            max="24"
                            placeholder="0"
                            value={r.hours}
                            onChange={(e) => update(i, { hours: e.target.value })}
                            aria-invalid={!!bad && !!r.date}
                            className="h-9 bg-card text-right font-semibold tabular-nums"
                          />
                        </div>
                      </div>
                      <span className="hidden sm:block">{remove}</span>
                      {bad ? (
                        <p role="alert" className="text-xs font-medium text-destructive sm:col-span-5">
                          {bad}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 h-9 w-full border-dashed"
              onClick={() => {
                // New shifts default to the first day this person isn't on.
                const used = new Set(rows.map((r) => r.date));
                const free = days.find((d) => !used.has(toDateInput(d))) ?? days[0];
                setRows((rs) => [
                  ...rs,
                  { date: toDateInput(free), startLabel: "", endLabel: "", hours: "" },
                ]);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Add shift
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Hours fill in from the start and end times (e.g. 9:00am to 5:30pm = 8.5).
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : saveLabel(total)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
