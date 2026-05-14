import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { fmtMoney, STORE_ABBR } from "@/lib/format";
import { Phone, Plus, Search, Users, ArrowRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function Employees() {
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStore, setBulkStore] = useState<string>("");
  const [bulkRole, setBulkRole] = useState<string>("");

  const optionsQ = trpc.meta.options.useQuery();
  const scopeQ = trpc.meta.myScope.useQuery();
  const listQ = trpc.employees.list.useQuery({
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const filtered = useMemo(() => {
    const list = listQ.data ?? [];
    return list.filter((e) => {
      if (roleFilter !== "all" && e.role !== roleFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !e.fullName.toLowerCase().includes(q) &&
          !e.phone.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [listQ.data, roleFilter, search]);

  const stores = scopeQ.data?.stores ?? [];
  const roles = optionsQ.data?.roles ?? [];
  const utils = trpc.useUtils();

  const bulkM = trpc.employees.bulkUpdate.useMutation({
    onSuccess: ({ updated, skipped }) => {
      if (updated > 0) toast.success(`Updated ${updated} employee${updated === 1 ? "" : "s"}.`);
      if (skipped.length > 0)
        toast.warning(`${skipped.length} skipped (not in your scope).`);
      setSelected(new Set());
      setBulkStore("");
      setBulkRole("");
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Clear selections that fall out of the filtered view.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(filtered.map((e) => e.id));
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter, roleFilter, search]);

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (prev.size === filtered.length) return new Set();
      return new Set(filtered.map((e) => e.id));
    });

  const applyBulk = () => {
    if (selected.size === 0) return;
    if (!bulkStore && !bulkRole) {
      toast.error("Pick a new store or role first.");
      return;
    }
    bulkM.mutate({
      ids: Array.from(selected),
      storeLocation: bulkStore ? (bulkStore as any) : undefined,
      role: bulkRole ? (bulkRole as any) : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            Roster
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Users className="h-7 w-7" /> Employees
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage employee profiles, pay rates, and store assignments.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-lg">
              <Plus className="h-4 w-4 mr-2" /> Add employee
            </Button>
          </DialogTrigger>
          <AddEmployeeDialog
            stores={stores}
            roles={roles}
            onSuccess={() => setAddOpen(false)}
          />
        </Dialog>
      </header>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        {selected.size > 0 && (
          <div className="mx-6 mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge className="bg-primary text-primary-foreground">{selected.size}</Badge>
              <span className="font-medium">selected</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={() => setSelected(new Set())}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:ml-auto">
              <Select value={bulkStore} onValueChange={setBulkStore}>
                <SelectTrigger className="w-[200px] h-9 bg-background">
                  <SelectValue placeholder="Move to store…" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={bulkRole} onValueChange={setBulkRole}>
                <SelectTrigger className="w-[180px] h-9 bg-background">
                  <SelectValue placeholder="Change role…" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={applyBulk}
                disabled={bulkM.isPending || (!bulkStore && !bulkRole)}
                size="sm"
                className="h-9"
              >
                <ArrowRight className="h-4 w-4 mr-1" />
                {bulkM.isPending ? "Applying…" : "Apply to selected"}
              </Button>
            </div>
          </div>
        )}
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px] pl-4">
                    <Checkbox
                      checked={
                        filtered.length > 0 && selected.size === filtered.length
                          ? true
                          : selected.size > 0
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Pay rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!listQ.isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      No employees match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((emp) => (
                  <TableRow
                    key={emp.id}
                    data-state={selected.has(emp.id) ? "selected" : undefined}
                  >
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(emp.id)}
                        onCheckedChange={() => toggleOne(emp.id)}
                        aria-label={`Select ${emp.fullName}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/employees/${emp.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {emp.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {emp.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {emp.phone}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtMoney(Number(emp.payRate))}/hr
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/employees/${emp.id}`}>
                        <Button size="sm" variant="ghost">
                          View profile
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddEmployeeDialog({
  stores,
  roles,
  onSuccess,
}: {
  stores: string[];
  roles: string[];
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const create = trpc.employees.create.useMutation({
    onSuccess: () => {
      toast.success("Employee added");
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [payRate, setPayRate] = useState("");
  const [role, setRole] = useState<string>("");
  const [storeLocation, setStoreLocation] = useState<string>("");

  const submit = () => {
    const rate = Number(payRate);
    if (!fullName.trim() || !phone.trim() || !role || !storeLocation || !rate) {
      toast.error("Please fill in every field.");
      return;
    }
    create.mutate({
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
        <DialogTitle>Add new employee</DialogTitle>
        <DialogDescription>
          Just the essentials — they're added to the store roster instantly.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="emp-name">Full name</Label>
          <Input
            id="emp-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Doe"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="emp-phone">Phone</Label>
          <Input
            id="emp-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="emp-rate">Pay rate ($/hr)</Label>
            <Input
              id="emp-rate"
              type="number"
              step="0.25"
              min="0"
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
              placeholder="15.00"
            />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue placeholder="Pick role" />
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
              <SelectValue placeholder="Pick store" />
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
      <DialogFooter>
        <Button onClick={submit} disabled={create.isPending} className="w-full">
          {create.isPending ? "Adding…" : "Add employee"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
