/**
 * Full data export — every record the site has ever stored, as one ZIP, so
 * the payroll website and its complete history can move into another system
 * (the owner's own portal). CEO-only; the route is server/fullExportRoute.ts.
 *
 * Layout inside hotspot-payroll-export-<date>/:
 *   README.md          how to load it and keep it live (docs/PORTAL_MIGRATION.md)
 *   manifest.json      when, from where, schema migrations, row counts
 *   json/<table>.json  exact rows; timestamps ISO-8601 UTC, money as decimal strings
 *   csv/<table>.csv    the same rows for spreadsheets
 *   mysql/schema.sql   the site's own migrations in order — recreates the schema
 *   mysql/data.sql     REPLACE INTO for every row (UTC) — safe to re-run
 *
 * Credentials stay out unless the CEO explicitly asks for them. Clock-code
 * hashes are unsalted sha256 over 4 digits — anyone holding one can recover
 * the code instantly, so exporting them is exporting the codes. PIN hashes
 * are scrypt with this site's JWT_SECRET as pepper.
 *
 * Formatting and compression run in slices that hand the event loop back
 * between steps: a large history takes seconds to package, and kiosk punches
 * arriving meanwhile must not wait for it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { strToU8, Zip, ZipDeflate } from "fflate";
import mysql from "mysql2";
import {
  appSettings,
  attentionItems,
  auditLog,
  employees,
  managerStores,
  payrollEntries,
  pinCodes,
  scheduleImports,
  scheduleShifts,
  timePunches,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";

export const FULL_EXPORT_FORMAT_VERSION = 1;

const SLICE_ROWS = 2_000;
const SQL_BATCH_ROWS = 200;
const ZIP_SLICE_BYTES = 1 << 20;

type ExportTable = {
  table: MySqlTable;
  /** The whole table is credential material (PIN hashes). */
  credentialsOnly?: boolean;
  /** SQL column names that are credential material in an ordinary table. */
  credentialColumns?: string[];
};

/** Every table the site stores, in load order (mirrors bootstrap COPY_TABLES). */
const EXPORT_TABLES: ExportTable[] = [
  { table: users },
  { table: managerStores },
  { table: employees, credentialColumns: ["clockCodeHash"] },
  { table: payrollEntries },
  { table: timePunches },
  { table: pinCodes, credentialsOnly: true },
  { table: scheduleShifts },
  { table: scheduleImports },
  { table: auditLog },
  { table: attentionItems },
  { table: appSettings },
];

export type Row = Record<string, unknown>;
/** Reads every row of each table, in order. Injectable for tests. */
export type LoadAll = (tables: MySqlTable[]) => Promise<Row[][]>;

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Applies `format` to consecutive slices of `records`, yielding between them. */
async function formatInSlices(
  records: Row[],
  sliceSize: number,
  format: (slice: Row[]) => string,
): Promise<string[]> {
  const parts: string[] = [];
  for (let i = 0; i < records.length; i += sliceSize) {
    parts.push(format(records.slice(i, i + sliceSize)));
    await yieldToLoop();
  }
  return parts;
}

/**
 * One transaction for all reads: under REPEATABLE READ (MySQL and TiDB
 * default) every table is read from the same snapshot, so a punch written
 * mid-export can't reference an employee row the export never saw.
 */
const loadAllFromDb: LoadAll = async (tables) => {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async (tx) => {
    const out: Row[][] = [];
    for (const table of tables) {
      out.push((await tx.select().from(table as any)) as Row[]);
    }
    return out;
  });
};

/** Re-keys drizzle rows by SQL column name, minus any dropped columns. */
function toRecords(rows: Row[], table: MySqlTable, drop: Set<string>) {
  const cols = Object.entries(getTableColumns(table))
    .map(([prop, col]) => ({ prop, name: col.name }))
    .filter((c) => !drop.has(c.name));
  return {
    columns: cols.map((c) => c.name),
    records: rows.map((r) =>
      Object.fromEntries(cols.map((c) => [c.name, r[c.prop] ?? null])),
    ),
  };
}

