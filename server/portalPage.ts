/**
 * The live portal — a standalone, shareable, read-only dashboard served by
 * this site at /portal?key=…, fed by the same database that powers the app.
 *
 * Why it lives here: the website is the host and system of record; the
 * portal is a projection of it. Serving the projection from the same app
 * means the "relay" can never break, lag, or need its own hosting.
 *
 * Access: the key is compared timing-safe against PORTAL_FEED_TOKEN (the
 * same secret that guards /api/portal-feed). The CEO gets a ready-made
 * link from Executive view → Live portal — the token itself never appears
 * in any tRPC response except that CEO-only link.
 *
 * Data discipline: the page shows who is on the clock, hours and store
 * totals — never per-person pay rates, phone numbers, clock codes or PINs.
 */
import { timingSafeEqual } from "node:crypto";
import { STORES } from "@shared/hotspot";
import { getWeekStart } from "@shared/hotspot";
import { FEED_SILENCE_HOURS } from "./attention";
import {
  hoursWorkedForWeekBulk,
  listEmployees,
  listOpenPunches,
  listPunchesInRange,
} from "./db";

/** Timing-safe raw-key check; an unset token denies everything. */
export function portalPageAllowed(
  presentedKey: string | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!presentedKey || !configuredToken) return false;
  const presented = Buffer.from(presentedKey);
  const configured = Buffer.from(configuredToken);
  return (
    presented.length === configured.length &&
    timingSafeEqual(presented, configured)
  );
}

export type PortalStoreSummary = {
  store: string;
  clockedIn: { name: string; role: string; sinceIso: string }[];
  weekHours: number;
  weekLaborCost: number;
  employeeCount: number;
  lastPunchIso: string | null;
  /** True when the store has punched within FEED_SILENCE_HOURS. */
  reporting: boolean;
};

export type PortalSummary = {
  generatedAtIso: string;
  weekStartIso: string;
  silenceHours: number;
  totals: {
    clockedInNow: number;
    weekHours: number;
    weekLaborCost: number;
    storesReporting: number;
    storeCount: number;
  };
  stores: PortalStoreSummary[];
};

const LOOKBACK_DAYS = 14;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One pass over live data → the whole portal payload. Aggregates only:
 * per-person output is limited to name, role and on-the-clock-since.
 */
