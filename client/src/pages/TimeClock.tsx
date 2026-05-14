import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  Trash2,
  Search,
} from "lucide-react";
import { fmtWeekRange, STORE_ABBR } from "@/lib/format";
import { toast } from "sonner";

// Pay period: Thursday → Wednesday. Anchor any date to its Thursday.
function startOfPayWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function endOfPayWeek(weekStart: Date): Date {
  const e = new Date(weekStart);
  e.setUTCDate(e.getUTCDate() + 7);
  return e;
}

function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Format a Date as a value usable by <input type="datetime-local"> in the user's local zone. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): Date {
  // datetime-local is interpreted in the user's local zone.
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

export default function TimeClock() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfPayWeek(new Date()),
  );
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editPunch, setEditPunch] = useState<PunchRow | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const scopeQ = trpc.meta.myScope.useQuery();
  const stores = scopeQ.data?.stores ?? [];
  const isAdmin = scopeQ.data?.isAdmin ?? false;

  const employeesQ = trpc.employees.list.useQuery(
    storeFilter === "all" ? undefined : { store: storeFilter as any },
  );
  const employees = employeesQ.data ?? [];

  const listQ = trpc.clock.list.useQuery({
    store: storeFilter === "all" ? undefined : (storeFilter as any),
    employeeId:
      employeeFilter === "all" ? undefined : Number(employeeFilter),
    startDate: weekStart,
    endDate: endOfPayWeek(weekStart),
    limit: 500,
  });

  const utils = trpc.useUtils();
  const refreshAll = () => {
    utils.clock.list.invalidate();
    utils.clock.weekHoursBulk.invalidate();
    utils.dashboard.summary.invalidate();
    utils.payroll.week.invalidate();
  };

  const filteredRows = useMemo(() => {
    const rows = (listQ.data ?? []) as PunchRow[];
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r.employeeName.toLowerCase().includes(q));
  }, [listQ.data, search]);

  const totals = useMemo(() => {
    let openCount = 0;
    let hours = 0;
    for (const r of filteredRows) {
      if (r.clockOutAt === null) openCount += 1;
      else if (r.durationHours) hours += r.durationHours;
    }
    return { openCount, hours, count: filteredRows.length };
  }, [filteredRows]);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            Time Clock
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Clock className="h-7 w-7" /> Punches & shifts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every clock-in and clock-out for the week. Add manual punches when
            someone forgets the kiosk, or edit times to fix mistakes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shiftWeek(-1)}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary" />
              {fmtWeekRange(weekStart)}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shiftWeek(1)}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add punch
          </Button>
        </div>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Punches this week
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {totals.count}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Hours logged
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {totals.hours.toFixed(1)} h
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              Currently clocked in
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums">
              {totals.openCount}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end md:flex-wrap gap-3">
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Store
            </Label>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {isAdmin ? "All stores" : "All my stores"}
                </SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Employee
            </Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Any employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any employee</SelectItem>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 flex-1 min-w-[200px]">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by employee name…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Punches</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      Loading punches…
                    </TableCell>
                  </TableRow>
                )}
                {!listQ.isLoading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      No punches for this filter.
                    </TableCell>
                  </TableRow>
                )}
                {filteredRows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.employeeName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {STORE_ABBR[p.storeLocation] ?? p.storeLocation}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDateTime(p.clockInAt)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {p.clockOutAt ? (
                        fmtDateTime(p.clockOutAt)
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 text-emerald-700 bg-emerald-50"
                        >
                          Clocked in
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtDuration(p.durationHours)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.source === "manual"
                            ? "border-amber-500/40 text-amber-700 bg-amber-50"
                            : "border-zinc-300 text-zinc-600 bg-zinc-50"
                        }
                      >
                        {p.source === "manual" ? "Manual" : "Kiosk"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-muted-foreground truncate">
                      {p.note ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditPunch(p)}
                          aria-label="Edit punch"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          onClick={() => setDeleteId(p.id)}
                          aria-label="Delete punch"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add punch dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <AddPunchDialog
          employees={employees as any[]}
          onClose={() => setAddOpen(false)}
          onSaved={refreshAll}
        />
      </Dialog>

      {/* Edit punch dialog */}
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

      {/* Delete confirm */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the punch from the time clock log. If it was the
              only punch for this shift, the hours will drop from any payroll
              entry that auto-pulls clock data.
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
  const [clockIn, setClockIn] = useState<string>(() => toLocalInput(new Date()));
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
                  {e.fullName} · {STORE_ABBR[e.storeLocation] ?? e.storeLocation}
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
              <span className="text-xs text-muted-foreground">(optional)</span>
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

  // If the punch reference changes (rare here, but defensive), re-seed inputs.
  useEffect(() => {
    setClockIn(toLocalInput(new Date(punch.clockInAt)));
    setClockOut(punch.clockOutAt ? toLocalInput(new Date(punch.clockOutAt)) : "");
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
              <span className="text-xs text-muted-foreground">(blank = still in)</span>
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
