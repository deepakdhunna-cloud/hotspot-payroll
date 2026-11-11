/**
 * Command bar (Ctrl+K / ⌘K, or the search button in the top bar): jump to
 * any page or person, or start an everyday action, by typing a few letters.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { InitialsBadge } from "@/components/InitialsBadge";
import { STORE_ABBR } from "@/lib/format";
import { announceQueryFlags } from "@/lib/queryFlag";
import { trpc } from "@/lib/trpc";
import { CEO_SECTIONS, DESK_HOME, ceoPath, type Role } from "@/lib/portal";
import {
  CalendarDays,
  ClipboardList,
  Clock,
  ExternalLink,
  History,
  KeyRound,
  LayoutDashboard,
  Rocket,
  Store,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useLocation } from "wouter";

export function CommandMenu({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
}) {
  const isAdmin = role === "admin";
  // A manager's dashboard is "/"; the CEO's copy of it is on the store desk.
  const dashboard = isAdmin ? DESK_HOME : "/";
  const [, navigate] = useLocation();
  // Loaded only while the bar is open; the roster rarely changes mid-session.
  const peopleQ = trpc.employees.list.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });
  const people = peopleQ.data ?? [];
  const multiStore = new Set(people.map((p) => p.storeLocation)).size > 1;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
    // A page already on screen picks up flags like ?add=1 from this event.
    setTimeout(announceQueryFlags, 0);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump to a page, a person or an action"
      className="sm:max-w-xl"
    >
      <CommandInput placeholder="Search pages, people and actions…" />
      <CommandList className="max-h-[min(60vh,28rem)]">
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        <CommandGroup heading="Actions">
          {isAdmin ? (
            <>
              <CommandItem value="approve payroll autopilot run all stores" onSelect={() => go("/ceo/payroll")}>
                <Rocket /> Approve payroll
              </CommandItem>
              <CommandItem value="add a store new location" onSelect={() => go("/ceo/control?addStore=1")}>
                <Store /> Add a store
              </CommandItem>
              <CommandItem value="change a pin sign-in access password" onSelect={() => go("/ceo/control?section=access")}>
                <KeyRound /> Change a PIN
              </CommandItem>
            </>
          ) : null}
          <CommandItem value="add a punch fix hours manual" onSelect={() => go("/payroll?tab=punches&add=1")}>
            <Clock /> Add a punch
          </CommandItem>
          <CommandItem value="add employee new hire team member" onSelect={() => go("/employees?add=1")}>
            <UserPlus /> Add employee
          </CommandItem>
          <CommandItem value="import schedule upload homebase" onSelect={() => go("/schedule-import")}>
            <CalendarDays /> Import schedule
          </CommandItem>
          {isAdmin ? null : (
            <CommandItem value="run payroll last week export save" onSelect={() => go("/payroll")}>
              <Wallet /> Run payroll
            </CommandItem>
          )}
          <CommandItem
            value="open the time clock kiosk tablet punch in"
            onSelect={() => {
              onOpenChange(false);
              window.open("/clock", "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink /> Open the time clock
            <CommandShortcut className="tracking-normal">New tab</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {isAdmin ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Command center">
              {CEO_SECTIONS.map((sec) => (
                <CommandItem
                  key={sec.key}
                  value={`${sec.label} ${sec.hint} ceo command center ${sec.key}`}
                  onSelect={() => go(ceoPath(sec.key))}
                >
                  <sec.icon /> {sec.label}
                  <CommandShortcut className="tracking-normal">{sec.hint}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading={isAdmin ? "Store desk" : "Go to"}>
          <CommandItem value="dashboard home overview store desk" onSelect={() => go(dashboard)}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem value="employees team roster people staff" onSelect={() => go("/employees")}>
            <Users /> Employees
          </CommandItem>
          <CommandItem value="payroll hours and pay timesheet" onSelect={() => go("/payroll")}>
            <ClipboardList /> Payroll: hours &amp; pay
          </CommandItem>
          <CommandItem value="payroll punches time clock" onSelect={() => go("/payroll?tab=punches")}>
            <Clock /> Payroll: punches
          </CommandItem>
          <CommandItem value="payroll history export range" onSelect={() => go("/payroll?tab=history")}>
            <History /> Payroll: history
          </CommandItem>
          <CommandItem value="schedule week shifts" onSelect={() => go("/schedule-import")}>
            <CalendarDays /> Schedule
          </CommandItem>
        </CommandGroup>

        {people.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="People">
              {people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.fullName} ${p.role} ${p.storeLocation} #${p.id}`}
                  onSelect={() => go(`/employees/${p.id}`)}
                >
                  <InitialsBadge name={p.fullName} size="sm" />
                  <span className="truncate">{p.fullName}</span>
                  <CommandShortcut className="tracking-normal">
                    {p.role}
                    {multiStore ? ` · ${STORE_ABBR[p.storeLocation] ?? p.storeLocation}` : ""}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : peopleQ.isLoading || peopleQ.isError ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="People" forceMount>
              <p className="px-2 py-2 text-xs text-muted-foreground" role="status">
                {peopleQ.isError ? "Couldn't load people right now." : "Loading people…"}
              </p>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