/** Same text as JSON.stringify(records, null, 2), built in slices. */
export async function toJsonText(records: Row[]): Promise<string> {
  if (records.length === 0) return "[]\n";
  const parts = await formatInSlices(records, SLICE_ROWS, (slice) =>
    slice
      .map((r) => `  ${JSON.stringify(r, null, 2).replace(/\n/g, "\n  ")}`)
      .join(",\n"),
  );
  return `[\n${parts.join(",\n")}\n]\n`;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** One RFC 4180 cell. Text that a spreadsheet would run as a formula opens as text. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !NUMERIC.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM so Excel reads accented names correctly; CRLF per RFC 4180. */
export async function toCsv(columns: string[], records: Row[]): Promise<string> {
  const body = await formatInSlices(records, SLICE_ROWS, (slice) =>
    slice.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\r\n"),
  );
  return `﻿${[columns.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

/** REPLACE INTO keeps data.sql re-runnable and lets exported rows win over seeded defaults. */
export async function toReplaceSql(
  tableName: string,
  columns: string[],
  records: Row[],
  batchSize = SQL_BATCH_ROWS,
): Promise<string> {
  if (records.length === 0) return `-- ${tableName}: no rows\n`;
  const head = `REPLACE INTO ${mysql.escapeId(tableName)} (${columns
    .map((c) => mysql.escapeId(c))
    .join(", ")}) VALUES\n`;
  const statements = await formatInSlices(records, batchSize, (batch) => {
    const values = batch.map(
      (r) => `(${columns.map((c) => mysql.escape(r[c] ?? null, false, "Z")).join(", ")})`,
    );
    return `${head}${values.join(",\n")};`;
  });
  return `-- ${tableName}: ${records.length} rows\n${statements.join("\n")}\n`;
}

/** Streams files into one ZIP, deflating a slice at a time. */
async function zipFiles(
  files: { path: string; text: string }[],
  mtime: Date,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const zip = new Zip((err, data, final) => {
    if (err) return fail(err);
    chunks.push(data);
    if (final) finish();
  });
  for (const { path, text } of files) {
    const entry = new ZipDeflate(path, { level: 6 });
    entry.mtime = mtime;
    zip.add(entry);
    const bytes = strToU8(text);
    if (bytes.length === 0) entry.push(bytes, true);
    for (let i = 0; i < bytes.length; i += ZIP_SLICE_BYTES) {
      entry.push(bytes.subarray(i, i + ZIP_SLICE_BYTES), i + ZIP_SLICE_BYTES >= bytes.length);
      await yieldToLoop();
    }
  }
  zip.end();
  await done;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** The site's own migrations, concatenated in journal order. */
function readSchema(root: string): { sql: string; tags: string[] } | null {
  try {
    const journal = JSON.parse(
      readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    const chunks = tags.map(
      (tag) =>
        `-- migration ${tag}\n${readFileSync(join(root, "drizzle", `${tag}.sql`), "utf8")
          .replace(/-->\s*statement-breakpoint/g, "")
          .trim()}`,
    );
    return {
      tags,
      sql: [
        "-- Hotspot Payroll schema: the site's own migrations, in order.",
        "-- Run on an EMPTY MySQL 8 / TiDB database, then load data.sql.",
        "-- (Running this website's code itself? Skip this file: the app creates",
        "-- its schema on first boot. See README.md.)",
        "SET NAMES utf8mb4;",
        ...chunks,
      ].join("\n\n") + "\n",
    };
  } catch {
    return null;
  }
}

function readGuide(root: string): string {
  try {
    return readFileSync(join(root, "docs/PORTAL_MIGRATION.md"), "utf8");
  } catch {
    return "# Hotspot Payroll export\n\nSee manifest.json for contents. The full guide is docs/PORTAL_MIGRATION.md in the hotspot-payroll repository.\n";
  }
}

export async function buildFullExport(opts: {
  includeCredentials: boolean;
  /** e.g. https://hotspotpayroll.com — recorded so the portal knows the live feed address. */
  origin: string;
  now?: Date;
  loadAll?: LoadAll;
  /** Repository root holding drizzle/ and docs/ (the process cwd in production). */
  root?: string;
}): Promise<{ filename: string; zip: Uint8Array; counts: Record<string, number> }> {
  const now = opts.now ?? new Date();
  const root = opts.root ?? process.cwd();
  const folder = `hotspot-payroll-export-${now.toISOString().slice(0, 10)}`;

  const specs = EXPORT_TABLES.filter(
    (s) => opts.includeCredentials || !s.credentialsOnly,
  );
  const rowsByTable = await (opts.loadAll ?? loadAllFromDb)(specs.map((s) => s.table));

  const tableFiles: { path: string; text: string }[] = [];
  const sqlParts = [
    "-- Hotspot Payroll data: every row, timestamps in UTC.",
    // Clients that default to latin1 would otherwise double-encode accents.
    "SET NAMES utf8mb4;",
    "SET time_zone = '+00:00';",
    "SET FOREIGN_KEY_CHECKS = 0;",
  ];
  const counts: Record<string, number> = {};

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const name = getTableName(spec.table);
    const drop = new Set<string>(
      opts.includeCredentials ? [] : (spec.credentialColumns ?? []),
    );
    const { columns, records } = toRecords(rowsByTable[i] ?? [], spec.table, drop);
    counts[name] = records.length;
    tableFiles.push(
      { path: `json/${name}.json`, text: await toJsonText(records) },
      { path: `csv/${name}.csv`, text: await toCsv(columns, records) },
    );
    sqlParts.push(await toReplaceSql(name, columns, records));
  }
  sqlParts.push("SET FOREIGN_KEY_CHECKS = 1;");

  const schema = readSchema(root);
  const manifest = {
    format: "hotspot-payroll-full-export",
    formatVersion: FULL_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    source: opts.origin,
    timestamps: "UTC — ISO-8601 in json/ and csv/, UTC literals in mysql/data.sql",
    money: "USD decimal strings exactly as stored",
    includesCredentials: opts.includeCredentials,
    schemaMigrations: schema?.tags ?? [],
    tables: counts,
    liveFeed: {
      url: `${opts.origin}/api/portal-feed`,
      method: "GET",
      auth: "Authorization: Bearer <PORTAL_FEED_TOKEN>",
      note: "Every response is the complete, current data set. See README.md.",
    },
  };

  const files = [
    { path: "README.md", text: readGuide(root) },
    { path: "manifest.json", text: `${JSON.stringify(manifest, null, 2)}\n` },
    ...tableFiles,
    ...(schema ? [{ path: "mysql/schema.sql", text: schema.sql }] : []),
    { path: "mysql/data.sql", text: `${sqlParts.join("\n")}\n` },
  ].map((f) => ({ ...f, path: `${folder}/${f.path}` }));

  return { filename: `${folder}.zip`, zip: await zipFiles(files, now), counts };
}
