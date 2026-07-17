/**
 * Combined Payroll page. Three tabs:
 *   1. Hours & pay — the per-employee weekly grid (auto-prefills from clock).
 *   2. Punches    — the time-clock log with manual add / edit / delete.
 *   3. History    — multi-week summary + xlsx export for any range.
 *
 * The header (week navigator, store filter) is shared by all
 * three tabs. The tab is reflected in the URL (?tab=hours|punches|history) so
 * the dashboard CTA and the alias from /time-clock can land on the right tab.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  currentPayPeriodStart,
  fromDateInput,
  startOfPayWeek,
} from "@/lib/payweek";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { StoreSelect } from "@/components/StoreSelect";
import {
  ClipboardList,
  Clock,
  History as HistoryIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import HoursAndPayTab from "./payroll/HoursAndPayTab";
import PunchesTab from "./payroll/PunchesTab";
import HistoryTab from "./payroll/HistoryTab";
import { PageHeader } from "@/components/PageHeader";

type TabKey = "hours" | "punches" | "history";

function readTabFromQuery(): TabKey {
  if (typeof window === "undefined") return "hours";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "punches" || t === "history") return t;
  return "hours";
}

/** Dashboard CTAs deep-link a week via ?week=YYYY-MM-DD; snap it to Thursday. */
function readWeekFromQuery(): Date {
  if (typeof window !== "undefined") {
    const w = new URLSearchParams(window.location.search).get("week");
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
      return startOfPayWeek(fromDateInput(w));
    }
  }
  return currentPayPeriodStart();
}

export default function WeeklyPayroll() {
  const [location] = useLocation();
  // Re-read tab from URL whenever the route string changes (covers in-app nav).
  const [tab, setTab] = useState<TabKey>(readTabFromQuery);
  useEffect(() => {
    setTab(readTabFromQuery());
  }, [location]);

  const [weekStart, setWeekStart] = useState<Date>(readWeekFromQuery);
  // "all" is safe for single-store managers too: the server scopes queries to
  // their store, and StoreSelect renders a static badge instead of a picker.
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const scopeQ = trpc.meta.myScope.useQuery();
  const stores = scopeQ.data?.stores ?? [];
  const isAdmin = scopeQ.data?.isAdmin ?? false;

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
            <QuickWeekNav weekStart={weekStart} onChange={setWeekStart} />
          )}
          <StoreSelect
            stores={stores}
            isAdmin={isAdmin}
            value={storeFilter}
            onChange={setStoreFilter}
          />
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
