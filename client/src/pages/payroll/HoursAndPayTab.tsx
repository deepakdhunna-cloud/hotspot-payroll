/**
 * Hours & pay tab — the weekly timesheet. Every row prefills from the time
 * clock (or a standing weekly amount), and the manager can override the
 * hours, the hourly rate, or pay the week as a flat "set pay" amount.
 *
 * Editing model: edits stay local and mark the row "Edited"; nothing saves
 * until the manager commits — one row, or everything from the commit bar.
 * Rows that were never saved (hours straight from the clock) read "Not
 * saved" and, for a closed week, ride along in the commit bar so the week
 * can be finalized without retyping anything. Unsaved edits survive tab
 * switches and leaving the page (kept per week and store for the session),
 * and a background refetch never clobbers a row that's being edited.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { PositionBreakdown } from "@/components/PositionBreakdown";
import { BlockState, TableStateRows } from "@/components/QueryStates";
import { trpc } from "@/lib/trpc";
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { computeGrossPay } from "@shared/hotspot";
import {
  fmtHours,
  fmtHoursLabel,
  fmtMoney,
  fmtWeekRange,
  STORE_ABBR,
} from "@/lib/format";
import {
  currentPayPeriodStart,
  fromDateInput,
  inProgressPayWeekStart,
  toDateInput,
} from "@/lib/payweek";
import { errorMessage } from "@/lib/errors";
import { buildXlsx, exportXlsx, prefetchXlsx, type XlsxSheet } from "@/lib/xlsx";
import { ShareDialog, sharePayload, type SharePayload } from "@/components/SharePayroll";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Save,
  Share,
  Wallet,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type WeekRow =
  inferRouterOutputs<AppRouter>["payroll"]["week"]["employees"][number];

/** Limits that match the server's validation, stated in plain words. */
const HOURS_MAX = 168;
const RATE_MAX = 1000;
const SET_PAY_MAX = 100_000;
/** Hours this far past the schedule get flagged (15 minutes of slack). */
const OVER_SCHEDULE_SLACK = 0.25;
/** Saved vs clock differences under 3 minutes are rounding, not a change. */
const CLOCK_MATCH_SLACK = 0.05;

/** What the manager sees and types for one row. `fixed` null = hourly. */
type RowEdit = { hours: string; rate: string; fixed: string | null; manual: boolean };
/** The last saved (or prefilled) values; a row is "Edited" when it differs. */
type RowBaseline = { hours: string; rate: string; fixed: string | null };
type Draft = Record<number, { edit: RowEdit; base: RowBaseline }>;

/**
 * Unsaved edits, kept for the life of the browser tab per (sign-in, week,
 * store). Leaving the Payroll page and coming back restores them instead of
 * silently throwing them away.
 */
const drafts = new Map<string, Draft>();

/**
 * Pay weeks (YYYY-MM-DD, oldest first) holding unsaved edits for this
 * sign-in and store — so Payroll can reopen the week you left mid-edit.
 */
export function draftWeeks(scope: string | undefined, store: string): string[] {
  const prefix = `${scope ?? "anon"}|`;
  const suffix = `|${store}`;
  const weeks: string[] = [];
  drafts.forEach((d, key) => {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
    if (Object.keys(d).length === 0) return;
    weeks.push(key.slice(prefix.length, key.length - suffix.length));
  });
  return weeks.sort();
}

/** Lets the Payroll page save or drop edits before it switches week/store. */
export type HoursController = {
  editedCount: number;
  saveEdited: () => Promise<boolean>;
  discardEdits: () => void;
};

/* ---------------------------- value helpers ---------------------------- */

/** null = empty, NaN = not a number. */
function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Same value for dirtiness — "15" and "15.00" are the same rate. */
function sameValue(a: string, b: string): boolean {
  const x = parseNum(a);
  const y = parseNum(b);
  if (x === null || y === null) return x === y;
  if (Number.isNaN(x) || Number.isNaN(y)) return a.trim() === b.trim();
  return Math.abs(x - y) < 0.005;
}

function sameFixed(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return sameValue(a, b);
}

function isDirty(e: RowEdit, b: RowBaseline): boolean {
  return !sameValue(e.hours, b.hours) || !sameValue(e.rate, b.rate) || !sameFixed(e.fixed, b.fixed);
}

/** Tidy a typed number to two decimals once the field loses focus. */
function tidy2(raw: string): string {
  const n = parseNum(raw);
  return n === null || Number.isNaN(n) || n < 0 ? raw : n.toFixed(2);
}

/**
 * A payroll entry that only exists to carry scheduled hours (created by a
 * schedule import/commit) — the manager never entered hours on it. Legacy
 * rows from before the "schedule-only" marker are detected by their saved
 * 0 hours alongside real clock punches.
 */
function isScheduleOnlyEntry(entry: WeekRow["entry"], clockH: number | undefined): boolean {
  if (!entry) return false;
  if (entry.notes === "schedule-only") return true;
  return (
    entry.notes !== "fixed-pay" &&
    Number(entry.hoursWorked) === 0 &&
    clockH !== undefined &&
    clockH > 0
  );
}

/** The values a row opens with when nobody is editing it. */
function freshRow(row: WeekRow, clockH: number | undefined): { edit: RowEdit; base: RowBaseline } {
  const saved = row.entry && !isScheduleOnlyEntry(row.entry, clockH) ? row.entry : null;
  let hours = "";
  let manual = false;
  if (saved) {
    const n = Number(saved.hoursWorked);
    hours = n.toFixed(2);
    // Saved hours that no longer match the clock open as typed hours, with
    // the current clock figure offered next to them.
    if (clockH !== undefined && Math.abs(n - clockH) > CLOCK_MATCH_SLACK) manual = true;
  } else if (clockH !== undefined && clockH > 0) {
    hours = clockH.toFixed(2);
  }
  // Set pay: a week SAVED as set pay reopens with its amount. A standing
  // weekly amount on the profile only fills weeks that aren't saved yet —
  // a week deliberately saved hourly stays hourly.
  const standing = Number(row.employee.weeklyPay ?? 0);
  let fixed: string | null = null;
  if (saved?.notes === "fixed-pay") fixed = Number(saved.grossPay).toFixed(2);
  else if (!saved && standing > 0) fixed = standing.toFixed(2);
  // A saved week keeps the rate it was paid at; anything else uses today's
  // profile rate.
  const rate = Number(saved?.payRateSnapshot ?? row.employee.payRate ?? 0).toFixed(2);
  return { edit: { hours, rate, fixed, manual }, base: { hours, rate, fixed } };
}

type RowCalc = {
  /** Parsed hours: null when empty, NaN when not a number. */
  hours: number | null;
  rate: number | null;
  isFixed: boolean;
  fixed: number | null;
  /** Hours that count (0 when empty or invalid). */
  hoursOk: number;
  /** Rate that counts (0 when empty or invalid). */
  rateOk: number;
  /** The ONE gross used by the row, the totals, the role breakdown and the export. */
  gross: number;
  errors: { hours?: string; rate?: string; fixed?: string };
};

