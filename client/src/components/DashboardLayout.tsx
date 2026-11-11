/**
 * App chrome. One set of sections, three shapes — whichever fits the screen
 * the manager is holding:
 *
 *  Phone (and a foldable's cover screen)
 *      A brand bar on top that scrolls away, and a floating tab bar at the
 *      thumbs with the "+" quick-add in the middle.
 *  Foldable opened sideways, tablets, small laptops (48rem and up)
 *      A navigation rail on the left edge: nothing is spent on the short
 *      vertical space, and both thumbs reach it.
 *  Desktop (85rem and up)
 *      A sidebar with full labels, search and the account.
 *
 * The same things live in each: the sections, quick add, search (⌘K),
 * the attention bell, the light/dark switch (always in plain sight, never
 * inside a menu), the store picker (multi-store logins), the time clock,
 * and the account menu.
 */
import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import PinKeypad from "@/components/PinKeypad";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  Ellipsis,
  ExternalLink,
  Landmark,
  LayoutDashboard,
  LogOut,
  Pencil,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { CommandMenu } from "./CommandMenu";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { BrandGlyph, BrandMark } from "./BrandMark";
import { StoreSelect } from "./StoreSelect";
import { ThemeMenu, ThemeSwitch } from "./ThemeSwitch";
import { InstallDialog, useInstallState } from "./InstallApp";
import {
  StoreScopeProvider,
  useStoreScope,
} from "@/contexts/StoreScopeContext";
import { announceQueryFlags } from "@/lib/queryFlag";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type MenuItem = {
  icon: LucideIcon;
  /** One name per section — the same in the rail, tab bar and search. */
  label: string;
  path: string;
  adminOnly?: boolean;
};

const baseMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Employees", path: "/employees" },
  { icon: ClipboardList, label: "Payroll", path: "/payroll" },
  { icon: CalendarDays, label: "Schedule", path: "/schedule-import" },
  { icon: ShieldCheck, label: "Executive", path: "/ceo", adminOnly: true },
  { icon: Landmark, label: "Finance", path: "/cfo", adminOnly: true },
];

