/**
 * App chrome v3: a slim ink top bar carries the brand, the horizontal nav
 * (signal-red underline marks the active section) and the account chip.
 * Content sits on a porcelain canvas in a centered column so tables get
 * their full width. On small screens the nav becomes a second scrollable
 * row — every section stays one tap away.
 */
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
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { BrandMark } from "./BrandMark";
import { trpc } from "@/lib/trpc";

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
  return <DashboardLayoutContent>{children}</DashboardLayoutContent>;
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
  const greetingQ = trpc.meta.greetingName.useQuery(undefined, {
    enabled: !!user,
  });
  const displayName = isAdmin ? "CEO" : (greetingQ.data?.name ?? "Manager");
  const menuItems = baseMenuItems.filter(item => !item.adminOnly || isAdmin);
  // Highlight nested routes too (/employees/12 keeps Employees active).
  const isPathActive = (path: string) =>
    path === "/"
      ? location === "/"
      : location === path || location.startsWith(`${path}/`);

  return (
    <div className="min-h-svh flex flex-col">
      <header className="ink-panel sticky top-0 z-50 border-b border-white/10">
        <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
          <button
            onClick={() => setLocation("/")}
            className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <BrandMark size="sm" tone="ink" />
          </button>

          <NavLinks
            items={menuItems}
            isPathActive={isPathActive}
            onNavigate={setLocation}
            className="hidden md:flex items-center ml-4"
          />

          <div className="ml-auto flex items-center gap-2">
            <AttentionBell onNavigate={() => setLocation("/")} />
            <button
              onClick={() =>
                window.open("/clock", "_blank", "noopener,noreferrer")
              }
              className="hidden sm:flex items-center gap-1.5 h-9 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 hover:text-white hover:border-white/30 transition-colors"
              title="Open the punch-in kiosk in a new tab"
            >
              <Clock className="h-3.5 w-3.5" />
              Kiosk
              <ExternalLink className="h-3 w-3 opacity-60" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/10 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8 border border-white/20 shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {isAdmin ? "C" : (displayName[0]?.toUpperCase() ?? "M")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden lg:block min-w-0 max-w-40">
                    <p className="text-xs font-semibold text-white truncate leading-tight">
                      {displayName}
                    </p>
                    <p className="text-[10px] text-white/55 truncate leading-tight mt-0.5">
                      {isAdmin ? "All stores" : (user?.store ?? "—")}
                    </p>
                  </div>
                  <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-white/50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold leading-tight">{displayName}</p>
                  <p className="text-xs text-muted-foreground font-normal mt-0.5 flex items-center gap-1">
                    {isAdmin ? (
                      <>
                        <ShieldCheck className="h-3 w-3 text-primary" /> All stores
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3 w-3" /> {user?.store ?? "—"}
                      </>
                    )}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    window.open("/clock", "_blank", "noopener,noreferrer")
                  }
                  className="cursor-pointer sm:hidden"
                >
                  <Clock className="mr-2 h-4 w-4" />
                  <span>Time clock kiosk</span>
                </DropdownMenuItem>
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

        {/* Small screens: nav as a scrollable second row */}
        <NavLinks
          items={menuItems}
          isPathActive={isPathActive}
          onNavigate={setLocation}
          className="flex md:hidden items-center overflow-x-auto border-t border-white/10 [&>.topbar-link]:h-11 [&>.topbar-link]:shrink-0"
        />
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-4 md:px-6 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