function calcRow(e: RowEdit): RowCalc {
  const errors: RowCalc["errors"] = {};
  const hours = parseNum(e.hours);
  if (hours !== null) {
    if (Number.isNaN(hours) || hours < 0) errors.hours = "Enter hours as a number, like 38.5.";
    else if (hours > HOURS_MAX) errors.hours = `A week has at most ${HOURS_MAX} hours.`;
  }
  const rate = parseNum(e.rate);
  const isFixed = e.fixed !== null;
  if (rate === null) {
    if (!isFixed) errors.rate = "Enter an hourly rate.";
  } else if (Number.isNaN(rate) || rate < 0) {
    errors.rate = "Enter the rate as a number, like 15.50.";
  } else if (rate > RATE_MAX) {
    errors.rate = "The rate can't be over $1,000 an hour.";
  }
  let fixed: number | null = null;
  if (isFixed) {
    const f = parseNum(e.fixed ?? "");
    if (f === null || Number.isNaN(f) || f < 0) errors.fixed = "Enter the set pay amount.";
    else if (f > SET_PAY_MAX) errors.fixed = "Set pay can't be over $100,000.";
    else fixed = f;
  }
  const hoursOk = hours !== null && !errors.hours ? hours : 0;
  const rateOk = rate !== null && !Number.isNaN(rate) && !errors.rate ? rate : 0;
  // Cents, rounded exactly the way the server rounds what it saves, so the
  // grid, its totals and the saved payroll can never be a cent apart.
  const gross = Number(
    (isFixed ? (fixed ?? 0) : computeGrossPay(hoursOk, rateOk).grossPay).toFixed(2),
  );
  return { hours, rate, isFixed, fixed, hoursOk, rateOk, gross, errors };
}

type Status = "saving" | "edited" | "unsaved" | "saved" | "empty";

type RowView = {
  row: WeekRow;
  id: number;
  name: string;
  former: boolean;
  scheduled: number;
  clock: number | undefined;
  hasClock: boolean;
  edit: RowEdit;
  calc: RowCalc;
  dirty: boolean;
  isSaved: boolean;
  status: Status;
  /** Show the read-only clock figure instead of an input. */
  showClock: boolean;
  /** Typed/saved hours differ from what the clock now says. */
  clockDiffers: boolean;
  overBy: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/* ------------------------------ components ------------------------------ */

/** Hourly ↔ set pay, as a labeled two-way switch. */
function PayTypeToggle({
  fixed,
  onChange,
  name,
  className,
}: {
  fixed: boolean;
  onChange: (fixed: boolean) => void;
  name: string;
  className?: string;
}) {
  const seg = (on: boolean) =>
    cn(
      "h-9 sm:h-8 flex-1 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
      on
        ? "sk-seg-on bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div
      role="group"
      aria-label={`How ${name} is paid this week`}
      className={cn("sk-track inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      <button type="button" className={seg(!fixed)} aria-pressed={!fixed} onClick={() => onChange(false)}>
        Hourly
      </button>
      <button
        type="button"
        className={seg(fixed)}
        aria-pressed={fixed}
        onClick={() => onChange(true)}
        title="Pay a flat amount for this week instead of hours × rate"
      >
        Set pay
      </button>
    </div>
  );
}

/** A dollar field: "$" inside the box, digits right-aligned. */
function MoneyInput({
  id,
  value,
  onChange,
  label,
  error,
  errorId,
  onKeyDown,
  className,
  inputClassName,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  errorId?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
        aria-hidden="true"
      >
        $
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        placeholder="0.00"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const t = tidy2(e.target.value);
          if (t !== e.target.value) onChange(t);
        }}
        onKeyDown={onKeyDown}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn("pl-6 text-right tabular-nums", inputClassName)}
      />
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-[11px] leading-4 font-medium text-destructive">
      {children}
    </p>
  );
}

/** A row's status in the folded list: a small labelled mark, never color alone. */
function RowStatusDot({ status, liveWeek }: { status: Status; liveWeek: boolean }) {
  if (status === "saving") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />;
  }
  if (status === "saved") {
    return (
      <span className="chip-good shrink-0 !px-1.5" title="Saved to payroll">
        <Check className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Saved</span>
      </span>
    );
  }
  if (status === "empty") {
    return <span className="w-5 shrink-0" aria-hidden="true" />;
  }
  const edited = status === "edited";
  return (
    <span
      className={cn(edited || !liveWeek ? "chip-warn" : "chip-neutral", "shrink-0")}
      title={edited ? "Changed here, not saved yet" : "From the time clock — not saved to payroll yet"}
    >
      {edited ? "Edited" : "Not saved"}
    </span>
  );
}

function StatusCell({
  status,
  liveWeek,
  name,
  onSave,
}: {
  status: Status;
  liveWeek: boolean;
  name: string;
  onSave: () => void;
}) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="chip-good">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (status === "empty") {
    return <span className="text-xs text-muted-foreground">No hours</span>;
  }
  const edited = status === "edited";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={edited || !liveWeek ? "chip-warn" : "chip-neutral"}
        title={
          edited
            ? "Changed here, not saved yet"
            : "Filled in from the time clock — not saved to payroll yet"
        }
      >
        {edited ? <Pencil className="h-3 w-3" /> : null}
        {edited ? "Edited" : liveWeek ? "Not saved yet" : "Not saved"}
      </span>
      <Button
        size="sm"
        variant={edited || !liveWeek ? "outline" : "ghost"}
        className={cn("h-9 px-2.5 sm:h-8", !edited && liveWeek && "text-muted-foreground")}
        onClick={onSave}
        aria-label={`Save ${name}`}
        title={!edited && liveWeek ? "Save this row now — the week is still in progress" : "Save this row"}
      >
        Save
      </Button>
    </span>
  );
}

/* --------------------------------- tab --------------------------------- */

