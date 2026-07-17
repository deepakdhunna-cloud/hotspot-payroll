import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
// Route-level code splitting: each page ships as its own chunk so first
// paint only pays for the page being opened. Behavior is identical — pages
// just stream in on demand (Core Web Vitals: smaller LCP/INP budgets).
import { Suspense, lazy, useEffect } from "react";
import { useLocation } from "wouter";

/**
 * A tab left open across a deploy will request page chunks that no longer
 * exist (old hashes are gone). Instead of a broken page, reload once to
 * pick up the new build — a session flag prevents reload loops.
 */
let reloadedThisLifetime = false;
function lazyWithReload(load: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    load().catch((err) => {
      // Dev keeps the real error visible; storage access is guarded because
      // locked-down kiosk webviews can throw on sessionStorage itself.
      if (import.meta.env.DEV || reloadedThisLifetime) throw err;
      let last = 0;
      try {
        last = Number(sessionStorage.getItem("chunk-reload-at") ?? 0);
      } catch {
        /* storage unavailable — the in-memory flag still bounds reloads */
      }
      if (Date.now() - last > 30_000) {
        reloadedThisLifetime = true;
        try {
          sessionStorage.setItem("chunk-reload-at", String(Date.now()));
        } catch {
          /* same */
        }
        window.location.reload();
        // Keep the promise pending while the reload happens.
        return new Promise<never>(() => {});
      }
      throw err;
    }),
  );
}

const Home = lazyWithReload(() => import("./pages/Home"));
const Employees = lazyWithReload(() => import("./pages/Employees"));
const EmployeeProfile = lazyWithReload(() => import("./pages/EmployeeProfile"));
const WeeklyPayroll = lazyWithReload(() => import("./pages/WeeklyPayroll"));
const ScheduleImport = lazyWithReload(() => import("./pages/ScheduleImport"));
const CeoView = lazyWithReload(() => import("./pages/CeoView"));
const CfoView = lazyWithReload(() => import("./pages/CfoView"));
const ClockKiosk = lazyWithReload(() => import("./pages/ClockKiosk"));

/** Quiet in-layout loading state while a page chunk streams in. */
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading page">
      <div className="h-8 w-8 rounded-full border-2 border-border border-t-primary animate-spin" />
    </div>
  );
}

// Legacy /time-clock URL → redirect to the Punches tab of the merged page.
function TimeClockRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/payroll?tab=punches", { replace: true });
  }, [setLocation]);
  return null;
}

function Router() {
  const [location] = useLocation();
  // The /clock kiosk runs full-screen on store tablets — no sidebar, no PIN gate.
  if (location === "/clock" || location.startsWith("/clock/")) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path={"/clock"} component={ClockKiosk} />
          <Route path={"/clock/:store"} component={ClockKiosk} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  }
  return (
    <DashboardLayout>
      <Suspense fallback={<PageFallback />}>
        <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/employees"} component={Employees} />
        <Route path={"/employees/:id"} component={EmployeeProfile} />
        <Route path={"/payroll"} component={WeeklyPayroll} />
        <Route path={"/time-clock"} component={TimeClockRedirect} />
        <Route path={"/schedule-import"} component={ScheduleImport} />
        <Route path={"/ceo"} component={CeoView} />
        <Route path={"/cfo"} component={CfoView} />
          <Route path={"/404"} component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
