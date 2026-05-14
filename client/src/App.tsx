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

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/employees"} component={Employees} />
        <Route path={"/employees/:id"} component={EmployeeProfile} />
        <Route path={"/payroll"} component={WeeklyPayroll} />
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
