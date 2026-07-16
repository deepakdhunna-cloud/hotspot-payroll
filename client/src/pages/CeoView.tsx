/**
 * Executive view — every store on one screen: hours, gross, withholding
 * estimates, live clock-ins and over-schedule flags, plus PIN management
 * and the audit trail.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StoreSelect } from "@/components/StoreSelect";
import { WeekNavigator } from "@/components/WeekNavigator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STORE_ABBR, fmtMoney } from "@/lib/format";
import { currentPayPeriodStart, fmtDateTime } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Building2,
  Clock,
  History,
  Landmark,
  Receipt,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function CeoView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Executive view pays the most recently CLOSED week by default.
  const [weekStart, setWeekStart] = useState<Date>(() => currentPayPeriodStart());
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const optionsQ = trpc.meta.options.useQuery(undefined, { enabled: !!isAdmin });
  const ceoQ = trpc.ceo.weekly.useQuery(
    {
      weekStart,
      store: storeFilter === "all" ? undefined : (storeFilter as any),
    },
    { enabled: !!isAdmin, refetchInterval: 60_000 },
  );
  const stores = optionsQ.data?.stores ?? [];
  const data = ceoQ.data;
  const grand = data?.grand ?? {
    totalHours: 0,
    totalClockHours: 0,
    totalGross: 0,
    totalFederal: 0,
    totalState: 0,
    totalNet: 0,
    totalScheduled: 0,
  };
  const rows = data?.rows ?? [];
  const overClockedRows = rows.filter((r) => r.overClocked);

  // Role gate AFTER all hooks so the hook order never changes between renders.
  if (user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">CEO access only</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          This view shows cross-store tax withholding estimates and is restricted to the CEO
          role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CEO · cross-store overview"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Executive view"
        description="All four locations at a glance — payroll, withholding estimates, live clock-ins and over-schedule flags."
        actions={
          <>
            <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
            <StoreSelect
              stores={stores}
              isAdmin
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employees">By employee</TabsTrigger>
          <TabsTrigger value="managers">Managers &amp; access</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {overClockedRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rise-in">
              <span className="chip-warn">
                <AlertTriangle className="h-3 w-3" />
                {overClockedRows.length} employee{overClockedRows.length === 1 ? "" : "s"} clocked
                over schedule this week
              </span>
            </div>
          ) : null}

          {ceoQ.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[110px] rounded-xl" />
              ))}
            </div>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Gross pay (week)"
                value={fmtMoney(grand.totalGross)}
                sub={`${grand.totalClockHours.toFixed(1)} hours clocked`}
                icon={<Wallet />}
                style={{ animationDelay: "0ms" }}
              />
              <StatCard
                label="Federal withholding"
                value={fmtMoney(grand.totalFederal)}
                sub="est. FIT + FICA (~18%)"
                icon={<Landmark />}
                style={{ animationDelay: "40ms" }}
              />
              <StatCard
                label="State withholding"
                value={fmtMoney(grand.totalState)}
                sub="est. state tax (~5%)"
                icon={<Receipt />}
                style={{ animationDelay: "80ms" }}
              />
              <StatCard
                label="Net pay (est.)"
                value={fmtMoney(grand.totalNet)}
                sub={`${data?.employeeCount ?? 0} active employees company-wide`}
                icon={<Users />}
                style={{ animationDelay: "120ms" }}
              />
            </section>
          )}

          {/* Every store at one glance */}
          <section className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            {ceoQ.isLoading
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-52 rounded-xl" />)
              : Object.entries(data?.byStore ?? {}).map(([store, s]: [string, any], i) => (
                  <Card
                    key={store}
                    className="surface-card border-0 rise-in"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 truncate">
                          <Building2 className="h-4 w-4 text-primary shrink-0" />
                          <span className="truncate">{store}</span>
                        </span>
                        {s.clockedInCount > 0 ? (
                          <span className="chip-good shrink-0">
                            <Clock className="h-3 w-3" />
                            {s.clockedInCount} in
                          </span>
                        ) : null}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                      <Stat label="Clocked" value={s.totalClockHours.toFixed(1)} />
                      <Stat label="Scheduled" value={s.totalScheduled.toFixed(1)} />
                      <Stat label="Gross" value={fmtMoney(s.totalGross)} bold />
                      <Stat label="Net (est.)" value={fmtMoney(s.totalNet)} bold />
                      <Stat label="Staff" value={String(s.employeeCount)} />
                      <div>
                        <div className="kpi-label">Status</div>
                        {s.overClockedCount > 0 ? (
                          <span className="chip-warn mt-0.5">
                            <AlertTriangle className="h-3 w-3" />
                            {s.overClockedCount} over
                          </span>
                        ) : (
                          <span className="chip-good mt-0.5">on track</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
          </section>
        </TabsContent>

        <TabsContent value="employees">
          <Card className="surface-card border-0">
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
                      <TableHead className="text-right">Status</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Federal</TableHead>
                      <TableHead className="text-right">State</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ceoQ.isLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="h-24 text-center text-sm text-muted-foreground"
                        >
                          Loading payroll…
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center py-10 text-sm text-muted-foreground"
                        >
                          No payroll data for this week yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => (
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
                          <TableCell className="text-right tabular-nums">
                            {r.hoursWorked.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.overClocked ? (
                              <span className="chip-warn">
                                <AlertTriangle className="h-3 w-3" />
                                over
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {fmtMoney(r.grossPay)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmtMoney(r.federal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmtMoney(r.state)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtMoney(r.netPay)}
                          </TableCell>
                        </TableRow>
                      ))
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

        <TabsContent value="activity">
          <ActivityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="kpi-label">{label}</div>
      <div className={`tabular-nums ${bold ? "font-semibold text-base" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function ManagersPanel() {
  const pinsQ = trpc.ceo.listPins.useQuery();
  const utils = trpc.useUtils();

  const updatePin = trpc.ceo.updatePin.useMutation({
    onSuccess: () => {
      toast.success("PIN updated — sessions signed in with the old PIN are revoked");
      utils.ceo.listPins.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="surface-card border-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Access PINs
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          One PIN per store plus the CEO master PIN. Rotating a PIN immediately signs out every
          device that used the old one — rotate anytime a device is lost or a manager leaves.
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
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {scope === "ceo" ? (
            <ShieldCheck className="h-4 w-4 text-primary" />
          ) : (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          )}
          {label}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={isSet ? "default" : "secondary"}>{isSet ? "Active" : "Not set"}</Badge>
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
            placeholder="New PIN (4–8 digits)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm tabular-nums tracking-widest text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/** Append-only audit trail: logins, deletions, PIN rotations, payroll edits. */
function ActivityPanel() {
  const auditQ = trpc.ceo.auditLog.useQuery({ limit: 100 });

  const ACTION_LABELS: Record<string, string> = {
    "auth.pin_success": "Signed in",
    "auth.pin_failed": "Failed sign-in attempt",
    "employees.create": "Added employee",
    "employees.quickCreate": "Quick-added employee",
    "employees.update": "Edited employee",
    "employees.bulkUpdate": "Bulk-edited employees",
    "employees.deactivate": "Deactivated employee",
    "employees.delete": "Deleted employee (snapshot kept)",
    "payroll.saveHours": "Saved payroll hours",
    "payroll.saveSchedule": "Saved scheduled hours",
    "schedule.commit": "Committed schedule import",
    "clock.setCode": "Set clock code",
    "clock.createManual": "Added manual punch",
    "clock.updatePunch": "Edited punch",
    "clock.deletePunch": "Deleted punch",
    "clock.punch_failed": "Failed kiosk code attempt",
    "ceo.updatePin": "Rotated a PIN",
  };

  return (
    <Card className="surface-card border-0">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Activity log
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Every sensitive action is recorded — including snapshots of deleted data, so nothing
            is ever silently lost.
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    Loading activity…
                  </TableCell>
                </TableRow>
              ) : (auditQ.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    No recorded activity yet.
                  </TableCell>
                </TableRow>
              ) : (
                (auditQ.data ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {fmtDateTime(e.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm font-medium whitespace-nowrap">
                      {e.actorScope === "ceo" ? (
                        <span className="flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> CEO
                        </span>
                      ) : (
                        (STORE_ABBR[e.actorScope] ?? e.actorScope)
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.action.includes("failed") ? (
                        <span className="chip-warn">
                          <AlertTriangle className="h-3 w-3" />
                          {ACTION_LABELS[e.action] ?? e.action}
                        </span>
                      ) : (
                        (ACTION_LABELS[e.action] ?? e.action)
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[360px] truncate">
                      {e.detail ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
