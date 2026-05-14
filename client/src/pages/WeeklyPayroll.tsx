/**
 * Combined Payroll page. Three tabs:
 *   1. Hours & pay — the per-employee weekly grid (auto-prefills from clock).
 *   2. Punches    — the time-clock log with manual add / edit / delete.
 *   3. History    — multi-week summary + xlsx export for any range.
 *
 * The header (week navigator, store filter, Open kiosk button) is shared by all
 * three tabs. The tab is reflected in the URL (?tab=hours|punches|history) so
 * the dashboard CTA and the alias from /time-clock can land on the right tab.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { fmtWeekRange } from "@/lib/format";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  History as HistoryIcon,
  Pencil,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import HoursAndPayTab from "./payroll/HoursAndPayTab";
import PunchesTab from "./payroll/PunchesTab";
import HistoryTab from "./payroll/HistoryTab";
import { PageHeader } from "@/components/PageHeader";

function startOfPayWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay();
  const diff = (day - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function currentPayPeriodStart(now: Date = new Date()): Date {
  // The most recently closed Thursday→Wednesday — i.e. the week we're paying.
  const start = startOfPayWeek(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return start;
}

function toDateInput(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromDateInput(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

type TabKey = "hours" | "punches" | "history";

function readTabFromQuery(): TabKey {
  if (typeof window === "undefined") return "hours";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "punches" || t === "history") return t;
  return "hours";
}

export default function WeeklyPayroll() {
  const [location] = useLocation();
  // Re-read tab from URL whenever the route string changes (covers in-app nav).
  const [tab, setTab] = useState<TabKey>(readTabFromQuery);
  useEffect(() => {
    setTab(readTabFromQuery());
  }, [location]);

  const [weekStart, setWeekStart] = useState<Date>(() =>
    currentPayPeriodStart(new Date()),
  );
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const scopeQ = trpc.meta.myScope.useQuery();
  const stores = scopeQ.data?.stores ?? [];
  const isAdmin = scopeQ.data?.isAdmin ?? false;
  // CEO sees the "All stores" option. Managers tied to one store get pinned to
  // their store; multi-store managers see "All my stores".
  const canPickAll = isAdmin || stores.length > 1;
  useEffect(() => {
    if (!canPickAll && stores.length === 1 && storeFilter !== stores[0]) {
      setStoreFilter(stores[0]);
    }
  }, [canPickAll, stores, storeFilter]);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d);
  };

  const switchTab = (next: TabKey) => {
    setTab(next);
    // Reflect the tab in the URL so deep links + refresh keep the same view.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.toString());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll"
        icon={<ClipboardList className="h-5 w-5" />}
        title="Payroll & time clock"
        description="Thursday–Wednesday pay period. Hours auto-fill from the kiosk. Saved entries are kept permanently."
        actions={<>
          {tab !== "history" && (
            <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(-1)}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-2 text-sm font-medium hover:bg-accent rounded-md py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Edit pay-period start date"
                  >
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {fmtWeekRange(weekStart)}
                    <Pencil className="h-3 w-3 text-muted-foreground ml-1" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3" align="end">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Pay-period start
                    </label>
                    <Input
                      type="date"
                      value={toDateInput(weekStart)}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setWeekStart(
                          startOfPayWeek(fromDateInput(e.target.value)),
                        );
                      }}
                      className="w-44"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Snaps to the Thursday of the chosen week.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(1)}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Select
            value={storeFilter}
            onValueChange={setStoreFilter}
            disabled={!canPickAll && stores.length <= 1}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Store" />
            </SelectTrigger>
            <SelectContent>
              {canPickAll && (
                <SelectItem value="all">
                  {isAdmin ? "All stores" : "All my stores"}
                </SelectItem>
              )}
              {stores.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() =>
              window.open("/clock", "_blank", "noopener,noreferrer")
            }
            title="Open the public punch-in kiosk in a new tab"
          >
            <ExternalLink className="h-4 w-4 mr-2" /> Open kiosk
          </Button>
        </>}
      />

      <Tabs value={tab} onValueChange={(v) => switchTab(v as TabKey)}>
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="hours" className="gap-2">
            <ClipboardList className="h-4 w-4" /> Hours & pay
          </TabsTrigger>
          <TabsTrigger value="punches" className="gap-2">
            <Clock className="h-4 w-4" /> Punches
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <HistoryIcon className="h-4 w-4" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hours" className="mt-4">
          <HoursAndPayTab weekStart={weekStart} storeFilter={storeFilter} />
        </TabsContent>
        <TabsContent value="punches" className="mt-4">
          <PunchesTab weekStart={weekStart} storeFilter={storeFilter} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab storeFilter={storeFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
