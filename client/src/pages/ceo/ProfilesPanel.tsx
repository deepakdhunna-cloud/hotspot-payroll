/**
 * Executive → Profiles: everyone who can sign in to the website.
 *
 * Each profile is a name, an access level and its own PIN:
 *  - CEO      — everything: every store, Executive, Finance, profiles
 *  - CFO      — the read-only Finance page
 *  - Manager  — day-to-day work for the stores picked here (one or several)
 * Changes apply to that person's open sessions on their next click; a new
 * PIN signs out every device that used the old one.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InitialsBadge } from "@/components/InitialsBadge";
import { BlockState } from "@/components/QueryStates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { STORE_ABBR, storeColor } from "@/lib/format";
import { fmtDateTime } from "@/lib/payweek";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { STORES } from "../../../../shared/hotspot";

type Profile = inferRouterOutputs<AppRouter>["profiles"]["list"][number];
type Role = Profile["role"];

const storeShort = (s: string) => STORE_ABBR[s] ?? s;

/** Plain-language access levels, in the order they're offered. */
const ROLE_OPTIONS: {
  role: Role;
  title: string;
  reach: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    role: "manager",
    title: "Manager",
    reach:
      "Dashboard, employees, payroll and schedules — only for the stores you pick.",
    icon: Building2,
  },
  {
    role: "cfo",
    title: "CFO",
    reach:
      "The Finance page for every store. Read-only: can't change anything.",
    icon: Landmark,
  },
  {
    role: "admin",
    title: "CEO",
    reach:
      "Everything: every store, Executive, Finance, profiles, PINs and settings.",
    icon: ShieldCheck,
  },
];

/** "HM 11, HM 13 and Travel" / "All 5 stores". */
function storesLine(stores: string[]): string {
  if (stores.length === STORES.length) return `All ${STORES.length} stores`;
  const names = stores.map(storeShort);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function reachLine(p: Pick<Profile, "role" | "stores">): string {
  if (p.role === "admin") return "Every store · full access";
  if (p.role === "cfo") return "Finance page · read-only";
  return storesLine(p.stores);
}

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 8);

/* ------------------------------ The panel ------------------------------ */

