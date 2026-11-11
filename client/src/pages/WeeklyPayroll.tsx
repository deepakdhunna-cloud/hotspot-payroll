/**
 * Combined Payroll page. Three tabs:
 *   1. Hours & pay — the weekly timesheet (auto-prefills from the clock).
 *   2. Punches    — the time-clock log with manual add / edit / delete.
 *   3. History    — multi-week summary + xlsx export for any range.
 *
 * The header (week navigator) is shared by Hours & pay and Punches; the
 * store comes from the top bar. Tab AND week live in the URL
 * (?tab=hours|punches|history&week=YYYY-MM-DD), so refresh, Back and shared
 * links open exactly what was on screen.
 *
 * Unsaved Hours & pay edits are never dropped silently: the tab stays
 * mounted while you look at Punches or History, and switching week or store
 * with edits open asks first (save, discard, or keep editing).
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  currentPayPeriodStart,
  fromDateInput,
  inProgressPayWeekStart,
  startOfPayWeek,
  toDateInput,
} from "@/lib/payweek";
import { fmtWeekRange } from "@/lib/format";
import { QuickWeekNav } from "@/components/QuickWeekNav";
import { useStoreScope } from "@/contexts/StoreScopeContext";
import {
  ClipboardList,
  Clock,
  History as HistoryIcon,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import HoursAndPayTab, { draftWeeks, type HoursController } from "./payroll/HoursAndPayTab";
import { trpc } from "@/lib/trpc";
import PunchesTab from "./payroll/PunchesTab";
import HistoryTab from "./payroll/HistoryTab";
import { PageHeader } from "@/components/PageHeader";
import { FLAG_EVENT } from "@/lib/queryFlag";

type TabKey = "hours" | "punches" | "history";

function readTabFromQuery(): TabKey {
  if (typeof window === "undefined") return "hours";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "punches" || t === "history") return t;
  return "hours";
}

/** The ?week=YYYY-MM-DD in the URL, snapped to its Thursday (or null). */
function readWeekParam(): Date | null {
  if (typeof window === "undefined") return null;
  const w = new URLSearchParams(window.location.search).get("week");
  if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const live = inProgressPayWeekStart();
    const snapped = startOfPayWeek(fromDateInput(w));
    // Payroll never opens a week that hasn't started.
    return snapped.getTime() > live.getTime() ? live : snapped;
  }
  return null;
}

/**
 * Week to open with: the deep-linked one; else the week you left with
 * unsaved Hours & pay edits; else Punches opens on the live week (that's
 * where today's punches are) and Hours & pay on the last closed week (the
 * one to pay).
 */
function initialWeek(draftWeek: string | undefined): Date {
  const linked = readWeekParam();
  if (linked) return linked;
  if (draftWeek && readTabFromQuery() !== "history") return fromDateInput(draftWeek);
  if (readTabFromQuery() === "punches") return inProgressPayWeekStart();
  return currentPayPeriodStart();
}

/**
 * `?who=<employee id>` opens Punches on one person (the command center links
 * here to fix a flagged shift). Read once and removed from the address, so a
 * refresh or Back doesn't re-apply a filter the manager has since changed.
 */
function readWhoParam(): number | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("who");
  if (raw === null) return null;
  url.searchParams.delete("who");
  window.history.replaceState(window.history.state, "", url.toString());
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type PendingSwitch = { kind: "week"; to: Date } | { kind: "store"; to: string };

const storeName = (s: string) => (s === "all" ? "all stores" : s);

