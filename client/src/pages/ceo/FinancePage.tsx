/**
 * Finance — the money views, shared by two portals.
 *
 * The CFO signs in to exactly this (at /cfo); the CEO has it as a section of
 * the command center (at /ceo/finance). Both get the same two read-only
 * views — the labor-cost overview and the payroll register — in the
 * executive look. Which portal it is only changes the addresses.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import CfoView from "@/pages/CfoView";
import PayrollRegister from "@/pages/cfo/Register";
import { BarChart3, ListOrdered } from "lucide-react";
import { Link, useLocation } from "wouter";

function FinancePortal({ view }: { view: "overview" | "register" }) {
  const { user } = useAuth();
  const [location] = useLocation();
  // The CEO's copy lives under /ceo/finance; the CFO's is /cfo.
  const base = location.startsWith("/ceo") ? "/ceo/finance" : "/cfo";
  const eyebrow = `Hotspot Market // ${user?.role === "admin" ? "CEO" : "CFO"}`;
  const tabs = [
    { key: "overview", href: base, label: "Overview", icon: BarChart3 },
    { key: "register", href: `${base}/register`, label: "Register", icon: ListOrdered },
  ] as const;
  const switcher = (
    <nav className="inline-flex rounded-lg border border-border p-0.5" aria-label="Finance views">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={view === t.key ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
            view === t.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <t.icon className="h-4 w-4" aria-hidden />
          {t.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="cc">
      <div className="cc-backdrop" aria-hidden="true" />
      <div className="cc-body">
        {view === "overview" ? (
          <CfoView eyebrow={eyebrow} actions={switcher} />
        ) : (
          <PayrollRegister eyebrow={eyebrow} actions={switcher} />
        )}
      </div>
    </div>
  );
}

export default function FinanceOverviewPage() {
  return <FinancePortal view="overview" />;
}

export function FinanceRegisterPage() {
  return <FinancePortal view="register" />;
}
