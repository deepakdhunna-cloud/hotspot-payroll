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
  Building2,
  Phone,
  Pencil,
  DollarSign,
  Clock,
  Briefcase,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { toast } from "sonner";

export default function EmployeeProfile() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = Number(params.id);

  const empQ = trpc.employees.get.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const histQ = trpc.employees.history.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const optionsQ = trpc.meta.options.useQuery();
  const scopeQ = trpc.meta.myScope.useQuery();

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
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-6 border-b border-border">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-2xl font-bold">
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
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Lifetime hours
                </div>
                <div className="text-2xl font-bold mt-2 tabular-nums">{ytdHours.toFixed(1)} h</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Lifetime gross
                </div>
                <div className="text-2xl font-bold mt-2 tabular-nums">{fmtMoney(ytdGross)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Weeks recorded
                </div>
                <div className="text-2xl font-bold mt-2 tabular-nums">{history.length}</div>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
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
        </>
      )}
    </div>
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
  emp: any;
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
  const [role, setRole] = useState(emp.role);
  const [storeLocation, setStoreLocation] = useState(emp.storeLocation);

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
        <Button
          variant="destructive"
          onClick={() => {
            if (confirm("Deactivate this employee? Past payroll history is preserved.")) {
              deactivate.mutate({ id: emp.id });
            }
          }}
          className="sm:mr-auto"
        >
          Deactivate
        </Button>
        <Button
          onClick={() =>
            update.mutate({
              id: emp.id,
              fullName,
              phone,
              payRate: Number(payRate),
              role: role as any,
              storeLocation: storeLocation as any,
            })
          }
          disabled={update.isPending}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
