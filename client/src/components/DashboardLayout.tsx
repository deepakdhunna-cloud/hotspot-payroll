/**
 * App chrome: a floating glass top bar carries the brand, the section nav
 * and the account menu. Content sits in a centered column on a quiet canvas.
 * On phones the sections move to a bottom tab bar, so every one of them is
 * a thumb-tap away and none is ever scrolled off-screen.
 *
 * The bar never overflows: section labels collapse to icons (with tooltips)
 * before anything on the right is squeezed, and the right-hand tools show
 * their text only when there is room for it.
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
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
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { CommandMenu } from "./CommandMenu";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { BrandMark } from "./BrandMark";
import { StoreSelect } from "./StoreSelect";
import {
  StoreScopeProvider,
  useStoreScope,
} from "@/contexts/StoreScopeContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type MenuItem = {
  icon: typeof LayoutDashboard;
  /** One name per section — the same in the top bar, tab bar and search. */
  label: string;
  path: string;
  adminOnly?: boolean;
  /** Left out of the phone tab bar (reachable from the account menu). */
  desktopOnly?: boolean;
};

const baseMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Employees", path: "/employees" },
  { icon: ClipboardList, label: "Payroll", path: "/payroll" },
  { icon: CalendarDays, label: "Schedule", path: "/schedule-import" },
  { icon: ShieldCheck, label: "Executive", path: "/ceo", adminOnly: true },
  {
    icon: Landmark,
    label: "Finance",
    path: "/cfo",
    adminOnly: true,
    desktopOnly: true,
  },
];

/**
 * Responsive text in the top bar, as static class names (Tailwind only sees
 * literal strings). The CEO's bar carries six sections plus a store picker,
 * so its labels need a wider screen than a store manager's four.
 */
