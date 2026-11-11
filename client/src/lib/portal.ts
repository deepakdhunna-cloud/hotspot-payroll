/**
 * Who sees what.
 *
 * The site is three portals, one per job:
 *
 *   MANAGER  runs one store: its dashboard, payroll, team and schedule.
 *   CEO      runs the company: the command center and its sections. The
 *            CEO does not do a manager's daily work, so none of the
 *            manager's pages are in the CEO's navigation.
 *   CFO      reads the money: Finance, and nothing that changes anything.
 *
 * For the occasional manager's task — fix a punch, add someone, look at a
 * store's week — the CEO steps into the STORE DESK: the manager's own pages,
 * for any store, with a way straight back. It is the CEO's fourth "place",
 * reached on purpose, never the default.
 *
 * This file is the single description of that: which portal an address
 * belongs to, what each portal's navigation holds, and where someone is
 * sent when they open an address that isn't theirs. The layout renders from
 * it; nothing else decides navigation.
 */
import {
  Building2,
  CalendarDays,
  ClipboardList,
  History,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  Radar,
  Rocket,
  ScanLine,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Role = "admin" | "cfo" | "manager";
export type Portal = "ceo" | "desk" | "manager" | "cfo";

export type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  /** One line on what it is for (search, the store-desk card). */
  hint?: string;
};

/**
 * The CEO portal's sections, in order. `key` is what the page renders.
 * The log is a section with its own address but not a navigation entry: it
 * is opened from Control and from the live feed on Command.
 */
export const CEO_SECTIONS = [
  { key: "overview", slug: "", icon: Radar, label: "Command", hint: "The whole company, live" },
  { key: "payroll", slug: "payroll", icon: Rocket, label: "Payroll", hint: "Approve payroll for every store" },
  { key: "stores", slug: "stores", icon: Building2, label: "Stores", hint: "Every store side by side" },
  { key: "people", slug: "people", icon: Users, label: "People", hint: "Headcount, pay and the directory" },
  { key: "optimize", slug: "insights", icon: ScanLine, label: "Insights", hint: "Where hours and money are going" },
  { key: "finance", slug: "finance", icon: Landmark, label: "Finance", hint: "Labor cost week over week" },
  { key: "control", slug: "control", icon: SlidersHorizontal, label: "Control", hint: "Rules, stores, roles, PINs, data" },
  { key: "activity", slug: "log", icon: History, label: "Activity log", hint: "Every change, by whom and when" },
] as const;
/** Sections reached from inside the portal rather than from its navigation. */
const NOT_IN_NAV: readonly string[] = ["activity"];

export type CeoSectionKey = (typeof CEO_SECTIONS)[number]["key"];

export const ceoPath = (key: CeoSectionKey): string => {
  const s = CEO_SECTIONS.find((x) => x.key === key)!;
  return s.slug ? `/ceo/${s.slug}` : "/ceo";
};

/** The section an address segment names ("/ceo/insights" → "optimize"). */
export function ceoSectionFromSlug(slug: string | undefined | null): CeoSectionKey | null {
  if (!slug) return "overview";
  return CEO_SECTIONS.find((s) => s.slug === slug)?.key ?? null;
}

/** Addresses from before the portal had sections of its own (`?tab=`). */
const LEGACY_TABS: Record<string, CeoSectionKey> = {
  overview: "overview",
  payroll: "payroll",
  optimize: "optimize",
  control: "control",
  activity: "activity",
  pins: "control",
  portal: "control",
};
export const ceoSectionFromLegacyTab = (tab: string | null): CeoSectionKey | null =>
  tab ? (LEGACY_TABS[tab] ?? null) : null;

const CEO_NAV: NavItem[] = CEO_SECTIONS.filter((s) => !NOT_IN_NAV.includes(s.key)).map((s) => ({
  icon: s.icon,
  label: s.label,
  path: s.slug ? `/ceo/${s.slug}` : "/ceo",
  hint: s.hint,
}));

const storePages = (dashboard: string): NavItem[] => [
  { icon: LayoutDashboard, label: "Dashboard", path: dashboard, hint: "The store's week at a glance" },
  { icon: Users, label: "Employees", path: "/employees", hint: "The team, pay and clock codes" },
  { icon: ClipboardList, label: "Payroll", path: "/payroll", hint: "Hours, punches and history" },
  { icon: CalendarDays, label: "Schedule", path: "/schedule-import", hint: "Import and edit the week" },
];

/** Where the CEO's store desk starts. (A manager's own dashboard is "/".) */
export const DESK_HOME = "/desk";

const NAV: Record<Portal, NavItem[]> = {
  ceo: CEO_NAV,
  desk: storePages(DESK_HOME),
  manager: storePages("/"),
  cfo: [
    { icon: Landmark, label: "Finance", path: "/cfo", hint: "Labor cost week over week" },
    { icon: ListOrdered, label: "Register", path: "/cfo/register", hint: "Every pay week, exportable" },
  ],
};

/** Up to three sections beside the phone's "+"; the rest sit under More. */
const TAB_BAR: Record<Portal, string[]> = {
  ceo: ["/ceo", "/ceo/payroll", "/ceo/stores"],
  desk: [DESK_HOME, "/payroll", "/employees"],
  manager: ["/", "/employees", "/payroll", "/schedule-import"],
  cfo: ["/cfo", "/cfo/register"],
};

const isCeoPath = (path: string) => path === "/ceo" || path.startsWith("/ceo/");
const isCfoPath = (path: string) => path === "/cfo" || path.startsWith("/cfo/");

/** Which portal an address belongs to, for the role looking at it. */
export function portalOf(role: Role, path: string): Portal {
  if (role === "cfo") return "cfo";
  if (role === "manager") return "manager";
  return isCeoPath(path) ? "ceo" : "desk";
}

/** The page a role lands on when it signs in or opens the app. */
export function homeOf(role: Role): string {
  return role === "admin" ? "/ceo" : role === "cfo" ? "/cfo" : "/";
}

/**
 * Where to send someone who opened an address that isn't theirs — or null
 * when the address is fine. Nobody ever sees an "access denied" wall; they
 * simply arrive where their job is.
 */
export function redirectFor(role: Role, path: string): string | null {
  if (role === "cfo") return isCfoPath(path) ? null : "/cfo";
  if (role === "manager") {
    return isCeoPath(path) || isCfoPath(path) || path === DESK_HOME ? "/" : null;
  }
  // The CEO: the old home is now the command center, and Finance lives
  // inside the portal (same views, under /ceo/finance).
  if (path === "/") return "/ceo";
  if (isCfoPath(path)) return `/ceo/finance${path.slice("/cfo".length)}`;
  return null;
}

export function navFor(portal: Portal): NavItem[] {
  return NAV[portal];
}

/** The phone tab bar: the sections beside "+", and those under More. */
export function tabBarFor(portal: Portal): { tabs: NavItem[]; more: NavItem[] } {
  const items = NAV[portal];
  const paths = TAB_BAR[portal];
  const tabs = paths
    .map((p) => items.find((i) => i.path === p))
    .filter((i): i is NavItem => !!i);
  return { tabs, more: items.filter((i) => !paths.includes(i.path)) };
}

/** Is this navigation entry the page on screen? Nested pages count. */
export function isActivePath(itemPath: string, location: string): boolean {
  // Section roots are exact: "/ceo" is Command, not every CEO section.
  if (itemPath === "/" || itemPath === "/ceo" || itemPath === "/cfo" || itemPath === DESK_HOME) {
    return location === itemPath;
  }
  return location === itemPath || location.startsWith(`${itemPath}/`);
}
