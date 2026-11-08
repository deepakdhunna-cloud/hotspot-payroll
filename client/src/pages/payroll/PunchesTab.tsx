/**
 * Punches tab — the time-clock log: review a pay week (or any dates), add a
 * missed punch, fix or delete one.
 *
 * Every time here is STORE time (America/Chicago). A week's punch window is
 * Thursday 00:00 → next Thursday 00:00 in Chicago, rows group by the store
 * day they started on, and the add/edit fields are typed in store time — so
 * a Wednesday-night closer lands in the week they worked, whatever device is
 * looking.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryFlag } from "@/lib/queryFlag";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarX,
  Clock,
  Pencil,
  Plus,
  Search,
  Timer,
  Trash2,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { BlockState } from "@/components/QueryStates";
import { STORE_ABBR, fmtHoursLabel, fmtWeekRange } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import {
  fmtDayHeading,
  fmtDuration,
  fmtTime,
  fromStoreInput,
  payWeekBounds,
  storeDayKey,
  storeTzLabel,
  toDateInput,
} from "@/lib/payweek";
import {
  FUTURE_TOLERANCE_MS,
  FormAlert,
  LONG_SHIFT_HOURS,
  StoreDateTimeField,
  WARN_TEXT,
  addDays,
  fmtShortDay,
  joinStoreTime,
  splitStoreTime,
  useNow,
} from "@/components/PunchQuickActions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Newest punches fetched per view; a full page gets a "narrow the dates" notice. */
const PUNCH_LIMIT = 2000;
/** The marker the auto clock-out sweep writes into a punch's note. */
const AUTO_NOTE_RE = /\s*(?:·\s*)?Auto clock-out at the (\d+)h limit/;

type PunchRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  storeLocation: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  source: "kiosk" | "manual";
  note: string | null;
  durationHours: number | null;
};

type EmployeeOption = {
  id: number;
  fullName: string;
  storeLocation: string;
  active?: number | boolean | null;
};

const isFormer = (e: EmployeeOption) => e.active === 0 || e.active === false;

