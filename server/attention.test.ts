import { describe, expect, it } from "vitest";
import { diffAttention, type AttentionCandidate } from "./attention";

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
