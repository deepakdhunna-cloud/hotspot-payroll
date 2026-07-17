/**
 * Executive view — the whole company on one screen.
 *
 * Top: mode-aware pulse (live week = who's working and what labor costs
 * right now; closed week = what was saved and the withholding estimates).
 * Middle: one card per store — click a card to focus every number on that
 * store, click again to zoom back out. Eight-week filmstrip for history.
 * Tabs below hold the payroll detail, PIN management and the audit trail.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { AttentionCenter } from "@/components/AttentionCenter";
import { InitialsBadge } from "@/components/InitialsBadge";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { StoreSelect } from "@/components/StoreSelect";
import { WeekTrend } from "@/components/WeekTrend";
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
import { STORE_ABBR, fmtMoney, fmtWeekRange } from "@/lib/format";
import { inProgressPayWeekStart, fmtDateTime } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  History,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function CeoView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [weekStart, setWeekStart] = useState<Date>(() => inProgressPayWeekStart());
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const optionsQ = trpc.meta.options.useQuery(undefined, { enabled: !!isAdmin });
  // Always fetch every store — the store cards ARE the filter, so the
  // all-stores picture must stay on screen while one store is focused.
  const ceoQ = trpc.ceo.weekly.useQuery(
    { weekStart },
    { enabled: !!isAdmin, refetchInterval: 60_000 },
  );
  const trendQ = trpc.dashboard.trend.useQuery(
    {
      weeks: 8,
      store: storeFilter === "all" ? undefined : (storeFilter as any),
    },
    { enabled: !!isAdmin, refetchInterval: 5 * 60_000 },
  );

  const stores = optionsQ.data?.stores ?? [];
  const data = ceoQ.data;
  const byStore = data?.byStore ?? {};
  const allRows = data?.rows ?? [];
  const isLiveWeek = weekStart.getTime() === inProgressPayWeekStart().getTime();

  /* ------------- filter-aware aggregates (client-side, instant) ------------- */

  const rows = useMemo(
    () =>
      storeFilter === "all"
        ? allRows
        : allRows.filter((r) => r.storeLocation === storeFilter),
    [allRows, storeFilter],
  );

  const liveLaborByStore = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) {
      m.set(r.storeLocation, (m.get(r.storeLocation) ?? 0) + r.clockHours * r.payRate);
    }
    return m;
  }, [allRows]);

  const agg = useMemo(() => {
    const keys =
      storeFilter === "all"
        ? Object.keys(byStore)
        : Object.keys(byStore).filter((k) => k === storeFilter);
    const zero = {
      totalHours: 0,
      totalClockHours: 0,
      totalScheduled: 0,
      totalGross: 0,
      totalFederal: 0,
      totalState: 0,
      totalNet: 0,
      employeeCount: 0,
      clockedInCount: 0,
      overClockedCount: 0,
    };
    return keys.reduce((acc, k) => {
      const s = (byStore as any)[k];
      return {
        totalHours: acc.totalHours + s.totalHours,
        totalClockHours: acc.totalClockHours + s.totalClockHours,
        totalScheduled: acc.totalScheduled + s.totalScheduled,
        totalGross: acc.totalGross + s.totalGross,
        totalFederal: acc.totalFederal + s.totalFederal,
        totalState: acc.totalState + s.totalState,
        totalNet: acc.totalNet + s.totalNet,
        employeeCount: acc.employeeCount + s.employeeCount,
        clockedInCount: acc.clockedInCount + s.clockedInCount,
        overClockedCount: acc.overClockedCount + s.overClockedCount,
      };
    }, zero);
  }, [byStore, storeFilter]);

  const liveLabor = rows.reduce((s, r) => s + r.clockHours * r.payRate, 0);
  const savedCount = rows.filter((r) => r.hoursWorked > 0).length;
  const unsavedCount = rows.filter(
    (r) => r.clockHours > 0.25 && r.hoursWorked === 0,
  ).length;

  // Role gate AFTER all hooks so the hook order never changes between renders.
  if (user && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">CEO access only</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          This view shows cross-store payroll and withholding estimates and is
          restricted to the CEO role.
        </p>
      </div>
    );
  }

  const focusLabel =
    storeFilter === "all"
      ? "all stores"
      : (STORE_ABBR[storeFilter] ?? storeFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CEO · all stores"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Executive view"
        description={
          isLiveWeek
            ? "Live company pulse — click a store card to focus on one location."
            : `Closed week · ${fmtWeekRange(weekStart)} — saved payroll and withholding estimates.`
        }
        actions={
          <>
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />
            <StoreSelect
              stores={stores}
              isAdmin
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </>
        }
      />

      {/* The assistant — same persistent task stack, all stores in scope */}
      <AttentionCenter />

      {/* Company pulse — one strip, the money leads */}
      {ceoQ.isLoading ? (
        <Skeleton className="h-[124px] rounded-xl" />
      ) : (
        <KpiBand>
          <KpiCell
            hero
            label={isLiveWeek ? "Labor cost (live)" : "Gross payroll"}
            value={<Money value={isLiveWeek ? liveLabor : agg.totalGross} />}
            sub={
              isLiveWeek
                ? `what the team has earned so far · ${focusLabel}`
                : `payroll saved for that week · ${focusLabel}`
            }
            footer={
              !isLiveWeek && unsavedCount > 0 ? (
                <span className="chip-warn">
                  <AlertTriangle className="h-3 w-3" />
                  {unsavedCount} worked but unsaved
                </span>
              ) : !isLiveWeek && savedCount > 0 ? (
                <span className="chip-good">
                  <CheckCircle2 className="h-3 w-3" /> payroll complete
                </span>
              ) : null
            }
          />
          <KpiCell
            label="Hours clocked"
            value={agg.totalClockHours.toFixed(1)}
            sub={
              agg.totalScheduled > 0
                ? `of ${agg.totalScheduled.toFixed(1)} hours scheduled`
                : "no schedule loaded this week"
            }
            footer={
              agg.overClockedCount > 0 ? (
                <span className="chip-warn">
                  <AlertTriangle className="h-3 w-3" />
                  {agg.overClockedCount} over schedule
                </span>
              ) : agg.totalScheduled > 0 ? (
                <span className="chip-good">
                  <CheckCircle2 className="h-3 w-3" /> within schedule
                </span>
              ) : null
            }
          />
          {isLiveWeek ? (
            <KpiCell
              label="On the clock now"
              value={agg.clockedInCount}
              sub={
                agg.clockedInCount > 0
                  ? Object.entries(byStore)
                      .filter(([, s]: [string, any]) => s.clockedInCount > 0)
                      .map(
                        ([k, s]: [string, any]) =>
                          `${STORE_ABBR[k] ?? k} ${s.clockedInCount}`,
                      )
                      .join(" · ")
                  : "nobody clocked in"
              }
            />
          ) : (
            <KpiCell
              label="Saved to payroll"
              value={`${savedCount}/${rows.length}`}
              sub={`${agg.totalHours.toFixed(1)} hours entered so far`}
            />
          )}
          {isLiveWeek ? (
            <KpiCell
              label="Payroll saved"
              value={<Money value={agg.totalGross} />}
              sub="fills in when payroll is saved after Wednesday"
            />
          ) : (
            <KpiCell
              label="Net pay (est.)"
              value={<Money value={agg.totalNet} />}
              sub={`≈ ${fmtMoney(agg.totalFederal + agg.totalState)} withheld (est.)`}
            />
          )}
        </KpiBand>
      )}

      {/* Every store at one glance — the cards are the filter */}
      <section className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {ceoQ.isLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)
          : Object.entries(byStore).map(([store, s]: [string, any], i) => {
              const focused = storeFilter === store;
              return (
                <Card
                  key={store}
                  role="button"
                  tabIndex={0}
                  aria-pressed={focused}
                  onClick={() => setStoreFilter(focused ? "all" : store)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setStoreFilter(focused ? "all" : store);
                    }
                  }}
                  className={cn(
                    "surface-card border-0 rise-in cursor-pointer transition-all select-none",
                    focused
                      ? "ring-2 ring-primary shadow-md"
                      : storeFilter !== "all"
                        ? "opacity-55 hover:opacity-90"
                        : "hover:shadow-md hover:-translate-y-0.5",
                  )}
                  style={{ animationDelay: `${i * 40}ms` }}
                  title={
                    focused
                      ? "Click to show all stores"
                      : `Click to focus on ${store}`
                  }
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 truncate">
                        <Building2
                          className={cn(
                            "h-4 w-4 shrink-0",
                            focused ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="truncate">{store}</span>
                      </span>
                      {isLiveWeek && s.clockedInCount > 0 ? (
                        <span className="chip-good shrink-0">
                          <Clock className="h-3 w-3" />
                          {s.clockedInCount} in
                        </span>
                      ) : null}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    <Stat label="Clocked" value={`${s.totalClockHours.toFixed(1)}h`} />
                    <Stat label="Scheduled" value={`${s.totalScheduled.toFixed(1)}h`} />
                    <Stat
                      label={isLiveWeek ? "Labor (live)" : "Gross saved"}
                      value={fmtMoney(
                        isLiveWeek
                          ? (liveLaborByStore.get(store) ?? 0)
                          : s.totalGross,
                      )}
                      bold
                    />
                    <div>
                      <div className="kpi-label">Status</div>
                      {s.overClockedCount > 0 ? (
                        <span className="chip-warn mt-0.5">
                          <AlertTriangle className="h-3 w-3" />
                          {s.overClockedCount} over
                        </span>
                      ) : (
                        <span className="chip-good mt-0.5">
                          <CheckCircle2 className="h-3 w-3" /> on track
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </section>

      {/* Eight-week filmstrip — older payroll is one click away */}
      <Card className="surface-card border-0 rise-in" style={{ animationDelay: "160ms" }}>
        <CardHeader className="pb-1 flex flex-row items-center justify-between">
          <CardTitle className="section-title">
            Last 8 pay weeks{storeFilter !== "all" ? ` · ${focusLabel}` : ""}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            bars = clocked hours · <span className="text-success">●</span> payroll saved ·
            click to open
          </span>
        </CardHeader>
        <CardContent>
          {trendQ.isLoading ? (
            <Skeleton className="h-24 rounded-md" />
          ) : (
            <WeekTrend
              weeks={(trendQ.data?.weeks ?? []) as any}
              selected={weekStart}
              onSelect={(w) => setWeekStart(w)}
            />
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="payroll" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payroll">Payroll detail</TabsTrigger>
          <TabsTrigger value="managers">Access &amp; PINs</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll">
          <Card className="surface-card border-0">
            <CardHeader>
              <CardTitle className="section-title">
                Per-employee payroll{storeFilter !== "all" ? ` — ${storeFilter}` : ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Withholding is an estimate only — federal (FIT + FICA) at ~18%, state at
                ~5%. Gross and net come from saved payroll hours.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead className="text-right">Clocked</TableHead>
                      <TableHead className="text-right">Saved hrs</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Est. tax</TableHead>
                      <TableHead className="text-right">Est. net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ceoQ.isLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="h-24 text-center text-sm text-muted-foreground"
                        >
                          Loading payroll…
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center py-10 text-sm text-muted-foreground"
                        >
                          No payroll data for this week yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      [...rows]
                        .sort(
                          (a, b) =>
                            a.storeLocation.localeCompare(b.storeLocation) ||
                            b.clockHours - a.clockHours,
                        )
                        .map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <InitialsBadge name={r.fullName} size="sm" />
                                <div className="min-w-0">
                                  <span className="font-medium">{r.fullName}</span>
                                  <div className="text-xs text-muted-foreground">{r.role}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {STORE_ABBR[r.storeLocation] ?? r.storeLocation}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.clockHours > 0 ? r.clockHours.toFixed(1) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.hoursWorked > 0 ? r.hoursWorked.toFixed(1) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {r.overClocked ? (
                                <span className="chip-warn">
                                  <AlertTriangle className="h-3 w-3" />
                                  over
                                </span>
                              ) : r.hoursWorked > 0 ? (
                                <span className="chip-good">
                                  <CheckCircle2 className="h-3 w-3" /> saved
                                </span>
                              ) : r.clockHours > 0.25 ? (
                                <span className="chip-neutral">not saved</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {r.grossPay > 0 ? fmtMoney(r.grossPay) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {r.grossPay > 0 ? fmtMoney(r.federal + r.state) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.grossPay > 0 ? fmtMoney(r.netPay) : "—"}
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
        <CardTitle className="section-title flex items-center gap-2">
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
          <CardTitle className="section-title flex items-center gap-2">
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
