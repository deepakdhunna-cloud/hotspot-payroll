/**
 * The attention engine — a site-wide assistant that scans live data for
 * anything wrong or off, and keeps a persistent, dated task list:
 *
 *  - long_punch:       someone on the clock (or a closed shift) over 12h in
 *                      one stretch. Requires a human to approve the hours as
 *                      correct, or register the real clock-out.
 *  - hours_mismatch:   a closed week where an employee's clocked hours are
 *                      more than an hour off their schedule. Requires review.
 *  - missing_schedule: no day-level schedule for the live week (per store).
 *  - missing_codes:    employees who can't use the kiosk (no clock code).
 *  - unsaved_payroll:  a closed week with worked hours not saved to payroll.
 *
 * Items are keyed by refKey so they persist with their FIRST-detected date —
 * stacking up until addressed. Manual kinds (long_punch, hours_mismatch)
 * stay open until a person approves or reviews them; operational kinds
 * auto-resolve the moment the underlying condition verifiably clears, and
 * re-open with a fresh date if it comes back.
 */
import {
  getAttentionByRefKeys,
  hoursWorkedForWeekBulk,
  insertAttentionItems,
  listAttentionItems,
  listEmployees,
  listOpenPunches,
  listPunchesInRange,
  getPayrollByWeek,
  getShiftsForWeek,
  reopenAttentionItems,
  resolveAttentionItems,
  updateAttentionText,
} from "./db";
import {
  getCurrentPayPeriodStart,
  getWeekStart,
} from "@shared/hotspot";
import {
  buildAutoClockOutItem,
  isAutoClosedNote,
  sweepAutoClockOut,
} from "./autoClockOut";

export const LONG_PUNCH_HOURS = 12;
export const MISMATCH_TOLERANCE_HOURS = 1;
/** How far back closed punches are scanned for 12h+ shifts. */
const LONG_PUNCH_LOOKBACK_DAYS = 14;

export type AttentionCandidate = {
  refKey: string;
  kind:
    | "long_punch"
    | "auto_clockout"
    | "hours_mismatch"
    | "missing_schedule"
    | "missing_codes"
    | "unsaved_payroll";
  storeLocation: string;
  employeeId?: number | null;
  punchId?: number | null;
  weekStart?: Date | null;
  title: string;
  detail?: string | null;
};