export default function WeeklyPayroll() {
  const [location] = useLocation();
  // Re-read tab from URL whenever the route string changes (covers in-app nav).
  const [tab, setTab] = useState<TabKey>(readTabFromQuery);
  useEffect(() => {
    setTab(readTabFromQuery());
  }, [location]);

  // Store scope lives in the top bar and follows the manager across pages.
  const { scope: storeFilter, setScope } = useStoreScope();
  const utils = trpc.useUtils();
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const waiting = draftWeeks(utils.auth.me.getData()?.scope, storeFilter);
    return initialWeek(waiting[waiting.length - 1]);
  });
  usePageTitle(tab === "punches" ? "Punches" : tab === "history" ? "Payroll history" : "Payroll");

  // ---- Unsaved Hours & pay edits ----
  const hoursCtl = useRef<HoursController | null>(null);
  const [hoursEdited, setHoursEdited] = useState(0);
  const hoursEditedRef = useRef(0);
  hoursEditedRef.current = hoursEdited;
  const onEditedChange = useCallback((n: number) => setHoursEdited(n), []);
  // The store the timesheet is showing. It only follows the top bar once
  // any unsaved edits for the current store are saved or discarded.
  const [hoursStore, setHoursStore] = useState(storeFilter);
  const allowStore = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [switching, setSwitching] = useState(false);
  // Punches in "custom dates" mode don't use the header's week picker.
  const [punchRange, setPunchRange] = useState(false);
  // "See punches" on a timesheet row opens Punches on that one person.
  const [punchWho, setPunchWho] = useState<number | null>(readWhoParam);

  /** Change week — but ask first if Hours & pay has unsaved edits. */
  const requestWeek = useCallback(
    (next: Date) => {
      if (next.getTime() === weekStart.getTime()) return;
      if (hoursEditedRef.current > 0) setPending({ kind: "week", to: next });
      else setWeekStart(next);
    },
    [weekStart],
  );

  // A store change from the top bar with edits open: put the picker back
  // and ask. (Punches and History follow the top bar directly.)
  useEffect(() => {
    if (storeFilter === hoursStore) return;
    if (hoursEditedRef.current > 0 && allowStore.current !== storeFilter) {
      setPending({ kind: "store", to: storeFilter });
      setScope(hoursStore);
      return;
    }
    allowStore.current = null;
    setHoursStore(storeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter]);

  // Keep the week in the URL so refresh, Back and shared links match the screen.
  useEffect(() => {
    const url = new URL(window.location.href);
    const iso = toDateInput(weekStart);
    if (url.searchParams.get("week") === iso) return;
    url.searchParams.set("week", iso);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [weekStart]);

  // The browser Back button undoes a tab switch (switchTab pushes real
  // history entries), so re-read the tab — and the week — whenever history
  // pops. A week change from Back still asks first if edits are open.
  const requestWeekRef = useRef(requestWeek);
  requestWeekRef.current = requestWeek;
  useEffect(() => {
    const onPop = () => {
      setTab(readTabFromQuery());
      const w = readWeekParam();
      if (w) requestWeekRef.current(w);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // In-app navigation that changes only the query string — the "+" quick
  // actions or the command bar while Payroll is already open — is the same
  // route, so nothing above re-runs. Those navigations announce themselves
  // (see lib/queryFlag); re-read the tab so "Fix a punch" really opens
  // Punches, and so its ?add=1 has a mounted tab to open the form.
  const weekRef = useRef(weekStart);
  weekRef.current = weekStart;
  useEffect(() => {
    const onNavigate = () => {
      setTab(readTabFromQuery());
      setPunchWho(null);
      const w = readWeekParam();
      if (w) {
        requestWeekRef.current(w);
        return;
      }
      // The new address dropped the week: stay on the one on screen and put
      // it back in the URL, so refresh and Back still match the page.
      const url = new URL(window.location.href);
      url.searchParams.set("week", toDateInput(weekRef.current));
      window.history.replaceState(window.history.state, "", url.toString());
    };
    window.addEventListener(FLAG_EVENT, onNavigate);
    return () => window.removeEventListener(FLAG_EVENT, onNavigate);
  }, []);

  const switchTab = (next: TabKey) => {
    setTab(next);
    if (next !== "punches") setPunchWho(null);
    // Reflect the tab in the URL so deep links + refresh keep the same view.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState({}, "", url.toString());
  };

  const finishSwitch = (p: PendingSwitch) => {
    if (p.kind === "week") setWeekStart(p.to);
    else {
      allowStore.current = p.to;
      setScope(p.to);
    }
    setPending(null);
  };
  const discardAndSwitch = () => {
    if (!pending) return;
    hoursCtl.current?.discardEdits();
    finishSwitch(pending);
  };
  const saveAndSwitch = async () => {
    if (!pending) return;
    const p = pending;
    setSwitching(true);
    try {
      const ok = (await hoursCtl.current?.saveEdited()) ?? true;
      if (ok) finishSwitch(p);
      else setPending(null); // stay put; the toast lists what needs fixing
    } finally {
      setSwitching(false);
    }
  };

  const showWeekNav = tab === "hours" || (tab === "punches" && !punchRange);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Pay weeks run Thursday to Wednesday. Hours fill in from the time clock."
        actions={
          showWeekNav ? <QuickWeekNav weekStart={weekStart} onChange={requestWeek} /> : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => switchTab(v as TabKey)}>
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:self-start">
          <TabsTrigger value="hours" className="gap-2">
            <ClipboardList className="h-4 w-4" /> Hours & pay
            {hoursEdited > 0 ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                <span className="sr-only">({hoursEdited} unsaved)</span>
              </>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="punches" className="gap-2">
            <Clock className="h-4 w-4" /> Punches
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <HistoryIcon className="h-4 w-4" /> History
          </TabsTrigger>
        </TabsList>

        {/* Stays mounted while another tab is open, so edits survive. */}
        <TabsContent value="hours" forceMount className="mt-4 data-[state=inactive]:hidden">
          <HoursAndPayTab
            key={`${weekStart.getTime()}|${hoursStore}`}
            weekStart={weekStart}
            storeFilter={hoursStore}
            controllerRef={hoursCtl}
            onEditedChange={onEditedChange}
            onOpenWeek={requestWeek}
            onShowPunches={(employeeId) => {
              setPunchWho(employeeId);
              switchTab("punches");
              window.scrollTo({ top: 0 });
            }}
          />
        </TabsContent>
        <TabsContent value="punches" className="mt-4">
          <PunchesTab
            key={punchWho ?? "everyone"}
            weekStart={weekStart}
            storeFilter={storeFilter}
            onRangeModeChange={setPunchRange}
            initialEmployeeId={punchWho}
          />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab storeFilter={storeFilter} />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !switching) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes first?</AlertDialogTitle>
            <AlertDialogDescription>
              {hoursEdited} {hoursEdited === 1 ? "change" : "changes"} on Hours & pay for{" "}
              {fmtWeekRange(weekStart)} {hoursEdited === 1 ? "isn't" : "aren't"} saved yet.
              {pending?.kind === "week"
                ? ` Save before opening ${fmtWeekRange(pending.to)}, or discard them.`
                : pending?.kind === "store"
                  ? ` Save before switching to ${storeName(pending.to)}, or discard them.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={discardAndSwitch}
              disabled={switching}
            >
              Discard changes
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <AlertDialogCancel disabled={switching}>Keep editing</AlertDialogCancel>
              <Button onClick={() => void saveAndSwitch()} disabled={switching}>
                {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {switching ? "Saving…" : "Save and continue"}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
