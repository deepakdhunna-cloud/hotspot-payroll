/**
 * Boot-time database bootstrap.
 *
 * 1. Applies drizzle migrations (idempotent — drizzle tracks what has run),
 *    so a fresh database is fully provisioned on first boot and every deploy
 *    keeps the schema current with zero manual steps.
 *
 * 2. One-time data import: when COPY_FROM_DATABASE_URL is set AND the target
 *    database has no employees yet, copies every table row-for-row from the
 *    source (used for the Manus/TiDB → Railway migration). The empty-target
 *    guard makes it impossible to overwrite existing data; remove the env var
 *    once the copy has happened.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

/** Tables to copy, in dependency-friendly order. Unknown/missing source
 * tables are skipped (e.g. the day-level schedule tables predate the source). */
const COPY_TABLES = [
  "users",
  "manager_stores",
  "employees",
  "payroll_entries",
  "time_punches",
  "pin_codes",
  "schedule_shifts",
  "schedule_imports",
  "audit_log",
];

export async function runBootstrap(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return; // dev/test without a database

  // --- 1. migrations ---
  try {
    const conn = await mysql.createConnection(url);
    const db = drizzle(conn);
    await migrate(db, { migrationsFolder: "./drizzle" });
    await conn.end();
    console.log("[Bootstrap] Migrations up to date");
  } catch (error) {
    console.error("[Bootstrap] Migration failed:", error);
    return; // don't attempt a data copy on a broken schema
  }

  // --- 2. optional one-time data import ---
  const sourceUrl = process.env.COPY_FROM_DATABASE_URL;
  if (!sourceUrl) return;

  let source: mysql.Connection | null = null;
  let target: mysql.Connection | null = null;
  try {
    target = await mysql.createConnection(url);

    // Guard: only ever import into an EMPTY database.
    const [existing] = await target.query<any[]>(
      "SELECT COUNT(*) AS c FROM employees",
    );
    if (Number(existing[0]?.c ?? 0) > 0) {
      console.log(
        "[Bootstrap] Target already has data — skipping import. " +
          "Remove COPY_FROM_DATABASE_URL from the environment.",
      );
      return;
    }

    source = await mysql.createConnection(sourceUrl);
    console.log("[Bootstrap] Importing data from source database…");

    for (const table of COPY_TABLES) {
      let rows: any[];
      try {
        const [result] = await source.query<any[]>(`SELECT * FROM \`${table}\``);
        rows = result;
      } catch {
        console.log(`[Bootstrap]   ${table}: not present at source, skipped`);
        continue;
      }
      if (rows.length === 0) {
        console.log(`[Bootstrap]   ${table}: 0 rows`);
        continue;
      }
      const columns = Object.keys(rows[0]);
      const colSql = columns.map((c) => `\`${c}\``).join(", ");
      const batchSize = 250;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const placeholders = batch
          .map(() => `(${columns.map(() => "?").join(", ")})`)
          .join(", ");
        const values = batch.flatMap((r) => columns.map((c) => r[c]));
        await target.query(
          `INSERT INTO \`${table}\` (${colSql}) VALUES ${placeholders}`,
          values,
        );
      }
      // Verify the copy before moving on.
      const [count] = await target.query<any[]>(
        `SELECT COUNT(*) AS c FROM \`${table}\``,
      );
      const copied = Number(count[0]?.c ?? 0);
      if (copied !== rows.length) {
        throw new Error(
          `${table}: copied ${copied} of ${rows.length} rows — aborting import`,
        );
      }
      console.log(`[Bootstrap]   ${table}: ${copied} rows ✓`);
    }
    console.log(
      "[Bootstrap] Data import complete. Remove COPY_FROM_DATABASE_URL from the environment.",
    );
  } catch (error) {
    console.error("[Bootstrap] Data import failed:", error);
  } finally {
    await source?.end().catch(() => {});
    await target?.end().catch(() => {});
  }
}