const fmtDay = (d: Date) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
/** Thu → Wed pay-week range, e.g. "Jul 9 – Jul 15". */
const fmtRange = (weekStart: Date) => {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDay(weekStart)} – ${fmtDay(end)}`;
};
const fmtClock = (d: Date) =>
  new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

/** Scan current data and produce every discrepancy that holds RIGHT NOW. */
export async function computeAttentionCandidates(
  stores: string[],
  now = new Date()
): Promise<AttentionCandidate[]> {
  const liveWeek = getWeekStart(now);
  const closedWeek = getCurrentPayPeriodStart(now);
  const closedWeekEnd = new Date(closedWeek);
  closedWeekEnd.setUTCDate(closedWeekEnd.getUTCDate() + 7);
  const lookbackStart = new Date(
    now.getTime() - LONG_PUNCH_LOOKBACK_DAYS * 86_400_000
  );

  const [
    emps,
    openPunches,
    recentPunches,
    closedWeekClock,
    closedWeekPayroll,
    liveShifts,
  ] = await Promise.all([
    listEmployees({ stores }),
    listOpenPunches(stores),
    listPunchesInRange(lookbackStart, now, stores),
    hoursWorkedForWeekBulk(closedWeek, closedWeekEnd, stores),
    getPayrollByWeek(closedWeek, stores),
    getShiftsForWeek(liveWeek, stores),
  ]);
  const empById = new Map(emps.map(e => [e.id, e]));
  const out: AttentionCandidate[] = [];

  /* ---- 1. Long punches: open right now, or closed within the lookback ---- */
  const longOf = (p: {
    id: number;
    employeeId: number;
    storeLocation: string;
    clockInAt: Date | string;
    clockOutAt?: Date | string | null;
  }) => {
    const emp = empById.get(p.employeeId);
    if (!emp) return;
    const inAt = new Date(p.clockInAt);
    const endAt = p.clockOutAt ? new Date(p.clockOutAt) : now;
    const hours = (endAt.getTime() - inAt.getTime()) / 3_600_000;
    if (hours <= LONG_PUNCH_HOURS) return;
    const stillOpen = !p.clockOutAt;
    out.push({
      refKey: `long_punch:${p.id}`,
      kind: "long_punch",
      storeLocation: p.storeLocation,
      employeeId: p.employeeId,
      punchId: p.id,
      title: stillOpen
        ? `${emp.fullName} has been clocked in ${hours.toFixed(1)}h and counting`
        : `${emp.fullName} was clocked in ${hours.toFixed(1)}h in one shift`,
      detail: stillOpen
        ? `Clocked in ${fmtClock(inAt)} and never out. Register the real clock-out, or approve if this is genuinely correct.`
        : `${fmtClock(inAt)} → ${fmtClock(endAt)}. Approve these hours as correct, or fix the punch.`,
    });
  };
  // Punches the auto clock-out sweep closed get their own review task —
  // the system picked the end time, so a human should confirm it. The item
  // is INSERTED by the sweep at close time; emitting the candidate here
  // keeps its title/detail current (e.g. after the punch's times are
  // edited) while the punch is inside the scan window.
  const autoClosedOf = (p: {
    id: number;
    employeeId: number;
    storeLocation: string;
    clockInAt: Date | string;
    clockOutAt: Date | string;
    note?: string | null;
  }) => {
    const emp = empById.get(p.employeeId);
    if (!emp) return;
    out.push(buildAutoClockOutItem(p, emp.fullName));
  };

  for (const p of openPunches) longOf(p);
  for (const p of recentPunches) {
    if (!p.clockOutAt) continue;
    if (isAutoClosedNote(p.note)) {
      autoClosedOf(p as Parameters<typeof autoClosedOf>[0]);
    } else {
      longOf(p);
    }
  }

  /* ---- 2. Closed-week schedule vs worked mismatches ---- */
  const scheduledByEmp = new Map<number, number>();
  for (const entry of closedWeekPayroll) {
    scheduledByEmp.set(entry.employeeId, Number(entry.scheduledHours ?? 0));
  }
  closedWeekClock.forEach((clocked, empId) => {
    const emp = empById.get(empId);
    if (!emp) return;
    const scheduled = scheduledByEmp.get(empId) ?? 0;
    if (scheduled <= 0) return;
    const diff = clocked - scheduled;
    if (Math.abs(diff) <= MISMATCH_TOLERANCE_HOURS) return;
    out.push({
      refKey: `mismatch:${empId}:${closedWeek.toISOString().slice(0, 10)}`,
      kind: "hours_mismatch",
      storeLocation: emp.storeLocation,
      employeeId: empId,
      weekStart: closedWeek,
      title: `${emp.fullName}: ${clocked.toFixed(1)}h worked vs ${scheduled.toFixed(1)}h scheduled · ${fmtRange(closedWeek)}`,
      detail: `${diff > 0 ? `${diff.toFixed(1)}h OVER` : `${Math.abs(diff).toFixed(1)}h UNDER`} schedule for that week. Review before payroll is finalized.`,
    });
  });

  /* ---- 3. Missing live-week schedule, per store ---- */
  const storesWithShifts = new Set(liveShifts.map(s => s.storeLocation));
  for (const store of stores) {
    if (storesWithShifts.has(store)) continue;
    out.push({
      refKey: `missing_schedule:${store}:${liveWeek.toISOString().slice(0, 10)}`,
      kind: "missing_schedule",
      storeLocation: store,
      weekStart: liveWeek,
      title: `No schedule imported for ${store} · ${fmtRange(liveWeek)}`,
      detail:
        "Without it, over-schedule alerts and daily coverage can't be checked for this week.",
    });
  }

  /* ---- 4. Employees who can't use the kiosk — named, not counted ---- */
  const noCodeByStore = new Map<string, string[]>();
  for (const e of emps) {
    if (e.clockCodeHash) continue;
    noCodeByStore.set(e.storeLocation, [
      ...(noCodeByStore.get(e.storeLocation) ?? []),
      e.fullName,
    ]);
  }
  noCodeByStore.forEach((names, store) => {
    const shown = names.slice(0, 15);
    const more = names.length - shown.length;
    out.push({
      refKey: `missing_codes:${store}`,
      kind: "missing_codes",
      storeLocation: store,
      title:
        names.length <= 2
          ? `${names.join(" and ")} need${names.length === 1 ? "s" : ""} a clock code · ${store}`
          : `${names.length} people need clock codes · ${store}`,
      detail: `${shown.join(", ")}${more > 0 ? ` +${more} more` : ""} — set 4-digit codes from each profile.`,
    });
  });

  /* ---- 5. Closed week worked but not saved to payroll, per store ---- */
  const savedByEmp = new Map<number, number>();
  for (const entry of closedWeekPayroll) {
    savedByEmp.set(entry.employeeId, Number(entry.hoursWorked ?? 0));
  }
  const unsavedByStore = new Map<string, string[]>();
  closedWeekClock.forEach((clocked, empId) => {
    const emp = empById.get(empId);
    if (!emp || clocked <= 0.25) return;
    if ((savedByEmp.get(empId) ?? 0) > 0) return;
    unsavedByStore.set(emp.storeLocation, [
      ...(unsavedByStore.get(emp.storeLocation) ?? []),
      emp.fullName,
    ]);
  });
  unsavedByStore.forEach((names, store) => {
    const shown = names.slice(0, 15);
    const more = names.length - shown.length;
    out.push({
      refKey: `unsaved_payroll:${store}:${closedWeek.toISOString().slice(0, 10)}`,
      kind: "unsaved_payroll",
      storeLocation: store,
      weekStart: closedWeek,
      title:
        names.length <= 2
          ? `${names.join(" and ")} worked ${fmtRange(closedWeek)} but ${names.length === 1 ? "isn't" : "aren't"} saved to payroll · ${store}`
          : `${names.length} people worked ${fmtRange(closedWeek)} but aren't saved to payroll · ${store}`,
      detail: `${shown.join(", ")}${more > 0 ? ` +${more} more` : ""} — finalize that week in Payroll.`,
    });
  });

  return out;
}