const BAR_TEXT = {
  admin: {
    navLabel: "hidden xl:inline",
    navTip: "xl:hidden",
    toolInline: "hidden 2xl:inline",
    toolBlock: "hidden 2xl:block",
  },
  manager: {
    navLabel: "hidden lg:inline",
    navTip: "lg:hidden",
    toolInline: "hidden xl:inline",
    toolBlock: "hidden xl:block",
  },
} as const;
type BarText = (typeof BAR_TEXT)[keyof typeof BAR_TEXT];

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
  text,
  className,
}: {
  items: MenuItem[];
  isPathActive: (path: string) => boolean;
  text: BarText;
  className?: string;
}) {
  return (
    <nav className={className} aria-label="Primary">
      {items.map(item => {
        const active = isPathActive(item.path);
        return (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>
              <Link
                href={item.path}
                data-active={active}
                className="topbar-link"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className={text.navLabel}>{item.label}</span>
              </Link>
            </TooltipTrigger>
            {/* Only while the label itself is hidden. */}
            <TooltipContent side="bottom" sideOffset={6} className={text.navTip}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
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

/** Topbar bell: live count of open attention items, visible on every page. */
function AttentionBell({ onOpen }: { onOpen: () => void }) {
  const listQ = trpc.attention.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const count = listQ.data?.count ?? 0;
  const failed = listQ.isError && !listQ.data;
  const label = failed
    ? "Attention center: couldn't check for issues"
    : count > 0
      ? `Attention center: ${count} open item${count === 1 ? "" : "s"}`
      : listQ.isLoading
        ? "Attention center"
        : "Attention center: all clear";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white md:h-8 md:w-8"
      title={label}
      aria-label={label}
    >
      <Bell className="h-4 w-4" aria-hidden />
      {failed ? (
        <span
          className="absolute -top-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--warning)] text-[var(--ink)] ring-2 ring-[var(--ink)]"
          aria-hidden
        >
          <AlertTriangle className="h-2.5 w-2.5" />
        </span>
      ) : count > 0 ? (
        <span
          className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-[var(--ink)]"
          aria-hidden
        >
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
}: {
  items: MenuItem[];
  isPathActive: (path: string) => boolean;
}) {
  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="flex">
        {items.map(item => {
          const active = isPathActive(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              data-active={active}
              className="tabbar-link"
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
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
  const scopeLine = isAdmin
    ? "All stores"
    : isCfo
      ? "All stores · read-only"
      : (user?.store ?? "—");
  // The CFO login is a finance portal, not an operations account — its nav
  // is exactly the portal, nothing else.
  const menuItems = isCfo
    ? baseMenuItems.filter(item => item.path === "/cfo")
    : baseMenuItems.filter(item => !item.adminOnly || isAdmin);
  const text = isAdmin ? BAR_TEXT.admin : BAR_TEXT.manager;
  // The CFO portal is a single page: no tab bar.
  const showTabBar = !isCfo;
  const revealAttention = useRevealAttention(roleHome);
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

  return (
    <div className="min-h-svh flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {/* Floating glass nav: content scrolls under it, blurred */}
      <header className="sticky top-0 z-50 px-2 pt-2 sm:px-3 sm:pt-3">
        <div className="topbar mx-auto flex h-14 max-w-[1400px] items-center gap-2 rounded-2xl px-3 lg:px-4">
          <Link
            href={roleHome}
            className="shrink-0 rounded-md"
            aria-label={isCfo ? "Go to finance" : "Go to dashboard"}
          >
            <BrandMark size="sm" tone="ink" className="h-7 sm:h-8" />
          </Link>

          {menuItems.length > 1 ? (
            <NavLinks
              items={menuItems}
              isPathActive={isPathActive}
              text={text}
              className="hidden md:flex min-w-0 items-center gap-0.5 ml-3 lg:ml-5"
            />
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            {!isCfo ? (
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white md:h-8 md:min-w-8 md:bg-white/[0.07] md:shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
                aria-label={`Search pages, people and actions (${shortcut})`}
                title={`Search (${shortcut})`}
              >
                <Search className="h-4 w-4" aria-hidden />
                <span className={text.toolInline}>Search</span>
                <kbd
                  className={cn(
                    text.toolInline,
                    "whitespace-nowrap rounded border border-white/15 px-1 font-sans text-[10px] text-white/65",
                  )}
                >
                  {shortcut}
                </kbd>
              </button>
            ) : null}
            {!isCfo && <TopbarStoreScope className="w-auto md:w-36" />}
            {!isCfo && <AttentionBell onOpen={revealAttention} />}
            {!isCfo && (
              <a
                href="/clock"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="Open the time clock in a new tab"
                title="Open the time clock in a new tab"
              >
                <Clock className="h-4 w-4" aria-hidden />
                <span className={text.toolInline}>Time clock</span>
                <ExternalLink className={cn(text.toolInline, "h-3 w-3 opacity-70")} aria-hidden />
              </a>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 shrink-0 items-center gap-2 rounded-lg pl-1 pr-1 text-left transition-colors hover:bg-white/[0.08] md:pr-1.5"
                  aria-label={`Account menu: ${displayName}, ${scopeLine}`}
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[11px] font-semibold bg-white/[0.14] text-white">
                      {isAdmin ? "C" : isCfo ? "F" : (displayName[0]?.toUpperCase() ?? "M")}
                    </AvatarFallback>
                  </Avatar>
                  {/* The CEO's scope is already on the store picker beside it. */}
                  <div className={cn(isAdmin ? "hidden" : text.toolBlock, "min-w-0 max-w-44")}>
                    <p className="text-xs font-medium text-white truncate leading-tight">
                      {displayName}
                    </p>
                    <p className="text-[11px] text-white/70 truncate leading-tight mt-0.5">
                      {scopeLine}
                    </p>
                  </div>
                  <ChevronDown className={cn(isAdmin ? "hidden" : text.toolBlock, "h-3.5 w-3.5 text-white/50")} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold leading-tight">{displayName}</p>
                  <p className="text-xs text-muted-foreground font-normal mt-0.5 flex items-center gap-1">
                    {isAdmin || isCfo ? (
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                    ) : (
                      <Building2 className="h-3 w-3" aria-hidden />
                    )}
                    {scopeLine}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin ? (
                  <DropdownMenuItem asChild className="cursor-pointer md:hidden">
                    <Link href="/cfo">
                      <Landmark className="mr-2 h-4 w-4" aria-hidden />
                      <span>Finance</span>
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {!isCfo ? (
                  <DropdownMenuItem asChild className="cursor-pointer md:hidden">
                    <a href="/clock" target="_blank" rel="noopener noreferrer">
                      <Clock className="mr-2 h-4 w-4" aria-hidden />
                      <span className="flex-1">Open the time clock</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {!isCfo ? <DropdownMenuSeparator className="md:hidden" /> : null}
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main-content" className="relative flex-1">
        <div className="page-wash" aria-hidden="true" />
        <div
          className={`relative mx-auto w-full max-w-[1180px] px-4 md:px-6 pt-6 md:pt-8 ${
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

      {!isCfo ? (
        <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} isAdmin={isAdmin} />
      ) : null}

      {showTabBar ? (
        <TabBar
          items={menuItems.filter(item => !item.desktopOnly)}
          isPathActive={isPathActive}
        />
      ) : null}
    </div>
  );
}
