/**
 * Auto clock-out — when the owner sets a limit of N hours, anyone still on
 * the clock past N hours gets clocked out automatically. The clock-out is
 * recorded at exactly clock-in + N (the moment the limit was hit — never
 * "whenever the sweep happened to run"), the punch is marked with a note,
 * and the attention center carries a review task for every auto-closed
 * punch so a human verifies the real end time.
 *
 * The limit lives in app_settings under "auto_clockout_hours"; 0 or absent
 * means the feature is off. The sweep runs on a boot timer (see
 * _core/index.ts) and before every attention scan. Guard rails, each of
 * which a human action outranks:
 *  - closing is a conditional UPDATE (still-open + in < out), so kiosk
 *    punches, concurrent sweeps and punch edits can never be overwritten
 *    or produce a negative-duration punch;
 *  - a punch whose 12h+ shift a manager already APPROVED is left running;
 *  - a punch a manager re-opened after an auto close (marker note still
 *    present) is treated as a human override and never re-closed;
 *  - the review item is inserted HERE at close time — not derived from a
 *    time-windowed scan — so even a weeks-old forgotten punch gets one.
 */
import {
  closePunchIfOpen,
  getAppSetting,
  getAttentionByRefKeys,
  getEmployeeById,
  insertAttentionItems,
  listOpenPunches,
  logAudit,
} from "./db";
import { getWeekStart } from "@shared/hotspot";

export const AUTO_CLOCKOUT_SETTING_KEY = "auto_clockout_hours";
export const AUTO_CLOCKOUT_MIN_HOURS = 4;
export const AUTO_CLOCKOUT_MAX_HOURS = 24;

const NOTE_PREFIX = "Auto clock-out";
const NOTE_RE = /\s*(?:·\s*)?Auto clock-out at the (\d+)h limit/;

/** The note stamped on punches the sweep closes. */
export const autoClockOutNote = (hours: number) =>
  `${NOTE_PREFIX} at the ${hours}h limit`;

/**
 * Marks punches the sweep closed — the attention engine flags these as
 * auto_clockout review tasks (instead of long_punch) so each punch gets
 * exactly one task, and the kiosk knows a punch-out may really belong to
 * the auto-closed shift.
 */
export const isAutoClosedNote = (note: string | null | undefined): boolean =>
  !!note && note.includes(NOTE_PREFIX);

/** The limit (hours) recorded in an auto-close note, if any. */
export const limitFromNote = (note: string | null | undefined): number | null => {
  const m = NOTE_RE.exec(note ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Remove the auto-close marker — used when a human (kiosk tap or manager)
 * registers the REAL clock-out, turning this back into an ordinary punch.
 */
export function stripAutoClockOutNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const stripped = note.replace(NOTE_RE, "").replace(/^\s*·\s*|\s*·\s*$/g, "").trim();
  return stripped.length > 0 ? stripped : null;
}

/** Setting value → validated limit in hours, or null when off/invalid. */
export function parseAutoClockOutHours(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < AUTO_CLOCKOUT_MIN_HOURS || n > AUTO_CLOCKOUT_MAX_HOURS) return null;
  return n;
}

/**
 * When a punch has crossed the limit: the exact instant the limit was hit
 * (clock-in + limit). Null while it's still under the limit — or when the
 * clock-in is in the future (a mis-entered manual punch is not our call).
 */
export function autoCutoffFor(
  clockInAt: Date,
  limitHours: number,
  now: Date,
): Date | null {
  const cutoff = clockInAt.getTime() + limitHours * 3_600_000;
  return now.getTime() >= cutoff && cutoff > clockInAt.getTime()
    ? new Date(cutoff)
    : null;
}

const fmtClock = (d: Date) =>
  new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

/**
 * The review task for one auto-closed punch. Single source of truth for
 * the wording — used both by the sweep (insert at close time) and by the
 * attention scan (retitles while the punch is in its lookback window).
 * If the punch's times were edited after the auto close (clock-out no
 * longer equals clock-in + limit), the wording says so instead of falsely
 * claiming the system chose the current time.
 */
