import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { fmtHours, fmtMoney, fmtWeekRange } from "@/lib/format";
import {
  BUSINESS_TIME_ZONE,
  fmtDuration,
  fmtTime,
  toDateInput,
} from "@/lib/payweek";
import { errorMessage } from "@/lib/errors";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { InitialsBadge } from "@/components/InitialsBadge";
import { TableStateRows } from "@/components/QueryStates";
import {
  ClockOutDialog,
  FixTimeDialog,
  type QuickPunch,
} from "@/components/PunchQuickActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeleteEmployeeCopy } from "@/components/DeleteEmployeeCopy";
import {
  AlertTriangle,
  ArrowLeft,
  Pencil,
  Clock,
  LogOut,
  RotateCw,
  Trash2,
  KeyRound,
  UserCheck,
  UserX,
  Wallet,
  CalendarCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

/** Full employee record as returned by employees.get. */
type EmployeeRecord = inferRouterOutputs<AppRouter>["employees"]["get"];

/** Punches shown on the profile (the API caps the list at this many). */
const PUNCH_LIMIT = 50;
const PUNCH_PREVIEW = 10;

export default function EmployeeProfile() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = Number(params.id);
  // "/employees/abc" or "/employees/0" is not an employee — say so instead
  // of sitting on a disabled query forever.
  const invalidId = !Number.isInteger(id) || id <= 0;

  const empQ = trpc.employees.get.useQuery({ id }, { enabled: !invalidId });
  usePageTitle(empQ.data?.fullName ?? "Employee");
  const histQ = trpc.employees.history.useQuery({ id }, { enabled: !invalidId });
  const optionsQ = trpc.meta.options.useQuery();
  const scopeQ = trpc.meta.myScope.useQuery();
  const punchesQ = trpc.clock.list.useQuery(
    { employeeId: id, limit: PUNCH_LIMIT },
    { enabled: !invalidId },
  );

  if (invalidId || empQ.isError) {
    const code = (empQ.error as { data?: { code?: string } } | null)?.data?.code;
    const missing = invalidId || code === "NOT_FOUND" || code === "FORBIDDEN";
    return <ProfileUnavailable missing={missing} onRetry={() => empQ.refetch()} />;
  }

  const emp = empQ.data;
  const history = histQ.data ?? [];
  const isFormer = emp?.active === 0;

  const totalGross = history.reduce((acc, h) => acc + Number(h.grossPay), 0);
  const totalHours = history.reduce((acc, h) => acc + Number(h.hoursWorked), 0);
  // The band's history numbers wait for history — never a fake $0.00.
  const histValue = (v: ReactNode) =>
    histQ.isLoading ? (
      <Skeleton className="mt-1 h-7 w-20 bg-white/15" />
    ) : histQ.isError ? (
      "—"
    ) : (
      v
    );
  const histSub = histQ.isError ? "Couldn't load history" : "Last 52 saved weeks";

  return (
    <div className="space-y-5 md:space-y-6">
      <Link
        href="/employees"
        className="inline-flex h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>

      {empQ.isLoading && (
        <div className="space-y-4" role="status" aria-label="Loading employee">
          <Skeleton className="h-14 w-full max-w-md" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {emp && (
        <>
          <PageHeader
            title={
              <span className="flex items-center gap-3">
                <InitialsBadge name={emp.fullName} className="h-10 w-10 text-sm" />
                <span className="min-w-0 truncate">{emp.fullName}</span>
              </span>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="role-tag">{emp.role}</span>
                <span>{emp.storeLocation}</span>
                <span aria-hidden="true">·</span>
                <a href={`tel:${emp.phone}`} className="tabular-nums hover:text-foreground">
                  {emp.phone}
                </a>
                {isFormer ? <span className="chip-neutral">Former employee</span> : null}
              </span>
            }
            actions={
              <EditEmployeeButton
                emp={emp}
                roles={optionsQ.data?.roles ?? []}
                stores={scopeQ.data?.stores ?? []}
              />
            }
          />

          <KpiBand>
            <KpiCell
              hero
              icon={<Wallet />}
              label={emp.weeklyPay != null ? "Set weekly pay" : "Pay rate"}
              value={
                <>
                  <Money value={Number(emp.weeklyPay != null ? emp.weeklyPay : emp.payRate)} />
                  <span className="ml-0.5 text-base font-medium opacity-70">
                    {emp.weeklyPay != null ? "/wk" : "/hr"}
                  </span>
                </>
              }
              sub={
                emp.weeklyPay != null
                  ? `Same amount every week · ${fmtMoney(Number(emp.payRate))}/hr on file`
                  : "Hours × rate each week"
              }
            />
            <KpiCell
              hue="blue"
              icon={<Clock />}
              label="Hours paid"
              value={histValue(fmtHours(totalHours))}
              sub={histSub}
            />
            <KpiCell
              hue="green"
              icon={<Wallet />}
              label="Gross pay"
              value={histValue(<Money value={totalGross} />)}
              sub={histSub}
            />
            <KpiCell
              hue="teal"
              icon={<CalendarCheck />}
              label="Weeks paid"
              value={histValue(history.length)}
              sub={histQ.isError ? "Couldn't load history" : "Saved to payroll"}
            />
          </KpiBand>

          {isFormer ? <ReactivateBanner id={emp.id} name={emp.fullName} /> : null}

          {!isFormer ? (
            <ClockCodeCard
              employeeId={emp.id}
              employeeName={emp.fullName}
              hasCode={!!emp.clockCodeHash}
            />
          ) : null}

          <div className="grid gap-5 md:gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
            <Card className="surface-card gap-0 py-0">
              <CardHeader className="card-head px-4 sm:px-5 py-3">
                <CardTitle className="section-title">
                  <span className="icon-badge icon-badge-sm">
                    <Wallet />
                  </span>
                  Payroll history
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4 sm:pl-5">Week</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right pr-4 sm:pr-5">Gross</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableStateRows
                      colSpan={3}
                      skeletonRows={4}
                      isLoading={histQ.isLoading}
                      isError={histQ.isError}
                      onRetry={() => histQ.refetch()}
                      isEmpty={!histQ.isLoading && history.length === 0}
                      emptyTitle="No saved payroll yet"
                      emptyHint="Weeks show up here once their hours are saved in Payroll."
                    />
                    {history.map((h) => {
                      const scheduled = Number(h.scheduledHours);
                      const setPay = h.notes === "fixed-pay";
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="pl-4 sm:pl-5 font-medium">
                            <Link
                              href={`/payroll?week=${toDateInput(new Date(h.weekStart))}`}
                              className="hover:underline underline-offset-4"
                              title="Open this week in Payroll"
                            >
                              {fmtWeekRange(h.weekStart)}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtHours(Number(h.hoursWorked))}
                            {scheduled > 0 ? (
                              <span className="block text-xs text-muted-foreground">
                                of {fmtHours(scheduled)} scheduled
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium pr-4 sm:pr-5">
                            {fmtMoney(Number(h.grossPay))}
                            {setPay ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                Set pay
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <PunchHistoryCard
              isLoading={punchesQ.isLoading}
              isError={punchesQ.isError}
              onRetry={() => punchesQ.refetch()}
              punches={(punchesQ.data ?? []) as PunchRow[]}
              employeeName={emp.fullName}
            />
          </div>

          {/* Destructive action lives at the end of the page, away from the
              everyday controls. Deactivate (inside Edit) is the safe default
              for departures; Delete is for records created by mistake. */}
          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {isFormer ? (
                "Delete is only for records added by mistake — former employees can stay on file."
              ) : (
                <>
                  Left the team? Use{" "}
                  <span className="font-medium text-foreground">Edit → Deactivate</span> to keep
                  their payroll history. Delete is only for records added by mistake.
                </>
              )}
            </p>
            <DeleteEmployeeButton
              id={emp.id}
              name={emp.fullName}
              onDeleted={() => navigate("/employees")}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Not found (bad link, deleted, other store) vs. couldn't load (retry). */
function ProfileUnavailable({
  missing,
  onRetry,
}: {
  missing: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <div className="surface-card w-full max-w-md px-6 py-10 text-center sm:px-10">
        <span className="icon-badge icon-badge-lg mx-auto" aria-hidden="true">
          {missing ? <UserX /> : <AlertTriangle />}
        </span>
        <h1 className="page-title mt-5">
          {missing ? "Employee not found" : "Couldn't load this employee"}
        </h1>
        <p className="page-subtitle mx-auto">
          {missing
            ? "This link doesn't match anyone you can see. They may have been deleted, or they belong to another store."
            : "Check the connection, then try again."}
        </p>
        <div className="mt-8 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          {missing ? null : (
            <Button variant="outline" onClick={onRetry}>
              <RotateCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          )}
          <Button asChild>
            <Link href="/employees">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to employees
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClockCodeCard({
  employeeId,
  employeeName,
  hasCode,
}: {
  employeeId: number;
  employeeName: string;
  hasCode: boolean;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Every code change ripples to the roster chips, the header count and the
  // "missing clock codes" attention item.
  const refresh = () => {
    utils.employees.get.invalidate({ id: employeeId });
    utils.employees.list.invalidate();
    utils.attention.list.invalidate();
  };
  const setCodeM = trpc.clock.setCode.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.cleared
          ? `Clock code cleared for ${employeeName}.`
          : `Clock code saved for ${employeeName}.`,
      );
      refresh();
      setOpen(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const clearM = trpc.clock.setCode.useMutation({
    onSuccess: () => {
      toast.success(`Clock code cleared for ${employeeName}.`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onOpenChange = (next: boolean) => {
    // A fresh, empty field every time — a half-typed code never lingers.
    if (next) {
      setCode("");
      setError(null);
    }
    setOpen(next);
  };

  const submit = () => {
    if (!/^\d{4}$/.test(code)) {
      setError("Enter exactly 4 digits.");
      return;
    }
    setError(null);
    setCodeM.mutate({ employeeId, code });
  };

  return (
    <div
      className={`${hasCode ? "surface-card" : "callout-warn rounded-xl"} flex flex-col gap-3 px-4 sm:px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between`}
    >
      <div className="flex items-center gap-3">
        <span className="icon-badge">
          <KeyRound />
        </span>
        <div>
          <p className={`text-sm font-medium ${hasCode ? "" : "callout-title"}`}>
            {hasCode ? "Time clock code is set" : "No time clock code yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasCode
              ? "They clock in and out with it at the time clock. Codes stay hidden once saved."
              : "Set a 4-digit code so they can clock in at the time clock."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-12 sm:pl-0">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9 sm:h-8" variant={hasCode ? "outline" : "default"}>
              {hasCode ? "Change code" : "Set code"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{hasCode ? "Change clock code" : "Set clock code"}</DialogTitle>
              <DialogDescription>
                {employeeName} types this at the time clock. Each code is unique within a store.
              </DialogDescription>
            </DialogHeader>
            <form
              id="clock-code-form"
              className="grid gap-2 py-2"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Label htmlFor="clock-code">4-digit code</Label>
              <Input
                id="clock-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                  setError(null);
                }}
                placeholder="••••"
                className="h-12 text-center text-2xl tracking-[0.5em] tabular-nums"
                aria-invalid={error ? true : undefined}
                aria-describedby="clock-code-help"
                autoFocus
              />
              {error ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : (
                <p id="clock-code-help" className="text-xs text-muted-foreground">
                  Digits only. Avoid easy codes like 1234 or a birthday.
                </p>
              )}
            </form>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" form="clock-code-form" disabled={setCodeM.isPending}>
                {setCodeM.isPending ? "Saving…" : "Save code"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {hasCode && (
          <ConfirmDialog
            trigger={
              <Button
                size="sm"
                variant="ghost"
                className="h-9 sm:h-8 text-muted-foreground"
                disabled={clearM.isPending}
              >
                Clear
              </Button>
            }
            title={`Clear ${employeeName}'s clock code?`}
            description="They can't clock in at the time clock until you set a new code."
            confirmLabel="Clear code"
            destructive
            onConfirm={() => clearM.mutate({ employeeId, code: "" })}
          />
        )}
      </div>
    </div>
  );
}

type PunchRow = {
  id: number;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  durationHours: number | null;
  source: "kiosk" | "manual";
  note: string | null;
};

function PunchHistoryCard({
  isLoading,
  isError,
  onRetry,
  punches,
  employeeName,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  punches: PunchRow[];
  employeeName: string;
}) {
  // One-tap fixes, same dialogs the dashboard uses.
  const [clockOutFor, setClockOutFor] = useState<QuickPunch | null>(null);
  const [fixTimeFor, setFixTimeFor] = useState<QuickPunch | null>(null);
  const asQuickPunch = (p: PunchRow): QuickPunch => ({
    id: p.id,
    employeeName,
    clockInAt: p.clockInAt,
    clockOutAt: p.clockOutAt,
  });
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? punches : punches.slice(0, PUNCH_PREVIEW);
  const day = (d: Date | string, opts: Intl.DateTimeFormatOptions) =>
    new Date(d).toLocaleDateString("en-US", { ...opts, timeZone: BUSINESS_TIME_ZONE });
  const capped = punches.length >= PUNCH_LIMIT;
  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head flex flex-row items-center justify-between px-4 sm:px-5 py-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <Clock />
          </span>
          Recent punches
        </CardTitle>
        <Button size="sm" variant="outline" className="h-9 sm:h-8" asChild>
          <Link href="/payroll?tab=punches">All punches</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {isLoading ? (
          <div className="space-y-2 px-4 sm:px-5 py-3" role="status" aria-label="Loading punches">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
            <p className="text-sm font-semibold">Couldn&apos;t load punches</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : punches.length === 0 ? (
          <EmptyState
            icon={<Clock />}
            title="No punches yet"
            hint="Punches from the time clock, and any you add by hand, show up here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                <div className="w-14 shrink-0">
                  <p className="text-sm font-medium tabular-nums">
                    {day(p.clockInAt, { month: "short", day: "numeric" })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {day(p.clockInAt, { weekday: "short" })}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums">
                    {fmtTime(p.clockInAt)} –{" "}
                    {p.clockOutAt ? (
                      fmtTime(p.clockOutAt)
                    ) : (
                      <span className="chip-good">On the clock</span>
                    )}
                  </p>
                  {p.note || p.source === "manual" ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {p.source === "manual" ? "Added by hand" : ""}
                      {p.source === "manual" && p.note ? " · " : ""}
                      {p.note ?? ""}
                    </p>
                  ) : null}
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {fmtDuration(p.durationHours)}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground"
                    onClick={() => setFixTimeFor(asQuickPunch(p))}
                    aria-label={`Fix the times of the ${day(p.clockInAt, { month: "short", day: "numeric" })} punch`}
                    title="Fix times"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!p.clockOutAt ? (
                    <Button
                      size="sm"
                      className="h-9 sm:h-8 px-2.5"
                      onClick={() => setClockOutFor(asQuickPunch(p))}
                    >
                      <LogOut className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Clock out</span>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {punches.length > PUNCH_PREVIEW ? (
          <div className="px-4 sm:px-5 pt-1 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-9 text-muted-foreground"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? "Show fewer"
                : capped
                  ? `Show the ${punches.length} most recent`
                  : `Show all ${punches.length}`}
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ClockOutDialog
        punch={clockOutFor}
        onOpenChange={(o) => !o && setClockOutFor(null)}
      />
      <FixTimeDialog
        punch={fixTimeFor}
        onOpenChange={(o) => !o && setFixTimeFor(null)}
      />
    </Card>
  );
}

function DeleteEmployeeButton({
  id,
  name,
  onDeleted,
}: {
  id: number;
  name: string;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const del = trpc.employees.delete.useMutation({
    onSuccess: () => {
      toast.success(`${name} deleted. A snapshot is kept in the activity log.`);
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
      onDeleted();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/5"
          disabled={del.isPending}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {del.isPending ? "Deleting…" : "Delete employee"}
        </Button>
      }
      title={`Delete ${name}?`}
      description={<DeleteEmployeeCopy who={name} />}
      confirmLabel="Delete employee"
      destructive
      onConfirm={() => del.mutate({ id })}
    />
  );
}

/**
 * The Edit button + dialog. The form mounts fresh on every open (no stale
 * half-edits), and closing with unsaved changes asks first.
 */
function EditEmployeeButton({
  emp,
  roles,
  stores,
}: {
  emp: EmployeeRecord;
  roles: string[];
  stores: string[];
}) {
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirtyRef = useRef(false);
  const requestOpenChange = (next: boolean) => {
    if (next) {
      dirtyRef.current = false;
      setOpen(true);
      return;
    }
    if (dirtyRef.current) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
  };
  const done = () => {
    dirtyRef.current = false;
    setOpen(false);
  };
  return (
    <>
      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        </DialogTrigger>
        {open ? (
          <EditEmployeeDialog
            emp={emp}
            roles={roles}
            stores={stores}
            onDirtyChange={(d) => {
              dirtyRef.current = d;
            }}
            onDone={done}
          />
        ) : null}
      </Dialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to {emp.fullName} haven&apos;t been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="btn-danger"
              onClick={() => {
                setConfirmDiscard(false);
                done();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditEmployeeDialog({
  emp,
  roles,
  stores,
  onDirtyChange,
  onDone,
}: {
  emp: EmployeeRecord;
  roles: string[];
  stores: string[];
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [serverError, setServerError] = useState<string | null>(null);
  const update = trpc.employees.update.useMutation({
    onSuccess: (data) => {
      const applied = (data as { weeklyPayAppliedTo?: number }).weeklyPayAppliedTo;
      toast.success(
        applied
          ? `${emp.fullName} updated. Set pay now applies to ${applied} saved week${applied === 1 ? "" : "s"} too.`
          : `${emp.fullName} updated.`,
      );
      if (applied) {
        utils.payroll.week.invalidate();
        utils.payroll.range.invalidate();
      }
      utils.employees.get.invalidate({ id: emp.id });
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      onDone();
    },
    onError: (e) => setServerError(errorMessage(e)),
  });
  const deactivate = trpc.employees.deactivate.useMutation({
    onSuccess: () => {
      toast.success(`${emp.fullName} deactivated. Payroll history is kept.`);
      utils.employees.get.invalidate({ id: emp.id });
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
      onDone();
    },
    onError: (e) => setServerError(errorMessage(e)),
  });

  const initial = {
    fullName: emp.fullName,
    phone: emp.phone,
    payRate: String(Number(emp.payRate)),
    weeklyPay: emp.weeklyPay != null ? String(Number(emp.weeklyPay)) : "",
    role: emp.role as string,
    storeLocation: emp.storeLocation as string,
  };
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [payRate, setPayRate] = useState(initial.payRate);
  const [weeklyPay, setWeeklyPay] = useState(initial.weeklyPay);
  const [role, setRole] = useState<string>(initial.role);
  const [storeLocation, setStoreLocation] = useState<string>(initial.storeLocation);
  const [tried, setTried] = useState(false);

  const dirty =
    fullName !== initial.fullName ||
    phone !== initial.phone ||
    payRate !== initial.payRate ||
    weeklyPay !== initial.weeklyPay ||
    role !== initial.role ||
    storeLocation !== initial.storeLocation;
  useEffect(() => {
    onDirtyChange(dirty && !update.isSuccess);
  }, [dirty, update.isSuccess, onDirtyChange]);

  const rate = Number(payRate);
  const weekly = weeklyPay.trim() === "" ? null : Number(weeklyPay);
  const invalid = {
    fullName: !fullName.trim(),
    phone: !phone.trim(),
    payRate: payRate.trim() === "" || Number.isNaN(rate) || rate < 0 || rate > 1000,
    weeklyPay: weekly !== null && (Number.isNaN(weekly) || weekly < 0 || weekly > 100_000),
  };
  const problems = [
    invalid.fullName && "Add their name.",
    invalid.phone && "Add a phone number.",
    invalid.payRate && "Pay rate must be between $0 and $1,000 an hour.",
    invalid.weeklyPay && "Set weekly pay must be $0 or more — or leave it empty for hourly pay.",
  ].filter(Boolean) as string[];

  const save = () => {
    setTried(true);
    setServerError(null);
    if (problems.length > 0) return;
    if (!dirty) {
      onDone();
      return;
    }
    update.mutate({
      id: emp.id,
      fullName: fullName.trim(),
      phone: phone.trim(),
      payRate: rate,
      weeklyPay: weekly,
      role: role as any,
      storeLocation: storeLocation as any,
    });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Edit employee</DialogTitle>
        <DialogDescription>Changes apply from the next payroll you save.</DialogDescription>
      </DialogHeader>
      <form
        id="edit-employee-form"
        className="grid gap-4 py-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="edit-name">Full name</Label>
          <Input
            id="edit-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
            aria-invalid={tried && invalid.fullName ? true : undefined}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-phone">Phone</Label>
          <Input
            id="edit-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={tried && invalid.phone ? true : undefined}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="edit-rate">Pay rate ($/hr)</Label>
            <Input
              id="edit-rate"
              type="number"
              inputMode="decimal"
              step="0.25"
              min="0"
              max="1000"
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
              aria-invalid={tried && invalid.payRate ? true : undefined}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="edit-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-weekly">Set weekly pay ($/week, optional)</Label>
          <Input
            id="edit-weekly"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={weeklyPay}
            onChange={(e) => setWeeklyPay(e.target.value)}
            placeholder="Leave empty for hourly pay"
            aria-invalid={tried && invalid.weeklyPay ? true : undefined}
            aria-describedby="edit-weekly-help"
          />
          <p id="edit-weekly-help" className="text-xs text-muted-foreground leading-relaxed">
            A flat amount every week, saved weeks included. Hours are still
            recorded. Clear it to go back to hourly; past weeks keep what was paid.
          </p>
        </div>
        {stores.length > 1 ? (
          <div className="grid gap-2">
            <Label htmlFor="edit-store">Store</Label>
            <Select value={storeLocation} onValueChange={setStoreLocation}>
              <SelectTrigger id="edit-store" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {(tried && problems.length > 0) || serverError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {serverError ?? problems.join(" ")}
          </p>
        ) : null}
      </form>
      <DialogFooter className="gap-2 sm:items-center">
        {emp.active !== 0 ? (
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto text-destructive hover:text-destructive hover:bg-destructive/5"
                disabled={deactivate.isPending}
              >
                {deactivate.isPending ? "Deactivating…" : "Deactivate"}
              </Button>
            }
            title={`Deactivate ${emp.fullName}?`}
            description="They come off the schedule and payroll lists and can't clock in. Their payroll history stays, and you can reactivate them from their profile at any time."
            confirmLabel="Deactivate"
            destructive
            onConfirm={() => deactivate.mutate({ id: emp.id })}
          />
        ) : null}
        <DialogClose asChild>
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form="edit-employee-form" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Shown on a former employee's profile: what that means, and the way back. */
function ReactivateBanner({ id, name }: { id: number; name: string }) {
  const utils = trpc.useUtils();
  const reactivate = trpc.employees.reactivate.useMutation({
    onSuccess: () => {
      toast.success(`${name} is active again. Set a clock code so they can clock in.`);
      utils.employees.get.invalidate({ id });
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="callout-warn rounded-xl flex flex-col gap-3 px-4 sm:px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="icon-badge">
          <UserX />
        </span>
        <div>
          <p className="text-sm font-medium callout-title">Former employee</p>
          <p className="text-sm text-muted-foreground">
            Off the schedule and payroll lists, and can&apos;t clock in. Their payroll
            history is kept.
          </p>
        </div>
      </div>
      <Button
        className="shrink-0"
        onClick={() => reactivate.mutate({ id })}
        disabled={reactivate.isPending}
      >
        <UserCheck className="h-4 w-4 mr-2" />
        {reactivate.isPending ? "Reactivating…" : "Reactivate"}
      </Button>
    </div>
  );
}
