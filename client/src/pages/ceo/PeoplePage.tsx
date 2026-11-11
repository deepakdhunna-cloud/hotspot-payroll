/**
 * People — the CEO's view of who works for the company and what they cost.
 *
 * Up top, the numbers a CEO asks about: how many people, where, how they
 * are paid and what a week of set pay comes to. Under it, the directory for
 * the few things a CEO does to a person — change pay or role, move them to
 * another store, add or deactivate someone. It is the same directory a
 * manager uses, for every store at once.
 */
import { useStoreScope } from "@/contexts/StoreScopeContext";
import { STORE_ABBR, fmtMoney, storeColor, storeIndex } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import Employees from "@/pages/Employees";
import { useMemo } from "react";
import { CountMoney, CountNumber, HudPanel, Readout } from "./hud";

export default function CeoPeoplePage() {
  return (
    <div className="cc">
      <div className="cc-backdrop" aria-hidden="true" />
      <div className="cc-body">
        <Employees title="People" eyebrow="Hotspot Market // CEO" lead={<PeoplePulse />} />
      </div>
    </div>
  );
}

function PeoplePulse() {
  const { scope: focus, setScope } = useStoreScope();
  const listQ = trpc.employees.list.useQuery({ includeInactive: true }, { staleTime: 60_000 });

  const m = useMemo(() => {
    const everyone = listQ.data ?? [];
    const active = everyone.filter((e) => Number(e.active) !== 0);
    const inFocus = active.filter((e) => focus === "all" || e.storeLocation === focus);
    const setPay = inFocus.filter((e) => e.weeklyPay != null && Number(e.weeklyPay) > 0);
    const hourly = inFocus.filter((e) => !(e.weeklyPay != null && Number(e.weeklyPay) > 0));
    const rates = hourly.map((e) => Number(e.payRate)).filter((r) => r > 0);
    const byStore = new Map<string, number>();
    for (const e of active) byStore.set(e.storeLocation, (byStore.get(e.storeLocation) ?? 0) + 1);
    const byRole = new Map<string, number>();
    for (const e of inFocus) byRole.set(e.role, (byRole.get(e.role) ?? 0) + 1);
    return {
      headcount: inFocus.length,
      former: everyone.length - active.length,
      hourly: hourly.length,
      avgRate: rates.length ? rates.reduce((t, r) => t + r, 0) / rates.length : 0,
      lowRate: rates.length ? Math.min(...rates) : 0,
      highRate: rates.length ? Math.max(...rates) : 0,
      setPay: setPay.length,
      setPayWeekly: setPay.reduce((t, e) => t + Number(e.weeklyPay), 0),
      noCode: inFocus.filter((e) => !e.clockCodeHash).length,
      byStore: Array.from(byStore.entries()).sort(([a], [b]) => storeIndex(a) - storeIndex(b)),
      byRole: Array.from(byRole.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [listQ.data, focus]);

  const loading = listQ.isLoading;
  const dash = "—";

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="hud hud-rise grid grid-cols-2 [&>*]:border-[var(--hud-line)] [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b md:grid-cols-4 md:[&>*:nth-child(-n+2)]:border-b-0 md:[&>*:not(:last-child)]:border-r">
        <Readout
          label="People"
          value={loading ? dash : <CountNumber value={m.headcount} />}
          sub={
            focus === "all"
              ? `active across ${m.byStore.length} store${m.byStore.length === 1 ? "" : "s"}`
              : `active at ${STORE_ABBR[focus] ?? focus}`
          }
        />
        <Readout
          label="Paid by the hour"
          value={loading ? dash : <CountNumber value={m.hourly} />}
          sub={
            m.hourly > 0
              ? `average ${fmtMoney(m.avgRate)}/h · ${fmtMoney(m.lowRate)} to ${fmtMoney(m.highRate)}`
              : "nobody"
          }
        />
        <Readout
          label="On set pay"
          value={loading ? dash : <CountNumber value={m.setPay} />}
          sub={m.setPay > 0 ? "paid the same every week" : "nobody"}
          footer={
            m.setPay > 0 ? (
              <span className="mono text-xs text-muted-foreground">
                <span className="text-foreground">
                  <CountMoney value={m.setPayWeekly} />
                </span>{" "}
                a week
              </span>
            ) : null
          }
        />
        <Readout
          label="No clock code"
          value={loading ? dash : <CountNumber value={m.noCode} />}
          sub={m.noCode > 0 ? "can't use the time clock yet" : "everyone can clock in"}
        />
      </section>

      <div className="cc-cols">
        <HudPanel title="By store" meta="tap a store to see only its people">
          <ul className="divide-y divide-[var(--hud-line)]">
            {m.byStore.map(([store, n]) => {
              const on = focus === store;
              return (
                <li key={store}>
                  <button
                    type="button"
                    onClick={() => setScope(on ? "all" : store)}
                    aria-pressed={on}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60 sm:px-5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: storeColor(store) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{store}</span>
                    {on ? <span className="chip-neutral">Showing</span> : null}
                    <span className="mono text-sm tabular-nums">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </HudPanel>
        <HudPanel title="By role" meta={focus === "all" ? "all stores" : (STORE_ABBR[focus] ?? focus)}>
          <ul className="divide-y divide-[var(--hud-line)]">
            {m.byRole.map(([role, n]) => (
              <li key={role} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{role}</span>
                <span
                  className="hud-meter block w-24 shrink-0 sm:w-40"
                  aria-hidden
                >
                  <i style={{ width: `${m.headcount ? (n / m.headcount) * 100 : 0}%` }} />
                </span>
                <span className="mono w-6 text-right text-sm tabular-nums">{n}</span>
              </li>
            ))}
            {m.byRole.length === 0 && !loading ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">
                Nobody here yet.
              </li>
            ) : null}
          </ul>
        </HudPanel>
      </div>
    </div>
  );
}