export default function HoursAndPayTab({
  weekStart,
  storeFilter,
  controllerRef,
  onEditedChange,
  onOpenWeek,
  onShowPunches,
}: {
  weekStart: Date;
  storeFilter: string;
  controllerRef?: MutableRefObject<HoursController | null>;
  onEditedChange?: (count: number) => void;
  /** Jump to another week (used by the "unsaved edits waiting" banner). */
  onOpenWeek?: (weekStart: Date) => void;
  /** Open the Punches tab on one person's punches for this week. */
  onShowPunches?: (employeeId: number) => void;
}) {
  const store = storeFilter === "all" ? undefined : (storeFilter as any);
  const { stores: visibleStores } = useStoreScope();
  // "All" for a one-store login IS that store — name it in exports.
  const scopeStore =
    storeFilter !== "all" ? storeFilter : visibleStores.length === 1 ? visibleStores[0] : null;
  const weekQ = trpc.payroll.week.useQuery({ weekStart, store });
  const clockHoursQ = trpc.clock.weekHoursBulk.useQuery({ weekStart, store });
  const meQ = trpc.auth.me.useQuery();
  const draftKey = `${meQ.data?.scope ?? "anon"}|${toDateInput(weekStart)}|${storeFilter}`;
  const range = fmtWeekRange(weekStart);

  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [base, setBase] = useState<Record<number, RowBaseline>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(() => new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  // Export or Share with unsaved rows on screen asks first; this is which.
  const [askFor, setAskFor] = useState<"export" | "share" | null>(null);
  const [sharing, setSharing] = useState(false);
  // The share dialog (shown when the device's own share sheet can't be used).
  const [shareDialog, setShareDialog] = useState<SharePayload | null>(null);
  // Compact list (phone, foldable, tablet): which rows are opened for editing.
  const [openRows, setOpenRows] = useState<Set<number>>(() => new Set());
  const toggleRow = (id: number) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [exporting, setExporting] = useState(false);

  // Live mirrors so the merge effect never works from a stale closure.
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const baseRef = useRef(base);
  baseRef.current = base;
  const initialized = useRef(false);

  const clockHoursMap = (() => {
    const m = new Map<number, number>();
    for (const e of clockHoursQ.data?.entries ?? []) m.set(e.employeeId, e.hours);
    return m;
  })();
  const clockKey = JSON.stringify(clockHoursQ.data?.entries ?? null);

  // Open each row with fresh values — except rows mid-edit, which keep
  // their local values and baseline so a refetch can't wipe unsaved work.
  // The first pass also restores this week's unsaved edits from earlier.
  useEffect(() => {
    if (!weekQ.data || clockHoursQ.isLoading || meQ.isLoading) return;
    const draft = initialized.current ? undefined : drafts.get(draftKey);
    const nextEdits: Record<number, RowEdit> = {};
    const nextBase: Record<number, RowBaseline> = {};
    let restored = 0;
    for (const row of weekQ.data.employees) {
      const id = row.employee.id;
      const cur = editsRef.current[id];
      const curBase = baseRef.current[id];
      if (cur && curBase && isDirty(cur, curBase)) {
        nextEdits[id] = cur;
        nextBase[id] = curBase;
        continue;
      }
      const kept = draft?.[id];
      if (kept && isDirty(kept.edit, kept.base)) {
        nextEdits[id] = kept.edit;
        nextBase[id] = kept.base;
        restored++;
        continue;
      }
      const fresh = freshRow(row, clockHoursMap.get(id));
      if (cur?.manual) fresh.edit.manual = true;
      nextEdits[id] = fresh.edit;
      nextBase[id] = fresh.base;
    }
    initialized.current = true;
    setEdits(nextEdits);
    setBase(nextBase);
    if (restored > 0) {
      toast.info(
        `Your ${restored} unsaved ${plural(restored, "change")} for ${range} ${restored === 1 ? "is" : "are"} still here.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekQ.data, clockKey, clockHoursQ.isLoading, meQ.isLoading]);

  // Keep this week's unsaved edits in the session store.
  useEffect(() => {
    if (!initialized.current) return;
    const d: Draft = {};
    for (const key of Object.keys(edits)) {
      const id = Number(key);
      const e = edits[id];
      const b = base[id];
      if (e && b && isDirty(e, b)) d[id] = { edit: e, base: b };
    }
    if (Object.keys(d).length > 0) drafts.set(draftKey, d);
    else drafts.delete(draftKey);
  }, [edits, base, draftKey]);

  const utils = trpc.useUtils();
  const saveHoursM = trpc.payroll.saveHours.useMutation();
  const invalidateAll = () => {
    utils.payroll.week.invalidate();
    utils.payroll.range.invalidate();
    utils.employees.list.invalidate();
    utils.dashboard.summary.invalidate();
    utils.attention.list.invalidate();
  };

  const liveWeek = weekStart.getTime() >= inProgressPayWeekStart().getTime();
  // Weeks before the last closed one: the rate on screen is that week's
  // own rate, and saving must keep it (the server never copies it to the
  // profile for these weeks).
  const olderWeek = weekStart.getTime() < currentPayPeriodStart().getTime();

  const rows = weekQ.data?.employees ?? [];
  const ready = weekQ.isSuccess && !clockHoursQ.isLoading;

  const views: RowView[] = rows.map((row) => {
    const id = row.employee.id;
    const clock = clockHoursMap.get(id);
    const hasClock = clock !== undefined && clock > 0;
    const fresh = edits[id] && base[id] ? null : freshRow(row, clock);
    const edit = edits[id] ?? fresh!.edit;
    const b = base[id] ?? fresh!.base;
    const calc = calcRow(edit);
    const dirty = isDirty(edit, b);
    const isSaved =
      (!!row.entry && !isScheduleOnlyEntry(row.entry, clock)) || savedIds.has(id);
    const hasWork = calc.hoursOk > 0 || calc.isFixed || hasClock;
    const status: Status = saving[id]
      ? "saving"
      : dirty
        ? "edited"
        : isSaved
          ? "saved"
          : hasWork
            ? "unsaved"
            : "empty";
    const clockDiffers =
      hasClock && calc.hours !== null && !calc.errors.hours && Math.abs(calc.hoursOk - clock!) > CLOCK_MATCH_SLACK;
    const scheduled = Number(row.entry?.scheduledHours ?? 0);
    const effective = calc.hours !== null && !calc.errors.hours ? calc.hoursOk : (clock ?? 0);
    const overBy =
      scheduled > 0 && effective > scheduled + OVER_SCHEDULE_SLACK ? effective - scheduled : null;
    return {
      row,
      id,
      name: row.employee.fullName,
      former: Number(row.employee.active) === 0,
      scheduled,
      clock,
      hasClock,
      edit,
      calc,
      dirty,
      isSaved,
      status,
      showClock: hasClock && !edit.manual && !clockDiffers && calc.hours !== null,
      clockDiffers,
      overBy,
    };
  });

  const edited = views.filter((v) => v.dirty);
  const unsaved = views.filter((v) => v.status === "unsaved");
  // A closed week's clock-filled rows are ready to finalize as they are.
  const barTargets = liveWeek ? edited : [...edited, ...unsaved];
  const exportPending = edited.length + unsaved.length;
  const payable = views.filter((v) => v.isSaved || v.status === "unsaved" || v.dirty);
  const savedCount = views.filter((v) => v.isSaved).length;

  const totals = views.reduce(
    (t, v) => ({
      scheduled: t.scheduled + v.scheduled,
      hours: t.hours + v.calc.hoursOk,
      gross: t.gross + v.calc.gross,
    }),
    { scheduled: 0, hours: 0, gross: 0 },
  );

  const positionItems = views
    .map((v) => ({ role: v.row.employee.role, hours: v.calc.hoursOk, gross: v.calc.gross }))
    .filter((it) => it.hours > 0 || it.gross > 0);

  const setRow = (id: number, patch: Partial<RowEdit>) =>
    setEdits((s) => {
      const cur = s[id];
      if (!cur) return s;
      return { ...s, [id]: { ...cur, ...patch } };
    });

  /** Hourly ↔ set pay. Set pay starts from the standing weekly amount, else
   *  from what the row pays right now, so nothing jumps to $0. */
  const setPayType = (v: RowView, fixed: boolean) => {
    if (!fixed) return setRow(v.id, { fixed: null });
    const standing = Number(v.row.employee.weeklyPay ?? 0);
    const start = standing > 0 ? standing : v.calc.gross;
    setRow(v.id, { fixed: start > 0 ? start.toFixed(2) : "" });
  };

  /* ------------------------------- saving ------------------------------- */

  type SaveInput = Parameters<typeof saveHoursM.mutateAsync>[0];
  const buildSave = (
    v: RowView,
  ): { ok: true; input: SaveInput; rateChanged: boolean } | { ok: false; message: string } => {
    const c = v.calc;
    if (c.errors.hours) return { ok: false, message: c.errors.hours };
    if (c.isFixed && c.errors.fixed) return { ok: false, message: c.errors.fixed };
    if (!c.isFixed && c.hours === null) {
      return { ok: false, message: "Enter hours (use 0 if they didn't work)." };
    }
    if (c.errors.rate) return { ok: false, message: c.errors.rate };
    const b = base[v.id] ?? v.edit;
    const validRate = c.rate !== null && !Number.isNaN(c.rate) ? c.rate : null;
    const rateChanged = validRate !== null && !sameValue(v.edit.rate, b.rate);
    // Send the rate only when the manager changed it — re-saving a past
    // week with its old rate must never roll the profile rate back. Older
    // weeks always send their own rate so their snapshot is kept.
    const sendRate = validRate !== null && (rateChanged || olderWeek);
    return {
      ok: true,
      rateChanged,
      input: {
        employeeId: v.id,
        weekStart,
        hoursWorked: c.hoursOk,
        scheduledHours: v.scheduled,
        ...(sendRate && validRate !== null ? { payRateOverride: validRate } : {}),
        ...(c.isFixed && c.fixed !== null ? { fixedGross: c.fixed } : {}),
      },
    };
  };

  /** Save rows one by one; never stops at the first failure. */
  const saveRows = async (targets: RowView[]) => {
    const failed: { id: number; name: string; message: string }[] = [];
    const notes: string[] = [];
    const savedNow: number[] = [];
    const many = targets.length > 1;
    let processed = 0;
    if (many) setBatch({ done: 0, total: targets.length });
    for (const v of targets) {
      const built = buildSave(v);
      if (!built.ok) {
        failed.push({ id: v.id, name: v.name, message: built.message });
      } else {
        const snap = v.edit;
        setSaving((s) => ({ ...s, [v.id]: true }));
        try {
          const res = await saveHoursM.mutateAsync(built.input);
          setBase((s) => ({ ...s, [v.id]: { hours: snap.hours, rate: snap.rate, fixed: snap.fixed } }));
          savedNow.push(v.id);
          const sent = built.input.payRateOverride;
          if (built.rateChanged && sent !== undefined) {
            notes.push(
              res.profileRateUpdated
                ? `${v.name}'s profile rate is now ${fmtMoney(sent)}/hr.`
                : `${v.name}: ${fmtMoney(sent)}/hr applies to this week only.`,
            );
          }
        } catch (err) {
          failed.push({ id: v.id, name: v.name, message: errorMessage(err) });
        } finally {
          setSaving((s) => {
            const next = { ...s };
            delete next[v.id];
            return next;
          });
        }
      }
      processed++;
      if (many) setBatch({ done: processed, total: targets.length });
    }
    setBatch(null);
    if (savedNow.length > 0) {
      setSavedIds((s) => new Set([...Array.from(s), ...savedNow]));
      // Update the session store now — the page may switch week right after.
      const d = drafts.get(draftKey);
      if (d) {
        for (const id of savedNow) delete d[id];
        if (Object.keys(d).length === 0) drafts.delete(draftKey);
      }
      invalidateAll();
    }
    return { saved: savedNow, failed, notes };
  };

  const failureToast = (saved: number, failed: { name: string; message: string }[]) =>
    toast.error(
      saved > 0
        ? `Saved ${saved}. ${failed.length} ${plural(failed.length, "row needs", "rows need")} a fix.`
        : `${failed.length} ${plural(failed.length, "row needs", "rows need")} a fix before saving.`,
      {
        duration: 12_000,
        description: (
          <ul className="mt-1 space-y-0.5">
            {failed.map((f) => (
              <li key={f.name}>
                <span className="font-medium">{f.name}</span> — {f.message}
              </li>
            ))}
          </ul>
        ),
      },
    );

  const handleSaveOne = async (v: RowView) => {
    const res = await saveRows([v]);
    if (res.failed.length > 0) {
      toast.error(`${v.name}: ${res.failed[0].message}`);
      return;
    }
    toast.success(`Saved ${v.name}${v.calc.isFixed ? " as set pay" : ""}.`, {
      description: res.notes[0],
    });
  };

  const handleSaveAll = async () => {
    const res = await saveRows(barTargets);
    if (res.failed.length > 0) {
      failureToast(res.saved.length, res.failed);
      return;
    }
    toast.success(
      `Saved ${res.saved.length} ${plural(res.saved.length, "row")} to payroll for ${range}.`,
      {
        description: res.notes.join(" ") || undefined,
        action: { label: "Export", onClick: () => void runExport(new Set(res.saved)) },
      },
    );
  };

  /** Throw away local edits and fall back to the last-saved values. */
  const discardEdits = () => {
    setEdits((s) => {
      const next = { ...s };
      for (const v of edited) {
        const b = baseRef.current[v.id];
        if (!b) continue;
        next[v.id] = { hours: b.hours, rate: b.rate, fixed: b.fixed, manual: false };
      }
      return next;
    });
    drafts.delete(draftKey);
  };

  // The Payroll page asks before switching week or store with edits open.
  if (controllerRef) {
    controllerRef.current = {
      editedCount: edited.length,
      saveEdited: async () => {
        const res = await saveRows(edited);
        if (res.failed.length > 0) {
          failureToast(res.saved.length, res.failed);
          return false;
        }
        if (res.saved.length > 0) {
          toast.success(`Saved ${res.saved.length} ${plural(res.saved.length, "row")} for ${range}.`);
        }
        return true;
      },
      discardEdits,
    };
  }
  useEffect(() => {
    onEditedChange?.(edited.length);
  }, [edited.length, onEditedChange]);
  useEffect(() => () => onEditedChange?.(0), [onEditedChange]);

  // Reloading or closing the tab with edits open asks first.
  const hasEdits = edited.length > 0;
  useEffect(() => {
    if (!hasEdits) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasEdits]);

  /** Enter in any field of a row saves that row. */
  const saveOnEnter = (v: RowView) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (v.status === "edited" || v.status === "unsaved")) {
      e.preventDefault();
      void handleSaveOne(v);
    }
  };

  /* ------------------------------- export ------------------------------- */

  type ExportRow = {
    employee: string;
    store: string;
    role: string;
    payType: string;
    rate: number;
    scheduled: number;
    hours: number;
    gross: number;
    status: string;
  };

  /**
   * The week on screen as a spreadsheet, plus the words that go with it when
   * it is shared. One builder for Export and Share, so they can never differ.
   */
  const buildWeekFile = (justSaved?: Set<number>) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const year = weekEnd.getUTCFullYear();
    const storeLabel = scopeStore ?? "All stores";
    const storeSlug = (scopeStore ? (STORE_ABBR[scopeStore] ?? scopeStore) : "All-stores").replace(/\s+/g, "-");
    const filename = `Hotspot-Payroll-${toDateInput(weekStart)}_to_${toDateInput(weekEnd)}-${storeSlug}.xlsx`;
    const statusLabel = (v: RowView) => {
      if (justSaved?.has(v.id)) return "Saved";
      if (v.status === "saved") return "Saved";
      if (v.status === "edited") return "Edited, not saved";
      if (v.status === "unsaved" || v.status === "saving") return "Not saved";
      return "No hours";
    };
    const exportRows: ExportRow[] = views.map((v) => ({
      employee: v.former ? `${v.name} (former)` : v.name,
      store: v.row.employee.storeLocation,
      role: v.row.employee.role,
      payType: v.calc.isFixed ? "Set pay" : "Hourly",
      rate: v.calc.rateOk,
      scheduled: v.scheduled,
      hours: v.calc.hoursOk,
      gross: v.calc.gross,
      status: statusLabel(v),
    }));
    const paid = exportRows.filter((r) => r.status !== "No hours");
    const savedN = paid.filter((r) => r.status === "Saved").length;
    const pendingN = paid.length - savedN;
    const sheet: XlsxSheet<ExportRow> = {
      name: "Hours & pay",
      title: "Weekly payroll",
      subtitle: `Pay week ${range}, ${year} · ${storeLabel}`,
      summary: [
        { label: "Gross pay", value: fmtMoney(totals.gross) },
        { label: "Hours worked", value: fmtHours(totals.hours, 2) },
        { label: "People paid", value: String(paid.length) },
        { label: "Saved to payroll", value: `${savedN} of ${paid.length}` },
      ],
      columns: [
        { header: "Employee", key: "employee", width: 26 },
        { header: "Store", key: "store", width: 20 },
        { header: "Role", key: "role", width: 18 },
        { header: "Pay type", key: "payType", width: 11 },
        { header: "Hourly rate", key: "rate", width: 12, numFmt: "$#,##0.00", align: "right" },
        { header: "Scheduled hours", key: "scheduled", width: 16, numFmt: "#,##0.0", align: "right" },
        { header: "Hours worked", key: "hours", width: 14, numFmt: "#,##0.00", align: "right" },
        { header: "Gross pay", key: "gross", width: 14, numFmt: "$#,##0.00", align: "right" },
        {
          header: "Status",
          key: "status",
          width: 18,
          tone: (r) => (r.status === "Saved" ? "good" : r.status === "No hours" ? "muted" : "warn"),
        },
      ],
      rows: exportRows,
      totals: {
        scheduled: Number(totals.scheduled.toFixed(2)),
        hours: Number(totals.hours.toFixed(2)),
        gross: Number(totals.gross.toFixed(2)),
      },
      totalsLabelKey: "employee",
      totalsLabel: "Total",
    };
    return {
      filename,
      sheet,
      title: `Hotspot payroll · ${range}`,
      text: [
        `${storeLabel} — pay week ${range}, ${year}`,
        `${paid.length} ${plural(paid.length, "person", "people")} · ${fmtHours(totals.hours, 2)} hours · ${fmtMoney(totals.gross)} gross`,
        pendingN > 0
          ? `${pendingN} ${plural(pendingN, "row")} not saved to payroll yet`
          : "Everyone is saved to payroll",
      ].join("\n"),
    };
  };

  const buildFailed = (err: unknown) => {
    console.error("[Export] failed:", err);
    toast.error(
      "Couldn't build the spreadsheet. A new version of the app may have been released — refresh the page (saved payroll is safe) and try again.",
    );
  };

  const runExport = async (justSaved?: Set<number>) => {
    const { filename, sheet } = buildWeekFile(justSaved);
    setExporting(true);
    try {
      await exportXlsx(filename, sheet);
      toast.success("Spreadsheet downloaded.", { description: filename });
    } catch (err) {
      buildFailed(err);
    } finally {
      setExporting(false);
    }
  };

  /** Send the week: the device's share sheet, or the share dialog. */
  const runShare = async (justSaved?: Set<number>) => {
    const { filename, sheet, title, text } = buildWeekFile(justSaved);
    setSharing(true);
    try {
      const payload: SharePayload = { filename, blob: await buildXlsx(sheet), title, text };
      const result = await sharePayload(payload);
      if (result === "shared") toast.success("Payroll shared.");
      else if (result === "dialog") setShareDialog(payload);
    } catch (err) {
      buildFailed(err);
    } finally {
      setSharing(false);
    }
  };

  const onExportClick = () => {
    if (exportPending > 0) setAskFor("export");
    else void runExport();
  };
  const onShareClick = () => {
    if (exportPending > 0) setAskFor("share");
    else void runShare();
  };
  const run = (what: "export" | "share", justSaved?: Set<number>) =>
    what === "share" ? runShare(justSaved) : runExport(justSaved);

  const saveThen = async (what: "export" | "share") => {
    setAskFor(null);
    const res = await saveRows([...edited, ...unsaved]);
    if (res.failed.length > 0) {
      failureToast(res.saved.length, res.failed);
      return;
    }
    await run(what, new Set(res.saved));
  };

  // Warm the spreadsheet builder once the week is on screen, so the first
  // Export or Share starts the moment it is tapped.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(prefetchXlsx, 1500);
    return () => window.clearTimeout(t);
  }, [ready]);

  // Only label stores when the grid spans more than one.
  const multiStore = new Set(rows.map((r) => r.employee.storeLocation)).size > 1;
  const storeTag = (s: string) => STORE_ABBR[s] ?? s;
  const everyoneSaved =
    ready && payable.length > 0 && savedCount >= payable.length && edited.length === 0 && unsaved.length === 0;

  const kpiLoading = (
    <span className="inline-block h-8 w-28 animate-pulse rounded-md bg-muted" aria-label="Loading" />
  );

  /* -------------------------------- render -------------------------------- */

  const waitingWeeks = draftWeeks(meQ.data?.scope, storeFilter).filter(
    (w) => w !== toDateInput(weekStart),
  );

  return (
    <div className="space-y-5 md:space-y-6">
      {waitingWeeks.length > 0 && onOpenWeek ? (
        <div className="callout-warn flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="callout-title font-medium">Unsaved edits are waiting</span>{" "}
            <span className="text-muted-foreground">
              for {waitingWeeks.map((w) => fmtWeekRange(fromDateInput(w))).join(", ")}.
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 bg-card sm:h-8"
            onClick={() => onOpenWeek(fromDateInput(waitingWeeks[waitingWeeks.length - 1]))}
          >
            Open {fmtWeekRange(fromDateInput(waitingWeeks[waitingWeeks.length - 1]))}
          </Button>
        </div>
      ) : null}
      <KpiBand className="grid-cols-2 md:grid-cols-3">
        <KpiCell
          hero
          icon={<Wallet />}
          label="Gross pay"
          value={ready ? <Money value={totals.gross} /> : weekQ.isError ? "—" : kpiLoading}
          sub={
            liveWeek
              ? `${range} · so far, week in progress`
              : ready && exportPending > 0
                ? `${range} · includes ${exportPending} unsaved ${plural(exportPending, "row")}`
                : range
          }
        />
        <KpiCell
          hue="blue"
          icon={<Clock />}
          label="Hours worked"
          value={ready ? fmtHours(totals.hours) : weekQ.isError ? "—" : kpiLoading}
          sub={ready ? `${fmtHoursLabel(totals.scheduled)} scheduled` : " "}
        />
        <KpiCell
          hue="green"
          icon={<Check />}
          label="Saved to payroll"
          value={ready ? `${savedCount} of ${payable.length}` : weekQ.isError ? "—" : kpiLoading}
          sub={
            !ready
              ? " "
              : payable.length === 0
                ? "nobody has hours yet"
                : edited.length > 0
                  ? `${edited.length} ${plural(edited.length, "row")} edited, not saved`
                  : unsaved.length > 0
                    ? liveWeek
                      ? "saved once the week closes"
                      : `${unsaved.length} with hours, not saved yet`
                    : "everyone with hours is saved"
          }
        />
      </KpiBand>

      <Card className="surface-card gap-0 py-0">
        <CardHeader className="card-head flex flex-row flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3">
          <div className="min-w-0">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <ClipboardList />
              </span>
              Timesheet
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {range}
              {ready ? ` · ${rows.length} ${plural(rows.length, "person", "people")}` : ""}
              {liveWeek ? " · week in progress" : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 sm:h-8"
              onClick={onShareClick}
              disabled={!ready || rows.length === 0 || sharing}
              title="Send this week's payroll: the spreadsheet with a short summary"
            >
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share className="h-4 w-4" />}
              Share
            </Button>
            <Button
              variant={everyoneSaved ? "default" : "outline"}
              size="sm"
              className="h-9 sm:h-8"
              onClick={onExportClick}
              disabled={!ready || rows.length === 0 || exporting}
              title="Download this week as an .xlsx spreadsheet (opens in Google Sheets and Excel)"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {/* ---------- Phone, foldable and tablet: one compact row per person ----------
              A row shows who, hours, pay and status at a glance. Tapping it
              opens that person's controls in place, so a whole store fits
              on a screen or two and only the row being fixed takes room. */}
          <div className="lg:hidden">
            {(weekQ.isLoading || (weekQ.isSuccess && clockHoursQ.isLoading)) && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            )}
            {weekQ.isError && <BlockState isError onRetry={() => weekQ.refetch()}>{null}</BlockState>}
            {ready && rows.length === 0 && (
              <BlockState
                isEmpty
                emptyTitle="No one to pay this week"
                emptyHint="Change the store, or add employees from the Employees page."
              >
                {null}
              </BlockState>
            )}
            {ready && rows.length > 0 && (
              <ul className="divide-y divide-border">
                {views.map((v) => {
                  const errId = (f: string) => `m-${f}-err-${v.id}`;
                  const hasErrors = Object.keys(v.calc.errors).length > 0;
                  const open = openRows.has(v.id) || hasErrors;
                  const panelId = `m-panel-${v.id}`;
                  return (
                    <li
                      key={v.id}
                      className={cn(
                        "relative",
                        v.dirty && "shadow-[inset_3px_0_0_var(--primary)]",
                        open && "bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => toggleRow(v.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[15px] font-medium leading-tight">
                              {v.name}
                            </span>
                            {v.former ? <span className="chip-neutral">Former</span> : null}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                            <span className="truncate">
                              {v.row.employee.role}
                              {multiStore ? ` · ${storeTag(v.row.employee.storeLocation)}` : ""}
                            </span>
                            {v.overBy !== null ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" /> {fmtHoursLabel(v.overBy)} over
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[15px] font-semibold leading-tight tabular-nums">
                            {fmtMoney(v.calc.gross)}
                          </span>
                          <span className="mt-1 flex items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground">
                            {v.calc.isFixed ? (
                              "Set pay"
                            ) : (
                              <>
                                {v.showClock ? <Clock className="h-3 w-3" aria-hidden="true" /> : null}
                                {fmtHours(v.calc.hoursOk, 2)} h
                              </>
                            )}
                          </span>
                        </span>
                        {/* While open, the row's status sits beside its Save button. */}
                        {open ? null : <RowStatusDot status={v.status} liveWeek={liveWeek} />}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </button>

                      {open ? (
                        <div id={panelId} className="px-4 pb-4 sm:px-5">
                          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
                            <PayTypeToggle
                              className="flex w-full sm:w-auto"
                              fixed={v.calc.isFixed}
                              name={v.name}
                              onChange={(fixed) => setPayType(v, fixed)}
                            />
                            <div className="grid grid-cols-2 gap-3 sm:contents">
                              {v.calc.isFixed ? (
                                <div className="space-y-1">
                                  <label htmlFor={`m-fixed-${v.id}`} className="text-xs font-medium text-muted-foreground">
                                    Set pay this week
                                  </label>
                                  <MoneyInput
                                    id={`m-fixed-${v.id}`}
                                    value={v.edit.fixed ?? ""}
                                    onChange={(val) => setRow(v.id, { fixed: val })}
                                    error={v.calc.errors.fixed}
                                    errorId={errId("fixed")}
                                    onKeyDown={saveOnEnter(v)}
                                    inputClassName="h-10"
                                  />
                                  {v.calc.errors.fixed ? (
                                    <FieldError id={errId("fixed")}>{v.calc.errors.fixed}</FieldError>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <label htmlFor={`m-rate-${v.id}`} className="text-xs font-medium text-muted-foreground">
                                    Hourly rate
                                  </label>
                                  <MoneyInput
                                    id={`m-rate-${v.id}`}
                                    value={v.edit.rate}
                                    onChange={(val) => setRow(v.id, { rate: val })}
                                    error={v.calc.errors.rate}
                                    errorId={errId("rate")}
                                    onKeyDown={saveOnEnter(v)}
                                    inputClassName="h-10"
                                  />
                                  {v.calc.errors.rate ? (
                                    <FieldError id={errId("rate")}>{v.calc.errors.rate}</FieldError>
                                  ) : null}
                                </div>
                              )}
                              <div className="space-y-1">
                                <label htmlFor={`m-hours-${v.id}`} className="text-xs font-medium text-muted-foreground">
                                  Hours worked
                                </label>
                                {v.showClock ? (
                                  <button
                                    type="button"
                                    id={`m-hours-${v.id}`}
                                    className="flex h-10 w-full items-center justify-between rounded-[0.625rem] border border-input bg-[var(--field)] px-3 text-sm"
                                    onClick={() => setRow(v.id, { manual: true })}
                                    aria-label={`${fmtHours(v.calc.hoursOk, 2)} hours from the time clock. Tap to edit.`}
                                  >
                                    <span className="chip-good">
                                      <Clock className="h-3 w-3" /> Clock
                                    </span>
                                    <span className="flex items-center gap-1.5 font-medium tabular-nums">
                                      {fmtHours(v.calc.hoursOk, 2)}
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                    </span>
                                  </button>
                                ) : (
                                  <Input
                                    id={`m-hours-${v.id}`}
                                    type="number"
                                    inputMode="decimal"
                                    step="0.25"
                                    min="0"
                                    value={v.edit.hours}
                                    onChange={(e) => setRow(v.id, { hours: e.target.value, manual: true })}
                                    onBlur={(e) => {
                                      const t = tidy2(e.target.value);
                                      if (t !== e.target.value) setRow(v.id, { hours: t });
                                    }}
                                    onKeyDown={saveOnEnter(v)}
                                    placeholder={v.hasClock ? fmtHours(v.clock!, 2) : "0.00"}
                                    aria-invalid={v.calc.errors.hours ? true : undefined}
                                    aria-describedby={v.calc.errors.hours ? errId("hours") : undefined}
                                    className="h-10 text-right tabular-nums"
                                  />
                                )}
                                {v.calc.errors.hours ? (
                                  <FieldError id={errId("hours")}>{v.calc.errors.hours}</FieldError>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                            <p className="text-xs text-muted-foreground">
                              {v.scheduled > 0
                                ? `${fmtHoursLabel(v.scheduled)} scheduled`
                                : "Not on the schedule"}
                              {onShowPunches && v.hasClock ? (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="inline-flex min-h-8 items-center font-medium text-foreground underline underline-offset-2"
                                    onClick={() => onShowPunches(v.id)}
                                  >
                                    See punches
                                  </button>
                                </>
                              ) : null}
                              {v.clockDiffers && !v.showClock ? (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="inline-flex min-h-8 items-center"
                                    onClick={() =>
                                      setRow(v.id, { hours: v.clock!.toFixed(2), manual: false })
                                    }
                                  >
                                    Clock says {fmtHours(v.clock!, 2)} ·&nbsp;
                                    <span className="font-medium text-foreground underline underline-offset-2">
                                      Use clock
                                    </span>
                                  </button>
                                </>
                              ) : null}
                            </p>
                            <StatusCell
                              status={v.status}
                              liveWeek={liveWeek}
                              name={v.name}
                              onSave={() => void handleSaveOne(v)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {ready && rows.length > 0 && (
              <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-4 py-3 text-sm sm:px-5">
                <span className="flex-1 font-semibold">Total</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fmtHoursLabel(totals.hours, 2)}
                </span>
                <span className="font-semibold tabular-nums">{fmtMoney(totals.gross)}</span>
              </div>
            )}
          </div>

          {/* ---------- Desktop layout: the grid ---------- */}
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-card pl-4 sm:pl-5">Employee</TableHead>
                  <TableHead className="w-[146px]">Pay</TableHead>
                  <TableHead className="w-[126px] text-right">Hourly rate</TableHead>
                  <TableHead className="w-[96px] text-right">Scheduled</TableHead>
                  <TableHead className="w-[196px] text-right">Hours worked</TableHead>
                  <TableHead className="w-[140px] text-right">Gross pay</TableHead>
                  <TableHead className="w-[164px] pr-4 sm:pr-5 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableStateRows
                  colSpan={7}
                  isLoading={!ready && !weekQ.isError}
                  isError={weekQ.isError}
                  onRetry={() => weekQ.refetch()}
                  isEmpty={ready && rows.length === 0}
                  emptyTitle="No one to pay this week"
                  emptyHint="Change the store in the top bar, or add employees from the Employees page."
                />
                {ready &&
                  views.map((v) => {
                    const errId = (f: string) => `d-${f}-err-${v.id}`;
                    return (
                      <TableRow key={v.id} className="hover:bg-transparent">
                        <TableCell
                          className={cn(
                            "sticky left-0 z-10 bg-card pl-4 sm:pl-5 align-top py-3",
                            v.dirty && "shadow-[inset_3px_0_0_var(--primary)]",
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-medium">
                            {v.name}
                            {v.former ? (
                              <span className="chip-neutral" title="No longer active — shown because they have hours or pay this week">
                                Former
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="role-tag">{v.row.employee.role}</span>
                            {multiStore ? ` · ${storeTag(v.row.employee.storeLocation)}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="align-top py-3">
                          <PayTypeToggle
                            fixed={v.calc.isFixed}
                            name={v.name}
                            onChange={(fixed) => setPayType(v, fixed)}
                          />
                        </TableCell>
                        <TableCell className="align-top py-3 text-right">
                          {v.calc.isFixed ? (
                            <div
                              className="flex h-9 items-center justify-end text-sm text-muted-foreground tabular-nums"
                              title="Set pay doesn't use the hourly rate"
                            >
                              {v.calc.rateOk > 0 ? fmtMoney(v.calc.rateOk) : "—"}
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <MoneyInput
                                value={v.edit.rate}
                                onChange={(val) => setRow(v.id, { rate: val })}
                                label={`Hourly rate for ${v.name}`}
                                error={v.calc.errors.rate}
                                errorId={errId("rate")}
                                onKeyDown={saveOnEnter(v)}
                                className="w-28"
                                inputClassName="h-9"
                              />
                              {v.calc.errors.rate ? (
                                <FieldError id={errId("rate")}>{v.calc.errors.rate}</FieldError>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top py-3 text-right text-muted-foreground tabular-nums">
                          <div className="flex h-9 items-center justify-end">
                            {v.scheduled > 0 ? fmtHours(v.scheduled) : "—"}
                          </div>
                        </TableCell>
                        <TableCell className="align-top py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            {v.showClock ? (
                              <div className="flex h-9 items-center justify-end gap-2">
                                {onShowPunches ? (
                                  <button
                                    type="button"
                                    className="chip-good transition-opacity hover:opacity-80"
                                    onClick={() => onShowPunches(v.id)}
                                    title="Filled in from the time clock. Click to see the punches behind these hours."
                                    aria-label={`See ${v.name}'s punches for this week`}
                                  >
                                    <Clock className="h-3 w-3" /> Clock
                                  </button>
                                ) : (
                                  <span className="chip-good" title="Filled in from time clock punches">
                                    <Clock className="h-3 w-3" /> Clock
                                  </span>
                                )}
                                <span className="w-14 text-right font-medium tabular-nums">
                                  {fmtHours(v.calc.hoursOk, 2)}
                                </span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground"
                                  onClick={() => setRow(v.id, { manual: true })}
                                  aria-label={`Edit hours for ${v.name}`}
                                  title="Edit hours"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min="0"
                                value={v.edit.hours}
                                onChange={(e) => setRow(v.id, { hours: e.target.value, manual: true })}
                                onBlur={(e) => {
                                  const t = tidy2(e.target.value);
                                  if (t !== e.target.value) setRow(v.id, { hours: t });
                                }}
                                onKeyDown={saveOnEnter(v)}
                                placeholder={v.hasClock ? fmtHours(v.clock!, 2) : "0.00"}
                                aria-label={`Hours worked by ${v.name}`}
                                aria-invalid={v.calc.errors.hours ? true : undefined}
                                aria-describedby={v.calc.errors.hours ? errId("hours") : undefined}
                                className="h-9 w-24 text-right tabular-nums"
                              />
                            )}
                            {v.calc.errors.hours ? (
                              <FieldError id={errId("hours")}>{v.calc.errors.hours}</FieldError>
                            ) : null}
                            {v.clockDiffers && !v.showClock && (
                              <button
                                type="button"
                                className="text-[11px] text-muted-foreground hover:text-foreground"
                                onClick={() => setRow(v.id, { hours: v.clock!.toFixed(2), manual: false })}
                                title="Replace with the hours from the time clock"
                              >
                                Clock says {fmtHours(v.clock!, 2)} ·{" "}
                                <span className="font-medium text-foreground underline underline-offset-2">Use clock</span>
                              </button>
                            )}
                            {v.overBy !== null && (
                              <span className="chip-warn" title={`${fmtHoursLabel(v.scheduled)} scheduled`}>
                                <AlertTriangle className="h-3 w-3" /> {fmtHoursLabel(v.overBy)} over schedule
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top py-3 text-right">
                          {v.calc.isFixed ? (
                            <div className="flex flex-col items-end gap-1">
                              <MoneyInput
                                value={v.edit.fixed ?? ""}
                                onChange={(val) => setRow(v.id, { fixed: val })}
                                label={`Set pay for ${v.name}`}
                                error={v.calc.errors.fixed}
                                errorId={errId("fixed")}
                                onKeyDown={saveOnEnter(v)}
                                className="w-32"
                                inputClassName="h-9 font-semibold"
                              />
                              {v.calc.errors.fixed ? (
                                <FieldError id={errId("fixed")}>{v.calc.errors.fixed}</FieldError>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex h-9 items-center justify-end font-semibold tabular-nums">
                              {fmtMoney(v.calc.gross)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top py-3 pr-4 sm:pr-5 text-right">
                          <div className="flex h-9 items-center justify-end">
                            <StatusCell
                              status={v.status}
                              liveWeek={liveWeek}
                              name={v.name}
                              onSave={() => void handleSaveOne(v)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
              {ready && rows.length > 0 && (
                <TableFooter className="bg-muted">
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="sticky left-0 z-10 bg-muted pl-4 sm:pl-5 font-semibold">Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtHours(totals.scheduled)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtHours(totals.hours, 2)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtMoney(totals.gross)}
                    </TableCell>
                    <TableCell className="pr-4 sm:pr-5 text-right text-xs font-normal text-muted-foreground">
                      {savedCount} of {payable.length} saved
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <PositionBreakdown items={positionItems} />

      {/* ---------- Commit bar: what will be saved, in plain words ---------- */}
      {ready && barTargets.length > 0 && (
        <div className="above-tabbar sticky z-40 px-1">
          <div
            role="region"
            aria-label="Unsaved payroll"
            className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl bg-popover/95 py-2.5 pl-4 pr-2.5 shadow-[var(--shadow-pop)] backdrop-blur sm:gap-4 sm:py-3 sm:pr-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {edited.length > 0 && !liveWeek && unsaved.length > 0
                  ? `${barTargets.length} rows to save for ${range}`
                  : edited.length > 0
                    ? `${edited.length} unsaved ${plural(edited.length, "change")}`
                    : `${unsaved.length} ${plural(unsaved.length, "person has", "people have")} hours not saved`}
              </p>
              <p className="hidden pl-4 text-xs text-muted-foreground sm:block">
                {edited.length > 0 && !liveWeek && unsaved.length > 0
                  ? `${edited.length} edited · ${unsaved.length} straight from the time clock`
                  : edited.length > 0
                    ? `Saves to payroll for ${range}`
                    : `From the time clock for ${range} — review, then save`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {edited.length > 0 && (
                <Button variant="ghost" size="sm" className="h-9 px-2.5" onClick={discardEdits} disabled={batch !== null}>
                  Discard<span className="hidden sm:inline">&nbsp;edits</span>
                </Button>
              )}
              <Button size="sm" className="h-9" onClick={() => void handleSaveAll()} disabled={batch !== null}>
                {batch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {batch
                  ? `Saving ${batch.done} of ${batch.total}…`
                  : `Save ${barTargets.length} ${plural(barTargets.length, "row")}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Export or share with unsaved rows: say so, offer to save first ---------- */}
      <AlertDialog open={askFor !== null} onOpenChange={(open) => !open && setAskFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {exportPending} {plural(exportPending, "row isn't", "rows aren't")} saved yet
            </AlertDialogTitle>
            <AlertDialogDescription>
              The spreadsheet shows exactly what's on screen. Save first so it matches payroll, or{" "}
              {askFor === "share" ? "share" : "export"} as is — unsaved rows are marked "Not saved"
              in a Status column.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const what = askFor ?? "export";
                setAskFor(null);
                void run(what);
              }}
            >
              {askFor === "share" ? "Share as is" : "Export as is"}
            </Button>
            <Button onClick={() => void saveThen(askFor ?? "export")}>
              <Save className="h-4 w-4" /> {askFor === "share" ? "Save and share" : "Save and export"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareDialog payload={shareDialog} onOpenChange={(open) => !open && setShareDialog(null)} />
    </div>
  );
}
