/**
 * Text extraction for schedule uploads. The import must read ANYTHING a
 * manager throws at it — Homebase PDF exports, spreadsheets, photos of a
 * handwritten grid. Digital PDFs and sheets carry their own text, and
 * feeding that text to the model is far more reliable than asking it to
 * fetch and read the raw file (and sidesteps upstream file-size limits).
 * Photos and scans have no text layer — those still go to the model as
 * images, which it reads visually.
 */
import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";

/** Minimum letters before we trust a PDF's text layer (scans have ~none). */
const MIN_MEANINGFUL_CHARS = 60;
/** Keep prompts bounded — a schedule never legitimately needs more. */
const MAX_TEXT_CHARS = 120_000;

export async function extractPdfText(buf: Buffer): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n") : text) ?? "";
    const letters = merged.replace(/[^a-zA-Z0-9]/g, "");
    if (letters.length < MIN_MEANINGFUL_CHARS) return null;
    return merged.slice(0, MAX_TEXT_CHARS);
  } catch {
    return null;
  }
}

export function isSheetMime(mimeType: string, filename: string): boolean {
  const f = filename.toLowerCase();
  return (
    mimeType === "text/csv" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    f.endsWith(".csv") ||
    f.endsWith(".xlsx")
  );
}

/** Serialize a spreadsheet (xlsx or csv) into plain tab-separated text. */
export async function extractSheetText(
  buf: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  try {
    if (mimeType === "text/csv" || filename.toLowerCase().endsWith(".csv")) {
      const text = buf.toString("utf8").trim();
      return text.length > 0 ? text.slice(0, MAX_TEXT_CHARS) : null;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const lines: string[] = [];
    wb.eachSheet(ws => {
      lines.push(`=== Sheet: ${ws.name} ===`);
      ws.eachRow({ includeEmpty: false }, row => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, cell => {
          cells.push(String(cell.text ?? "").trim());
        });
        lines.push(cells.join("\t"));
      });
    });
    const text = lines.join("\n").trim();
    const letters = text.replace(/[^a-zA-Z0-9]/g, "");
    return letters.length >= MIN_MEANINGFUL_CHARS / 2
      ? text.slice(0, MAX_TEXT_CHARS)
      : null;
  } catch {
    return null;
  }
}
