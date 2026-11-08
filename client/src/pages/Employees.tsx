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
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { fmtMoney, roleHue, STORE_ABBR } from "@/lib/format";
import { KeyRound, Plus, Search, ArrowRight, Trash2, X, ChevronRight } from "lucide-react";
import { TableStateRows } from "@/components/QueryStates";
import { useEffect, useMemo, useState } from "react";
import { consumeQueryFlag } from "@/lib/queryFlag";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InitialsBadge } from "@/components/InitialsBadge";
import { useStoreScope } from "@/contexts/StoreScopeContext";

export default function Employees() {
  const { scope: storeFilter } = useStoreScope();
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // Dashboard "Add employee" shortcut lands here with ?add=1.
  useEffect(() => {
    if (consumeQueryFlag("add")) setAddOpen(true);
  }, []);
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
  const missingCodes = (listQ.data ?? []).filter((e) => !e.clockCodeHash).length;
  // A store column only earns its place when the list spans several stores.
  const showStore = storeFilter === "all" && stores.length > 1;
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const bulkDeleteM = trpc.employees.bulkDelete.useMutation({
    onSuccess: ({ deleted, skipped }) => {
      if (deleted > 0)
        toast.success(
          `Deleted ${deleted} employee${deleted === 1 ? "" : "s"}. Full snapshots are kept in the activity log.`,
        );
      if (skipped.length > 0)
        toast.warning(`${skipped.length} skipped (not in your scope).`);
      setSelected(new Set());
      utils.employees.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.attention.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

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

  // Clear selections that fall out of the filtered view — including rows that
  // disappear when a background refetch updates listQ.data.
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
  }, [listQ.data, storeFilter, roleFilter, search]);

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
      <PageHeader
        title="Employees"
        description={
          listQ.data
            ? `${listQ.data.length} ${listQ.data.length === 1 ? "person" : "people"}${
                storeFilter === "all"
                  ? stores.length > 1
                    ? " across your stores"
                    : stores[0]
                      ? ` at ${stores[0]}`
                      : ""
                  : ` at ${storeFilter}`
              }${missingCodes > 0 ? ` · ${missingCodes} without a clock code` : ""}`
            : undefined
        }
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Add employee
              </Button>
            </DialogTrigger>
            <AddEmployeeDialog
              stores={stores}
              roles={roles}
              onSuccess={() => setAddOpen(false)}
            />
          </Dialog>
        }
      />

      <Card className="surface-card border-0 gap-0 py-0 overflow-hidden">
        <CardHeader className="px-3 sm:px-4 py-3 border-b border-border">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search people"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
                aria-label="Search employees"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="h-9 w-[140px] sm:w-[180px] bg-card">
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
          <div className="border-b border-border bg-muted/50 px-4 py-2.5 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium tabular-nums">{selected.size} selected</span>
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
              <ConfirmDialog
                trigger={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                    disabled={bulkDeleteM.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {bulkDeleteM.isPending ? "Deleting…" : `Delete ${selected.size}`}
                  </Button>
                }
                title={`Permanently delete ${selected.size} employee${selected.size === 1 ? "" : "s"}?`}
                description="This removes their profiles AND their punch history, payroll entries and scheduled shifts. A full snapshot of every deleted record is written to the activity log first, so nothing is lost forever — but this list can't be un-deleted from the app. If someone just stopped working here, consider deactivating from their profile instead."
                confirmLabel={`Delete ${selected.size} employee${selected.size === 1 ? "" : "s"}`}
                onConfirm={() => bulkDeleteM.mutate({ ids: Array.from(selected) })}
              />
            </div>
          </div>
        )}
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hidden sm:table-cell w-[44px] pl-4">
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
                  <TableHead className="pl-4 sm:pl-2">Name</TableHead>
                  {showStore ? <TableHead className="hidden md:table-cell">Store</TableHead> : null}
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="text-right">Pay rate</TableHead>
                  <TableHead className="w-10" aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableStateRows
                  colSpan={6}
                  isLoading={listQ.isLoading}
                  isError={listQ.isError}
                  onRetry={() => listQ.refetch()}
                  isEmpty={!listQ.isLoading && filtered.length === 0}
                  emptyTitle={
                    (listQ.data?.length ?? 0) === 0
                      ? "No employees yet"
                      : "Nobody matches your search"
                  }
                  emptyHint={
                    (listQ.data?.length ?? 0) === 0
                      ? "Add your team, or import a schedule and add new names from there."
                      : undefined
                  }
                />
                {filtered.map((emp) => (
                  <TableRow
                    key={emp.id}
                    data-state={selected.has(emp.id) ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => navigate(`/employees/${emp.id}`)}
                  >
                    <TableCell
                      className="hidden sm:table-cell pl-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.has(emp.id)}
                        onCheckedChange={() => toggleOne(emp.id)}
                        aria-label={`Select ${emp.fullName}`}
                      />
                    </TableCell>
                    <TableCell className="pl-4 sm:pl-2 py-2.5">
                      <div className="flex items-center gap-3">
                        <InitialsBadge name={emp.fullName} />
                        <div className="min-w-0">
                          <Link
                            href={`/employees/${emp.id}`}
                            className="block font-medium truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {emp.fullName}
                          </Link>
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                            <span className={`role-tag hue-${roleHue(emp.role)}`}>{emp.role}</span>
                            {showStore ? (
                              <span className="md:hidden">
                                · {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                              </span>
                            ) : null}
                            {!emp.clockCodeHash ? (
                              <span className="chip-warn py-0">
                                <KeyRound className="h-3 w-3" /> No code
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {showStore ? (
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {STORE_ABBR[emp.storeLocation] ?? emp.storeLocation}
                      </TableCell>
                    ) : null}
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground tabular-nums">
                      {emp.phone}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtMoney(Number(emp.payRate))}
                      <span className="text-muted-foreground font-normal">/hr</span>
                    </TableCell>
                    <TableCell className="pr-3 text-muted-foreground">
                      <ChevronRight className="h-4 w-4" />
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
    const rateValid = payRate !== "" && rate >= 0;
    if (!fullName.trim() || !phone.trim() || !role || !storeLocation || !rateValid) {
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