/** The everyday jobs, one tap from anywhere (the "+" button). */
const QUICK_ACTIONS: { icon: LucideIcon; label: string; hint: string; href: string }[] = [
  {
    icon: Pencil,
    label: "Fix a punch",
    hint: "Change a wrong clock-in or clock-out",
    href: "/payroll?tab=punches",
  },
  {
    icon: Clock,
    label: "Add a missed punch",
    hint: "A shift the time clock didn't catch",
    href: "/payroll?tab=punches&add=1",
  },
  {
    icon: UserPlus,
    label: "Add employee",
    hint: "New team member, pay and clock code",
    href: "/employees?add=1",
  },
  {
    icon: CalendarDays,
    label: "Import schedule",
    hint: "Upload this week's schedule",
    href: "/schedule-import",
  },
  {
    icon: Wallet,
    label: "Run payroll",
    hint: "Review hours, save and export",
    href: "/payroll",
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
 * already in the account menu.
 */
function StoreScope({ className }: { className?: string }) {
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

/** Bring the attention card into view — on this page if it's here, else on
 *  the dashboard once it has rendered. */
function useRevealAttention(home: string) {
  const [, setLocation] = useLocation();
  return React.useCallback(() => {
    const reveal = () => {
      const el = document.getElementById("attention");
      if (!el) return false;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      el.focus({ preventScroll: true });
      return true;
    };
    if (reveal()) return;
    setLocation(home);
    let tries = 0;
    const tick = () => {
      if (reveal() || ++tries > 40) return;
      window.setTimeout(tick, 75);
    };
    window.setTimeout(tick, 75);
  }, [home, setLocation]);
}

/** Live count of open attention items, shared by every bell on screen. */
function useAttentionCount() {
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const count = listQ.data?.count ?? 0;
  const failed = listQ.isError && !listQ.data;
  const label = failed
    ? "Needs attention: couldn't check for issues"
    : count > 0
      ? `Needs attention: ${count} open item${count === 1 ? "" : "s"}`
      : listQ.isLoading
        ? "Needs attention"
        : "Needs attention: all clear";
  // The home-screen icon carries the same count, where the device allows.
  React.useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge || !listQ.data) return;
    (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
  }, [count, listQ.data]);
  return { count, failed, label };
}

function BellBadge({ count, failed }: { count: number; failed: boolean }) {
  if (failed) {
    return (
      <span
        className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-warning-foreground ring-2 ring-background"
        aria-hidden
      >
        <AlertTriangle className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (count <= 0) return null;
  return (
    <span className="nav-badge absolute right-0.5 top-0.5 ring-2 ring-background" aria-hidden>
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** Round avatar with the account's initial. */
function AccountAvatar({ initial, className }: { initial: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-semibold text-background",
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function QuickActionList({ onPick }: { onPick: (href: string) => void }) {
  return (
    <ul className="grid gap-1.5">
      {QUICK_ACTIONS.map((a) => (
        <li key={a.href}>
          <button
            type="button"
            onClick={() => onPick(a.href)}
            className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-accent"
          >
            <span className="icon-badge icon-badge-lg hue-red">
              <a.icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-tight">{a.label}</span>
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                {a.hint}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
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
  const scopeLine = isAdmin
    ? "All stores"
    : isCfo
      ? "All stores · read-only"
      : (user?.store ?? "—");
  const initial = isAdmin ? "C" : isCfo ? "F" : (displayName[0]?.toUpperCase() ?? "M");
  // The CFO login is a finance portal, not an operations account — its nav
  // is exactly the portal, nothing else.
  const menuItems = isCfo
    ? baseMenuItems.filter((item) => item.path === "/cfo")
    : baseMenuItems.filter((item) => !item.adminOnly || isAdmin);
  // The phone tab bar holds four sections around the "+". A store login has
  // exactly four; the CEO's extra ones sit under "More".
  const tabPaths = isAdmin
    ? ["/", "/payroll", "/ceo"]
    : ["/", "/employees", "/payroll", "/schedule-import"];
  const tabItems = tabPaths
    .map((p) => menuItems.find((m) => m.path === p))
    .filter((m): m is MenuItem => !!m);
  const moreItems = menuItems.filter((m) => !tabPaths.includes(m.path));
  // The CFO portal is a single page: no tab bar, no operations tools.
  const showTabBar = !isCfo;
  const ops = !isCfo;
  const revealAttention = useRevealAttention(roleHome);
  const attention = useAttentionCount();
  const install = useInstallState();
  const [installOpen, setInstallOpen] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);
  // The rail / sidebar "+" menu is controlled so picking an action closes it.
  const [railQuickOpen, setRailQuickOpen] = React.useState(false);
  // Command bar: Ctrl+K / ⌘K from anywhere.
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  React.useEffect(() => {
    if (isCfo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCfo]);
  // Highlight nested routes too (/employees/12 keeps Employees active).
  const isPathActive = (path: string) =>
    path === "/"
      ? location === "/"
      : location === path || location.startsWith(`${path}/`);
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  const pickQuick = (href: string) => {
    setQuickOpen(false);
    setRailQuickOpen(false);
    setLocation(href);
    // A page already on screen picks up flags like ?add=1 from this event.
    setTimeout(announceQueryFlags, 0);
  };

  /** What the account menu offers; the trigger differs per layout. */
  const accountMenu = (side: "top" | "bottom" | "right", align: "start" | "end") => (
    <DropdownMenuContent side={side} align={align} sideOffset={8} className="w-64">
      <DropdownMenuLabel className="flex items-center gap-2.5">
        <AccountAvatar initial={initial} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">
            {displayName}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground">
            {isAdmin || isCfo ? (
              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Building2 className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate">{scopeLine}</span>
          </span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {install.standalone ? (
        // From the home screen there is no browser reload button.
        <DropdownMenuItem className="cursor-pointer" onSelect={() => window.location.reload()}>
          <RotateCw className="mr-2 h-4 w-4" aria-hidden />
          <span>Refresh</span>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem className="cursor-pointer" onSelect={() => setInstallOpen(true)}>
          <Smartphone className="mr-2 h-4 w-4" aria-hidden />
          <span>Add to Home Screen</span>
        </DropdownMenuItem>
      )}
      {ops ? (
        <DropdownMenuItem asChild className="cursor-pointer">
          <a href="/clock" target="_blank" rel="noopener noreferrer">
            <Clock className="mr-2 h-4 w-4" aria-hidden />
            <span className="flex-1">Open the time clock</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={logout}
        className="cursor-pointer text-destructive focus:text-destructive"
      >
        <LogOut className="mr-2 h-4 w-4" aria-hidden />
        <span>Sign out</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* ---------------- Rail (48rem+) and sidebar (85rem+) ---------------- */}
      <aside className="sidenav" aria-label="App">
        <Link
          href={roleHome}
          className="mb-1 flex h-11 shrink-0 items-center justify-center rounded-xl xl:mb-2 xl:justify-start xl:px-2"
          aria-label={isCfo ? "Go to finance" : "Go to dashboard"}
        >
          <BrandGlyph className="h-6 xl:hidden" />
          <BrandMark size="sm" className="hidden h-8 xl:block" />
        </Link>

        {ops ? (
          <div className="flex shrink-0 flex-col items-center gap-1 xl:flex-row xl:items-stretch xl:gap-2">
            {/* Sidebar: a search field. Rail: an icon. */}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="hidden h-9 min-w-0 flex-1 items-center gap-2 rounded-[0.625rem] border border-input bg-[var(--field)] px-2.5 text-sm text-muted-foreground transition-colors hover:border-[var(--border-strong)] hover:text-foreground xl:flex"
              aria-label={`Search pages, people and actions (${shortcut})`}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left">Search</span>
              <kbd className="whitespace-nowrap rounded border border-border px-1 font-sans text-[10px]">
                {shortcut}
              </kbd>
            </button>
            <DropdownMenu open={railQuickOpen} onOpenChange={setRailQuickOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="btn-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full xl:h-9 xl:w-9 xl:rounded-[0.625rem]"
                      aria-label="Quick add"
                    >
                      <Plus className="h-5 w-5 xl:h-4 xl:w-4" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Quick add
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-80 p-1.5">
                <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                  Quick add
                </p>
                <QuickActionList onPick={pickQuick} />
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="chrome-btn xl:hidden"
                  aria-label={`Search pages, people and actions (${shortcut})`}
                >
                  <Search aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Search ({shortcut})
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}

        {ops ? <StoreScope className="mx-auto mt-1 w-full max-w-full shrink-0 xl:mt-2" /> : null}

        {menuItems.length > 1 ? (
          <nav className="mt-2 flex shrink-0 flex-col gap-0.5 xl:mt-3" aria-label="Primary">
            {menuItems.map((item) => {
              const active = isPathActive(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  data-active={active}
                  className="nav-item"
                  aria-current={active ? "page" : undefined}
                >
                  <item.icon aria-hidden />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="mt-auto flex shrink-0 flex-col gap-0.5 pt-2">
          {ops ? (
            <>
              <button
                type="button"
                onClick={revealAttention}
                className="nav-item"
                aria-label={attention.label}
                title={attention.label}
              >
                <span className="relative flex">
                  <Bell className="h-5 w-5 xl:h-[1.05rem] xl:w-[1.05rem]" aria-hidden />
                  <span className="xl:hidden">
                    {attention.failed || attention.count > 0 ? (
                      <span
                        className={cn(
                          "absolute -right-1.5 -top-1.5 ring-2 ring-background",
                          attention.failed
                            ? "inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-warning-foreground"
                            : "nav-badge",
                        )}
                        aria-hidden
                      >
                        {attention.failed ? (
                          <AlertTriangle className="h-2.5 w-2.5" />
                        ) : attention.count > 9 ? (
                          "9+"
                        ) : (
                          attention.count
                        )}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="truncate xl:flex-1 xl:text-left">
                  <span className="xl:hidden">Alerts</span>
                  <span className="hidden xl:inline">Needs attention</span>
                </span>
                {attention.failed ? (
                  <AlertTriangle className="hidden h-4 w-4 text-warning xl:block" aria-hidden />
                ) : attention.count > 0 ? (
                  <span className="nav-badge hidden xl:inline-flex" aria-hidden>
                    {attention.count > 99 ? "99+" : attention.count}
                  </span>
                ) : null}
              </button>
              <a
                href="/clock"
                target="_blank"
                rel="noopener noreferrer"
                className="nav-item"
                aria-label="Open the time clock in a new tab"
                title="Open the time clock in a new tab"
              >
                <Clock aria-hidden />
                <span className="truncate xl:flex-1 xl:text-left">Time clock</span>
                <ExternalLink className="hidden h-3.5 w-3.5 opacity-60 xl:block" aria-hidden />
              </a>
            </>
          ) : null}

          {/* Appearance: a button on the rail, the three choices spelled out
              in the sidebar. */}
          <ThemeMenu label side="right" align="end" className="nav-item xl:hidden" />
          <ThemeSwitch className="mt-1.5 hidden xl:grid" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mt-1 flex shrink-0 items-center justify-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-[var(--nav-active)] xl:justify-start xl:border xl:border-border xl:bg-card xl:p-2 xl:shadow-[var(--shadow-card)]"
                aria-label={`Account menu: ${displayName}, ${scopeLine}`}
              >
                <AccountAvatar initial={initial} />
                <span className="hidden min-w-0 flex-1 xl:block">
                  <span className="block truncate text-[13px] font-medium leading-tight">
                    {displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
                    {scopeLine}
                  </span>
                </span>
                <ChevronsUpDown
                  className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground xl:block"
                  aria-hidden
                />
              </button>
            </DropdownMenuTrigger>
            {accountMenu("right", "end")}
          </DropdownMenu>
        </div>
      </aside>

      <div className="app-main">
        {/* ---------------- Phone brand bar (scrolls away) ---------------- */}
        <header className="app-topbar">
          <Link
            href={roleHome}
            className="mr-auto min-w-0 shrink rounded-md"
            aria-label={isCfo ? "Go to finance" : "Go to dashboard"}
          >
            <BrandMark size="sm" className="h-[1.9rem] max-w-full" />
          </Link>
          {ops ? <StoreScope className="w-auto" /> : null}
          {ops ? (
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="chrome-btn"
              aria-label="Search pages, people and actions"
            >
              <Search aria-hidden />
            </button>
          ) : null}
          <ThemeMenu className="chrome-btn" />
          {ops ? (
            <button
              type="button"
              onClick={revealAttention}
              className="chrome-btn"
              aria-label={attention.label}
              title={attention.label}
            >
              <Bell aria-hidden />
              <BellBadge count={attention.count} failed={attention.failed} />
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="chrome-btn"
                aria-label={`Account menu: ${displayName}, ${scopeLine}`}
              >
                <AccountAvatar initial={initial} className="h-7 w-7 text-[11px]" />
              </button>
            </DropdownMenuTrigger>
            {accountMenu("bottom", "end")}
          </DropdownMenu>
        </header>

        <main id="main-content" className="relative flex-1">
          <div className="app-page" data-tabbar={showTabBar}>
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
      </div>

      {ops ? (
        <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} isAdmin={isAdmin} />
      ) : null}
      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />

      {/* ---------------- Phone tab bar ---------------- */}
      {showTabBar ? (
        <nav className="tabbar" aria-label="Sections">
          {tabItems.slice(0, 2).map((item) => (
            <TabLink key={item.path} item={item} active={isPathActive(item.path)} />
          ))}
          <button
            type="button"
            className="tabbar-add"
            onClick={() => setQuickOpen(true)}
            aria-label="Quick add"
            aria-haspopup="dialog"
          >
            <Plus aria-hidden />
          </button>
          {tabItems.slice(2).map((item) => (
            <TabLink key={item.path} item={item} active={isPathActive(item.path)} />
          ))}
          {moreItems.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="tabbar-link"
                  data-active={moreItems.some((m) => isPathActive(m.path))}
                  aria-label="More sections"
                >
                  <Ellipsis aria-hidden />
                  <span>More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" sideOffset={12} className="w-56">
                {moreItems.map((item) => (
                  <DropdownMenuItem key={item.path} asChild className="cursor-pointer py-2.5">
                    <Link href={item.path}>
                      <item.icon className="mr-2 h-4 w-4" aria-hidden />
                      <span>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </nav>
      ) : null}

      {/* Quick add, as a sheet from the tab bar's "+" */}
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="gap-3 p-4 sm:max-w-sm" showCloseButton={false}>
          <DialogHeader className="px-2.5 text-left">
            <DialogTitle className="text-base">Quick add</DialogTitle>
            <DialogDescription className="sr-only">
              Start an everyday task
            </DialogDescription>
          </DialogHeader>
          <QuickActionList onPick={pickQuick} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabLink({ item, active }: { item: MenuItem; active: boolean }) {
  return (
    <Link
      href={item.path}
      data-active={active}
      className="tabbar-link"
      aria-current={active ? "page" : undefined}
    >
      <item.icon aria-hidden />
      <span className="max-w-full truncate px-0.5">{item.label}</span>
    </Link>
  );
}
