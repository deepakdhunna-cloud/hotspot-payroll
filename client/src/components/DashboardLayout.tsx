/**
 * App chrome v4: a slim, flat ink top bar carries the brand, the section nav
 * and the account chip. Content sits in a centered column on a quiet canvas.
 * On phones the sections move to a bottom tab bar, so every one of them is
 * a thumb-tap away and none is ever scrolled off-screen.
 */
import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import PinKeypad from "@/components/PinKeypad";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  ExternalLink,
  Landmark,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { BrandMark } from "./BrandMark";
import { StoreSelect } from "./StoreSelect";
import {
  StoreScopeProvider,
  useStoreScope,
} from "@/contexts/StoreScopeContext";
import { trpc } from "@/lib/trpc";

type MenuItem = {
  icon: typeof LayoutDashboard;
  label: string;
  /** Label under the icon in the phone tab bar. */
  short: string;
  path: string;
  adminOnly?: boolean;
  /** Left out of the phone tab bar (reachable from the account menu). */
  desktopOnly?: boolean;
};

const baseMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", short: "Home", path: "/" },
  { icon: Users, label: "Employees", short: "Team", path: "/employees" },
  { icon: ClipboardList, label: "Payroll", short: "Payroll", path: "/payroll" },
  { icon: CalendarDays, label: "Schedule", short: "Schedule", path: "/schedule-import" },
  { icon: ShieldCheck, label: "Executive", short: "Executive", path: "/ceo", adminOnly: true },
  {
    icon: Landmark,
    label: "Finance",
    short: "Finance",
    path: "/cfo",
    adminOnly: true,
    desktopOnly: true,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }
  if (!user) {
    return <PinKeypad />;
  }
  return (
    <StoreScopeProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </StoreScopeProvider>
  );
}

/**
 * The one store filter, living in the chrome so it follows the manager
 * across pages. Single-store logins see nothing extra — their store is
 * already in the account chip.
 */
function TopbarStoreScope({ className }: { className?: string }) {
  const { scope, setScope, stores, isAdmin } = useStoreScope();
  if (!isAdmin && stores.length <= 1) return null;
  return (
    <StoreSelect
      tone="ink"
      stores={stores}
      isAdmin={isAdmin}
      value={scope}
      onChange={setScope}
      className={className}
    />
  );
}

