import { describe, expect, it } from "vitest";
import { nameSimilarity, rankNameMatches } from "./nameMatch";

describe("nameSimilarity", () => {
  it("exact names score 1", () => {
    expect(nameSimilarity("Tammy Vreeland", "TAMMY VREELAND")).toBe(1);
  });

  it("initial + surname matches strongly", () => {
    expect(nameSimilarity("Tammy V.", "Tammy Vreeland")).toBeGreaterThan(0.8);
    expect(nameSimilarity("T. Vreeland", "Tammy Vreeland")).toBeGreaterThan(0.8);
  });

  it("nickname prefixes match strongly", () => {
    expect(nameSimilarity("Mike Ruiz", "Michael Ruiz")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Sam Carter", "Samantha Carter")).toBeGreaterThan(0.85);
  });

  it("single-character typos still match", () => {
    expect(nameSimilarity("Reign Rollins", "Riegn Rollins")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Tammy Vreland", "Tammy Vreeland")).toBeGreaterThan(0.85);
  });

  it("token order does not matter", () => {
    expect(nameSimilarity("Rollins Reign", "Reign Rollins")).toBe(1);
  });

  it("missing middle names cost little", () => {
    expect(nameSimilarity("Mary Smith", "Mary Ann Smith")).toBeGreaterThan(0.85);
  });

  it("different people score low", () => {
    expect(nameSimilarity("Tammy Vreeland", "Reign Rollins")).toBeLessThan(0.4);
    expect(nameSimilarity("John Park", "Jane Peterson")).toBeLessThan(0.55);
  });

  it("empty names score 0", () => {
    expect(nameSimilarity("", "Tammy Vreeland")).toBe(0);
  });
});

describe("rankNameMatches", () => {
  const roster = [
    { id: 1, fullName: "Tammy Vreeland" },
    { id: 2, fullName: "Reign Rollins" },
    { id: 3, fullName: "Michael Ruiz" },
    { id: 4, fullName: "Tammy Vaughn" },
  ];

  it("ranks the right person first and respects minScore", () => {
    const out = rankNameMatches("TAMMY V.", roster, r => r.fullName);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].record.id).toBe(1);
    for (const c of out) expect(c.score).toBeGreaterThanOrEqual(0.55);
  });

  it("returns at most `limit` results, best first", () => {
    const out = rankNameMatches("Tammy", roster, r => r.fullName, { limit: 2 });
    expect(out.length).toBeLessThanOrEqual(2);
    if (out.length === 2) expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });

  it("finds nothing for unrelated names", () => {
    const out = rankNameMatches("Zebulon Quartz", roster, r => r.fullName, {
      minScore: 0.6,
    });
    expect(out).toEqual([]);
  });
});
