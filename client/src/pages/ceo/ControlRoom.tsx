/**
 * Control — everything about how the site runs that the CEO can change
 * without asking anyone:
 *
 *   Rules   the withholding estimate rates, how long a shift runs before it
 *           is flagged, and the automatic clock-out.
 *   Stores  add a store (it gets its manager PIN on the spot).
 *   Roles   add a role employees can be given.
 *   Access  every sign-in PIN (passed in: the existing PIN panel).
 *   Data    the live portal and the full export (passed in).
 *
 * Every change here is saved on the server, applies to every device at once
 * and is written to the activity log.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { storeColor } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  CalendarDays,
  ClipboardList,
  Clock,
  ExternalLink,
  Landmark,
  Loader2,
  Plus,
  Users,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { HudPanel } from "./hud";

/** Matches the server's suggestion for a short label. */
function suggestShort(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const market = /^Hotspot Market\s+(.+)$/i.exec(clean);
  if (market) return `HM ${market[1]}`.slice(0, 12);
  return (clean.replace(/^Hotspot\s+/i, "").split(" ")[0] || clean).slice(0, 12);
}

// Two decimals (7.65%), so the field shows exactly what is saved and a later
// save can never quietly round a rate it wasn't asked to change.
const pctText = (rate: number) => String(Math.round(rate * 10000) / 100);

export function ControlRoom({ access, data }: { access: ReactNode; data: ReactNode }) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="cc-cols">
        <RulesPanel />
        <div className="space-y-4 sm:space-y-5">
          <StoresPanel />
          <RolesPanel />
        </div>
      </div>
      <ShortcutsPanel />
      <SectionLabel>Access</SectionLabel>
      {access}
      <SectionLabel>Data and portal</SectionLabel>
      {data}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="hud-label flex items-center gap-3 pt-2">
      <span className="text-[var(--hud-accent)]">//</span>
      {children}
      <span className="h-px flex-1 bg-[var(--hud-line)]" aria-hidden />
    </h2>
  );
}

/* --------------------------------- rules --------------------------------- */