export async function buildPortalSummary(
  now: Date = new Date(),
): Promise<PortalSummary> {
  const weekStart = getWeekStart(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const [employees, openPunches, weekHoursByEmployee, recentPunches] =
    await Promise.all([
      listEmployees({ activeOnly: true }),
      listOpenPunches(),
      hoursWorkedForWeekBulk(weekStart, weekEnd, undefined, now),
      listPunchesInRange(lookbackStart, now),
    ]);

  const employeeById = new Map(employees.map((e) => [e.id, e]));

  // Newest punch activity per store — open punches count as activity too.
  const lastPunchByStore = new Map<string, number>();
  for (const p of [...recentPunches, ...openPunches]) {
    const t = Math.max(
      new Date(p.clockInAt).getTime(),
      p.clockOutAt ? new Date(p.clockOutAt).getTime() : 0,
    );
    const prev = lastPunchByStore.get(p.storeLocation) ?? 0;
    if (t > prev) lastPunchByStore.set(p.storeLocation, t);
  }

  const stores: PortalStoreSummary[] = STORES.map((store) => {
    const staff = employees.filter((e) => e.storeLocation === store);

    const clockedIn = openPunches
      .filter((p) => p.storeLocation === store)
      .map((p) => {
        const emp = employeeById.get(p.employeeId);
        return emp
          ? {
              name: emp.fullName,
              role: emp.role,
              sinceIso: new Date(p.clockInAt).toISOString(),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let weekHours = 0;
    let weekLaborCost = 0;
    for (const emp of staff) {
      const hrs = weekHoursByEmployee.get(emp.id) ?? 0;
      weekHours += hrs;
      weekLaborCost += hrs * Number(emp.payRate);
    }

    const last = lastPunchByStore.get(store) ?? null;
    return {
      store,
      clockedIn,
      weekHours: round1(weekHours),
      weekLaborCost: round2(weekLaborCost),
      employeeCount: staff.length,
      lastPunchIso: last ? new Date(last).toISOString() : null,
      reporting:
        last !== null &&
        now.getTime() - last < FEED_SILENCE_HOURS * 3_600_000,
    };
  });

  return {
    generatedAtIso: now.toISOString(),
    weekStartIso: weekStart.toISOString(),
    silenceHours: FEED_SILENCE_HOURS,
    totals: {
      clockedInNow: stores.reduce((s, x) => s + x.clockedIn.length, 0),
      weekHours: round1(stores.reduce((s, x) => s + x.weekHours, 0)),
      weekLaborCost: round2(stores.reduce((s, x) => s + x.weekLaborCost, 0)),
      storesReporting: stores.filter((x) => x.reporting).length,
      storeCount: stores.length,
    },
    stores,
  };
}

/* ------------------------------------------------------------------ */
/* HTML — every page below is fully self-contained (inline CSS/JS).    */
/* ------------------------------------------------------------------ */

const BASE_STYLE = `
  :root {
    --red: oklch(0.54 0.21 27);
    --bg: oklch(0.966 0.003 250);
    --card: #ffffff;
    --ink: #1c1c21;
    --muted: #6b6b74;
    --line: #e6e4df;
    --good: #157347;
    --warn: #b23c17;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font: 15px/1.45 "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;
    min-height: 100vh;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .brand b { font-size: 26px; letter-spacing: 0.12em; }
  .brand .pill {
    background: var(--red); color: #fff; border-radius: 999px;
    padding: 2px 10px; font-size: 12px; letter-spacing: 0.22em;
  }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 14px; padding: 18px;
  }
  .muted { color: var(--muted); }
  button.retry {
    margin-top: 12px; border: 1px solid var(--line); background: #fff;
    border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer;
  }
`;

const htmlShell = (title: string, body: string, extraStyle = "", script = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap" rel="stylesheet">
<style>${BASE_STYLE}${extraStyle}</style>
</head>
<body><div class="wrap">${body}</div>${script ? `<script>${script}</script>` : ""}</body>
</html>`;

/** Shown when PORTAL_FEED_TOKEN is not configured on the host at all. */
export function renderPortalUnconfiguredPage(): string {
  return htmlShell(
    "Hotspot portal — not configured",
    `<div class="brand"><b>HOTSPOT</b><span class="pill">MARKET</span></div>
     <div class="card" style="margin-top:18px;max-width:560px">
       <h1 style="font-size:20px">The live portal is not switched on</h1>
       <p class="muted" style="margin-top:8px">
         This site has no <code>PORTAL_FEED_TOKEN</code> set in its hosting
         environment, so the portal (and the pull feed) stay closed. Set the
         variable and restart the site, then use the portal link from
         Executive view → Live portal.
       </p>
     </div>`,
  );
}

/** Shown for a missing or wrong key — includes a paste-the-key form. */
export function renderPortalAccessPage(): string {
  return htmlShell(
    "Hotspot portal — access",
    `<div class="brand"><b>HOTSPOT</b><span class="pill">MARKET</span></div>
     <div class="card" style="margin-top:18px;max-width:460px">
       <h1 style="font-size:20px">Live portal access</h1>
       <p class="muted" style="margin-top:8px">
         This page needs its access key. Open the portal from
         Executive view → Live portal (the link carries the key), or paste
         the key here:
       </p>
       <form style="margin-top:12px;display:flex;gap:8px" onsubmit="event.preventDefault();var k=this.key.value.trim();if(k)location.search='?key='+encodeURIComponent(k)">
         <input name="key" type="password" placeholder="Access key" autocomplete="off"
           style="flex:1;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:inherit">
         <button class="retry" style="margin:0">Open</button>
       </form>
     </div>`,
  );
}

const DASHBOARD_STYLE = `
  header { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px 18px; margin-bottom:18px; }
  header .title { font-size:20px; font-weight:600; }
  header .live { display:inline-flex; align-items:center; gap:6px; color:var(--good); font-weight:600; }
  header .live .dot { width:8px; height:8px; border-radius:999px; background:var(--good); animation:pulse 2s infinite; }
  @keyframes pulse { 50% { opacity:.35 } }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:18px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .kpi .label { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .kpi .value { font-size:30px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
  .kpi .sub { font-size:12px; color:var(--muted); }
  .stores { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
  .store h2 { font-size:17px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .chip { font-size:11px; letter-spacing:.06em; border-radius:999px; padding:2px 9px; white-space:nowrap; }
  .chip.good { background:#e5f3ec; color:var(--good); }
  .chip.warn { background:#f9e8e1; color:var(--warn); }
  .store .nums { display:flex; gap:18px; margin:10px 0 4px; }
  .store .nums b { font-size:20px; font-variant-numeric:tabular-nums; }
  .store .nums span { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; }
  .people { margin-top:8px; border-top:1px dashed var(--line); padding-top:8px; }
  .person { display:flex; justify-content:space-between; gap:8px; padding:2px 0; font-size:14px; }
  .person .who span { color:var(--muted); font-size:12px; margin-left:6px; }
  .person time { color:var(--good); font-variant-numeric:tabular-nums; }
  .nobody { color:var(--muted); font-size:13px; padding:2px 0; }
  footer { margin-top:22px; font-size:12px; color:var(--muted); }
  #err { display:none; margin-bottom:14px; border:1px solid #eab8a6; background:#fbeee8; color:var(--warn); border-radius:10px; padding:10px 14px; }
`;

const DASHBOARD_SCRIPT = `
const KEY = new URLSearchParams(location.search).get("key") || "";
const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSince = (iso, now) => {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m";
};
const fmtAgo = (iso, now) => {
  if (!iso) return "no punches yet";
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 2880) return Math.floor(m / 60) + " h ago";
  return Math.floor(m / 1440) + " d ago";
};
const weekLabel = (iso) => {
  const s = new Date(iso);
  const e = new Date(s.getTime() + 6 * 86400000);
  const f = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return "Pay week " + f(s) + " – " + f(e);
};
async function load() {
  try {
    const res = await fetch("/portal/data?key=" + encodeURIComponent(KEY), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    const now = Date.now();
    $("err").style.display = "none";
    $("week").textContent = weekLabel(d.weekStartIso);
    $("updated").textContent = "updated " + new Date(d.generatedAtIso).toLocaleTimeString();
    $("kpi-in").textContent = d.totals.clockedInNow;
    $("kpi-hours").textContent = d.totals.weekHours.toFixed(1);
    $("kpi-cost").textContent = money.format(d.totals.weekLaborCost);
    $("kpi-feed").textContent = d.totals.storesReporting + "/" + d.totals.storeCount;
    $("stores").innerHTML = d.stores.map((s) => {
      const chip = s.reporting
        ? '<span class="chip good">reporting</span>'
        : '<span class="chip warn">silent · ' + escapeHtml(fmtAgo(s.lastPunchIso, now)) + "</span>";
      const people = s.clockedIn.length
        ? s.clockedIn.map((p) =>
            '<div class="person"><span class="who">' + escapeHtml(p.name) +
            "<span>" + escapeHtml(p.role) + '</span></span><time>on clock ' +
            fmtSince(p.sinceIso, now) + "</time></div>").join("")
        : '<div class="nobody">Nobody on the clock</div>';
      return '<div class="card store"><h2>' + escapeHtml(s.store) + chip + "</h2>" +
        '<div class="nums">' +
        "<div><b>" + s.clockedIn.length + "</b><span>on clock</span></div>" +
        "<div><b>" + s.weekHours.toFixed(1) + "</b><span>week hrs</span></div>" +
        "<div><b>" + money.format(s.weekLaborCost) + "</b><span>week labor</span></div>" +
        "</div><div class=\\"people\\">" + people + "</div></div>";
    }).join("");
  } catch (e) {
    $("err").style.display = "block";
    $("err").textContent = "Could not reach the payroll site (" + e.message + "). Retrying automatically…";
  }
}
load();
setInterval(load, 30000);
`;

/** The live dashboard shell — data arrives via /portal/data. */
export function renderPortalDashboardPage(): string {
  return htmlShell(
    "Hotspot live portal",
    `<header>
       <div class="brand"><b>HOTSPOT</b><span class="pill">MARKET</span></div>
       <span class="title">Live payroll portal</span>
       <span class="live"><span class="dot"></span>LIVE</span>
       <span class="muted" id="week"></span>
       <span class="muted" id="updated">loading…</span>
     </header>
     <div id="err"></div>
     <div class="kpis">
       <div class="kpi"><div class="label">On the clock now</div><div class="value" id="kpi-in">–</div><div class="sub">all stores</div></div>
       <div class="kpi"><div class="label">Hours this week</div><div class="value" id="kpi-hours">–</div><div class="sub">from clock punches</div></div>
       <div class="kpi"><div class="label">Live labor cost</div><div class="value" id="kpi-cost">–</div><div class="sub">hours × pay rate, this week</div></div>
       <div class="kpi"><div class="label">Stores reporting</div><div class="value" id="kpi-feed">–</div><div class="sub">punched within 24h</div></div>
     </div>
     <div class="stores" id="stores"></div>
     <footer>Read-only live view served by hotspotpayroll · refreshes every 30 seconds ·
       store totals only — no pay rates or personal details on this page.</footer>`,
    DASHBOARD_STYLE,
    DASHBOARD_SCRIPT,
  );
}
