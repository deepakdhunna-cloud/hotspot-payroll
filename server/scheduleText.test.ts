import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  extractPdfText,
  extractSheetText,
  isSheetMime,
  layoutPdfText,
  type PdfTextItem,
} from "./scheduleText";

describe("extractPdfText", () => {
  it("pulls the text layer out of a digital PDF", async () => {
    const buf = readFileSync(join(__dirname, "fixtures/schedule-text.pdf"));
    const text = await extractPdfText(buf);
    expect(text).toBeTruthy();
    expect(text).toContain("JULIE GREEN");
    expect(text).toContain("9:00am-5:00pm");
  });

  it("returns null for a scanned PDF with no text layer (image path takes over)", async () => {
    const buf = readFileSync(join(__dirname, "fixtures/schedule-scan.pdf"));
    const text = await extractPdfText(buf);
    expect(text).toBeNull();
  });

  it("returns null for garbage bytes instead of throwing", async () => {
    const text = await extractPdfText(Buffer.from("not a pdf at all"));
    expect(text).toBeNull();
  });
});

describe("extractSheetText", () => {
  it("serializes an xlsx workbook to readable rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Week");
    ws.addRow(["Employee", "Thu", "Fri", "Total"]);
    ws.addRow(["TAMMY VREELAND", "9am-5pm", "", "8"]);
    ws.addRow(["REIGN ROLLINS", "", "10am-6pm", "8"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const text = await extractSheetText(
      buf,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "week.xlsx",
    );
    expect(text).toBeTruthy();
    expect(text).toContain("TAMMY VREELAND");
    expect(text).toContain("10am-6pm");
  });

  it("passes CSV through as text", async () => {
    const text = await extractSheetText(
      Buffer.from("Employee,Thu,Fri\nJULIE GREEN,9am-5pm,off\n"),
      "text/csv",
      "week.csv",
    );
    expect(text).toContain("JULIE GREEN,9am-5pm,off");
  });

  it("returns null for an unreadable sheet instead of throwing", async () => {
    const text = await extractSheetText(
      Buffer.from("binary junk"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "week.xlsx",
    );
    expect(text).toBeNull();
  });
});

describe("layoutPdfText — grid geometry decides the day", () => {
  // Helper: one glyph run at (x, y). Width ≈ 5 units per character.
  const item = (str: string, x: number, y: number): PdfTextItem => ({
    str,
    transform: [10, 0, 0, 10, x, y],
    width: str.length * 5,
    height: 10,
  });

  it("prefixes each cell with the day column it sits under", () => {
    const items = [
      // Header row: Employee | Thu 7/16 | Fri 7/17 | Sat 7/18 | Sun 7/19
      item("Employee", 10, 700),
      item("Thu 7/16", 150, 700),
      item("Fri 7/17", 250, 700),
      item("Sat 7/18", 350, 700),
      item("Sun 7/19", 450, 700),
      // JULIE works Thu and SAT — Friday is an EMPTY cell. A naive text dump
      // would read her two times consecutively and land the second on Friday.
      item("JULIE GREEN", 10, 680),
      item("5:00am-1:00pm", 150, 680),
      item("5:00am-1:00pm", 350, 680),
      // TAMMY works Fri and Sun only.
      item("TAMMY VREELAND", 10, 660),
      item("2:00pm-11:00pm", 250, 660),
      item("2:00pm-11:00pm", 450, 660),
    ];
    const text = layoutPdfText(items);
    const julie = text.split("\n").find((l) => l.includes("JULIE"))!;
    expect(julie).toContain("Thu 7/16: 5:00am-1:00pm");
    expect(julie).toContain("Sat 7/18: 5:00am-1:00pm");
    expect(julie).not.toContain("Fri");
    const tammy = text.split("\n").find((l) => l.includes("TAMMY"))!;
    expect(tammy).toContain("Fri 7/17: 2:00pm-11:00pm");
    expect(tammy).toContain("Sun 7/19: 2:00pm-11:00pm");
    expect(tammy).not.toContain("Sat");
  });

  it("merges split glyph runs in one cell and keeps columns apart", () => {
    const items = [
      item("Thu 7/16", 150, 700),
      item("Fri 7/17", 250, 700),
      item("Sat 7/18", 350, 700),
      item("BRANN STROUD", 10, 680),
      // One cell drawn as three runs: "5:00am", "-", "3:00pm" (tight gaps)
      item("5:00am", 150, 680),
      item("-", 182, 680),
      item("3:00pm", 188, 680),
      // Next column far away
      item("5:00am-1:00pm", 350, 680),
    ];
    const text = layoutPdfText(items);
    const brann = text.split("\n").find((l) => l.includes("BRANN"))!;
    expect(brann).toMatch(/Thu 7\/16: 5:00am ?- ?3:00pm/);
    expect(brann).toContain("Sat 7/18: 5:00am-1:00pm");
    expect(brann).not.toContain("Fri 7/17: 5");
  });

  it("leaves lines untouched when there is no day-header row", () => {
    const items = [
      item("Hotspot Market 13", 10, 700),
      item("Weekly totals", 10, 680),
      item("411.5 hours", 120, 680),
    ];
    const text = layoutPdfText(items);
    expect(text).toContain("Hotspot Market 13");
    expect(text).toContain("Weekly totals | 411.5 hours");
    expect(text).not.toContain(":  ");
  });

  it("uses the nearest header above when the grid repeats per store section", () => {
    const items = [
      item("Thu 7/16", 150, 700),
      item("Fri 7/17", 250, 700),
      item("Sat 7/18", 350, 700),
      item("ALEXA", 10, 680),
      item("7:00am-1:00pm", 250, 680),
      // Second section further down with shifted columns
      item("Thu 7/16", 200, 600),
      item("Fri 7/17", 300, 600),
      item("Sat 7/18", 400, 600),
      item("REIGN", 10, 580),
      item("2:00pm-11:00pm", 400, 580),
    ];
    const text = layoutPdfText(items);
    expect(text.split("\n").find((l) => l.includes("ALEXA"))).toContain(
      "Fri 7/17: 7:00am-1:00pm",
    );
    expect(text.split("\n").find((l) => l.includes("REIGN"))).toContain(
      "Sat 7/18: 2:00pm-11:00pm",
    );
  });
});

describe("isSheetMime", () => {
  it("recognizes csv and xlsx by mime or extension", () => {
    expect(isSheetMime("text/csv", "a.csv")).toBe(true);
    expect(isSheetMime("", "Schedule.XLSX")).toBe(true);
    expect(isSheetMime("application/pdf", "a.pdf")).toBe(false);
    expect(isSheetMime("image/png", "photo.png")).toBe(false);
  });
});
