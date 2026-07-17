// Tiny wrapper around exceljs that builds nicely-formatted Hotspot payroll
// spreadsheets and triggers a download. The output opens cleanly in both
// Google Sheets and Microsoft Excel.
//
// We intentionally avoid pulling in exceljs's Node-only streaming APIs —
// `xlsx.write` to a Buffer works in the browser via the bundled UMD-ish entry.
// exceljs is heavy (~1MB) and only needed at export time, so it loads on
// demand — identical behavior, far smaller first paint.

export type XlsxColumn<T> = {
  header: string;
  key: keyof T | string;
  width?: number;
  /** Cell number format string, e.g. "$#,##0.00" or "0.00". */
  numFmt?: string;
  /** Right-align numeric columns. */
  align?: "left" | "center" | "right";
};

export type XlsxSheet<T> = {
  name: string;
  title?: string;
  subtitle?: string;
  columns: XlsxColumn<T>[];
  rows: T[];
  /** Optional totals row appended at the bottom (already-aggregated values). */
  totals?: Partial<Record<keyof T | string, string | number>>;
  totalsLabelKey?: keyof T | string;
  totalsLabel?: string;
};

const HEADER_FILL = "FFE11D48"; // Hotspot red
const HEADER_TEXT = "FFFFFFFF";
const BORDER_COLOR = "FFE5E7EB";
const ZEBRA_FILL = "FFF9FAFB";
const TOTALS_FILL = "FFFEF2F2";

function downloadBlob(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build and download a single-sheet xlsx with bold header, frozen row,
 * column formatting, zebra striping, and an optional totals row.
 */
export async function exportXlsx<T extends Record<string, any>>(
  filename: string,
  sheet: XlsxSheet<T>,
) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hotspot Market Payroll";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheet.name, {
    views: [{ state: "frozen", ySplit: sheet.title ? 3 : 1 }],
  });

  let headerRowIndex = 1;

  if (sheet.title) {
    const titleRow = ws.addRow([sheet.title]);
    titleRow.font = { name: "Inter", size: 16, bold: true };
    ws.mergeCells(titleRow.number, 1, titleRow.number, sheet.columns.length);
    if (sheet.subtitle) {
      const sub = ws.addRow([sheet.subtitle]);
      sub.font = { name: "Inter", size: 10, italic: true, color: { argb: "FF6B7280" } };
      ws.mergeCells(sub.number, 1, sub.number, sheet.columns.length);
    }
    ws.addRow([]); // spacer
    headerRowIndex = ws.lastRow!.number + 1;
  }

  // Header
  const headerRow = ws.addRow(sheet.columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { name: "Inter", bold: true, color: { argb: HEADER_TEXT }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
  headerRow.height = 22;

  // Apply column widths + per-cell alignment after the header is added.
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(12, c.header.length + 4);
    if (c.numFmt) col.numFmt = c.numFmt;
  });

  // Body rows
  sheet.rows.forEach((row, idx) => {
    const values = sheet.columns.map((c) => (row as any)[c.key]);
    const r = ws.addRow(values);
    if (idx % 2 === 1) {
      r.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_FILL } };
      });
    }
    sheet.columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      cell.font = { name: "Inter", size: 11 };
      cell.alignment = { vertical: "middle", horizontal: c.align ?? "left" };
      if (c.numFmt) cell.numFmt = c.numFmt;
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER_COLOR } },
      };
    });
  });

  // Totals row
  if (sheet.totals) {
    const values = sheet.columns.map((c) => {
      if (c.key === sheet.totalsLabelKey) return sheet.totalsLabel ?? "Total";
      const v = (sheet.totals as any)[c.key];
      return v === undefined ? "" : v;
    });
    const tr = ws.addRow(values);
    tr.eachCell((cell, colIdx) => {
      const c = sheet.columns[colIdx - 1];
      cell.font = { name: "Inter", size: 11, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_FILL } };
      cell.alignment = { vertical: "middle", horizontal: c?.align ?? "left" };
      if (c?.numFmt) cell.numFmt = c.numFmt;
      cell.border = {
        top: { style: "medium", color: { argb: HEADER_FILL } },
      };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf as ArrayBuffer, filename);
}
