import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractPdfText, extractSheetText, isSheetMime } from "./scheduleText";

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

describe("isSheetMime", () => {
  it("recognizes csv and xlsx by mime or extension", () => {
    expect(isSheetMime("text/csv", "a.csv")).toBe(true);
    expect(isSheetMime("", "Schedule.XLSX")).toBe(true);
    expect(isSheetMime("application/pdf", "a.pdf")).toBe(false);
    expect(isSheetMime("image/png", "photo.png")).toBe(false);
  });
});
