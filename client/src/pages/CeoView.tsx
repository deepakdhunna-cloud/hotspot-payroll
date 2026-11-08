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
import { Input } from "@/components/ui/input";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/PageHeader";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { KpiBand, KpiCell } from "@/components/KpiBand";
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { WeekTrend } from "@/components/WeekTrend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
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
import { STORE_ABBR, fmtMoney, fmtWeekRange, storeColor } from "@/lib/format";
import { inProgressPayWeekStart, fmtDateTime } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LayoutDashboard,
  Radio,
  RefreshCw,
  Satellite,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

export default function CeoView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [weekStart, setWeekStart] = useState<Date>(() => inProgressPayWeekStart());
  const { scope: storeFilter, setScope: setStoreFilter } = useStoreScope();

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
        <Link href="/">
          <Button className="mt-5">Go to my dashboard</Button>
        </Link>
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
        title="Executive"
        description={
          isLiveWeek
            ? `Live · ${storeFilter === "all" ? "all stores" : storeFilter} · tap a store to focus on it`
            : `Closed week · ${fmtWeekRange(weekStart)} · ${storeFilter === "all" ? "all stores" : storeFilter}`
        }
        actions={
          <>
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />
          </>
        }
      />

      {/* The assistant — same persistent task stack, all stores in scope */}
      <AttentionCenter />

      {/* Everything the CEO does here, one tap away at the top of the page */}
      <Tabs defaultValue="overview" className="gap-4 md:gap-5">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="w-max md:self-start">
            <TabsTrigger value="overview" >
              <LayoutDashboard  /> Overview
            </TabsTrigger>
            <TabsTrigger value="payroll" >
              <Wallet  /> Payroll
            </TabsTrigger>
            <TabsTrigger value="managers" >
              <KeyRound  /> Access &amp; PINs
            </TabsTrigger>
            <TabsTrigger value="activity" >
              <History  /> Activity
            </TabsTrigger>
            <TabsTrigger value="portal" >
              <Radio  /> Live portal
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5 md:space-y-6">

      {/* Company pulse — one strip, the money leads */}
      {ceoQ.isLoading ? (
        <Skeleton className="h-[124px] rounded-xl" />
      ) : (
        <KpiBand>
          <KpiCell
            hero
            icon={<Wallet />}
            label={isLiveWeek ? "Labor cost so far" : "Gross payroll"}
            value={<Money value={isLiveWeek ? liveLabor : agg.totalGross} />}
            sub={isLiveWeek ? `earned this week · ${focusLabel}` : `saved for that week · ${focusLabel}`}
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
            hue="blue"
            icon={<Clock />}
            label="Hours clocked"
            value={agg.totalClockHours.toFixed(1)}
            sub={
              agg.totalScheduled > 0
                ? `of ${agg.totalScheduled.toFixed(1)} scheduled`
                : "no schedule this week"
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
              hue="green"
              icon={<Users />}
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
              hue="teal"
              icon={<CheckCircle2 />}
              label="Saved to payroll"
              value={`${savedCount}/${rows.length}`}
              sub={`${agg.totalHours.toFixed(1)} hours entered so far`}
            />
          )}
          {isLiveWeek ? (
            <KpiCell
              hue="teal"
              icon={<CheckCircle2 />}
              label="Payroll saved"
              value={<Money value={agg.totalGross} />}
              sub="fills in once the week is paid"
            />
          ) : (
            <KpiCell
              hue="violet"
              icon={<Wallet />}
              label="Net pay (est.)"
              value={<Money value={agg.totalNet} />}
              sub={`≈ ${fmtMoney(agg.totalFederal + agg.totalState)} withheld (est.)`}
            />
          )}
        </KpiBand>
      )}

      {/* Every store at one glance — the cards are the filter */}
      <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {ceoQ.isLoading
          ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)
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
                    "surface-card gap-0 py-0 cursor-pointer transition-all select-none overflow-hidden",
                    focused
                      ? "ring-2 ring-[var(--hue)] shadow-md"
                      : storeFilter !== "all"
                        ? "opacity-55 hover:opacity-90"
                        : "hover:-translate-y-px hover:shadow-md",
                  )}
                  style={{ ["--hue" as string]: storeColor(store) } as React.CSSProperties}
                  title={
                    focused
                      ? "Tap to show all stores"
                      : `Tap to focus on ${store}`
                  }
                >
                  <div className="h-1 w-full" style={{ background: "var(--hue)" }} aria-hidden="true" />
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 truncate text-sm font-semibold">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--hue)" }} />
                        {STORE_ABBR[store] ?? store}
                      </span>
                      {isLiveWeek && s.clockedInCount > 0 ? (
                        <span className="chip-good shrink-0">{s.clockedInCount} in</span>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xl font-semibold tabular-nums tracking-tight">
                        <Money
                          value={
                            isLiveWeek ? (liveLaborByStore.get(store) ?? 0) : s.totalGross
                          }
                        />
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {s.totalClockHours.toFixed(1)}h of {s.totalScheduled.toFixed(1)}h
                      </p>
                      <div className="mt-1.5 h-1.5 rounded-full bg-[color-mix(in_oklab,var(--hue)_14%,transparent)] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${s.totalScheduled > 0 ? Math.min(100, (s.totalClockHours / s.totalScheduled) * 100) : 0}%`,
                            background: "var(--hue)",
                          }}
                        />
                      </div>
                    </div>
                    {s.overClockedCount > 0 ? (
                      <span className="chip-warn">
                        <AlertTriangle className="h-3 w-3" />
                        {s.overClockedCount} over schedule
                      </span>
                    ) : (
                      <span className="chip-good">
                        <CheckCircle2 className="h-3 w-3" /> on track
                      </span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </section>

      {/* Eight-week filmstrip — older payroll is one click away */}
      <Card className="surface-card border-0 gap-0 py-0">
        <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5 pt-4 pb-2">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <History />
            </span>
            Last 8 pay weeks{storeFilter !== "all" ? ` · ${focusLabel}` : ""}
          </CardTitle>
          <span className="hidden sm:inline text-xs text-muted-foreground">tap a week to open it</span>
        </CardHeader>
        <CardContent className="px-4 sm:px-5 pb-4">
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

        </TabsContent>

        <TabsContent value="payroll">
          <Card className="surface-card border-0 gap-0 py-0">
            <CardHeader className="px-4 sm:px-5 pt-4 pb-3">
              <CardTitle className="section-title">
                <span className="icon-badge icon-badge-sm">
                  <Wallet />
                </span>
                Payroll by employee{storeFilter !== "all" ? ` · ${storeFilter}` : ""}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Tax is an estimate: federal (FIT + FICA) ~18%, state ~5%, on saved payroll.
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

        <TabsContent value="portal">
          <LivePortalPanel />
        </TabsContent>
      </Tabs>
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
    <Card className="surface-card border-0 gap-0 py-0">
      <CardHeader className="px-4 sm:px-5 pt-4 pb-3">
        <CardTitle className="section-title">
          <span className="icon-badge icon-badge-sm">
            <KeyRound />
          </span>
          Access PINs
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Changing a PIN signs out every device that used the old one. Do it when a device
          is lost or a manager leaves.
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
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          )}
          {label}
        </span>
      </TableCell>
      <TableCell>
        {isSet ? (
          <span className="chip-good">Active</span>
        ) : (
          <span className="chip-warn">Not set</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={8}
            placeholder="New PIN"
            aria-label={`New PIN for ${label}, 4 to 8 digits`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-8 w-32 text-center text-sm tabular-nums tracking-widest"
          />
          <Button
            size="sm"
            variant={valid ? "default" : "outline"}
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
    "portal.syncNow": "Pushed snapshot to portal",
    "export.full": "Downloaded full data export",
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
                          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> CEO
                        </span>
                      ) : e.actorScope === "cfo" ? (
                        "CFO"
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

/**
 * Live portal relay — shows whether this site is actually delivering its
 * data to the portal, why not when it isn't, and a button to push right
 * now. The site is the system of record; the portal only receives.
 */
function LivePortalPanel() {
  const statusQ = trpc.portal.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const linkQ = trpc.portal.portalLink.useQuery();
  const utils = trpc.useUtils();
  const syncNow = trpc.portal.syncNow.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Snapshot delivered to the portal (${r.durationMs} ms)`);
      } else {
        toast.error(r.error ?? "Push failed");
      }
      utils.portal.status.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const s = statusQ.data;

  const sinceLabel = (iso?: string) => {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "moments ago";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
    return `${Math.floor(ms / 86_400_000)} d ago`;
  };

  const relayChip = !s ? null : !s.configured ? (
    <span className="chip-warn">
      <AlertTriangle className="h-3 w-3" /> off — nothing is being sent
    </span>
  ) : s.lastError ? (
    <span className="chip-warn">
      <AlertTriangle className="h-3 w-3" /> failing ({s.consecutiveFailures}×)
    </span>
  ) : s.lastSuccessAt ? (
    <span className="chip-good">
      <CheckCircle2 className="h-3 w-3" /> delivering
    </span>
  ) : (
    <span className="chip-neutral">waiting for first push</span>
  );

  return (
    <div className="space-y-4">
      <MoveToPortalCard />
      <Card className="surface-card border-0">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="section-title flex items-center gap-2">
              <Satellite className="h-5 w-5" /> Live relay to the portal
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              This website is the system of record. When the relay is on, it
              pushes the full snapshot (employees, payroll, punches, schedules)
              to the portal seconds after every change, plus on a fixed cadence
              as a safety net.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {relayChip}
            <Button
              size="sm"
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending || !s?.configured}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-1.5", syncNow.isPending && "animate-spin")}
              />
              {syncNow.isPending ? "Pushing…" : "Sync now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statusQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !s ? (
            <p className="text-sm text-muted-foreground">
              Could not load relay status.
            </p>
          ) : !s.configured ? (
            <div className="rounded-lg border border-dashed p-4 text-sm space-y-2">
              {s.configError ? (
                <p className="font-medium text-destructive">{s.configError}</p>
              ) : (
                <p className="font-medium">The relay is not configured.</p>
              )}
              <p className="text-muted-foreground">
                Set{" "}
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  PORTAL_SYNC_URL
                </code>{" "}
                (the portal&apos;s ingest address) and{" "}
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  PORTAL_SYNC_TOKEN
                </code>{" "}
                (shared secret) in this site&apos;s hosting environment, then
                restart it. Until then the portal receives nothing from this
                site.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {s.lastError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Last push failed
                  </p>
                  <p className="text-muted-foreground mt-1 break-words">{s.lastError}</p>
                </div>
              )}
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div>
                  <div className="kpi-label">Destination</div>
                  <div className="font-mono text-xs mt-1 break-all">{s.target}</div>
                </div>
                <div>
                  <div className="kpi-label">Cadence</div>
                  <div className="mt-1">
                    every {s.intervalSeconds}s + instantly after changes
                  </div>
                </div>
                <div>
                  <div className="kpi-label">Authentication</div>
                  <div className="mt-1">
                    {s.hasToken ? "Bearer token set" : "no token (open endpoint)"}
                  </div>
                </div>
                <div>
                  <div className="kpi-label">Last delivered</div>
                  <div className="mt-1">
                    {s.lastSuccessAt ? (
                      <>
                        {sinceLabel(s.lastSuccessAt)}
                        <span className="text-xs text-muted-foreground ml-1.5">
                          ({fmtDateTime(new Date(s.lastSuccessAt))})
                        </span>
                      </>
                    ) : (
                      "never since this server started"
                    )}
                  </div>
                </div>
                <div>
                  <div className="kpi-label">Last attempt</div>
                  <div className="mt-1">
                    {sinceLabel(s.lastAttemptAt)}
                    {typeof s.lastDurationMs === "number" && s.lastAttemptAt && (
                      <span className="text-xs text-muted-foreground ml-1.5">
                        ({s.lastDurationMs} ms)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="kpi-label">Records in last delivery</div>
                  <div className="mt-1">
                    {s.lastCounts
                      ? `${s.lastCounts.employees} employees · ${s.lastCounts.payrollEntries} payroll · ${s.lastCounts.timePunches} punches · ${s.lastCounts.scheduleShifts} shifts`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="surface-card border-0">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="section-title text-base">
              The portal page — hosted right here
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              A standalone, read-only live dashboard at{" "}
              <code className="font-mono">/portal</code>: who&apos;s on the
              clock, week hours and labor per store, refreshed every 30
              seconds. The link carries its own access key — anyone you send
              it to can watch, and nothing more. No pay rates or personal
              details appear on it.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={!linkQ.data?.configured}
            onClick={() => {
              if (linkQ.data?.url)
                window.open(linkQ.data.url, "_blank", "noopener,noreferrer");
            }}
          >
            <Satellite className="h-3.5 w-3.5 mr-1.5" /> Open portal
          </Button>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {s?.pullFeedTokenSet ? (
            <span className="chip-good">
              <CheckCircle2 className="h-3 w-3" /> on — portal page and pull feed
              are unlocked
            </span>
          ) : (
            <div className="space-y-1.5">
              <span className="chip-neutral">off</span>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">PORTAL_FEED_TOKEN</code> is not set
                in this site&apos;s environment, so the portal page and the
                pull feed at <code className="font-mono">/api/portal-feed</code>{" "}
                are refused until it is.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Integrations can also pull the full raw snapshot from{" "}
            <code className="font-mono">/api/portal-feed</code> with{" "}
            <code className="font-mono">Authorization: Bearer</code> and the
            same token.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Everything needed to move the site into the CEO's own portal: the full
 * history as files, the live feed for whatever comes after, and the code.
 */
function MoveToPortalCard() {
  const [withCredentials, setWithCredentials] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const accessQ = trpc.portal.feedAccess.useQuery(undefined, { enabled: revealed });
  const token = accessQ.data?.token ?? null;
  const feedUrl = `${window.location.origin}/api/portal-feed`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy. Select it and copy it by hand.");
    }
  };

  const downloadEverything = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/export/full${withCredentials ? "?credentials=1" : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        "hotspot-payroll-export.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Downloaded. It holds personal data, so keep it somewhere private.");
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="surface-card border-0">
      <CardHeader>
        <CardTitle className="section-title flex items-center gap-2">
          <Database className="h-5 w-5" /> Move everything to your own portal
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Three pieces: every record from day one, a live connection for
          everything entered after that, and the website itself.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <section className="space-y-2">
          <div className="font-medium">1 · All history: download everything</div>
          <p className="text-xs text-muted-foreground">
            One .zip with every employee, punch, payroll week, schedule, alert
            and activity-log entry, as JSON, spreadsheet (CSV) and MySQL files,
            plus a step-by-step guide. Each download is recorded in the
            activity log.
          </p>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={withCredentials}
              onCheckedChange={(v) => setWithCredentials(v === true)}
              className="mt-0.5"
            />
            <span>
              Include sign-in PINs and employee clock codes. Only needed if your
              portal will run sign-in and the time clock itself.{" "}
              <span className="font-medium text-destructive">
                The clock-code data can be turned back into each employee&apos;s
                code, so treat the file like a list of codes.
              </span>
            </span>
          </label>
          <Button size="sm" onClick={downloadEverything} disabled={downloading}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {downloading ? "Preparing…" : "Download everything (.zip)"}
          </Button>
        </section>

        <section className="space-y-2">
          <div className="font-medium">2 · New data, live: connect your portal</div>
          <p className="text-xs text-muted-foreground">
            Your portal asks this address for data and sends the key in an{" "}
            <code className="font-mono">Authorization: Bearer</code> header.
            Every answer is the complete, current data: everything in the
            download plus whatever was entered since. Checking every 1–5
            minutes keeps the portal live.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">
              {feedUrl}
            </code>
            <Button size="sm" variant="outline" onClick={() => copy(feedUrl, "Feed address")}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">
              {!revealed
                ? "••••••••••••••••"
                : accessQ.isLoading
                  ? "loading…"
                  : (token ?? "not set. Add PORTAL_FEED_TOKEN on Railway.")}
            </code>
            <Button size="sm" variant="outline" onClick={() => setRevealed((r) => !r)}>
              {revealed ? (
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1.5" />
              )}
              {revealed ? "Hide key" : "Show key"}
            </Button>
            {revealed && token && (
              <Button size="sm" variant="outline" onClick={() => copy(token, "Access key")}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy key
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Would you rather this site send the data to your portal? Set{" "}
            <code className="font-mono">PORTAL_SYNC_URL</code> on Railway. The
            relay card below shows whether it&apos;s delivering.
          </p>
        </section>

        <section className="space-y-1">
          <div className="font-medium">3 · The website itself</div>
          <p className="text-xs text-muted-foreground">
            The code lives in GitHub at{" "}
            <code className="font-mono">deepakdhunna-cloud/hotspot-payroll</code>.
            The guide in the download explains running it inside your portal
            and copying the whole database across in one step.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