/** Kinds a human must act on — they persist even while the condition holds. */
const MANUAL_KINDS = new Set(["long_punch", "auto_clockout", "hours_mismatch"]);

export type AttentionDiff = {
  toInsert: AttentionCandidate[];
  toReopenIds: number[];
  toAutoResolveIds: number[];
  toRetitle: { id: number; title: string; detail: string | null }[];
};

/**
 * Pure sync decision. Given what holds NOW and what the table has:
 *  - brand-new condition        → insert (dated now)
 *  - open, condition gone       → auto-resolve (the task got done)
 *  - auto-resolved, came back   → re-open with a fresh date
 *  - manually resolved          → never resurrect (a human signed it off)
 *  - open, numbers changed      → refresh title/detail, keep original date
 */
export function diffAttention(
  candidates: AttentionCandidate[],
  existing: {
    id: number;
    refKey: string;
    status: string;
    resolution: string | null;
    title: string;
    detail: string | null;
  }[]
): AttentionDiff {
  const byRef = new Map(existing.map(e => [e.refKey, e]));
  const candidateRefs = new Set(candidates.map(c => c.refKey));
  const diff: AttentionDiff = {
    toInsert: [],
    toReopenIds: [],
    toAutoResolveIds: [],
    toRetitle: [],
  };

  for (const c of candidates) {
    const row = byRef.get(c.refKey);
    if (!row) {
      diff.toInsert.push(c);
    } else if (row.status === "resolved") {
      if (row.resolution === "auto") diff.toReopenIds.push(row.id);
      // manual resolutions stay resolved — a human already signed off
    } else if (row.title !== c.title || (row.detail ?? null) !== (c.detail ?? null)) {
      diff.toRetitle.push({ id: row.id, title: c.title, detail: c.detail ?? null });
    }
  }

  for (const row of existing) {
    if (row.status !== "open") continue;
    if (candidateRefs.has(row.refKey)) continue;
    // auto_clockout items are inserted at close time and their punch drops
    // out of the time-windowed candidate scan after two weeks — absence is
    // NOT evidence anyone reviewed the system-chosen hours. They resolve
    // only through a human sign-off (or explicitly when the punch is
    // corrected at the kiosk or deleted).
    if (row.refKey.startsWith("auto_clockout:")) continue;
    // Condition no longer holds. Auto kinds clear silently; manual kinds
    // clear too — if the punch was fixed or the hours now match, the task
    // is genuinely done.
    diff.toAutoResolveIds.push(row.id);
  }

  return diff;
}

/** Run detection for the given stores and sync the persistent list. */
export async function syncAttention(stores: string[]) {
  // Close over-limit punches BEFORE scanning, so a punch that just crossed
  // the auto clock-out limit shows up as one auto_clockout review task —
  // not a transient "still on the clock" long_punch. Never let a sweep
  // hiccup break the attention list itself.
  try {
    await sweepAutoClockOut();
  } catch (err) {
    console.error("[AutoClockOut] sweep failed:", err);
  }
  const candidates = await computeAttentionCandidates(stores);
  const refKeys = candidates.map(c => c.refKey);
  const existingByRef = await getAttentionByRefKeys(refKeys);
  const openInScope = await listAttentionItems({ stores, status: "open" });
  const known = new Map<
    number,
    { id: number; refKey: string; status: string; resolution: string | null; title: string; detail: string | null }
  >();
  for (const r of [...existingByRef, ...openInScope]) {
    known.set(r.id, {
      id: r.id,
      refKey: r.refKey,
      status: r.status,
      resolution: r.resolution,
      title: r.title,
      detail: r.detail,
    });
  }
  const diff = diffAttention(candidates, Array.from(known.values()));

  if (diff.toInsert.length > 0) {
    await insertAttentionItems(
      diff.toInsert.map(c => ({
        refKey: c.refKey,
        kind: c.kind,
        storeLocation: c.storeLocation,
        employeeId: c.employeeId ?? null,
        punchId: c.punchId ?? null,
        weekStart: c.weekStart ?? null,
        title: c.title,
        detail: c.detail ?? null,
      }))
    );
  }
  await reopenAttentionItems(diff.toReopenIds);
  await resolveAttentionItems(diff.toAutoResolveIds, "auto", "system");
  for (const r of diff.toRetitle) {
    await updateAttentionText(r.id, { title: r.title, detail: r.detail });
  }

  return listAttentionItems({ stores, status: "open" });
}

/** MANUAL_KINDS exported for the router's resolution rules. */
export function isManualKind(kind: string) {
  return MANUAL_KINDS.has(kind);
}
