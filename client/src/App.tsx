import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Employees from "./pages/Employees";
import EmployeeProfile from "./pages/EmployeeProfile";
import WeeklyPayroll from "./pages/WeeklyPayroll";
import ScheduleImport from "./pages/ScheduleImport";
import CeoView from "./pages/CeoView";
import ClockKiosk from "./pages/ClockKiosk";
import { useEffect } from "react";
import { useLocation } from "wouter";

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
      <Switch>
        <Route path={"/clock"} component={ClockKiosk} />
        <Route path={"/clock/:store"} component={ClockKiosk} />
        <Route component={NotFound} />
      </Switch>
    );
  }
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/employees"} component={Employees} />
        <Route path={"/employees/:id"} component={EmployeeProfile} />
        <Route path={"/payroll"} component={WeeklyPayroll} />
        <Route path={"/time-clock"} component={TimeClockRedirect} />
        <Route path={"/schedule-import"} component={ScheduleImport} />
        <Route path={"/ceo"} component={CeoView} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
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
