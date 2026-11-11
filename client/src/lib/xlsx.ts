// Builds Hotspot payroll spreadsheets with exceljs, styled to match the
// site: the logo, a white sheet with hairline rows, an ink column header
// under a thin brand-red rule, the page's headline figures above the table,
// and status words in the same green / amber the site uses. The output opens
// cleanly in Google Sheets, Excel and Numbers.
//
// Two ways out:
//   exportXlsx  — download the file.
//   shareFile   — hand the file to the device's share sheet (Messages, Mail,
//                 AirDrop, Save to Files…), where the browser can do that.
//
// We intentionally avoid pulling in exceljs's Node-only streaming APIs —
// `xlsx.write` to a Buffer works in the browser via the bundled UMD-ish entry.
// exceljs is heavy (~1MB) and only needed at export time, so it loads on
// demand; `prefetchXlsx` warms it once a payroll page is idle so the first
// export or share starts at once.

export type XlsxColumn<T> = {
  header: string;
  key: keyof T | string;
  width?: number;
  /** Cell number format string, e.g. "$#,##0.00" or "0.00". */
  numFmt?: string;
  /** Right-align numeric columns. */
  align?: "left" | "center" | "right";
  /**
   * Color a cell's text by what it says, like the site's status chips:
   * "good" = green, "warn" = amber, "muted" = grey.
   */
  tone?: (row: T) => "good" | "warn" | "muted" | undefined;
};

export type XlsxSheet<T> = {
  name: string;
  title?: string;
  subtitle?: string;
  /** Headline figures above the table (the page's numbers strip). */
  summary?: { label: string; value: string }[];
  columns: XlsxColumn<T>[];
  rows: T[];
  /** Optional totals row appended at the bottom (already-aggregated values). */
  totals?: Partial<Record<keyof T | string, string | number>>;
  totalsLabelKey?: keyof T | string;
  totalsLabel?: string;
};

/* ---- The site's palette, as spreadsheet colors (ARGB) ---- */
const INK = "FF1F1D1D"; // the logo's black: header fill, headings
const TEXT = "FF26262B";
const MUTED = "FF6E6E78";
const BRAND_RED = "FFD2232A";
const HAIRLINE = "FFE6E6EA";
const ZEBRA_FILL = "FFFAFAFB";
const TOTALS_FILL = "FFF4F4F6";
const GOOD = "FF1B7A47";
const WARN = "FF8A5A0B";
const WHITE = "FFFFFFFF";
const FONT = "Inter";

const LOGO_URL = "/brand/hotspot-logo-ink.png";
/** Logo size on the sheet, in pixels (the artwork is 1201 × 289). */
const LOGO_W = 158;
const LOGO_H = 38;

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let logoBase64: Promise<string | null> | null = null;