function RulesPanel() {
  const utils = trpc.useUtils();
  const settingsQ = trpc.settings.get.useQuery();
  const rules = settingsQ.data?.rules;
  const [fed, setFed] = useState("");
  const [st, setSt] = useState("");
  const [long, setLong] = useState("");
  useEffect(() => {
    if (!rules) return;
    setFed(pctText(rules.estFederalRate));
    setSt(pctText(rules.estStateRate));
    setLong(String(rules.longShiftHours));
  }, [rules?.estFederalRate, rules?.estStateRate, rules?.longShiftHours]);

  const refresh = () => {
    utils.settings.get.invalidate();
    utils.attention.list.invalidate();
    utils.ceo.weekly.invalidate();
    utils.cfo.summary.invalidate();
    utils.dashboard.summary.invalidate();
  };
  const rulesM = trpc.settings.setRules.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Rules updated. They apply everywhere now.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const autoM = trpc.settings.setAutoClockOut.useMutation({
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.hours
          ? `Automatic clock-out is on at ${r.hours} hours.${
              r.closedNow ? ` ${r.closedNow} shift${r.closedNow === 1 ? " was" : "s were"} closed just now.` : ""
            }`
          : "Automatic clock-out is off.",
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const fedN = Number(fed);
  const stN = Number(st);
  const longN = Number(long);
  const ratesValid =
    fed !== "" && st !== "" && fedN >= 0 && fedN <= 60 && stN >= 0 && stN <= 30;
  const ratesChanged =
    !!rules && (pctText(rules.estFederalRate) !== String(fedN) || pctText(rules.estStateRate) !== String(stN));
  const longValid = Number.isInteger(longN) && longN >= 6 && longN <= 24;
  const longChanged = !!rules && rules.longShiftHours !== longN;

  const saveRates = (e: FormEvent) => {
    e.preventDefault();
    if (ratesValid) rulesM.mutate({ estFederalPct: fedN, estStatePct: stN });
  };
  const saveLong = (e: FormEvent) => {
    e.preventDefault();
    if (longValid) rulesM.mutate({ longShiftHours: longN });
  };

  const auto = settingsQ.data?.autoClockOutHours ?? null;

  return (
    <HudPanel title="Rules" meta="how the site decides things">
      <div className="divide-y divide-[var(--hud-line)]">
        <form className="space-y-3 p-4 sm:p-5" onSubmit={saveRates} noValidate>
          <div>
            <h3 className="text-sm font-semibold">Withholding estimates</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              The share of gross pay shown as estimated federal and state withholding here and on
              Finance. For planning only — real withholding comes from your payroll processor.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <PercentField id="rule-fed" label="Federal" value={fed} onChange={setFed} max={60} />
            <PercentField id="rule-state" label="State" value={st} onChange={setSt} max={30} />
            <Button type="submit" className="h-10" disabled={!ratesValid || !ratesChanged || rulesM.isPending}>
              {rulesM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
          {!ratesValid && (fed !== "" || st !== "") ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              Federal can be 0–60% and state 0–30%.
            </p>
          ) : null}
        </form>

        <form className="space-y-3 p-4 sm:p-5" onSubmit={saveLong} noValidate>
          <div>
            <h3 className="text-sm font-semibold">Long-shift alert</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              A shift running longer than this is flagged in Needs attention and held by Autopilot
              until someone signs it off. Almost always a forgotten clock-out.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rule-long" className="text-xs">
                Flag after
              </Label>
              <div className="relative w-32">
                <Input
                  id="rule-long"
                  type="number"
                  inputMode="numeric"
                  min={6}
                  max={24}
                  step={1}
                  value={long}
                  onChange={(e) => setLong(e.target.value)}
                  aria-invalid={long !== "" && !longValid ? true : undefined}
                  className="h-10 pr-14 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  hours
                </span>
              </div>
            </div>
            <Button type="submit" className="h-10" disabled={!longValid || !longChanged || rulesM.isPending}>
              Save
            </Button>
          </div>
          {long !== "" && !longValid ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              Use a whole number of hours from 6 to 24.
            </p>
          ) : null}
        </form>

        <div className="space-y-3 p-4 sm:p-5">
          <div>
            <h3 className="text-sm font-semibold">Automatic clock-out</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              Anyone still on the clock past this is clocked out at the limit and flagged for
              review, so a forgotten clock-out can never run for days.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={auto ? String(auto) : "0"}
              onValueChange={(v) => autoM.mutate({ hours: Number(v) as 0 })}
              disabled={settingsQ.isLoading || autoM.isPending}
            >
              <SelectTrigger className="h-10 w-44" aria-label="Automatic clock-out limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Off</SelectItem>
                {Array.from({ length: 21 }, (_, i) => i + 4).map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    After {h} hours
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {autoM.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>
      </div>
    </HudPanel>
  );
}

function PercentField({
  id,
  label,
  value,
  onChange,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="relative w-28">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step={0.01}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 pr-8 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

/* --------------------------------- stores --------------------------------- */

function StoresPanel() {
  const utils = trpc.useUtils();
  const optionsQ = trpc.meta.options.useQuery();
  const stores = optionsQ.data?.storeInfo ?? [];
  // Active headcount per store, so a store that still needs its team says so.
  const peopleQ = trpc.employees.list.useQuery({ includeInactive: true }, { staleTime: 60_000 });
  const headcount = new Map<string, number>();
  for (const e of peopleQ.data ?? []) {
    if (Number(e.active) === 0) continue;
    headcount.set(e.storeLocation, (headcount.get(e.storeLocation) ?? 0) + 1);
  }
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [shortTouched, setShortTouched] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addM = trpc.settings.addStore.useMutation({
    onSuccess: (r) => {
      utils.meta.options.invalidate();
      utils.meta.myScope.invalidate();
      utils.ceo.listPins.invalidate();
      utils.ceo.weekly.invalidate();
      utils.cfo.summary.invalidate();
      toast.success(`${r.store.name} added.`, {
        description: "Its manager can sign in with the PIN you set. Add its employees next.",
      });
      setOpen(false);
    },
    onError: (e) => {
      setError(errorMessage(e));
      // The store itself may have been added even if a later step failed.
      utils.meta.options.invalidate();
      utils.ceo.listPins.invalidate();
    },
  });

  const reset = () => {
    setName("");
    setShort("");
    setShortTouched(false);
    setPin("");
    setError(null);
  };
  const pinOk = /^\d{4,8}$/.test(pin);
  const canSubmit = name.trim().length >= 3 && pinOk && !addM.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    addM.mutate({ name: name.trim(), short: (short || suggestShort(name)).trim(), pin });
  };

  return (
    <HudPanel
      title="Stores"
      meta={stores.length ? `${stores.length} stores` : undefined}
      actions={
        <Button
          size="sm"
          variant="tint"
          className="h-8"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add store
        </Button>
      }
    >
      <ul className="divide-y divide-[var(--hud-line)]">
        {stores.map((s) => (
          <li key={s.name} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: storeColor(s.name) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
            <span className="cc-wide-only mono text-xs text-muted-foreground">{s.short}</span>
            {peopleQ.data ? (
              (headcount.get(s.name) ?? 0) > 0 ? (
                <span className="mono text-xs tabular-nums text-muted-foreground">
                  {headcount.get(s.name)} {headcount.get(s.name) === 1 ? "person" : "people"}
                </span>
              ) : (
                <Link href="/employees" className="chip-warn shrink-0 hover:underline underline-offset-2">
                  No team yet · add people
                </Link>
              )
            ) : null}
            <a
              href={`/clock/${encodeURIComponent(s.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Open the time clock for ${s.name} in a new tab`}
              title="Open this store's time clock"
            >
              <Clock className="h-4 w-4" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--hud-line)] px-4 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-5">
        A store&apos;s name is what all its records are filed under, so stores can be added but not
        renamed or removed here.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add a store</DialogTitle>
              <DialogDescription>
                It appears everywhere at once: sign-in, the time clock, employees, payroll,
                schedules and this command center.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                  if (!shortTouched) setShort(suggestShort(e.target.value));
                }}
                placeholder="Hotspot Market 22"
                maxLength={56}
                autoFocus
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="store-short">Short label</Label>
                <Input
                  id="store-short"
                  value={short}
                  onChange={(e) => {
                    setShort(e.target.value);
                    setShortTouched(true);
                  }}
                  placeholder="HM 22"
                  maxLength={12}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-pin">Manager PIN</Label>
                <Input
                  id="store-pin"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
                    setError(null);
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="4–8 digits"
                  className="h-10 tabular-nums"
                />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The short label is used on chips and in tight places. The PIN is what this store&apos;s
              manager signs in with; you can change it later under Access.
            </p>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add store
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </HudPanel>
  );
}

/* --------------------------------- roles --------------------------------- */

function RolesPanel() {
  const utils = trpc.useUtils();
  const optionsQ = trpc.meta.options.useQuery();
  const roles = optionsQ.data?.roles ?? [];
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addM = trpc.settings.addRole.useMutation({
    onSuccess: (r) => {
      utils.meta.options.invalidate();
      toast.success(`Role added: ${r.role}.`);
      setName("");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || addM.isPending) return;
    setError(null);
    addM.mutate({ name: name.trim() });
  };
  return (
    <HudPanel title="Roles" meta={roles.length ? `${roles.length} roles` : undefined}>
      <div className="space-y-3 p-4 sm:p-5">
        <ul className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <li key={r} className="role-tag">
              {r}
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="role-name" className="text-xs">
              New role
            </Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Shift Lead"
              maxLength={40}
              className="h-10"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10" disabled={name.trim().length < 2 || addM.isPending}>
            {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add role
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </HudPanel>
  );
}

/* ------------------------------- shortcuts ------------------------------- */

const SHORTCUTS = [
  { href: "/employees", icon: Users, label: "Employees", hint: "Add, edit, move, deactivate — any store" },
  { href: "/payroll", icon: ClipboardList, label: "Payroll", hint: "Timesheets, punches and history" },
  { href: "/schedule-import", icon: CalendarDays, label: "Schedule", hint: "Import, edit or move a week" },
  { href: "/cfo", icon: Landmark, label: "Finance", hint: "Five-week labor cost, read-only" },
] as const;

function ShortcutsPanel() {
  return (
    <HudPanel title="Everything else" meta="the rest of the site, under the same sign-in">
      <ul className="grid divide-y divide-[var(--hud-line)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5">
        {SHORTCUTS.map((s) => (
          <li key={s.href} className="sm:border-b sm:border-[var(--hud-line)] lg:border-b-0 lg:border-r lg:last:border-r-0">
            <Link href={s.href} className="flex h-full items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent/60 sm:px-5">
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hud-accent)]" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <a
            href="/clock"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent/60 sm:px-5"
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hud-accent)]" aria-hidden />
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-medium">
                Time clock <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                The punch screen for a store tablet
              </span>
            </span>
          </a>
        </li>
      </ul>
    </HudPanel>
  );
}
