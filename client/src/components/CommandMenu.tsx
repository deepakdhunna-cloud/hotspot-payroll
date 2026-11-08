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
import {
  CalendarDays,
  ClipboardList,
  Clock,
  ExternalLink,
  History,
  Landmark,
  LayoutDashboard,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useLocation } from "wouter";

export function CommandMenu({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
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
          <CommandItem value="add a punch fix hours manual" onSelect={() => go("/payroll?tab=punches&add=1")}>
            <Clock /> Add a punch
          </CommandItem>
          <CommandItem value="add employee new hire team member" onSelect={() => go("/employees?add=1")}>
            <UserPlus /> Add employee
          </CommandItem>
          <CommandItem value="import schedule upload homebase" onSelect={() => go("/schedule-import")}>
            <CalendarDays /> Import schedule
          </CommandItem>
          <CommandItem value="run payroll last week export save" onSelect={() => go("/payroll")}>
            <Wallet /> Run payroll
          </CommandItem>
          <CommandItem
            value="open time clock kiosk tablet"
            onSelect={() => {
              onOpenChange(false);
              window.open("/clock", "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink /> Open the time clock kiosk
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="dashboard home" onSelect={() => go("/")}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem value="employees team roster" onSelect={() => go("/employees")}>
            <Users /> Employees
          </CommandItem>
          <CommandItem value="payroll hours and pay" onSelect={() => go("/payroll")}>
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
          {isAdmin ? (
            <>
              <CommandItem value="executive ceo all stores pins activity" onSelect={() => go("/ceo")}>
                <ShieldCheck /> Executive
              </CommandItem>
              <CommandItem value="finance cfo labor cost" onSelect={() => go("/cfo")}>
                <Landmark /> Finance
              </CommandItem>
            </>
          ) : null}
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
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
