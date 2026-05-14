import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { fmtMoney, fmtWeekRange, STORE_ABBR } from "@/lib/format";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Users,
  Landmark,
  Receipt,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export default function CeoView() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [storeFilter, setStoreFilter] = useState<string>("all");

  if (user && user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">CEO access only</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          This view shows cross-store tax withholding estimates and is restricted to the CEO role.
        </p>
      </div>
    );
  }

  const optionsQ = trpc.meta.options.useQuery();
  const ceoQ = trpc.ceo.weekly.useQuery({
    weekStart,
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });
  const stores = optionsQ.data?.stores ?? [];

  const data = ceoQ.data;
  const grand = data?.grand ?? {
    totalHours: 0,
    totalGross: 0,
    totalFederal: 0,
    totalState: 0,
    totalNet: 0,
    totalScheduled: 0,
  };

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
            CEO &middot; Cross-Store Overview
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" /> Executive view
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Full payroll across all four locations, with estimated federal and state withholding for
            planning purposes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary" />
              {fmtWeekRange(weekStart)}
            </div>
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(1)} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

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
        </div>
      </header>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employees">By employee</TabsTrigger>
          <TabsTrigger value="managers">Managers &amp; access</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Gross pay (week)" value={fmtMoney(grand.totalGross)} icon={<Wallet />} accent="primary" />
            <Kpi
              label="Federal withholding"
              value={fmtMoney(grand.totalFederal)}
              icon={<Landmark />}
              accent="blue"
            />
            <Kpi label="State withholding" value={fmtMoney(grand.totalState)} icon={<Receipt />} accent="amber" />
            <Kpi
              label="Net pay (after est. tax)"
              value={fmtMoney(grand.totalNet)}
              icon={<Wallet />}
              accent="green"
            />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Object.entries(data?.byStore ?? {}).map(([store, s]: any) => (
              <Card key={store} className="overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
                <CardHeader className="relative pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" /> {store}
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Hours" value={`${s.totalHours.toFixed(1)} h`} />
                  <Stat label="Gross" value={fmtMoney(s.totalGross)} bold />
                  <Stat label="Federal" value={fmtMoney(s.totalFederal)} />
                  <Stat label="State" value={fmtMoney(s.totalState)} />
                  <Stat label="Net" value={fmtMoney(s.totalNet)} bold />
                  <Stat label="Employees" value={String(s.employeeCount)} />
                </CardContent>
              </Card>
            ))}
          </section>
        </TabsContent>

        <TabsContent value="employees">
          <Card>
            <CardHeader>
              <CardTitle>Per-employee gross &amp; withholding</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Estimates only. Federal estimate combines FIT + FICA at ~18%; state at ~5%.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Federal</TableHead>
                      <TableHead className="text-right">State</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.rows ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.fullName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {STORE_ABBR[r.storeLocation] ?? r.storeLocation}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="font-normal">
                            {r.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.hoursWorked.toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmtMoney(r.grossPay)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sky-300">
                          {fmtMoney(r.federal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-300">
                          {fmtMoney(r.state)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-300">
                          {fmtMoney(r.netPay)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data && data.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                          No payroll data for this week yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="managers">
          <ManagersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: "primary" | "blue" | "amber" | "green";
}) {
  const ring = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-sky-500/10 text-sky-400",
    amber: "bg-amber-500/10 text-amber-400",
    green: "bg-emerald-500/10 text-emerald-400",
  }[accent];
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold mt-2 tabular-nums">{value}</p>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${ring}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`tabular-nums ${bold ? "font-semibold text-base" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function ManagersPanel() {
  const optionsQ = trpc.meta.options.useQuery();
  const managersQ = trpc.ceo.listManagers.useQuery();
  const utils = trpc.useUtils();

  const setStores = trpc.ceo.setManagerStores.useMutation({
    onSuccess: () => {
      toast.success("Updated access");
      utils.ceo.listManagers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setRole = trpc.ceo.setUserRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      utils.ceo.listManagers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stores = optionsQ.data?.stores ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Manager access
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Promote signed-in users to CEO, or restrict managers to specific stores. Admins always see all stores.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned stores</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(managersQ.data ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.email ?? "—"}</TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as any })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">Manager</SelectItem>
                        <SelectItem value="admin">CEO / Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {u.role === "admin" ? (
                      <span className="text-xs text-muted-foreground">All stores (admin)</span>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {stores.map((s) => {
                          const checked = u.stores.includes(s);
                          return (
                            <label
                              key={s}
                              className="flex items-center gap-2 text-xs cursor-pointer"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(c) => {
                                  const next = c
                                    ? [...u.stores, s]
                                    : u.stores.filter((x) => x !== s);
                                  setStores.mutate({ userId: u.id, stores: next as any });
                                }}
                              />
                              {STORE_ABBR[s] ?? s}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {managersQ.data && managersQ.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-10 text-sm text-muted-foreground">
                    No users have signed in yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
