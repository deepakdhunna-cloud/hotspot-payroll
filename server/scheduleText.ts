/**
 * Text extraction for schedule uploads. The import must read ANYTHING a
 * manager throws at it — Homebase PDF exports, spreadsheets, photos of a
 * handwritten grid. Digital PDFs and sheets carry their own text, and
 * feeding that text to the model is far more reliable than asking it to
 * fetch and read the raw file (and sidesteps upstream file-size limits).
 * Photos and scans have no text layer — those still go to the model as
 * images, which it reads visually.
 *
 * Weekly schedules are GRIDS (rows = people, columns = days). A naive text
 * dump flattens the grid: empty cells vanish, so "Thu … Sat" shifts read as
 * two consecutive times and the model has to guess the days — which is how
 * time slots end up on the wrong day. extractPdfText therefore rebuilds the
 * layout from glyph coordinates: items are clustered into lines, lines into
 * cells, a day-header row is detected, and every cell below it is prefixed
 * with the day column it sits under ("Fri 7/17: 5:00am-1:00pm"). The model
 * no longer guesses — the geometry decides the day.
 */
import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";

/** Minimum letters before we trust a PDF's text layer (scans have ~none). */
const MIN_MEANINGFUL_CHARS = 60;
/** Keep prompts bounded — a schedule never legitimately needs more. */
const MAX_TEXT_CHARS = 120_000;

/** The shape PDF.js gives us for one run of glyphs on a page. */
export type PdfTextItem = {
  str: string;
  /** [a, b, c, d, x, y] — x = transform[4], y = transform[5], y grows UP. */
  transform: number[];
  width?: number;
  height?: number;
};

/** "Thu", "Thursday", "Thu 7/16", "7/16", "7/16/26" — a day-column header. */
const DAY_CELL =
  /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?(\s+\d{1,2}[\/-]\d{1,2}(\/\d{2,4})?)?$|^\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?$/i;

type Cell = { text: string; x0: number; x1: number };

/**
 * Rebuild readable, column-faithful text from positioned glyph runs.
 * Pure — exported so the grid logic is unit-testable without a real PDF.
 */
export function layoutPdfText(items: PdfTextItem[]): string {
  const pieces = items
    .filter((i) => i.str && i.str.trim().length > 0)
    .map((i) => ({
      str: i.str.trim(),
      x: i.transform?.[4] ?? 0,
      y: i.transform?.[5] ?? 0,
      w: Math.max(i.width ?? 0, i.str.trim().length * 4),
      h: Math.abs(i.transform?.[3] ?? i.height ?? 10) || 10,
    }));
  if (pieces.length === 0) return "";

  // Cluster into lines: nearby baselines (scaled to glyph height) are one row.
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: typeof pieces }[] = [];
  for (const p of pieces) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) <= Math.max(3, p.h * 0.55)) {
      line.items.push(p);
    } else {
      lines.push({ y: p.y, items: [p] });
    }
  }

  // Within a line: sort by x, merge runs into cells, split on wide gaps.
  const toCells = (its: (typeof pieces)[number][]): Cell[] => {
    const sorted = [...its].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of sorted) {
      const last = cells[cells.length - 1];
      const avgChar = it.str.length > 0 ? it.w / it.str.length : 5;
      const gap = last ? it.x - last.x1 : Infinity;
      if (last && gap <= Math.max(7, avgChar * 1.6)) {
        last.text += (gap > avgChar * 0.25 ? " " : "") + it.str;
        last.x1 = Math.max(last.x1, it.x + it.w);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    return cells.filter((c) => c.text.length > 0);
  };
  const cellLines = lines.map((l) => toCells(l.items));

  // Day-header rows: at least 3 day-looking cells ("Thu 7/16 | Fri 7/17 | …").
  type Head = { index: number; cols: { label: string; cx: number }[] };
  const heads: Head[] = [];
  cellLines.forEach((cells, i) => {
    const dayCols = cells.filter((c) => DAY_CELL.test(c.text));
    if (dayCols.length >= 3) {
      heads.push({
        index: i,
        cols: dayCols.map((c) => ({ label: c.text, cx: (c.x0 + c.x1) / 2 })),
      });
    }
  });
  // A cell belongs to a column when its center is within about half the
  // typical column pitch — beyond that it's a name/notes cell, left bare.
  const radiusOf = (head: Head) => {
    const cs = head.cols.map((c) => c.cx).sort((a, b) => a - b);
    if (cs.length < 2) return 40;
    const gaps = cs.slice(1).map((v, i) => v - cs[i]).sort((a, b) => a - b);
    return Math.max(20, gaps[Math.floor(gaps.length / 2)] * 0.55);
  };

  let h = -1;
  const out: string[] = [];
  cellLines.forEach((cells, i) => {
    if (heads[h + 1]?.index === i) h += 1;
    const head = h >= 0 ? heads[h] : null;
    if (!head || head.index === i) {
      out.push(cells.map((c) => c.text).join(" | "));
      return;
    }
    const radius = radiusOf(head);
    out.push(
      cells
        .map((c) => {
          const cx = (c.x0 + c.x1) / 2;
          let best: { label: string; d: number } | null = null;
          for (const col of head.cols) {
            const d = Math.abs(col.cx - cx);
            if (!best || d < best.d) best = { label: col.label, d };
          }
          return best && best.d <= radius ? `${best.label}: ${c.text}` : c.text;
        })
        .join(" | "),
    );
  });
  return out.join("\n");
}

export async function extractPdfText(buf: Buffer): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    let merged = "";
    try {
      const pages: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pages.push(layoutPdfText((content.items ?? []) as PdfTextItem[]));
      }
      merged = pages.join("\n\n").trim();
    } catch {
      merged = "";
    }
    if (merged.replace(/[^a-zA-Z0-9]/g, "").length < MIN_MEANINGFUL_CHARS) {
      // Layout rebuild came up short — fall back to the plain text dump
      // before declaring the PDF textless.
      const { text } = await extractText(pdf, { mergePages: true });
      merged = ((Array.isArray(text) ? text.join("\n") : text) ?? "").trim();
    }
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
