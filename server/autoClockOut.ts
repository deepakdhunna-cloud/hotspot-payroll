/**
 * Auto clock-out — when the owner sets a limit of N hours, anyone still on
 * the clock past N hours gets clocked out automatically. The clock-out is
 * recorded at exactly clock-in + N (the moment the limit was hit — never
 * "whenever the sweep happened to run"), the punch is marked with a note,
 * and the attention center turns every auto-closed punch into a review
 * task so a human verifies the real end time.
 *
 * The limit lives in app_settings under "auto_clockout_hours"; 0 or absent
 * means the feature is off. The sweep runs on a boot timer (see
 * _core/index.ts) and before every attention scan, and closing uses a
 * conditional UPDATE so concurrent sweeps can never double-close a punch.
 */
import { closePunchIfOpen, getAppSetting, listOpenPunches, logAudit } from "./db";

export const AUTO_CLOCKOUT_SETTING_KEY = "auto_clockout_hours";
export const AUTO_CLOCKOUT_MIN_HOURS = 4;
export const AUTO_CLOCKOUT_MAX_HOURS = 24;

const NOTE_PREFIX = "Auto clock-out";

/** The note stamped on punches the sweep closes. */
export const autoClockOutNote = (hours: number) =>
  `${NOTE_PREFIX} at the ${hours}h limit`;

/**
 * Marks punches the sweep closed — the attention engine flags these as
 * auto_clockout review tasks (instead of long_punch) so each punch gets
 * exactly one task.
 */
export const isAutoClosedNote = (note: string | null | undefined): boolean =>
  !!note && note.includes(NOTE_PREFIX);

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
  let closed = 0;
  for (const p of open) {
    const cutoff = autoCutoffFor(new Date(p.clockInAt), limit, now);
    if (!cutoff) continue;
    const note = p.note
      ? `${p.note} · ${autoClockOutNote(limit)}`
      : autoClockOutNote(limit);
    const didClose = await closePunchIfOpen(p.id, cutoff, note);
    if (!didClose) continue; // a kiosk punch or another sweep won the race
    closed++;
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