export function buildAutoClockOutItem(
  p: {
    id: number;
    employeeId: number;
    storeLocation: string;
    clockInAt: Date | string;
    clockOutAt: Date | string;
    note?: string | null;
  },
  employeeName: string,
) {
  const inAt = new Date(p.clockInAt);
  const outAt = new Date(p.clockOutAt);
  const hours = (outAt.getTime() - inAt.getTime()) / 3_600_000;
  const limit = limitFromNote(p.note);
  const edited =
    limit !== null &&
    Math.abs(outAt.getTime() - (inAt.getTime() + limit * 3_600_000)) > 60_000;
  return {
    refKey: `auto_clockout:${p.id}`,
    kind: "auto_clockout" as const,
    storeLocation: p.storeLocation,
    employeeId: p.employeeId,
    punchId: p.id,
    weekStart: getWeekStart(inAt),
    title: edited
      ? `${employeeName}'s auto clock-out was corrected to ${hours.toFixed(1)}h`
      : `${employeeName} was clocked out automatically after ${hours.toFixed(1)}h`,
    detail: edited
      ? `Originally closed by the ${limit}h auto clock-out limit; the punch was since edited to ${fmtClock(inAt)} → ${fmtClock(outAt)}. Confirm the corrected times, then mark this reviewed.`
      : `Clocked in ${fmtClock(inAt)} and never out — the auto clock-out limit recorded the clock-out at ${fmtClock(outAt)}. Fix the real end time right here (or in Payroll → Punches), then approve.`,
  };
}

export async function getAutoClockOutHours(): Promise<number | null> {
  return parseAutoClockOutHours(await getAppSetting(AUTO_CLOCKOUT_SETTING_KEY));
}

/**
 * Close every open punch past the limit, across all stores.
 * Returns how many punches this sweep closed.
 */
export async function sweepAutoClockOut(now = new Date()): Promise<number> {
  const limit = await getAutoClockOutHours();
  if (limit === null) return 0;

  const open = await listOpenPunches();
  if (open.length === 0) return 0;

  // A manager may have APPROVED a long shift ("genuinely still working")
  // — that sign-off outranks the limit, so those punches keep running.
  const approvals = await getAttentionByRefKeys(
    open.map(p => `long_punch:${p.id}`),
  );
  const approvedPunchIds = new Set(
    approvals
      .filter(a => a.status === "resolved" && a.resolution === "approved")
      .map(a => a.punchId),
  );

  let closed = 0;
  for (const p of open) {
    // Open WITH the marker = a human re-opened it after an auto close.
    // That's an explicit override — never re-close it.
    if (isAutoClosedNote(p.note)) continue;
    if (approvedPunchIds.has(p.id)) continue;
    const cutoff = autoCutoffFor(new Date(p.clockInAt), limit, now);
    if (!cutoff) continue;
    const note = p.note
      ? `${p.note} · ${autoClockOutNote(limit)}`
      : autoClockOutNote(limit);
    const didClose = await closePunchIfOpen(p.id, cutoff, note);
    if (!didClose) continue; // a kiosk punch or another sweep won the race
    closed++;
    const emp = await getEmployeeById(p.employeeId);
    // Insert the review task NOW — refKey dedupe makes this idempotent,
    // and it works even for punches older than the attention scan window.
    await insertAttentionItems([
      buildAutoClockOutItem(
        { ...p, clockOutAt: cutoff, note },
        emp?.fullName ?? `Employee #${p.employeeId}`,
      ),
    ]);
    await logAudit({
      actorScope: "system",
      action: "clock.autoClockOut",
      entityType: "punch",
      entityId: p.id,
      detail: JSON.stringify({
        employeeId: p.employeeId,
        storeLocation: p.storeLocation,
        limitHours: limit,
        clockInAt: new Date(p.clockInAt).toISOString(),
        clockOutAt: cutoff.toISOString(),
      }),
    });
  }
  return closed;
}