/** The light-background logo as base64, fetched once. Null if unavailable. */
function loadLogo(): Promise<string | null> {
  logoBase64 ??= (async () => {
    try {
      const res = await fetch(LOGO_URL);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch {
      return null; // the sheet is still complete without the picture
    }
  })();
  return logoBase64;
}

/** Load the spreadsheet builder and the logo ahead of the first export. */
export function prefetchXlsx() {
  void import("exceljs").catch(() => {});
  void loadLogo();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build a single-sheet workbook in the site's style. */
export async function buildXlsx<T extends Record<string, any>>(
  sheet: XlsxSheet<T>,
): Promise<Blob> {
  const [{ default: ExcelJS }, logo] = await Promise.all([import("exceljs"), loadLogo()]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hotspot Market Payroll";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheet.name);
  const colCount = sheet.columns.length;
  const solid = (argb: string) =>
    ({ type: "pattern", pattern: "solid", fgColor: { argb } }) as const;
  // A left-aligned column right after a right-aligned one (Status after
  // Gross pay) gets a little air, so the two never read as one value.
  const align = (i: number) => {
    const c = sheet.columns[i];
    const horizontal = c.align ?? "left";
    const afterNumber = i > 0 && sheet.columns[i - 1].align === "right";
    return {
      vertical: "middle" as const,
      horizontal,
      ...(horizontal === "left" && afterNumber ? { indent: 1 } : {}),
    };
  };

  // ---- Masthead: logo, title, one line of context ----
  if (logo) {
    const logoRow = ws.addRow([]);
    logoRow.height = 34;
    const imageId = wb.addImage({ base64: logo, extension: "png" });
    ws.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: LOGO_W, height: LOGO_H },
      editAs: "oneCell",
    });
    ws.addRow([]).height = 8;
  }
  if (sheet.title) {
    const titleRow = ws.addRow([sheet.title]);
    titleRow.font = { name: FONT, size: 16, bold: true, color: { argb: INK } };
    titleRow.height = 24;
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount);
    if (sheet.subtitle) {
      const sub = ws.addRow([sheet.subtitle]);
      sub.font = { name: FONT, size: 10, color: { argb: MUTED } };
      ws.mergeCells(sub.number, 1, sub.number, colCount);
    }
    ws.addRow([]).height = 10;
  }

  // ---- Headline figures: small label over a large value ----
  if (sheet.summary && sheet.summary.length > 0) {
    const figures = sheet.summary.slice(0, colCount);
    const labels = ws.addRow(figures.map((f) => f.label));
    const values = ws.addRow(figures.map((f) => f.value));
    labels.height = 16;
    values.height = 24;
    figures.forEach((_, i) => {
      const label = labels.getCell(i + 1);
      label.font = { name: FONT, size: 9, color: { argb: MUTED } };
      label.alignment = { vertical: "bottom", horizontal: "left" };
      const value = values.getCell(i + 1);
      // The first figure is the headline, like the page's first number.
      value.font = { name: FONT, size: i === 0 ? 16 : 14, bold: true, color: { argb: INK } };
      value.alignment = { vertical: "middle", horizontal: "left" };
    });
    ws.addRow([]).height = 10;
  }

  // ---- Column header: ink, under a thin brand-red rule ----
  const headerRow = ws.addRow(sheet.columns.map((c) => c.header));
  headerRow.height = 24;
  sheet.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = solid(INK);
    cell.alignment = align(i);
    cell.border = { top: { style: "medium", color: { argb: BRAND_RED } } };
  });
  // Freeze everything down to and including the column header, wherever the
  // masthead pushed it, so the header never scrolls away. No gridlines: the
  // rows carry their own hairlines, like the tables on the site.
  ws.views = [
    { state: "frozen", xSplit: 0, ySplit: headerRow.number, showGridLines: false },
  ];

  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(12, c.header.length + 4);
  });

  // ---- Rows ----
  sheet.rows.forEach((row, idx) => {
    const r = ws.addRow(sheet.columns.map((c) => (row as any)[c.key]));
    r.height = 20;
    sheet.columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      const tone = c.tone?.(row);
      cell.font = {
        name: FONT,
        size: 10.5,
        color: {
          argb: tone === "good" ? GOOD : tone === "warn" ? WARN : tone === "muted" ? MUTED : TEXT,
        },
      };
      cell.alignment = align(ci);
      if (c.numFmt) cell.numFmt = c.numFmt;
      if (idx % 2 === 1) cell.fill = solid(ZEBRA_FILL);
      cell.border = { bottom: { style: "thin", color: { argb: HAIRLINE } } };
    });
  });

  // ---- Totals ----
  if (sheet.totals) {
    const tr = ws.addRow(
      sheet.columns.map((c) => {
        if (c.key === sheet.totalsLabelKey) return sheet.totalsLabel ?? "Total";
        const v = (sheet.totals as any)[c.key];
        return v === undefined ? "" : v;
      }),
    );
    tr.height = 24;
    sheet.columns.forEach((c, ci) => {
      const cell = tr.getCell(ci + 1);
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
      cell.fill = solid(TOTALS_FILL);
      cell.alignment = align(ci);
      if (c.numFmt) cell.numFmt = c.numFmt;
      cell.border = { top: { style: "medium", color: { argb: INK } } };
    });
  }

  // ---- Where it came from ----
  ws.addRow([]).height = 8;
  const stamp = ws.addRow([
    `Exported ${new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })} · Hotspot Market Payroll`,
  ]);
  stamp.font = { name: FONT, size: 9, color: { argb: MUTED } };
  ws.mergeCells(stamp.number, 1, stamp.number, colCount);

  // Prints (and saves to PDF) on one page wide, landscape.
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: XLSX_MIME });
}

/** Build the workbook and download it. */
export async function exportXlsx<T extends Record<string, any>>(
  filename: string,
  sheet: XlsxSheet<T>,
): Promise<void> {
  downloadBlob(await buildXlsx(sheet), filename);
}

/* ------------------------------- sharing ------------------------------- */

/** Can this browser hand a file to the device's share sheet? */
export function canShareFile(blob: Blob, filename: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    const file = new File([blob], filename, { type: blob.type || XLSX_MIME });
    return navigator.canShare?.({ files: [file] }) ?? false;
  } catch {
    return false;
  }
}

/**
 * Open the device's share sheet with the file and a short message.
 *
 *  "shared"    — it went out (or to Files).
 *  "cancelled" — the sheet was closed; a choice, not a failure.
 *  "blocked"   — the browser refused, usually because building the file
 *                took longer than it lets a tap stay "fresh". The caller
 *                shows a button so the next tap can share at once.
 */
export async function shareFile(
  blob: Blob,
  filename: string,
  message: { title: string; text: string },
): Promise<"shared" | "cancelled" | "blocked"> {
  try {
    const file = new File([blob], filename, { type: blob.type || XLSX_MIME });
    await navigator.share({ files: [file], title: message.title, text: message.text });
    return "shared";
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
    return "blocked";
  }
}
