import { describe, expect, it, vi } from "vitest";
import {
  computeAttentionCandidates,
  diffAttention,
  type AttentionCandidate,
} from "./attention";
import { autoClockOutNote } from "./autoClockOut";
import * as db from "./db";

vi.mock("./db", () => ({
  listEmployees: vi.fn(async () => []),
  listOpenPunches: vi.fn(async () => []),
  listPunchesInRange: vi.fn(async () => []),
  hoursWorkedForWeekBulk: vi.fn(async () => new Map()),
  getPayrollByWeek: vi.fn(async () => []),
  getShiftsForWeek: vi.fn(async () => []),
  getAttentionByRefKeys: vi.fn(async () => []),
  insertAttentionItems: vi.fn(async () => {}),
  listAttentionItems: vi.fn(async () => []),
  reopenAttentionItems: vi.fn(async () => {}),
  resolveAttentionItems: vi.fn(async () => {}),
  updateAttentionText: vi.fn(async () => {}),
  closePunchIfOpen: vi.fn(async () => false),
  getAppSetting: vi.fn(async () => undefined),
  getEmployeeById: vi.fn(async () => undefined),
  logAudit: vi.fn(async () => {}),
}));

const cand = (refKey: string, title = "t"): AttentionCandidate => ({
  refKey,
  kind: "long_punch",
  storeLocation: "Hotspot Market 13",
  title,
  detail: null,
});

const row = (
  refKey: string,
  status: "open" | "resolved",
  resolution: string | null = null,
  title = "t",
) => ({ id: refKey.length * 7, refKey, status, resolution, title, detail: null });

describe("diffAttention — the stack's lifecycle rules", () => {
  it("brand-new conditions are inserted", () => {
    const d = diffAttention([cand("long_punch:1")], []);
    expect(d.toInsert.map((c) => c.refKey)).toEqual(["long_punch:1"]);
    expect(d.toAutoResolveIds).toEqual([]);
  });

  it("open items whose condition cleared are auto-resolved", () => {
    const d = diffAttention([], [row("long_punch:1", "open")]);
    expect(d.toAutoResolveIds).toEqual([row("long_punch:1", "open").id]);
    expect(d.toInsert).toEqual([]);
  });

  it("open items still holding are kept without a new insert (date preserved)", () => {
    const d = diffAttention([cand("long_punch:1")], [row("long_punch:1", "open")]);
    expect(d.toInsert).toEqual([]);
    expect(d.toAutoResolveIds).toEqual([]);
    expect(d.toReopenIds).toEqual([]);
  });

  it("auto-resolved items whose condition returned are re-opened", () => {
    const d = diffAttention(
      [cand("missing_codes:HM13")],
      [row("missing_codes:HM13", "resolved", "auto")],
    );
    expect(d.toReopenIds).toEqual([row("missing_codes:HM13", "resolved").id]);
    expect(d.toInsert).toEqual([]);
  });

  it("manually approved items are NEVER resurrected while the condition holds", () => {
    const d = diffAttention(
      [cand("long_punch:9")],
      [row("long_punch:9", "resolved", "approved")],
    );
    expect(d.toInsert).toEqual([]);
    expect(d.toReopenIds).toEqual([]);
    expect(d.toAutoResolveIds).toEqual([]);
  });

  it("open auto_clockout items are NEVER auto-resolved by candidate absence", () => {
    // The punch has aged out of the 14-day scan window — its candidate is
    // gone, but nobody reviewed the system-chosen hours yet.
    const d = diffAttention([], [row("auto_clockout:77", "open")]);
    expect(d.toAutoResolveIds).toEqual([]);
  });

  it("open items with changed numbers get retitled, keeping their date", () => {
    const d = diffAttention(
      [cand("missing_codes:HM13", "5 employees can't clock in")],
      [row("missing_codes:HM13", "open", null, "6 employees can't clock in")],
    );
    expect(d.toRetitle).toHaveLength(1);
    expect(d.toRetitle[0].title).toBe("5 employees can't clock in");
    expect(d.toInsert).toEqual([]);
  });
});

describe("computeAttentionCandidates — auto clock-out integration", () => {
  const STORE = "Hotspot Market 13";
  const now = new Date("2026-07-17T18:00:00Z");

  it("an auto-closed punch becomes ONE auto_clockout task, never a long_punch", async () => {
    vi.mocked(db.listEmployees).mockResolvedValueOnce([
      { id: 1, fullName: "Maya Lopez", storeLocation: STORE, clockCodeHash: "x" },
    ] as any);
    // 14h punch closed by the sweep (note carries the marker) — long enough
    // that the long_punch rule would fire if the dedupe were missing.
    vi.mocked(db.listPunchesInRange).mockResolvedValueOnce([
      {
        id: 44,
        employeeId: 1,
        storeLocation: STORE,
        clockInAt: new Date("2026-07-16T10:00:00Z"),
        clockOutAt: new Date("2026-07-17T00:00:00Z"),
        note: autoClockOutNote(14),
      },
    ] as any);
    vi.mocked(db.getShiftsForWeek).mockResolvedValueOnce([
      { storeLocation: STORE },
    ] as any);

    const out = await computeAttentionCandidates([STORE], now);
    const auto = out.find((c) => c.refKey === "auto_clockout:44");
    expect(auto).toBeTruthy();
    expect(auto?.kind).toBe("auto_clockout");
    expect(auto?.title).toContain("clocked out automatically after 14.0h");
    expect(out.find((c) => c.refKey === "long_punch:44")).toBeUndefined();
  });

  it("a manually-closed long punch still becomes a long_punch task", async () => {
    vi.mocked(db.listEmployees).mockResolvedValueOnce([
      { id: 2, fullName: "Ray Ortiz", storeLocation: STORE, clockCodeHash: "x" },
    ] as any);
    vi.mocked(db.listPunchesInRange).mockResolvedValueOnce([
      {
        id: 45,
        employeeId: 2,
        storeLocation: STORE,
        clockInAt: new Date("2026-07-16T04:00:00Z"),
        clockOutAt: new Date("2026-07-16T17:30:00Z"),
        note: null,
      },
    ] as any);
    vi.mocked(db.getShiftsForWeek).mockResolvedValueOnce([
      { storeLocation: STORE },
    ] as any);

    const out = await computeAttentionCandidates([STORE], now);
    expect(out.find((c) => c.refKey === "long_punch:45")).toBeTruthy();
    expect(out.find((c) => c.refKey === "auto_clockout:45")).toBeUndefined();
  });
});
