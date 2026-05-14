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
import { PageHeader } from "@/components/PageHeader";

// Hotspot pay period: Thursday – Wednesday. Dashboards default to the most
// recently closed week (the week we're actively paying).
function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function currentPayPeriodStart(now: Date = new Date()): Date {
  const start = startOfWeek(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return start;
}

export default function CeoView() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => currentPayPeriodStart(new Date()));
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
      <PageHeader
        eyebrow="CEO · cross-store overview"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Executive view"
        description="Payroll across all four locations with estimated federal and state withholding."
        actions={
          <>
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
          </>
        }
      />

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
    <div className="surface-card relative overflow-hidden transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">{label}</p>
            <p className="text-[28px] leading-none font-bold mt-3 tabular-nums">{value}</p>
          </div>
          <div className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${ring}`}>
            {icon}
          </div>
        </div>
      </div>
    </div>
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
  const pinsQ = trpc.ceo.listPins.useQuery();
  const utils = trpc.useUtils();

  const updatePin = trpc.ceo.updatePin.useMutation({
    onSuccess: () => {
      toast.success("PIN updated");
      utils.ceo.listPins.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Access PINs
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Manage the CEO master PIN and one PIN per store. The CEO PIN always grants full access and can recover any store if a manager forgets their PIN.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last changed</TableHead>
                <TableHead className="text-right">Update PIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pinsQ.data ?? []).map((row) => (
                <PinRow
                  key={row.scope}
                  scope={row.scope}
                  label={row.label}
                  isSet={row.isSet}
                  updatedAt={row.updatedAt}
                  onSave={(pin) => updatePin.mutate({ scope: row.scope, pin })}
                  saving={updatePin.isPending}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function PinRow({
  scope,
  label,
  isSet,
  updatedAt,
  onSave,
  saving,
}: {
  scope: string;
  label: string;
  isSet: boolean;
  updatedAt: Date | null;
  onSave: (pin: string) => void;
  saving: boolean;
}) {
  const [pin, setPin] = useState("");
  const valid = /^\d{4,8}$/.test(pin);
  return (
    <TableRow>
      <TableCell className="font-medium flex items-center gap-2">
        {scope === "ceo" ? (
          <ShieldCheck className="h-4 w-4 text-primary" />
        ) : (
          <Building2 className="h-4 w-4 text-muted-foreground" />
        )}
        {label}
      </TableCell>
      <TableCell>
        <Badge variant={isSet ? "default" : "secondary"}>
          {isSet ? "Active" : "Not set"}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={8}
            placeholder="New 4-digit PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm tabular-nums tracking-widest text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            disabled={!valid || saving}
            onClick={() => {
              onSave(pin);
              setPin("");
            }}
          >
            Save
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