export function ProfilesPanel() {
  const profilesQ = trpc.profiles.list.useQuery();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; id: number } | null
  >(null);
  const [pinOpenId, setPinOpenId] = useState<number | null>(null);

  const profiles = profilesQ.data ?? [];
  // The edit dialog always shows the live row, so a change saved from it
  // (e.g. turning sign-in off) shows up without closing it.
  const editing =
    dialog?.mode === "edit"
      ? (profiles.find(p => p.id === dialog.id) ?? null)
      : null;
  const byRole = (role: Role) => profiles.filter(p => p.role === role);
  const groups: { role: Role; label: string; items: Profile[] }[] = [
    { role: "admin", label: "CEO", items: byRole("admin") },
    { role: "cfo", label: "CFO", items: byRole("cfo") },
    { role: "manager", label: "Managers", items: byRole("manager") },
  ];

  return (
    <Card className="surface-card gap-0 py-0">
      <CardHeader className="card-head flex flex-col gap-3 px-4 sm:px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="section-title">
            <span className="icon-badge icon-badge-sm">
              <Users />
            </span>
            Sign-in profiles
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone who can sign in to the website, what they can see, and
            their PIN. Give each person their own profile so the activity log
            shows who did what. Changes apply right away.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-9 sm:h-8 shrink-0"
          onClick={() => setDialog({ mode: "create" })}
        >
          <UserPlus className="h-4 w-4" aria-hidden /> Add profile
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {profilesQ.isPending || profilesQ.isError || profiles.length === 0 ? (
          <div className="p-4 sm:p-5">
            <BlockState
              isLoading={profilesQ.isPending && !profilesQ.isError}
              isError={profilesQ.isError}
              onRetry={() => profilesQ.refetch()}
              isEmpty={profiles.length === 0}
              emptyTitle="No profiles yet"
              emptyHint="Add a profile to give someone their own PIN."
              skeletonClassName="h-56"
            >
              {null}
            </BlockState>
          </div>
        ) : (
          <div>
            {groups
              .filter(g => g.items.length > 0)
              .map(g => (
                <section key={g.role} aria-label={g.label}>
                  <h3 className="border-y border-border bg-muted/60 px-4 sm:px-5 py-1.5 text-xs font-semibold text-muted-foreground first:border-t-0">
                    {g.label}
                    <span className="ml-1.5 tabular-nums font-normal">
                      {g.items.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-border">
                    {g.items.map(p => (
                      <ProfileRow
                        key={p.id}
                        profile={p}
                        pinOpen={pinOpenId === p.id}
                        onPinOpenChange={o => setPinOpenId(o ? p.id : null)}
                        onEdit={() => setDialog({ mode: "edit", id: p.id })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={dialog !== null}
        onOpenChange={o => {
          if (!o) setDialog(null);
        }}
      >
        {dialog?.mode === "create" ? (
          <ProfileDialog
            key="new"
            profile={null}
            onDone={() => setDialog(null)}
          />
        ) : editing ? (
          <ProfileDialog
            key={editing.id}
            profile={editing}
            onDone={() => setDialog(null)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

/* ------------------------------ One profile ------------------------------ */

function ProfileRow({
  profile,
  pinOpen,
  onPinOpenChange,
  onEdit,
}: {
  profile: Profile;
  pinOpen: boolean;
  onPinOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const pinRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const wasOpen = useRef(false);

  // Closing the PIN form hands focus back to this row's button (unless the
  // person has already moved on elsewhere).
  useEffect(() => {
    if (!pinOpen && wasOpen.current) {
      const active = document.activeElement;
      if (
        !active ||
        active === document.body ||
        rowRef.current?.contains(active)
      ) {
        pinRef.current?.focus();
      }
    }
    wasOpen.current = pinOpen;
  }, [pinOpen]);

  return (
    <li ref={rowRef} className="px-4 sm:px-5 py-3.5">
      <div className="flex items-start gap-3 sm:items-center">
        <InitialsBadge name={profile.name} />
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5">
              <span className="truncate">{profile.name}</span>
              {profile.isYou ? <span className="chip-good">You</span> : null}
              {!profile.active ? (
                <span className="chip-warn">Sign-in off</span>
              ) : null}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {profile.role === "manager" ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {profile.stores.length === STORES.length ? (
                    <span>{storesLine(profile.stores)}</span>
                  ) : (
                    profile.stores.map(s => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: storeColor(s) }}
                          aria-hidden
                        />
                        {storeShort(s)}
                      </span>
                    ))
                  )}
                </span>
              ) : (
                <span>{reachLine(profile)}</span>
              )}
              <span aria-hidden>·</span>
              <span>
                {profile.pinSet && profile.pinUpdatedAt
                  ? `PIN changed ${fmtDateTime(profile.pinUpdatedAt)}`
                  : profile.pinSet
                    ? "PIN set"
                    : "No PIN yet"}
              </span>
            </p>
          </div>
          <div className="mt-2 flex items-center gap-2 sm:mt-0 sm:shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 sm:h-8"
              aria-label={`Edit ${profile.name}`}
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
            </Button>
            {pinOpen ? null : (
              <Button
                ref={pinRef}
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-8"
                aria-expanded={false}
                aria-label={`${profile.pinSet ? "Change" : "Set"} the PIN for ${profile.name}`}
                onClick={() => onPinOpenChange(true)}
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                {profile.pinSet ? "Change PIN" : "Set PIN"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {pinOpen ? (
        <PinForm profile={profile} onClose={() => onPinOpenChange(false)} />
      ) : null}
    </li>
  );
}

/* ------------------------------ PIN form ------------------------------ */

/** New PIN + confirmation, typed twice so a slip never locks someone out. */
function PinFields({
  idBase,
  pin,
  confirm,
  onPin,
  onConfirm,
  show,
  autoFocus,
  hintId,
  mismatch,
  pinInvalid,
}: {
  idBase: string;
  pin: string;
  confirm: string;
  onPin: (v: string) => void;
  onConfirm: (v: string) => void;
  show: boolean;
  autoFocus?: boolean;
  hintId: string;
  mismatch: boolean;
  pinInvalid: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-new`}>PIN</Label>
        <Input
          id={`${idBase}-new`}
          type={show ? "text" : "password"}
          inputMode="numeric"
          autoComplete="new-password"
          autoFocus={autoFocus}
          maxLength={8}
          placeholder="4 to 8 digits"
          value={pin}
          aria-invalid={pinInvalid || undefined}
          aria-describedby={hintId}
          onChange={e => onPin(digitsOnly(e.target.value))}
          className="h-10 bg-card tabular-nums tracking-widest"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-confirm`}>Type it again</Label>
        <Input
          id={`${idBase}-confirm`}
          type={show ? "text" : "password"}
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          placeholder="Same PIN"
          value={confirm}
          aria-invalid={mismatch || undefined}
          aria-describedby={hintId}
          onChange={e => onConfirm(digitsOnly(e.target.value))}
          className="h-10 bg-card tabular-nums tracking-widest"
        />
      </div>
    </div>
  );
}

function pinHint(pin: string, confirm: string): string | null {
  const pinValid = /^\d{4,8}$/.test(pin);
  if (pin.length > 0 && !pinValid && confirm.length === 0)
    return "Use 4 to 8 digits.";
  if (confirm.length > 0 && confirm.length >= pin.length && pin !== confirm) {
    return "The two PINs don't match.";
  }
  return null;
}

function ShowDigitsButton({
  show,
  onToggle,
}: {
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 sm:h-8 text-muted-foreground"
      aria-pressed={show}
      onClick={onToggle}
    >
      {show ? (
        <EyeOff className="h-3.5 w-3.5" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
      {show ? "Hide digits" : "Show digits"}
    </Button>
  );
}

function PinForm({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const setPinM = trpc.profiles.setPin.useMutation();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idBase = `pin-${profile.id}`;
  const hintId = `${idBase}-hint`;

  const pinValid = /^\d{4,8}$/.test(pin);
  const matches = pin === confirm;
  const canSave = pinValid && matches && !setPinM.isPending;
  const hint = pinHint(pin, confirm);
  const signOutLine = profile.isYou
    ? "This signs out every device using your PIN, including this one. You'll sign in again with the new PIN."
    : `This signs out every device ${profile.name} is signed in on. They sign in again with the new PIN.`;

  const save = () =>
    setPinM.mutate(
      { id: profile.id, pin },
      {
        onSuccess: () => {
          utils.profiles.list.invalidate();
          toast.success(
            profile.isYou
              ? "Your PIN was changed. Sign in again with the new PIN."
              : `${profile.name}'s PIN was changed. Devices using the old PIN were signed out.`
          );
          onClose();
          if (profile.isYou) utils.auth.me.invalidate();
        },
        onError: e => setError(errorMessage(e)),
      }
    );

  return (
    <form
      className="mt-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4 space-y-3"
      onSubmit={e => e.preventDefault()}
      noValidate
      aria-label={`New PIN for ${profile.name}`}
    >
      <PinFields
        idBase={idBase}
        pin={pin}
        confirm={confirm}
        onPin={v => {
          setPin(v);
          setError(null);
        }}
        onConfirm={v => {
          setConfirm(v);
          setError(null);
        }}
        show={show}
        autoFocus
        hintId={hintId}
        mismatch={hint === "The two PINs don't match."}
        pinInvalid={pin.length > 0 && !pinValid && confirm.length > 0}
      />
      <p
        id={hintId}
        role={error ? "alert" : undefined}
        className={cn(
          "min-h-4 text-xs",
          error || hint ? "delta-bad font-medium" : "text-muted-foreground"
        )}
      >
        {error ?? hint ?? signOutLine}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ShowDigitsButton show={show} onToggle={() => setShow(s => !s)} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 sm:h-8"
            onClick={onClose}
          >
            Cancel
          </Button>
          <ConfirmDialog
            disabled={!canSave}
            title={`Change ${profile.isYou ? "your" : `${profile.name}'s`} PIN?`}
            description={signOutLine}
            confirmLabel="Change PIN"
            onConfirm={save}
            trigger={
              <Button
                type="submit"
                size="sm"
                className="h-9 sm:h-8"
                disabled={!canSave}
              >
                {setPinM.isPending ? "Saving…" : "Save PIN"}
              </Button>
            }
          />
        </div>
      </div>
    </form>
  );
}

/* ------------------------------ Add / edit ------------------------------ */

function ProfileDialog({
  profile,
  onDone,
}: {
  /** null = create a new profile */
  profile: Profile | null;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const isNew = profile === null;
  const isYou = !!profile?.isYou;
  const idBase = useId();

  const [name, setName] = useState(profile?.name ?? "");
  const [role, setRole] = useState<Role>(profile?.role ?? "manager");
  const [stores, setStores] = useState<string[]>(
    profile?.role === "manager" ? profile.stores : []
  );
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    utils.profiles.list.invalidate();
    utils.profiles.names.invalidate();
    // The signed-in CEO may have renamed themself.
    utils.auth.me.invalidate();
    utils.meta.greetingName.invalidate();
  };
  const onError = (e: unknown) => setError(errorMessage(e));

  const create = trpc.profiles.create.useMutation({
    onSuccess: (_d, vars) => {
      refresh();
      toast.success(`${vars.name} can now sign in with their PIN.`);
      onDone();
    },
    onError,
  });
  const update = trpc.profiles.update.useMutation({
    onSuccess: (_d, vars) => {
      refresh();
      toast.success(`${vars.name} updated. It applies on their next click.`);
      onDone();
    },
    onError,
  });
  const setActive = trpc.profiles.setActive.useMutation({
    onSuccess: (_d, vars) => {
      refresh();
      toast.success(
        vars.active
          ? `${profile?.name} can sign in again.`
          : `${profile?.name} can no longer sign in. Their open sessions were ended.`
      );
    },
    onError,
  });
  const remove = trpc.profiles.remove.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(`${profile?.name} was removed. Their PIN no longer works.`);
      onDone();
    },
    onError,
  });
  const busy =
    create.isPending ||
    update.isPending ||
    setActive.isPending ||
    remove.isPending;

  const trimmed = name.trim();
  const invalid = {
    name: trimmed.length === 0,
    stores: role === "manager" && stores.length === 0,
    pin: isNew && !/^\d{4,8}$/.test(pin),
    confirm: isNew && pin !== confirm,
  };
  const hint = isNew ? pinHint(pin, confirm) : null;
  const firstProblem = invalid.name
    ? "Give the profile a name."
    : invalid.stores
      ? "Pick at least one store for a manager."
      : invalid.pin
        ? "Set a PIN of 4 to 8 digits."
        : invalid.confirm
          ? "The two PINs don't match."
          : null;

  const toggleStore = (s: string, on: boolean) =>
    setStores(prev =>
      on
        ? STORES.filter(x => x === s || prev.includes(x))
        : prev.filter(x => x !== s)
    );
  const allStores = stores.length === STORES.length;

  const submit = () => {
    setTried(true);
    setError(null);
    if (firstProblem) return;
    const payload = {
      name: trimmed,
      role,
      stores: (role === "manager" ? stores : []) as (typeof STORES)[number][],
    };
    if (isNew) create.mutate({ ...payload, pin });
    else update.mutate({ id: profile.id, ...payload });
  };

  return (
    <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {isNew ? "Add a profile" : `Edit ${profile.name}`}
        </DialogTitle>
        <DialogDescription>
          {isNew
            ? "Pick what they can see, then set the PIN they'll sign in with."
            : isYou
              ? "This is the profile you're signed in with."
              : "Changes apply on their next click — no need to sign them out."}
        </DialogDescription>
      </DialogHeader>

      <form
        id={`${idBase}-form`}
        className="grid gap-5 py-1"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <div className="grid gap-2">
          <Label htmlFor={`${idBase}-name`}>Name</Label>
          <Input
            id={`${idBase}-name`}
            value={name}
            maxLength={40}
            autoComplete="off"
            autoFocus={isNew}
            placeholder="e.g. Raj, CFO, HM 11 Manager"
            aria-invalid={(tried && invalid.name) || undefined}
            onChange={e => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="grid gap-2">
          <p
            id={`${idBase}-access`}
            className="text-sm font-medium leading-none"
          >
            Access
          </p>
          <RadioGroupPrimitive.Root
            aria-labelledby={`${idBase}-access`}
            value={role}
            disabled={isYou}
            onValueChange={v => {
              setRole(v as Role);
              setError(null);
            }}
            className="grid gap-2"
          >
            {ROLE_OPTIONS.map(opt => {
              const on = role === opt.role;
              const OptIcon = opt.icon;
              return (
                <RadioGroupPrimitive.Item
                  key={opt.role}
                  value={opt.role}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
                    on
                      ? "border-primary bg-primary/[0.06] ring-1 ring-primary/40"
                      : "border-border bg-card hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                    aria-hidden
                  >
                    <OptIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {opt.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {opt.reach}
                    </span>
                  </span>
                </RadioGroupPrimitive.Item>
              );
            })}
          </RadioGroupPrimitive.Root>
          {isYou ? (
            <p className="text-xs text-muted-foreground">
              You can't change your own access level. Another CEO profile can.
            </p>
          ) : null}
        </div>

        {role === "manager" ? (
          <div
            role="group"
            aria-labelledby={`${idBase}-stores`}
            className="grid gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p
                id={`${idBase}-stores`}
                className="text-sm font-medium leading-none"
              >
                Stores they manage
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setStores(allStores ? [] : [...STORES])}
              >
                {allStores ? "Clear" : "Select all"}
              </Button>
            </div>
            <div
              className={cn(
                "grid gap-1.5 sm:grid-cols-2 rounded-xl border p-2",
                tried && invalid.stores ? "border-destructive" : "border-border"
              )}
            >
              {STORES.map(s => {
                const checked = stores.includes(s);
                const cid = `${idBase}-store-${s.replace(/\W+/g, "-")}`;
                return (
                  <label
                    key={s}
                    htmlFor={cid}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      checked ? "bg-muted" : "hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      id={cid}
                      checked={checked}
                      onCheckedChange={v => {
                        toggleStore(s, v === true);
                        setError(null);
                      }}
                    />
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: storeColor(s) }}
                      aria-hidden
                    />
                    <span className="truncate">{s}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {stores.length === 0
                ? "They'll only see the stores you tick."
                : stores.length === 1
                  ? `They'll work in ${stores[0]} only.`
                  : `They'll switch between ${storesLine(stores)} from the store picker.`}
            </p>
          </div>
        ) : null}

        {isNew ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium leading-none">
              Sign-in PIN
            </legend>
            <PinFields
              idBase={`${idBase}-pin`}
              pin={pin}
              confirm={confirm}
              onPin={v => {
                setPin(v);
                setError(null);
              }}
              onConfirm={v => {
                setConfirm(v);
                setError(null);
              }}
              show={show}
              hintId={`${idBase}-pin-hint`}
              mismatch={hint === "The two PINs don't match."}
              pinInvalid={tried && invalid.pin}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                id={`${idBase}-pin-hint`}
                className={cn(
                  "text-xs",
                  hint ? "delta-bad font-medium" : "text-muted-foreground"
                )}
              >
                {hint ?? "Every profile needs its own PIN — no two can match."}
              </p>
              <ShowDigitsButton show={show} onToggle={() => setShow(s => !s)} />
            </div>
          </fieldset>
        ) : null}

        {!isNew ? (
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label
                  htmlFor={`${idBase}-active`}
                  className="text-sm font-medium"
                >
                  Can sign in
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isYou
                    ? "You can't turn off your own sign-in."
                    : profile.active
                      ? "Turn off to block their PIN without deleting the profile."
                      : "Their PIN is blocked. Turn on to let them back in."}
                </p>
              </div>
              <Switch
                id={`${idBase}-active`}
                checked={profile.active}
                disabled={isYou || busy}
                onCheckedChange={v =>
                  setActive.mutate({ id: profile.id, active: v })
                }
              />
            </div>
            {isYou ? null : (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Removing a profile frees up its PIN. The activity log keeps
                  their name.
                </p>
                <ConfirmDialog
                  title={`Remove ${profile.name}?`}
                  description={`${profile.name}'s PIN stops working right away and every device they're signed in on is signed out. This can't be undone — you'd add them again as a new profile.`}
                  confirmLabel="Remove profile"
                  onConfirm={() => remove.mutate({ id: profile.id })}
                  disabled={busy}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 sm:h-8 shrink-0 text-destructive hover:text-destructive"
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        ) : null}

        {(tried && firstProblem) || error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error ?? firstProblem}
          </p>
        ) : null}
      </form>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form={`${idBase}-form`} disabled={busy}>
          {create.isPending || update.isPending
            ? "Saving…"
            : isNew
              ? "Add profile"
              : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
