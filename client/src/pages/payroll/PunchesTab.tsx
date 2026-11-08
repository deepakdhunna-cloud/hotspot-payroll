/**
 * Punches tab — clock-in/out log with manual add, edit and delete.
 *
 * Shares the active store filter with the rest of the Payroll page, but lets
 * the user widen the date range beyond the currently-displayed week so they
 * can review punches from previous months.
 */
import { useEffect, useMemo, useState } from "react";
import { consumeQueryFlag } from "@/lib/queryFlag";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Clock, Pencil, Plus, Trash2, Search, Timer } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { STORE_ABBR } from "@/lib/format";
import {
  fmtDuration,
  fromDateInput,
  shiftPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { toast } from "sonner";

// Punch times are intentionally LOCAL time (the kiosk records wall-clock
// time), so the datetime-local helpers below stay local — do not use the
// UTC-based payweek helpers for these.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): Date {
  return new Date(value);
}

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

export default function PunchesTab({
  weekStart,
  storeFilter,
}: {
  weekStart: Date;
  storeFilter: string;
}) {
  // Range mode lets users look back months. Default to the parent's week.
  const [rangeMode, setRangeMode] = useState<"week" | "range">("week");
  const [rangeStart, setRangeStart] = useState<Date>(weekStart);
  const [rangeEnd, setRangeEnd] = useState<Date>(shiftPayWeek(weekStart, 1));

  useEffect(() => {
    if (rangeMode === "week") {
      setRangeStart(weekStart);
      setRangeEnd(shiftPayWeek(weekStart, 1));
    }
  }, [weekStart, rangeMode]);

  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // Dashboard "Add a punch" shortcut lands here with ?add=1.
  useEffect(() => {
    if (consumeQueryFlag("add")) setAddOpen(true);
  }, []);
  const [editPunch, setEditPunch] = useState<PunchRow | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const settingsQ = trpc.settings.get.useQuery();

  const employeesQ = trpc.employees.list.useQuery(
    storeFilter === "all" ? undefined : { store: storeFilter as any },
  );
  const employees = employeesQ.data ?? [];

  const listQ = trpc.clock.list.useQuery({
    store: storeFilter === "all" ? undefined : (storeFilter as any),
    employeeId: employeeFilter === "all" ? undefined : Number(employeeFilter),
    startDate: rangeStart,
    endDate: rangeEnd,
    limit: 2000,
  });

  const utils = trpc.useUtils();
  const refreshAll = () => {
    utils.clock.list.invalidate();
    utils.clock.weekHoursBulk.invalidate();
    utils.dashboard.summary.invalidate();
    utils.payroll.week.invalidate();
    utils.payroll.range.invalidate();
  };

  const setAutoM = trpc.settings.setAutoClockOut.useMutation({
    onSuccess: (r) => {
      utils.settings.get.invalidate();
      if (r.hours) {
        toast.success(
          `Auto clock-out on — anyone still on the clock past ${r.hours}h gets clocked out at the limit and flagged for review.`,
        );
      } else {
        toast.success("Auto clock-out turned off.");
      }
      if (r.closedNow > 0) {
        toast.warning(
          `${r.closedNow} punch${r.closedNow === 1 ? " was" : "es were"} already over the limit and ${r.closedNow === 1 ? "was" : "were"} closed just now — review ${r.closedNow === 1 ? "it" : "them"} in the attention center.`,
        );
        refreshAll();
        utils.attention.list.invalidate();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredRows = useMemo(() => {
    const rowsAll = (listQ.data ?? []) as PunchRow[];
    if (!search.trim()) return rowsAll;
    const q = search.trim().toLowerCase();
    return rowsAll.filter((r) => r.employeeName.toLowerCase().includes(q));
  }, [listQ.data, search]);

  const totals = useMemo(() => {
    let openCount = 0;
    let hours = 0;
    for (const r of filteredRows) {
      if (r.clockOutAt === null) openCount += 1;
      else if (r.durationHours) hours += r.durationHours;
    }
    return { openCount, hours };
  }, [filteredRows]);

  // Span (days, inclusive) helps the user understand what they're looking at.
  const spanDays = Math.max(
    1,
    Math.round(
      (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24),
    ),
  );

  const multiStore = new Set(filteredRows.map((r) => r.storeLocation)).size > 1;
  const timeOf = (d: Date | string) =>
    new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-4">
      {/* Toolbar: find a punch, or add one */}
      <div className="surface-card p-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="relative md:flex-1 md:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            aria-label="Search punches by employee name"
            className="pl-9 h-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="h-9 w-full md:w-[200px]" aria-label="Employee">
              <SelectValue placeholder="Everyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {employees.map((e: any) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={rangeMode}
            onValueChange={(v) => setRangeMode(v as "week" | "range")}
          >
            <SelectTrigger className="h-9 w-full md:w-[150px]" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Selected week</SelectItem>
              <SelectItem value="range">Custom dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rangeMode === "range" && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
            <Input
              type="date"
              aria-label="From"
              value={toDateInput(rangeStart)}
              onChange={(e) => {
                if (!e.target.value) return;
                setRangeStart(fromDateInput(e.target.value));
              }}
              className="h-9 md:w-40"
            />
            <Input
              type="date"
              aria-label="To"
              value={toDateInput(new Date(rangeEnd.getTime() - 86_400_000))}
              onChange={(e) => {
                if (!e.target.value) return;
                // Make the end inclusive of the picked day.
                const d = fromDateInput(e.target.value);
                d.setUTCDate(d.getUTCDate() + 1);
                setRangeEnd(d);
              }}
              className="h-9 md:w-40"
            />
          </div>
        )}
        <Button onClick={() => setAddOpen(true)} className="h-9 md:ml-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Add punch
        </Button>
      </div>

      <Card className="surface-card border-0 gap-0 py-0 overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 sm:px-5 pt-4 pb-3 border-b border-border">
          <CardTitle className="section-title">Punches</CardTitle>
          <p className="text-sm text-muted-foreground tabular-nums">
            <span className="font-medium text-foreground">{totals.hours.toFixed(1)}h</span>{" "}
            over {spanDays} day{spanDays === 1 ? "" : "s"}
            {totals.openCount > 0 ? (
              <>
                {" · "}
                <span className="font-medium text-success">{totals.openCount} on the clock</span>
              </>
            ) : null}
          </p>
        </CardHeader>
        <CardContent className="px-0">
          {listQ.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <EmptyState
              icon={<Clock />}
              title="No punches here"
              hint="Try another week or person, or add a punch by hand."
            />
          ) : (
            dayGroups(filteredRows).map((g) => (
              <section key={g.key}>
                <header className="flex items-baseline justify-between bg-muted/50 px-4 sm:px-5 py-2 border-b border-border text-xs">
                  <span className="font-medium text-foreground">{g.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {g.rows.length} punch{g.rows.length === 1 ? "" : "es"} · {g.hours.toFixed(1)}h
                  </span>
                </header>
                <ul className="divide-y divide-border border-b border-border last:border-b-0">
                  {g.rows.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
                        <p className="truncate text-sm font-medium sm:w-48 sm:shrink-0">
                          {p.employeeName}
                          {multiStore ? (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              {STORE_ABBR[p.storeLocation] ?? p.storeLocation}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm tabular-nums text-muted-foreground sm:text-foreground">
                          {timeOf(p.clockInAt)} –{" "}
                          {p.clockOutAt ? (
                            <>
                              {timeOf(p.clockOutAt)}
                              {new Date(p.clockOutAt).toDateString() !==
                              new Date(p.clockInAt).toDateString() ? (
                                <span className="text-xs text-muted-foreground"> (next day)</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="chip-good">on the clock</span>
                          )}
                        </p>
                        {p.source === "manual" || p.note ? (
                          <p className="truncate text-xs text-muted-foreground sm:min-w-0 sm:flex-1">
                            {p.source === "manual" ? (
                              <span className="chip-neutral mr-1.5">
                                <Pencil className="h-3 w-3" /> by hand
                              </span>
                            ) : null}
                            {p.note ?? ""}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`w-14 text-right text-sm tabular-nums ${
                          p.clockOutAt ? "text-muted-foreground" : "text-success"
                        }`}
                      >
                        {fmtDuration(p.clockOutAt ? p.durationHours : runningHours(p))}
                      </span>
                      <div className="flex shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => setEditPunch(p)}
                          aria-label={`Edit ${p.employeeName}'s punch`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(p.id)}
                          aria-label={`Delete ${p.employeeName}'s punch`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      {/* Store-wide rule, set by the CEO; shown to managers so they know it */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <Timer className="h-4 w-4" />
        <span>Auto clock-out</span>
        {isAdmin ? (
          <Select
            value={String(settingsQ.data?.autoClockOutHours ?? 0)}
            onValueChange={(v) => setAutoM.mutate({ hours: Number(v) })}
            disabled={setAutoM.isPending || settingsQ.isLoading}
          >
            <SelectTrigger
              className="h-8 w-[130px] bg-card"
              title="Anyone still on the clock past this many hours is clocked out at the limit and flagged for review. Pick a limit longer than your longest real shift."
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              {[8, 10, 12, 14, 16, 18, 20, 24].map((h) => (
                <SelectItem key={h} value={String(h)}>
                  After {h}h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium text-foreground">
            {settingsQ.data?.autoClockOutHours
              ? `after ${settingsQ.data.autoClockOutHours}h`
              : "off"}
          </span>
        )}
        <span className="text-xs">
          {isAdmin
            ? "Forgotten punches close at the limit and land in Needs attention."
            : "Set by the CEO account."}
        </span>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <AddPunchDialog
          employees={employees as any[]}
          onClose={() => setAddOpen(false)}
          onSaved={refreshAll}
        />
      </Dialog>

      <Dialog
        open={editPunch !== null}
        onOpenChange={(o) => !o && setEditPunch(null)}
      >
        {editPunch && (
          <EditPunchDialog
            punch={editPunch}
            onClose={() => setEditPunch(null)}
            onSaved={refreshAll}
          />
        )}
      </Dialog>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the punch from the time clock log. If it was the only
              punch for this shift, the hours will drop from any payroll entry
              that auto-pulls clock data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DeletePunchAction
              id={deleteId}
              onDone={() => {
                setDeleteId(null);
                refreshAll();
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeletePunchAction({
  id,
  onDone,
}: {
  id: number | null;
  onDone: () => void;
}) {
  const del = trpc.clock.delete.useMutation({
    onSuccess: () => {
      toast.success("Punch deleted.");
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <AlertDialogAction
      disabled={del.isPending || id === null}
      onClick={() => {
        if (id !== null) del.mutate({ id });
      }}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      {del.isPending ? "Deleting…" : "Delete"}
    </AlertDialogAction>
  );
}

function AddPunchDialog({
  employees,
  onClose,
  onSaved,
}: {
  employees: { id: number; fullName: string; storeLocation: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState<string>("");
  const [clockIn, setClockIn] = useState<string>(() =>
    toLocalInput(new Date()),
  );
  const [clockOut, setClockOut] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const create = trpc.clock.createManual.useMutation({
    onSuccess: () => {
      toast.success("Manual punch added.");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!employeeId) {
      toast.error("Pick an employee first.");
      return;
    }
    if (!clockIn) {
      toast.error("Clock-in time is required.");
      return;
    }
    const inDate = fromLocalInput(clockIn);
    const outDate = clockOut ? fromLocalInput(clockOut) : undefined;
    if (outDate && outDate.getTime() <= inDate.getTime()) {
      toast.error("Clock-out must be after clock-in.");
      return;
    }
    create.mutate({
      employeeId: Number(employeeId),
      clockInAt: inDate,
      clockOutAt: outDate,
      note: note.trim() ? note.trim() : undefined,
    });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add manual punch</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label>Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick an employee" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName} ·{" "}
                  {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Clock in</Label>
            <Input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>
              Clock out{" "}
              <span className="text-xs text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for manual entry, e.g. forgot to clock in"
            rows={2}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Save punch"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditPunchDialog({
  punch,
  onClose,
  onSaved,
}: {
  punch: PunchRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clockIn, setClockIn] = useState<string>(() =>
    toLocalInput(new Date(punch.clockInAt)),
  );
  const [clockOut, setClockOut] = useState<string>(() =>
    punch.clockOutAt ? toLocalInput(new Date(punch.clockOutAt)) : "",
  );
  const [note, setNote] = useState<string>(punch.note ?? "");

  useEffect(() => {
    setClockIn(toLocalInput(new Date(punch.clockInAt)));
    setClockOut(
      punch.clockOutAt ? toLocalInput(new Date(punch.clockOutAt)) : "",
    );
    setNote(punch.note ?? "");
  }, [punch.id]);

  const update = trpc.clock.update.useMutation({
    onSuccess: () => {
      toast.success("Punch updated.");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const inDate = fromLocalInput(clockIn);
    const outDate = clockOut ? fromLocalInput(clockOut) : null;
    if (outDate && outDate.getTime() <= inDate.getTime()) {
      toast.error("Clock-out must be after clock-in.");
      return;
    }
    update.mutate({
      id: punch.id,
      clockInAt: inDate,
      clockOutAt: outDate,
      note: note.trim() ? note.trim() : null,
    });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Edit punch · {punch.employeeName}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Clock in</Label>
            <Input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>
              Clock out{" "}
              <span className="text-xs text-muted-foreground">
                (blank = still in)
              </span>
            </Label>
            <Input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            rows={2}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}


/** Group punches (newest first) by the local day they started on. */
function dayGroups(rows: PunchRow[]) {
  const groups: { key: string; label: string; rows: PunchRow[]; hours: number }[] = [];
  for (const r of rows) {
    const d = new Date(r.clockInAt);
    const key = d.toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = {
        key,
        label: d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        }),
        rows: [],
        hours: 0,
      };
      groups.push(g);
    }
    g.rows.push(r);
    g.hours += r.clockOutAt ? (r.durationHours ?? 0) : runningHours(r);
  }
  return groups;
}

/** Hours so far on a punch that's still open. */
function runningHours(r: PunchRow) {
  return Math.max(0, (Date.now() - new Date(r.clockInAt).getTime()) / 3_600_000);
}