function NavLinks({
  items,
  isPathActive,
  onNavigate,
  className,
}: {
  items: MenuItem[];
  isPathActive: (path: string) => boolean;
  onNavigate: (path: string) => void;
  className?: string;
}) {
  return (
    <nav className={className} aria-label="Primary">
      {items.map(item => {
        const active = isPathActive(item.path);
        return (
          <button
            key={item.path}
            data-active={active}
            onClick={() => onNavigate(item.path)}
            className="topbar-link"
            aria-current={active ? "page" : undefined}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Topbar bell: live count of open attention items, visible on every page. */
function AttentionBell({ onNavigate }: { onNavigate: () => void }) {
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const count = listQ.data?.count ?? 0;
  return (
    <button
      onClick={onNavigate}
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
      title={
        count > 0
          ? `${count} item${count === 1 ? "" : "s"} need attention — open the attention center`
          : "Attention center — all clear"
      }
      aria-label="Attention center"
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-[var(--ink)]">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );
}

/** Phone-only bottom tab bar. */
function TabBar({
  items,
  isPathActive,
  onNavigate,
}: {
  items: MenuItem[];
  isPathActive: (path: string) => boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="flex">
        {items.map(item => {
          const active = isPathActive(item.path);
          return (
            <button
              key={item.path}
              data-active={active}
              onClick={() => onNavigate(item.path)}
              className="tabbar-link"
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-5 w-5" />
              {item.short}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isAdmin = user?.role === "admin";
  const isCfo = user?.role === "cfo";
  // Seamless account switching: a route the signed-in role can't use never
  // shows an "access only" wall — it glides straight to that role's home.
  // (Store logins have no business on /ceo or /cfo; the CFO login lives on
  // its portal.)
  const roleBlocked =
    !!user &&
    ((isCfo && location !== "/cfo") ||
      (!isAdmin && !isCfo && (location === "/ceo" || location === "/cfo")));
  const roleHome = isCfo ? "/cfo" : "/";
  React.useEffect(() => {
    if (roleBlocked) setLocation(roleHome, { replace: true });
  }, [roleBlocked, roleHome, setLocation]);
  const greetingQ = trpc.meta.greetingName.useQuery(undefined, {
    enabled: !!user && !isCfo,
  });
  const displayName = isAdmin
    ? "CEO"
    : isCfo
      ? "CFO"
      : (greetingQ.data?.name ?? "Manager");
  // The CFO login is a finance portal, not an operations account — its nav
  // is exactly the portal, nothing else.
  const menuItems = isCfo
    ? baseMenuItems.filter(item => item.path === "/cfo")
    : baseMenuItems.filter(item => !item.adminOnly || isAdmin);
  // The CFO portal is a single page: no tab bar.
  const showTabBar = !isCfo;
  // Highlight nested routes too (/employees/12 keeps Employees active).
  const isPathActive = (path: string) =>
    path === "/"
      ? location === "/"
      : location === path || location.startsWith(`${path}/`);

  return (
    <div className="min-h-svh flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="topbar sticky top-0 z-50 border-b border-white/[0.06]">
        <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
          <button
            onClick={() => setLocation(roleHome)}
            className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <BrandMark size="sm" tone="ink" className="h-8" />
          </button>

          {menuItems.length > 1 ? (
            <NavLinks
              items={menuItems}
              isPathActive={isPathActive}
              onNavigate={setLocation}
              className="hidden md:flex items-center gap-0.5 ml-5"
            />
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            {!isCfo && <TopbarStoreScope className="w-36 md:w-40" />}
            {!isCfo && <AttentionBell onNavigate={() => setLocation("/")} />}
            {!isCfo && (
              <button
                onClick={() =>
                  window.open("/clock", "_blank", "noopener,noreferrer")
                }
                className="hidden md:flex items-center gap-1.5 h-8 rounded-md px-2.5 text-xs font-medium text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                title="Open the punch-in kiosk in a new tab"
              >
                <Clock className="h-3.5 w-3.5" />
                Kiosk
                <ExternalLink className="h-3 w-3 opacity-60" />
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md pl-1 pr-1.5 py-1 hover:bg-white/[0.08] transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[11px] font-semibold bg-white/[0.14] text-white">
                      {isAdmin ? "C" : isCfo ? "F" : (displayName[0]?.toUpperCase() ?? "M")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden lg:block min-w-0 max-w-40">
                    <p className="text-xs font-medium text-white truncate leading-tight">
                      {displayName}
                    </p>
                    <p className="text-[11px] text-white/50 truncate leading-tight mt-0.5">
                      {isAdmin || isCfo ? "All stores" : (user?.store ?? "—")}
                    </p>
                  </div>
                  <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-white/40" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold leading-tight">{displayName}</p>
                  <p className="text-xs text-muted-foreground font-normal mt-0.5 flex items-center gap-1">
                    {isAdmin || isCfo ? (
                      <>
                        <ShieldCheck className="h-3 w-3" /> All stores
                        {isCfo ? " · read-only" : ""}
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3 w-3" /> {user?.store ?? "—"}
                      </>
                    )}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin ? (
                  <DropdownMenuItem
                    onClick={() => setLocation("/cfo")}
                    className="cursor-pointer md:hidden"
                  >
                    <Landmark className="mr-2 h-4 w-4" />
                    <span>Finance</span>
                  </DropdownMenuItem>
                ) : null}
                {!isCfo ? (
                  <DropdownMenuItem
                    onClick={() =>
                      window.open("/clock", "_blank", "noopener,noreferrer")
                    }
                    className="cursor-pointer md:hidden"
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    <span>Open time clock kiosk</span>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <div
          className={`mx-auto w-full max-w-[1180px] px-4 md:px-6 pt-6 md:pt-8 ${
            showTabBar ? "pb-24 md:pb-10" : "pb-10"
          }`}
        >
          {roleBlocked ? (
            <div
              className="flex items-center justify-center py-24"
              role="status"
              aria-label="Taking you to your dashboard"
            >
              <div className="h-8 w-8 rounded-full border-2 border-border border-t-primary animate-spin" />
            </div>
          ) : (
            children
          )}
        </div>
      </main>

      {showTabBar ? (
        <TabBar
          items={menuItems.filter(item => !item.desktopOnly)}
          isPathActive={isPathActive}
          onNavigate={setLocation}
        />
      ) : null}
    </div>
  );
}
