import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange } from "@/lib/format";
import { fmtDuration } from "@/lib/payweek";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { Money } from "@/components/Money";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { InitialsBadge } from "@/components/InitialsBadge";
import {
  ClockOutDialog,
  FixTimeDialog,
  type QuickPunch,
} from "@/components/PunchQuickActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  CalendarDays,
  Pencil,
  Clock,
  LogOut,
  Trash2,
  KeyRound,
  Wallet,
  CalendarCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

/** Full employee record as returned by employees.get. */
type EmployeeRecord = inferRouterOutputs<AppRouter>["employees"]["get"];

export default function EmployeeProfile() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = Number(params.id);

  const empQ = trpc.employees.get.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const histQ = trpc.employees.history.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const optionsQ = trpc.meta.options.useQuery();
  const scopeQ = trpc.meta.myScope.useQuery();
  const punchesQ = trpc.clock.list.useQuery(
    { employeeId: id, limit: 50 },
    { enabled: !Number.isNaN(id) },
  );

  const [editOpen, setEditOpen] = useState(false);

  if (empQ.isError) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Employee not found.</p>
        <Button variant="link" onClick={() => navigate("/employees")}>
          Back to roster
        </Button>
      </div>
    );
  }

  const emp = empQ.data;
  const history = histQ.data ?? [];

  const ytdGross = history.reduce((acc, h) => acc + Number(h.grossPay), 0);
  const ytdHours = history.reduce((acc, h) => acc + Number(h.hoursWorked), 0);

  return (
    <div className="space-y-5 md:space-y-6">
      <Link
        href="/employees"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>

      {empQ.isLoading && (
        <div className="space-y-4" role="status" aria-label="Loading employee">
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
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
                {emp.active === 0 ? <span className="chip-neutral">Inactive</span> : null}
              </span>
            }
            actions={
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Button>
                </DialogTrigger>
                <EditEmployeeDialog
                  emp={emp}
                  roles={optionsQ.data?.roles ?? []}
                  stores={scopeQ.data?.stores ?? []}
                  onClose={() => setEditOpen(false)}
                />
              </Dialog>
            }
          />

          <KpiBand>
            <KpiCell
              hero
              icon={<Wallet />}
              label={emp.weeklyPay != null ? "Weekly pay" : "Pay rate"}
              value={
                emp.weeklyPay != null ? (
                  <>
                    {fmtMoney(Number(emp.weeklyPay))}
                    <span className="text-base font-medium opacity-70">/wk</span>
                  </>
                ) : (
                  <>
                    {fmtMoney(Number(emp.payRate))}
                    <span className="text-base font-medium opacity-70">/hr</span>
                  </>
                )
              }
            />
            <KpiCell hue="blue" icon={<Clock />} label="Hours" value={ytdHours.toFixed(1)} sub="last 52 weeks" />
            <KpiCell hue="green" icon={<Wallet />} label="Gross pay" value={<Money value={ytdGross} />} sub="last 52 weeks" />
            <KpiCell hue="teal" icon={<CalendarCheck />} label="Weeks paid" value={history.length} sub="last 52 weeks" />
          </KpiBand>

          <ClockCodeCard
            employeeId={emp.id}
            employeeName={emp.fullName}
            hasCode={!!emp.clockCodeHash}
          />

          <div className="grid gap-5 md:gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
            <Card className="surface-card border-0 gap-0 py-0">
              <CardHeader className="px-4 sm:px-5 pt-4 pb-2">
                <CardTitle className="section-title">
                  <span className="icon-badge icon-badge-sm">
                    <Wallet />
                  </span>
                  Payroll history
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {history.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays />}
                    title="No saved payroll yet"
                    hint="Weeks appear here once their payroll is saved."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-4 sm:pl-5">Week</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right pr-4 sm:pr-5">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="pl-4 sm:pl-5 font-medium">
                            {fmtWeekRange(h.weekStart)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(h.hoursWorked).toFixed(1)}
                            <span className="text-muted-foreground">
                              {" "}/ {Number(h.scheduledHours).toFixed(1)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium pr-4 sm:pr-5">
                            {fmtMoney(Number(h.grossPay))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <PunchHistoryCard
              isLoading={punchesQ.isLoading}
              punches={(punchesQ.data ?? []) as any[]}
              employeeName={emp.fullName}
            />
          </div>

          {/* Destructive action lives at the end of the page, away from the
              everyday controls. Deactivate (inside Edit) is the safe default
              for departures; Delete is for records created by mistake. */}
          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Left the team? Use <span className="font-medium text-foreground">Edit → Deactivate</span>{" "}
              to keep their payroll history. Delete only removes records added by mistake.
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
  const setCodeM = trpc.clock.setCode.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.cleared
          ? `Clock code cleared for ${employeeName}.`
          : `Clock code updated for ${employeeName}.`,
      );
      utils.employees.get.invalidate({ id: employeeId });
      setOpen(false);
      setCode("");
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (code !== "" && !/^\d{4}$/.test(code)) {
      toast.error("Code must be exactly 4 digits.");
      return;
    }
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
          <p className="text-sm font-medium">
            {hasCode ? "Time clock code is set" : "No time clock code yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasCode
              ? "They punch in and out with it at the kiosk. Codes are hidden once saved."
              : "Set a 4-digit code so they can punch in at the kiosk."}
          </p>
        </div>
      </div>
        <div className="flex flex-wrap gap-2 pl-12 sm:pl-0">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant={hasCode ? "outline" : "default"}>
                {hasCode ? "Change code" : "Set code"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {hasCode ? "Change clock code" : "Set clock code"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <Label>4-digit code</Label>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="1234"
                  className="text-center text-2xl tracking-[0.5em] tabular-nums"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be 4 digits. Codes must be unique within a store.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={setCodeM.isPending}>
                  {setCodeM.isPending ? "Saving…" : "Save code"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {hasCode && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-muted-foreground">
                  Clear
                </Button>
              }
              title={`Clear clock code for ${employeeName}?`}
              description="They won't be able to punch in at the kiosk until you assign a new code."
              confirmLabel="Clear code"
              destructive
              onConfirm={() => setCodeM.mutate({ employeeId, code: "" })}
            />
          )}
        </div>
    </div>
  );
}

function PunchHistoryCard({
  isLoading,
  punches,
  employeeName,
}: {
  isLoading: boolean;
  punches: Array<{
    id: number;
    clockInAt: Date | string;
    clockOutAt: Date | string | null;
    durationHours: number | null;
    source: "kiosk" | "manual";
    note: string | null;
  }>;
  employeeName: string;
}) {
  // One-tap fixes, same dialogs the dashboard uses.
  const [clockOutFor, setClockOutFor] = useState<QuickPunch | null>(null);
  const [fixTimeFor, setFixTimeFor] = useState<QuickPunch | null>(null);
  const asQuickPunch = (p: (typeof punches)[number]): QuickPunch => ({
    id: p.id,
    employeeName,
    clockInAt: p.clockInAt,
    clockOutAt: p.clockOutAt,
  });
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? punches : punches.slice(0, 10);
  const time = (d: Date | string) =>
    new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <Card className="surface-card border-0 gap-0 py-0">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5 pt-4 pb-2">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <Clock />
          </span>
          Recent punches
        </CardTitle>
        <Button size="sm" variant="outline" className=" h-8" asChild>
          <Link href="/payroll?tab=punches">All punches</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {isLoading ? (
          <div className="space-y-2 px-5 py-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : punches.length === 0 ? (
          <EmptyState icon={<Clock />} title="No punches yet" />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                <div className="w-16 shrink-0">
                  <p className="text-sm font-medium tabular-nums">
                    {new Date(p.clockInAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.clockInAt).toLocaleDateString("en-US", { weekday: "short" })}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums">
                    {time(p.clockInAt)} – {p.clockOutAt ? time(p.clockOutAt) : (
                      <span className="chip-good">on the clock</span>
                    )}
                  </p>
                  {p.note || p.source === "manual" ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {p.source === "manual" ? "Entered by hand" : ""}
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
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setFixTimeFor(asQuickPunch(p))}
                    aria-label="Fix this punch's times"
                    title="Fix times"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!p.clockOutAt ? (
                    <Button
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => setClockOutFor(asQuickPunch(p))}
                      title="Clock out from here"
                    >
                      <LogOut className="h-3.5 w-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">Clock out</span>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {punches.length > 10 ? (
          <div className="px-4 sm:px-5 pt-1 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-8 text-muted-foreground"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${punches.length}`}
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
      toast.success(`${name} permanently deleted.`);
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      onDeleted();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/5 shrink-0">
          <Trash2 className="h-4 w-4 mr-2" /> Delete employee
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the employee <span className="font-semibold text-foreground">and</span> their
            entire payroll history. This cannot be undone. If you only want to
            stop scheduling them, use <span className="font-semibold text-foreground">Deactivate</span> inside Edit profile
            instead — it keeps their history intact.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => del.mutate({ id })}
            disabled={del.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {del.isPending ? "Deleting…" : "Yes, delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


function EditEmployeeDialog({
  emp,
  roles,
  stores,
  onClose,
}: {
  emp: EmployeeRecord;
  roles: string[];
  stores: string[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const update = trpc.employees.update.useMutation({
    onSuccess: (data) => {
      toast.success("Profile updated");
      if ((data as { weeklyPayAppliedTo?: number }).weeklyPayAppliedTo) {
        toast.success(
          `Set pay applied to ${data.weeklyPayAppliedTo} saved week${
            data.weeklyPayAppliedTo === 1 ? "" : "s"
          } as well — history now shows the flat amount.`,
        );
        utils.payroll.week.invalidate();
        utils.payroll.range.invalidate();
      }
      utils.employees.get.invalidate({ id: emp.id });
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const deactivate = trpc.employees.deactivate.useMutation({
    onSuccess: () => {
      toast.success("Employee deactivated");
      utils.employees.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const [fullName, setFullName] = useState(emp.fullName);
  const [phone, setPhone] = useState(emp.phone);
  const [payRate, setPayRate] = useState(String(emp.payRate));
  const [weeklyPay, setWeeklyPay] = useState(
    emp.weeklyPay != null ? String(Number(emp.weeklyPay)) : "",
  );
  const [role, setRole] = useState<string>(emp.role);
  const [storeLocation, setStoreLocation] = useState<string>(emp.storeLocation);

  const save = () => {
    const rate = Number(payRate);
    if (!fullName.trim()) {
      toast.error("Name can't be empty.");
      return;
    }
    if (!phone.trim()) {
      toast.error("Phone can't be empty.");
      return;
    }
    if (payRate === "" || Number.isNaN(rate) || rate < 0) {
      toast.error("Pay rate must be 0 or more.");
      return;
    }
    const weekly = weeklyPay.trim() === "" ? null : Number(weeklyPay);
    if (weekly !== null && (Number.isNaN(weekly) || weekly < 0)) {
      toast.error("Set weekly pay must be 0 or more (or empty for hourly).");
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
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Pay rate ($/hr)</Label>
            <Input
              type="number"
              step="0.25"
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
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
          <Label>Set weekly pay ($/week, optional)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={weeklyPay}
            onChange={(e) => setWeeklyPay(e.target.value)}
            placeholder="Leave empty for hourly pay"
          />
          <p className="text-xs text-muted-foreground">
            When set, this flat amount applies to EVERY week — already-saved
            past weeks are updated to it, and every future week opens with it.
            Hours are still recorded, they just don't drive the pay. Clearing
            the field returns future weeks to hourly; past weeks keep what was
            paid.
          </p>
        </div>
        <div className="grid gap-2">
          <Label>Store</Label>
          <Select value={storeLocation} onValueChange={setStoreLocation}>
            <SelectTrigger>
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
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2">
        <ConfirmDialog
          trigger={
            <Button variant="destructive" className="sm:mr-auto">
              Deactivate
            </Button>
          }
          title={`Deactivate ${emp.fullName}?`}
          description="They are removed from the active roster, but past payroll history is preserved."
          confirmLabel="Deactivate"
          destructive
          onConfirm={() => deactivate.mutate({ id: emp.id })}
        />
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