/** "Nov 5" for a store-local "YYYY-MM-DD" day (with the year when it isn't this year's). */
function fmtDayShort(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** Split a punch note into the auto clock-out marker and the human part. */
function splitNote(note: string | null): {
  autoLimit: number | null;
  text: string;
} {
  if (!note) return { autoLimit: null, text: "" };
  const m = AUTO_NOTE_RE.exec(note);
  if (!m) return { autoLimit: null, text: note.trim() };
  const text = note
    .replace(AUTO_NOTE_RE, "")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
  return { autoLimit: Number(m[1]), text };
}

export default function PunchesTab({
  weekStart,
  storeFilter,
  onRangeModeChange,
}: {
  weekStart: Date;
  storeFilter: string;
  /**
   * Called with `true` when the tab switches to custom dates (the page's
   * week picker no longer applies) and `false` when it returns to the pay
   * week or the tab goes away.
   */
  onRangeModeChange?: (on: boolean) => void;
}) {
  const tz = storeTzLabel();
  const today = storeDayKey(new Date());
  const weekMs = weekStart.getTime();
  const weekDay = toDateInput(weekStart);

  // Range mode looks back months; it starts from the week on screen.
  const [rangeMode, setRangeMode] = useState<"week" | "range">("week");
  const [fromDay, setFromDay] = useState(weekDay);
  const [toDay, setToDay] = useState(() => addDays(weekDay, 6));
  useEffect(() => {
    if (rangeMode === "week") {
      setFromDay(weekDay);
      setToDay(addDays(weekDay, 6));
    }
  }, [weekDay, rangeMode]);

  // The page's week picker only applies in pay-week mode.
  const rangeCb = useRef(onRangeModeChange);
  rangeCb.current = onRangeModeChange;
  useEffect(() => {
    rangeCb.current?.(rangeMode === "range");
  }, [rangeMode]);
  useEffect(() => () => rangeCb.current?.(false), []);

  const rangeInvalid =
    rangeMode === "range" && (!fromDay || !toDay || toDay < fromDay);
  // Real store-time instants: Thursday 00:00 → next Thursday 00:00 in
  // Chicago for a week; From 00:00 → the day after To, for custom dates.
  const bounds = useMemo(() => {
    if (rangeMode === "week") return payWeekBounds(new Date(weekMs));
    if (!fromDay || !toDay || toDay < fromDay) return null;
    const start = fromStoreInput(`${fromDay}T00:00`);
    const end = fromStoreInput(`${addDays(toDay, 1)}T00:00`);
    return start && end ? { start, end } : null;
  }, [rangeMode, weekMs, fromDay, toDay]);

  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  // Someone picked under one store means nothing under another.
  useEffect(() => {
    setEmployeeFilter("all");
  }, [storeFilter]);
  const [search, setSearch] = useState("");

  // The add form mounts only while open, so every open starts fresh.
  const [addOpen, setAddOpen] = useState(false);
  const openAdd = () => setAddOpen(true);
  // Dashboard "Add a punch" shortcut lands here with ?add=1.
  useQueryFlag("add", openAdd);
  const [editPunch, setEditPunch] = useState<PunchRow | null>(null);
  const [deletePunch, setDeletePunch] = useState<PunchRow | null>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const settingsQ = trpc.settings.get.useQuery();

  // Former employees stay pickable: their old punches are still here, and
  // a final shift may still need adding.
  const employeesQ = trpc.employees.list.useQuery({
    ...(storeFilter === "all" ? {} : { store: storeFilter as any }),
    includeInactive: true,
  });
  const employees = (employeesQ.data ?? []) as EmployeeOption[];
  useEffect(() => {
    if (
      employeeFilter !== "all" &&
      employeesQ.data &&
      !employeesQ.data.some(e => String(e.id) === employeeFilter)
    ) {
      setEmployeeFilter("all");
    }
  }, [employeesQ.data, employeeFilter]);

  const listQ = trpc.clock.list.useQuery(
    {
      store: storeFilter === "all" ? undefined : (storeFilter as any),
      employeeId: employeeFilter === "all" ? undefined : Number(employeeFilter),
      startDate: bounds?.start,
      endDate: bounds?.end,
      limit: PUNCH_LIMIT,
    },
    { enabled: bounds !== null }
  );

  const utils = trpc.useUtils();
  const refreshAll = () => {
    utils.clock.list.invalidate();
    utils.clock.weekHoursBulk.invalidate();
    utils.dashboard.summary.invalidate();
    utils.payroll.week.invalidate();
    utils.payroll.range.invalidate();
    utils.attention.list.invalidate();
  };

  const setAutoM = trpc.settings.setAutoClockOut.useMutation({
    onSuccess: r => {
      utils.settings.get.invalidate();
      if (r.hours) {
        toast.success(
          `Auto clock-out on — anyone still on the clock past ${r.hours}h gets clocked out at the limit and flagged for review.`
        );
      } else {
        toast.success("Auto clock-out turned off.");
      }
      if (r.closedNow > 0) {
        toast.warning(
          `${r.closedNow} punch${r.closedNow === 1 ? " was" : "es were"} already over the limit and ${r.closedNow === 1 ? "was" : "were"} closed just now — review ${r.closedNow === 1 ? "it" : "them"} in Needs attention.`
        );
        refreshAll();
      }
    },
    onError: e => toast.error(errorMessage(e)),
  });

  const rowsAll = (listQ.data ?? []) as PunchRow[];
  const truncated = rowsAll.length >= PUNCH_LIMIT;
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rowsAll;
    const q = search.trim().toLowerCase();
    return rowsAll.filter(r => r.employeeName.toLowerCase().includes(q));
  }, [rowsAll, search]);

  // Open punches show running time, so re-render once a minute while any
  // are on screen; otherwise a page left open freezes at its first render.
  const hasOpen = filteredRows.some(r => r.clockOutAt === null);
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    if (!hasOpen) return;
    const id = window.setInterval(() => setMinuteTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [hasOpen]);

  // Same accounting as the per-day totals below: open punches count their
  // running time, so the header and the day headers always agree.
  const totals = useMemo(() => {
    let openCount = 0;
    let hours = 0;
    for (const r of filteredRows) {
      if (r.clockOutAt === null) {
        openCount += 1;
        hours += runningHours(r);
      } else if (r.durationHours) {
        hours += r.durationHours;
      }
    }
    return { openCount, hours };
    // minuteTick: recompute running time each minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, minuteTick]);
  const groups = useMemo(
    () => dayGroups(filteredRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRows, minuteTick]
  );

  const spanDays =
    Math.round(
      (new Date(`${toDay}T00:00:00Z`).getTime() -
        new Date(`${fromDay}T00:00:00Z`).getTime()) /
        86_400_000
    ) + 1;
  const scopeLabel =
    rangeMode === "week"
      ? fmtWeekRange(weekStart)
      : rangeInvalid
        ? "Custom dates"
        : `${fmtDayShort(fromDay)} – ${fmtDayShort(toDay)} · ${spanDays} day${spanDays === 1 ? "" : "s"}`;

  const multiStore = new Set(filteredRows.map(r => r.storeLocation)).size > 1;
  const filteredName = employees.find(
    e => String(e.id) === employeeFilter
  )?.fullName;
  const query = search.trim();
  const where =
    rangeMode === "week" ? `in ${fmtWeekRange(weekStart)}` : "in these dates";
  const emptyTitle = query
    ? `No punches match “${query}”`
    : filteredName
      ? `${filteredName} has no punches ${where}`
      : `No punches ${where}`;
  const emptyHint = query
    ? "Check the spelling, or clear the search."
    : rangeMode === "week"
      ? "Punches show up here as people clock in at the time clock. Missed one? Add it by hand."
      : "Try wider dates, or add a punch by hand.";

  const activeOptions = employees.filter(e => !isFormer(e));
  const formerOptions = employees.filter(isFormer);

  return (
    <div className="space-y-4">
      {/* Toolbar: find punches, or add one */}
      <div className="surface-card p-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="relative md:flex-1 md:min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name"
            aria-label="Search punches by employee name"
            className="pl-9 h-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger
              className="h-9 w-full md:w-[200px]"
              aria-label="Employee"
            >
              <SelectValue placeholder="Everyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {activeOptions.map(e => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
              {formerOptions.length > 0 ? (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Former employees</SelectLabel>
                    {formerOptions.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.fullName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              ) : null}
            </SelectContent>
          </Select>
          <Select
            value={rangeMode}
            onValueChange={v => setRangeMode(v as "week" | "range")}
          >
            <SelectTrigger
              className="h-9 w-full md:w-[150px]"
              aria-label="Dates"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Pay week</SelectItem>
              <SelectItem value="range">Custom dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Last on phones (after any date fields), right-aligned on desktop. */}
        <Button
          onClick={openAdd}
          className="h-9 order-last md:order-none md:ml-auto"
        >
          <Plus className="h-4 w-4 mr-1.5" aria-hidden /> Add punch
        </Button>
        {rangeMode === "range" ? (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 md:basis-full md:flex md:flex-wrap md:items-end md:gap-3 md:pt-1">
            <div className="grid gap-1">
              <Label
                htmlFor="punch-from"
                className="text-xs text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="punch-from"
                type="date"
                value={fromDay}
                max={today}
                onChange={e => setFromDay(e.target.value)}
                className="h-9 md:w-44 tabular-nums"
              />
            </div>
            <div className="grid gap-1">
              <Label
                htmlFor="punch-to"
                className="text-xs text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="punch-to"
                type="date"
                value={toDay}
                min={fromDay || undefined}
                max={today}
                onChange={e => setToDay(e.target.value)}
                aria-invalid={rangeInvalid || undefined}
                className="h-9 md:w-44 tabular-nums"
              />
            </div>
            {rangeInvalid ? (
              <p
                role="alert"
                className="col-span-2 text-sm font-medium text-destructive md:self-center md:pb-2"
              >
                {!fromDay || !toDay
                  ? "Pick both dates."
                  : "The To date is before the From date."}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Card className="surface-card gap-0 py-0 overflow-hidden">
        <CardHeader className="card-head flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-5 py-3">
          <div className="min-w-0">
            <CardTitle className="section-title">
              <span className="icon-badge icon-badge-sm">
                <Clock />
              </span>
              Punches
            </CardTitle>
            <p className="mt-0.5 pl-9 text-xs text-muted-foreground tabular-nums">
              {scopeLabel} · times in {tz}
            </p>
          </div>
          {listQ.data && !rangeInvalid ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
              <span>
                <span className="font-semibold text-foreground">
                  {fmtHoursLabel(totals.hours)}
                </span>{" "}
                <span className="text-muted-foreground">clocked</span>
              </span>
              <span className="text-muted-foreground">
                {filteredRows.length.toLocaleString("en-US")} punch
                {filteredRows.length === 1 ? "" : "es"}
              </span>
              {totals.openCount > 0 ? (
                <span className="chip-good">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-current"
                    aria-hidden
                  />
                  {totals.openCount} on the clock
                </span>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {truncated && !query ? (
            <p
              role="status"
              className="callout-warn mx-4 sm:mx-5 mt-3 rounded-lg px-3 py-2 text-sm"
            >
              Showing the newest {PUNCH_LIMIT.toLocaleString("en-US")} punches
              only — the total above leaves out older ones. Narrow the dates or
              pick one person to see everything.
            </p>
          ) : null}
          {rangeInvalid ? (
            <EmptyState
              icon={<CalendarX />}
              title="Fix the dates to see punches"
              hint="The To date needs to be on or after the From date."
            />
          ) : listQ.isLoading || listQ.isError ? (
            <div className="p-4 sm:p-5">
              <BlockState
                isLoading={listQ.isLoading}
                isError={listQ.isError}
                onRetry={() => listQ.refetch()}
                skeletonClassName="h-48 rounded-lg"
              >
                {null}
              </BlockState>
            </div>
          ) : filteredRows.length === 0 ? (
            <EmptyState
              icon={<Clock />}
              title={emptyTitle}
              hint={emptyHint}
              action={
                query ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSearch("")}
                  >
                    Clear search
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={openAdd}>
                    <Plus className="h-4 w-4" aria-hidden /> Add punch
                  </Button>
                )
              }
            />
          ) : (
            groups.map(g => (
              <section
                key={g.key}
                aria-label={g.label}
                className="[&:last-child>ul]:border-b-0"
              >
                <header className="flex items-baseline justify-between gap-3 bg-muted/70 px-4 sm:px-5 py-2 border-b border-border text-xs">
                  <h3 className="font-semibold text-foreground">{g.label}</h3>
                  <span className="text-muted-foreground tabular-nums">
                    {g.rows.length} punch{g.rows.length === 1 ? "" : "es"} ·{" "}
                    {fmtHoursLabel(g.hours)}
                  </span>
                </header>
                <ul className="divide-y divide-border border-b border-border">
                  {g.rows.map(p => (
                    <PunchListItem
                      key={p.id}
                      punch={p}
                      showStore={multiStore}
                      onEdit={() => setEditPunch(p)}
                      onDelete={() => setDeletePunch(p)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      {/* Store-wide rule, set by the CEO; shown to managers so they know it */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-sm text-muted-foreground">
        <Timer className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">Auto clock-out</span>
        {isAdmin ? (
          <Select
            value={String(settingsQ.data?.autoClockOutHours ?? 0)}
            onValueChange={v => setAutoM.mutate({ hours: Number(v) })}
            disabled={setAutoM.isPending || settingsQ.isLoading}
          >
            <SelectTrigger
              className="h-9 w-[140px] bg-card"
              aria-label="Auto clock-out limit"
              title="Anyone still on the clock past this many hours is clocked out at the limit and flagged for review. Pick a limit longer than your longest real shift."
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              {[8, 10, 12, 14, 16, 18, 20, 24].map(h => (
                <SelectItem key={h} value={String(h)}>
                  After {h}h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : settingsQ.data ? (
          <span className="chip-neutral">
            {settingsQ.data.autoClockOutHours
              ? `After ${settingsQ.data.autoClockOutHours}h`
              : "Off"}
          </span>
        ) : null}
        <span className="text-xs">
          {isAdmin
            ? "Forgotten punches close at the limit and land in Needs attention."
            : "Set by the CEO account. Forgotten punches close at the limit and land in Needs attention."}
        </span>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        {addOpen ? (
          <PunchFormDialog
            mode="add"
            employees={employees}
            defaultEmployeeId={
              employeeFilter !== "all" &&
              activeOptions.some(e => String(e.id) === employeeFilter)
                ? employeeFilter
                : ""
            }
            onClose={() => setAddOpen(false)}
            onSaved={() => {
              setAddOpen(false);
              refreshAll();
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={editPunch !== null}
        onOpenChange={o => !o && setEditPunch(null)}
      >
        {editPunch ? (
          <PunchFormDialog
            key={editPunch.id}
            mode="edit"
            punch={editPunch}
            onClose={() => setEditPunch(null)}
            onSaved={() => {
              setEditPunch(null);
              refreshAll();
            }}
          />
        ) : null}
      </Dialog>

      <DeletePunchDialog
        punch={deletePunch}
        onClose={() => setDeletePunch(null)}
        onDeleted={() => {
          setDeletePunch(null);
          refreshAll();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One row                                                             */
/* ------------------------------------------------------------------ */

function PunchListItem({
  punch: p,
  showStore,
  onEdit,
  onDelete,
}: {
  punch: PunchRow;
  showStore: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const open = p.clockOutAt === null;
  const nextDay =
    !!p.clockOutAt && storeDayKey(p.clockOutAt) !== storeDayKey(p.clockInAt);
  const { autoLimit, text: noteText } = splitNote(p.note);
  const when = `${fmtShortDay(p.clockInAt)} ${fmtTime(p.clockInAt)}`;
  return (
    <li className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <p className="truncate text-sm font-medium sm:w-48 sm:shrink-0">
          {p.employeeName}
          {showStore ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {STORE_ABBR[p.storeLocation] ?? p.storeLocation}
            </span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums text-muted-foreground sm:text-foreground sm:w-56 sm:shrink-0">
          <span className="whitespace-nowrap">
            {fmtTime(p.clockInAt)} –
            {p.clockOutAt ? ` ${fmtTime(p.clockOutAt)}` : ""}
          </span>
          {nextDay ? (
            <span className="text-xs text-muted-foreground">next day</span>
          ) : null}
          {open ? (
            <>
              {/* Phones: "10:54 AM – now" keeps the row to two lines. */}
              <span className="font-medium text-success sm:hidden">now</span>
              <span className="chip-good hidden sm:inline-flex">
                On the clock
              </span>
            </>
          ) : null}
        </p>
        {p.source === "manual" || autoLimit !== null || noteText ? (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:mt-0 sm:flex-1">
            {p.source === "manual" ? (
              <span
                className="chip-neutral"
                title="Added or entered by a manager, not the time clock"
              >
                <Pencil className="h-3 w-3" aria-hidden /> By hand
              </span>
            ) : null}
            {autoLimit !== null ? (
              <span
                className="chip-warn"
                title={`Nobody clocked out, so the ${autoLimit}h auto clock-out limit closed this punch`}
              >
                <Timer className="h-3 w-3" aria-hidden /> Auto clock-out
              </span>
            ) : null}
            {noteText ? (
              <span className="truncate" title={noteText}>
                {noteText}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <span
        className={cn(
          "w-[4.5rem] shrink-0 whitespace-nowrap text-right text-sm tabular-nums",
          open ? "font-medium text-success" : "text-muted-foreground"
        )}
      >
        {fmtDuration(open ? runningHours(p) : p.durationHours)}
      </span>
      <div className="flex shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground"
          onClick={onEdit}
          aria-label={`Edit ${p.employeeName}'s punch, ${when}`}
          title="Edit punch"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete ${p.employeeName}'s punch, ${when}`}
          title="Delete punch"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

function DeletePunchDialog({
  punch,
  onClose,
  onDeleted,
}: {
  punch: PunchRow | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // Keep the last punch on screen while the dialog animates closed.
  const last = useRef<PunchRow | null>(punch);
  if (punch) last.current = punch;
  const p = punch ?? last.current;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [punch?.id]);
  const del = trpc.clock.delete.useMutation();
  if (!p) return null;

  const open = p.clockOutAt === null;
  const hours = open ? runningHours(p) : p.durationHours;
  return (
    <AlertDialog
      open={punch !== null}
      onOpenChange={o => {
        if (!o && !del.isPending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {p.employeeName}&apos;s punch?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground tabular-nums">
                <span className="block font-medium">
                  {fmtDayHeading(p.clockInAt)}
                </span>
                {fmtTime(p.clockInAt)} –{" "}
                {p.clockOutAt ? fmtTime(p.clockOutAt) : "still on the clock"} ·{" "}
                {fmtDuration(hours)}
              </p>
              <p>
                Its hours come off the clock totals. If that week&apos;s payroll
                is already saved, re-save it so the change carries over. This
                can&apos;t be undone.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(
                { id: p.id },
                {
                  onSuccess: () => {
                    toast.success(`Deleted ${p.employeeName}'s punch.`);
                    onDeleted();
                  },
                  onError: e => setError(errorMessage(e)),
                }
              )
            }
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {del.isPending ? "Deleting…" : "Delete punch"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Add / edit                                                          */
/* ------------------------------------------------------------------ */

type FormProps =
  | {
      mode: "add";
      employees: EmployeeOption[];
      defaultEmployeeId?: string;
      onClose: () => void;
      onSaved: () => void;
    }
  | {
      mode: "edit";
      punch: PunchRow;
      onClose: () => void;
      onSaved: () => void;
    };

/**
 * One form for adding and editing a punch. It mounts fresh on every open,
 * so it never shows a previous punch's values. Clock-out's date follows clock-in (and rolls
 * to the next day for an overnight shift) until it is changed by hand.
 */
function PunchFormDialog(props: FormProps) {
  const punch = props.mode === "edit" ? props.punch : null;
  const now = useNow(true, 30_000);
  const today = storeDayKey(now);

  const [init] = useState(() => {
    if (punch) {
      const i = splitStoreTime(punch.clockInAt);
      const o = punch.clockOutAt ? splitStoreTime(punch.clockOutAt) : null;
      return {
        employeeId: String(punch.employeeId),
        inDay: i.day,
        inTime: i.time,
        outDay: o?.day ?? "",
        outTime: o?.time ?? "",
        stillOn: !punch.clockOutAt,
        note: punch.note ?? "",
      };
    }
    return {
      employeeId: props.mode === "add" ? (props.defaultEmployeeId ?? "") : "",
      inDay: storeDayKey(new Date()),
      inTime: "",
      outDay: "",
      outTime: "",
      stillOn: false,
      note: "",
    };
  });
  const [employeeId, setEmployeeId] = useState(init.employeeId);
  const [inDay, setInDay] = useState(init.inDay);
  const [inTime, setInTime] = useState(init.inTime);
  const [outDay, setOutDay] = useState(init.outDay);
  const [outTime, setOutTime] = useState(init.outTime);
  const [stillOn, setStillOn] = useState(init.stillOn);
  const [note, setNote] = useState(init.note);
  // An existing punch whose clock-out date isn't what the auto rule would
  // pick (a multi-day punch) keeps its explicit date.
  const [outDayTouched, setOutDayTouched] = useState(() => {
    if (!init.outDay) return false;
    const auto =
      init.outTime <= init.inTime ? addDays(init.inDay, 1) : init.inDay;
    return init.outDay !== auto;
  });
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const clear = () => setServerError(null);

  const create = trpc.clock.createManual.useMutation();
  const update = trpc.clock.update.useMutation();
  const pending = create.isPending || update.isPending;

  const autoOutDay =
    inDay && inTime && outTime && outTime <= inTime ? addDays(inDay, 1) : inDay;
  const effOutDay = outDayTouched ? outDay : autoOutDay;
  const inAt = joinStoreTime(inDay, inTime);
  const outAt = stillOn ? null : joinStoreTime(effOutDay, outTime);
  const limit = now.getTime() + FUTURE_TOLERANCE_MS;

  // Problems, in the order a person fixes them. Empty fields only complain
  // after a save attempt; a filled-in but impossible time says so at once.
  const problems: {
    field: "employee" | "in" | "out";
    msg: string;
    filled: boolean;
  }[] = [];
  if (props.mode === "add" && !employeeId) {
    problems.push({
      field: "employee",
      msg: "Pick who this punch is for.",
      filled: false,
    });
  }
  if (!inAt) {
    problems.push({
      field: "in",
      msg: "Enter when they clocked in.",
      filled: false,
    });
  } else if (inAt.getTime() > limit) {
    problems.push({
      field: "in",
      msg: "Clock-in can't be in the future.",
      filled: true,
    });
  }
  if (!stillOn) {
    if (!outAt) {
      problems.push({
        field: "out",
        msg: "Enter when they clocked out, or switch on “Still on the clock”.",
        filled: false,
      });
    } else if (inAt && outAt.getTime() <= inAt.getTime()) {
      problems.push({
        field: "out",
        msg: "Clock-out must be after clock-in.",
        filled: true,
      });
    } else if (outAt.getTime() > limit) {
      problems.push({
        field: "out",
        msg: "Clock-out can't be in the future. If they're still working, switch on “Still on the clock”.",
        filled: true,
      });
    }
  }
  const visible = problems.filter(x => tried || x.filled);
  const bad = (f: "employee" | "in" | "out") =>
    visible.some(x => x.field === f);

  const hours =
    inAt && (stillOn || outAt)
      ? Math.max(0, ((outAt ?? now).getTime() - inAt.getTime()) / 3_600_000)
      : null;
  const long = hours !== null && hours > LONG_SHIFT_HOURS;

  const dirty =
    props.mode === "add" ||
    inDay !== init.inDay ||
    inTime !== init.inTime ||
    stillOn !== init.stillOn ||
    (!stillOn && (effOutDay !== init.outDay || outTime !== init.outTime)) ||
    note.trim() !== init.note.trim();

  const submit = () => {
    setTried(true);
    clear();
    if (problems.length > 0 || !inAt) return;
    const noteVal = note.trim();
    if (props.mode === "edit") {
      if (!dirty) {
        props.onClose();
        return;
      }
      update.mutate(
        {
          id: props.punch.id,
          clockInAt: inAt,
          clockOutAt: outAt,
          note: noteVal ? noteVal : null,
        },
        {
          onSuccess: () => {
            toast.success(`Updated ${props.punch.employeeName}'s punch.`);
            props.onSaved();
          },
          onError: e => setServerError(errorMessage(e)),
        }
      );
      return;
    }
    const emp = props.employees.find(e => String(e.id) === employeeId);
    create.mutate(
      {
        employeeId: Number(employeeId),
        clockInAt: inAt,
        clockOutAt: outAt ?? undefined,
        note: noteVal ? noteVal : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Punch added for ${emp?.fullName ?? "them"}.`);
          props.onSaved();
        },
        onError: e => setServerError(errorMessage(e)),
      }
    );
  };

  const employees = props.mode === "add" ? props.employees : [];
  const showStore = new Set(employees.map(e => e.storeLocation)).size > 1;
  const optionLabel = (e: EmployeeOption) =>
    showStore
      ? `${e.fullName} · ${STORE_ABBR[e.storeLocation] ?? e.storeLocation}`
      : e.fullName;
  const activeOptions = employees.filter(e => !isFormer(e));
  const formerOptions = employees.filter(isFormer);

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{punch ? "Edit punch" : "Add a punch"}</DialogTitle>
        <DialogDescription>
          {punch
            ? `${punch.employeeName} · ${punch.source === "manual" ? "added by hand" : "from the time clock"}. Changes are audit-logged.`
            : "For a shift the time clock missed. It counts toward their hours like any punch."}
        </DialogDescription>
      </DialogHeader>
      <form
        id="punch-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4 py-1"
      >
        {props.mode === "add" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="punch-employee">Employee</Label>
            <Select
              value={employeeId}
              onValueChange={v => {
                setEmployeeId(v);
                clear();
              }}
            >
              <SelectTrigger
                id="punch-employee"
                className="w-full"
                aria-invalid={bad("employee") || undefined}
              >
                <SelectValue placeholder="Pick an employee" />
              </SelectTrigger>
              <SelectContent>
                {activeOptions.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {optionLabel(e)}
                  </SelectItem>
                ))}
                {formerOptions.length > 0 ? (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Former employees</SelectLabel>
                      {formerOptions.map(e => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {optionLabel(e)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <StoreDateTimeField
          id="punch-in"
          label="Clock in"
          day={inDay}
          time={inTime}
          onDayChange={v => {
            setInDay(v);
            clear();
          }}
          onTimeChange={v => {
            setInTime(v);
            clear();
          }}
          maxDay={today}
          invalid={bad("in")}
        />

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <Label
            htmlFor="punch-still-on"
            className="flex flex-col items-start gap-0.5 font-normal"
          >
            <span className="text-sm font-medium">Still on the clock</span>
            <span className="text-xs text-muted-foreground">
              No clock-out yet — they&apos;ll clock out at the time clock.
            </span>
          </Label>
          <Switch
            id="punch-still-on"
            checked={stillOn}
            onCheckedChange={v => {
              setStillOn(v);
              clear();
            }}
          />
        </div>

        {!stillOn ? (
          <StoreDateTimeField
            id="punch-out"
            label="Clock out"
            day={effOutDay}
            time={outTime}
            onDayChange={v => {
              setOutDay(v);
              setOutDayTouched(true);
              clear();
            }}
            onTimeChange={v => {
              setOutTime(v);
              clear();
            }}
            maxDay={today}
            invalid={bad("out")}
          />
        ) : null}

        {hours !== null && visible.length === 0 ? (
          <p
            className={cn(
              "-mt-1 text-sm",
              long ? cn("font-medium", WARN_TEXT) : "text-muted-foreground"
            )}
          >
            {stillOn
              ? `On the clock since ${fmtTime(inAt!)} · ${fmtDuration(hours)} so far.`
              : long
                ? `That's a ${fmtDuration(hours)} shift — double-check the dates.`
                : `${fmtDuration(hours)} shift${
                    effOutDay !== inDay && outAt
                      ? ` · ends ${fmtShortDay(outAt)}`
                      : ""
                  }.`}
          </p>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="punch-note">
            Note{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="punch-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={
              punch
                ? "Why it changed, e.g. clocked out late"
                : "Why it was added, e.g. forgot to clock in"
            }
            rows={2}
            maxLength={500}
          />
        </div>

        {visible.length > 0 ? <FormAlert>{visible[0].msg}</FormAlert> : null}
        {serverError ? <FormAlert>{serverError}</FormAlert> : null}
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form="punch-form" disabled={pending}>
          {pending ? "Saving…" : punch ? "Save changes" : "Add punch"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Group punches (newest first) by the store-local day they started on. */
function dayGroups(rows: PunchRow[]) {
  const groups: {
    key: string;
    label: string;
    rows: PunchRow[];
    hours: number;
  }[] = [];
  for (const r of rows) {
    const key = storeDayKey(r.clockInAt);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: fmtDayHeading(r.clockInAt), rows: [], hours: 0 };
      groups.push(g);
    }
    g.rows.push(r);
    g.hours += r.clockOutAt ? (r.durationHours ?? 0) : runningHours(r);
  }
  return groups;
}

/** Hours so far on a punch that's still open. */
function runningHours(r: PunchRow) {
  return Math.max(
    0,
    (Date.now() - new Date(r.clockInAt).getTime()) / 3_600_000
  );
}
