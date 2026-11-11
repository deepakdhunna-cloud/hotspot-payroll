/**
 * App chrome v4: a slim ink top bar carries the brand, the horizontal nav
 * (signal-red underline marks the active section) and the account chip.
 * Content sits on a porcelain canvas in a centered column so tables get
 * their full width. On phones the sections move to a bottom tab bar, the
 * way a native app works — and the chrome respects the notch and home
 * indicator when the site is launched from the home screen.
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
  ChevronDown,
  ClipboardList,
  Clock,
  ExternalLink,
  Landmark,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Smartphone,
  Upload,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { BrandMark } from "./BrandMark";
import { StoreSelect } from "./StoreSelect";
import {
  StoreScopeProvider,
  useStoreScope,
} from "@/contexts/StoreScopeContext";
import { trpc } from "@/lib/trpc";
import { useInstallApp } from "@/lib/installApp";
import { PullToRefresh } from "./PullToRefresh";
import { toast } from "sonner";

type MenuItem = {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  adminOnly?: boolean;
};

const baseMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Employees", path: "/employees" },
  { icon: ClipboardList, label: "Payroll", path: "/payroll" },
  { icon: Upload, label: "Schedule", path: "/schedule-import" },
  { icon: ShieldCheck, label: "CEO", path: "/ceo", adminOnly: true },
  { icon: Landmark, label: "CFO", path: "/cfo", adminOnly: true },
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
      compact
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
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/80 hover:text-white hover:border-white/30 transition-colors"
      title={
        count > 0
          ? `${count} item${count === 1 ? "" : "s"} need attention — open the attention center`
          : "Attention center — all clear"
      }
      aria-label="Attention center"
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-[var(--ink)]">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
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
  // Highlight nested routes too (/employees/12 keeps Employees active).
  const isPathActive = (path: string) =>
    path === "/"
      ? location === "/"
      : location === path || location.startsWith(`${path}/`);

  // Phones: sections live in a bottom tab bar. Five tabs at most (the CFO
  // analytics page moves into the account menu for the CEO), and none at
  // all when a login only has one page.
  const tabItems = menuItems.filter(item => !(isAdmin && item.path === "/cfo"));
  const showTabBar = tabItems.length > 1;

  const install = useInstallApp();
  const [installHelpOpen, setInstallHelpOpen] = React.useState(false);
  const onInstall = async () => {
    if (install.canPrompt) {
      const accepted = await install.prompt();
      if (accepted) toast.success("Installed — open Hotspot from your home screen.");
      return;
    }
    setInstallHelpOpen(true);
  };

  const openKiosk = () => window.open("/clock", "_blank", "noopener,noreferrer");

  return (
    <div className="min-h-svh flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="app-chrome app-header ink-panel sticky top-0 z-50 border-b border-white/10">
        <div className="app-gutter flex h-14 items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setLocation("/")}
            className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <BrandMark size="sm" tone="ink" className="h-[26px] sm:h-8 md:h-9" />
          </button>

          <NavLinks
            items={menuItems}
            isPathActive={isPathActive}
            onNavigate={setLocation}
            className="hidden md:flex items-center ml-4"
          />

          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            {!isCfo && (
              <TopbarStoreScope className="w-[7.5rem] sm:w-36 md:w-40" />
            )}
            {!isCfo && <AttentionBell onNavigate={() => setLocation("/")} />}
            {!isCfo && (
              <button
                onClick={openKiosk}
                className="hidden md:flex items-center gap-1.5 h-9 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 hover:text-white hover:border-white/30 transition-colors"
                title="Open the punch-in kiosk in a new tab"
              >
                <Clock className="h-3.5 w-3.5" />
                Kiosk
                <ExternalLink className="h-3 w-3 opacity-60" />
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex shrink-0 items-center gap-2.5 rounded-lg p-0.5 sm:px-1.5 sm:py-1 hover:bg-white/10 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Account menu"
                >
                  <Avatar className="h-8 w-8 border border-white/20 shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {isAdmin ? "C" : isCfo ? "F" : (displayName[0]?.toUpperCase() ?? "M")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden lg:block min-w-0 max-w-40">
                    <p className="text-xs font-semibold text-white truncate leading-tight">
                      {displayName}
                    </p>
                    <p className="text-[10px] text-white/55 truncate leading-tight mt-0.5">
                      {isAdmin || isCfo ? "All stores" : (user?.store ?? "—")}
                    </p>
                  </div>
                  <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-white/50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold leading-tight">{displayName}</p>
                  <p className="text-xs text-muted-foreground font-normal mt-0.5 flex items-center gap-1">
                    {isAdmin || isCfo ? (
                      <>
                        <ShieldCheck className="h-3 w-3 text-primary" /> All stores
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
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => setLocation("/cfo")}
                    className="cursor-pointer md:hidden"
                  >
                    <Landmark className="mr-2 h-4 w-4" />
                    <span>CFO analytics</span>
                  </DropdownMenuItem>
                )}
                {!isCfo && (
                  <DropdownMenuItem
                    onClick={openKiosk}
                    className="cursor-pointer md:hidden"
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    <span>Time clock kiosk</span>
                  </DropdownMenuItem>
                )}
                {install.available && (
                  <DropdownMenuItem onClick={onInstall} className="cursor-pointer">
                    <Smartphone className="mr-2 h-4 w-4" />
                    <span>{install.ios ? "Add to Home Screen" : "Install app"}</span>
                  </DropdownMenuItem>
                )}
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

        {/* The brand thread: a signal-red hairline closing the chrome */}
        <div
          aria-hidden="true"
          className="h-[2.5px] w-full"
          style={{
            background:
              "linear-gradient(90deg, var(--brand-red-bright), var(--brand-red) 45%, oklch(0.54 0.21 27 / 0.15) 100%)",
          }}
        />
      </header>

      <PullToRefresh />

      <main
        id="main-content"
        className={showTabBar ? "flex-1 app-main-with-tabs" : "flex-1 app-main"}
      >
        <div className="app-gutter mx-auto w-full max-w-[1180px] py-5 md:py-8">
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

      {showTabBar && (
        <BottomTabBar
          items={tabItems}
          isPathActive={isPathActive}
          onNavigate={setLocation}
        />
      )}

      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Home Screen</DialogTitle>
            <DialogDescription>
              Hotspot then opens full-screen from its own icon, like an app.
            </DialogDescription>
          </DialogHeader>
          {install.ios ? (
            <ol className="space-y-3 text-sm">
              <InstallStep n={1}>
                Tap the <strong>Share</strong> button{" "}
                <ShareGlyph /> in Safari's toolbar.
              </InstallStep>
              <InstallStep n={2}>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </InstallStep>
              <InstallStep n={3}>
                Tap <strong>Add</strong>, open Hotspot from its new icon, and
                enter your PIN once — it remembers you for 7 days.
              </InstallStep>
            </ol>
          ) : (
            <ol className="space-y-3 text-sm">
              <InstallStep n={1}>
                Open your browser's menu (<strong>⋮</strong>).
              </InstallStep>
              <InstallStep n={2}>
                Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </InstallStep>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstallStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <span className="pt-0.5 leading-relaxed">{children}</span>
    </li>
  );
}

/** The iOS share glyph, drawn inline so the steps match what people see. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-4 w-4 -mt-0.5 align-middle text-[#0a84ff]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Share"
      role="img"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

/**
 * Phone navigation: a fixed bottom bar, thumb-reachable, sitting above the
 * home indicator. Active tab: bright icon + label with a signal-red cap.
 */
function BottomTabBar({
  items,
  isPathActive,
  onNavigate,
}: {
  items: MenuItem[];
  isPathActive: (path: string) => boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav
      aria-label="Sections"
      className="app-chrome app-tabbar md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10"
    >
      <div className="app-gutter flex items-stretch">
        {items.map(item => {
          const active = isPathActive(item.path);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                if (active) window.scrollTo({ top: 0, behavior: "smooth" });
                else onNavigate(item.path);
              }}
              aria-current={active ? "page" : undefined}
              data-active={active}
              className="tabbar-link"
            >
              <item.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
