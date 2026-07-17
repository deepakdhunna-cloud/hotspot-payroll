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
import { fmtDateTime, fmtDuration } from "@/lib/payweek";
import { StatCard } from "@/components/StatCard";
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
  ArrowRight,
  Building2,
  CalendarDays,
  Phone,
  Pencil,
  DollarSign,
  Clock,
  Briefcase,
  Timer,
  Trash2,
  KeyRound,
  Trash,
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/employees">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to roster
          </Button>
        </Link>
        {emp && (
          <div className="flex items-center gap-2">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Pencil className="h-4 w-4 mr-2" /> Edit profile
                </Button>
              </DialogTrigger>
              <EditEmployeeDialog
                emp={emp}
                roles={optionsQ.data?.roles ?? []}
                stores={scopeQ.data?.stores ?? []}
                onClose={() => setEditOpen(false)}
              />
            </Dialog>
            <DeleteEmployeeButton
              id={emp.id}
              name={emp.fullName}
              onDeleted={() => navigate("/employees")}
            />
          </div>
        )}
      </div>

      {emp && (
        <>
          <Card className="surface-card border-0 overflow-hidden rise-in">
            <div className="bg-primary/5 p-6 border-b border-primary/10">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-2xl font-bold">
                  {emp.fullName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{emp.fullName}</h1>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Badge variant="secondary" className="font-normal">
                      {emp.role}
                    </Badge>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {emp.storeLocation}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
              <Field icon={<DollarSign className="h-4 w-4" />} label="Pay rate" value={`${fmtMoney(Number(emp.payRate))}/hr`} />
              <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={emp.phone} />
              <Field icon={<Briefcase className="h-4 w-4" />} label="Role" value={emp.role} />
              <Field icon={<Building2 className="h-4 w-4" />} label="Store" value={emp.storeLocation} />
            </CardContent>
          </Card>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Hours on record"
              value={`${ytdHours.toFixed(1)} h`}
              sub="last 52 weeks"
              icon={<Timer />}
              style={{ animationDelay: "0ms" }}
            />
            <StatCard
              label="Gross on record"
              value={fmtMoney(ytdGross)}
              sub="last 52 weeks"
              icon={<DollarSign />}
              style={{ animationDelay: "40ms" }}
            />
            <StatCard
              label="Weeks recorded"
              value={history.length}
              sub="last 52 weeks"
              icon={<CalendarDays />}
              style={{ animationDelay: "80ms" }}
            />
          </section>

          <ClockCodeCard
            employeeId={emp.id}
            employeeName={emp.fullName}
            hasCode={!!emp.clockCodeHash}
          />

          <Card className="surface-card border-0 rise-in">
            <CardHeader>
              <CardTitle className="section-title flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> Payroll history
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead className="text-right">Scheduled</TableHead>
                      <TableHead className="text-right">Worked</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">
                          No payroll history yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{fmtWeekRange(h.weekStart)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {Number(h.scheduledHours).toFixed(1)} h
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(h.hoursWorked).toFixed(1)} h
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmtMoney(Number(h.grossPay))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {fmtMoney(Number(h.payRateSnapshot))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <PunchHistoryCard
            isLoading={punchesQ.isLoading}
            punches={(punchesQ.data ?? []) as any[]}
          />
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
    <Card className="surface-card border-0 rise-in">
      <CardHeader>
        <CardTitle className="section-title flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Time clock code
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            {hasCode
              ? "This employee can clock in or out by entering their 4-digit code on the kiosk."
              : "No clock code has been set yet. Assign one so this employee can use the kiosk."}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {hasCode ? (
              <span className="chip-good">
                <KeyRound className="h-3 w-3" /> •••• set
              </span>
            ) : (
              <span className="chip-warn">
                <KeyRound className="h-3 w-3" /> No code
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              Codes are stored hashed — not visible after creation.
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Pencil className="h-4 w-4 mr-2" />
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash className="h-4 w-4 mr-2" /> Clear code
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
      </CardContent>
    </Card>
  );
}

function PunchHistoryCard({
  isLoading,
  punches,
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
}) {
  return (
    <Card className="surface-card border-0 rise-in">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="section-title flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" /> Recent punches
        </CardTitle>
        <Link
          href="/payroll?tab=punches"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all punches <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-8 text-sm text-muted-foreground"
                  >
                    Loading punches…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && punches.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-8 text-sm text-muted-foreground"
                  >
                    No punches yet.
                  </TableCell>
                </TableRow>
              )}
              {punches.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular-nums">{fmtDateTime(p.clockInAt)}</TableCell>
                  <TableCell className="tabular-nums">
                    {p.clockOutAt ? (
                      fmtDateTime(p.clockOutAt)
                    ) : (
                      <span className="chip-good">
                        <Clock className="h-3 w-3" /> Clocked in
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtDuration(p.durationHours)}
                  </TableCell>
                  <TableCell>
                    {p.source === "manual" ? (
                      <span className="chip-warn">
                        <Pencil className="h-3 w-3" /> Manual
                      </span>
                    ) : (
                      <span className="chip-neutral">
                        <Clock className="h-3 w-3" /> Kiosk
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                    {p.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
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
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-2" /> Delete
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

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="font-medium mt-1 truncate">{value}</div>
    </div>
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
    onSuccess: () => {
      toast.success("Profile updated");
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
    update.mutate({
      id: emp.id,
      fullName: fullName.trim(),
      phone: phone.trim(),
      payRate: rate,
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
