import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  buildFullExport,
  csvCell,
  toJsonText,
  toReplaceSql,
  type LoadAll,
  type Row,
} from "./fullExport";
import { handleFullExport } from "./fullExportRoute";

const ROOT = join(__dirname, "..");
const NOW = new Date("2026-11-05T18:30:00.000Z");
const FOLDER = "hotspot-payroll-export-2026-11-05";

const ROWS: Record<string, Row[]> = {
  employees: [
    {
      id: 1,
      fullName: 'Amrit "AK" Kaur',
      phone: "555-0100",
      payRate: "15.50",
      weeklyPay: null,
      role: "Manager",
      storeLocation: "Hotspot Market 17",
      active: 1,
      clockCodeHash: "clock-hash-SECRET",
      createdAt: new Date("2026-08-20T14:03:00.000Z"),
      updatedAt: new Date("2026-08-21T09:00:00.000Z"),
    },
  ],
  time_punches: [
    {
      id: 5,
      employeeId: 1,
      storeLocation: "Hotspot Market 17",
      clockInAt: new Date("2026-11-05T13:00:00.000Z"),
      clockOutAt: null,
      source: "kiosk",
      note: '=HYPERLINK("x")\nsecond line',
      createdAt: new Date("2026-11-05T13:00:00.000Z"),
      updatedAt: new Date("2026-11-05T13:00:00.000Z"),
    },
  ],
  pin_codes: [
    { id: 1, scope: "ceo", pinHash: "scrypt$pin-hash-SECRET", updatedAt: NOW },
  ],
};

function fakeLoad() {
  const requested: string[] = [];
  const loadAll: LoadAll = async (tables) =>
    tables.map((t) => {
      const name = getTableName(t);
      requested.push(name);
      return ROWS[name] ?? [];
    });
  return { loadAll, requested };
}

async function exportFiles(includeCredentials: boolean) {
  const { loadAll, requested } = fakeLoad();
  const result = await buildFullExport({
    includeCredentials,
    origin: "https://hotspotpayroll.com",
    now: NOW,
    loadAll,
    root: ROOT,
  });
  const raw = Object.fromEntries(
    Object.entries(unzipSync(result.zip)).map(([path, bytes]) => [
      path.replace(`${FOLDER}/`, ""),
      bytes,
    ]),
  );
  const files = Object.fromEntries(
    Object.entries(raw).map(([path, bytes]) => [path, strFromU8(bytes)]),
  );
  return { ...result, files, raw, requested };
}

/** Files holding exported rows (the guide and schema name columns legitimately). */
const dataFiles = (files: Record<string, string>) =>
  Object.entries(files)
    .filter(([path]) => /^(json|csv)\//.test(path) || path === "mysql/data.sql")
    .map(([, text]) => text)
    .join("\n");

describe("full export contents", () => {
  it("is one date-stamped folder with the guide, manifest, json, csv and mysql files", async () => {
    const { filename, files } = await exportFiles(false);
    expect(filename).toBe(`${FOLDER}.zip`);
    for (const path of [
      "README.md",
      "manifest.json",
      "json/employees.json",
      "csv/employees.csv",
      "json/time_punches.json",
      "json/audit_log.json",
      "json/attention_items.json",
      "json/app_settings.json",
      "mysql/schema.sql",
      "mysql/data.sql",
    ]) {
      expect(files[path], path).toBeDefined();
    }
    expect(files["README.md"]).toContain("# Moving Hotspot Payroll into your portal");
  });

  it("leaves PIN and clock-code hashes out unless asked", async () => {
    const { files, counts, requested } = await exportFiles(false);
    expect(requested).not.toContain("pin_codes");
    expect(files["json/pin_codes.json"]).toBeUndefined();
    expect(counts.pin_codes).toBeUndefined();
    const everything = Object.values(files).join("\n");
    expect(everything).not.toContain("clock-hash-SECRET");
    expect(everything).not.toContain("pin-hash-SECRET");
    expect(dataFiles(files)).not.toContain("clockCodeHash");
    expect(JSON.parse(files["manifest.json"]).includesCredentials).toBe(false);
  });

  it("carries them only when the CEO ticks the box", async () => {
    const { files, counts } = await exportFiles(true);
    expect(counts.pin_codes).toBe(1);
    expect(JSON.parse(files["json/employees.json"])[0].clockCodeHash).toBe("clock-hash-SECRET");
    expect(files["mysql/data.sql"]).toContain("REPLACE INTO `pin_codes`");
    expect(JSON.parse(files["manifest.json"]).includesCredentials).toBe(true);
  });

  it("keeps values exact: decimal strings, UTC ISO times, nulls", async () => {
    const { files } = await exportFiles(false);
    const [emp] = JSON.parse(files["json/employees.json"]);
    expect(emp.payRate).toBe("15.50");
    expect(emp.weeklyPay).toBeNull();
    expect(emp.createdAt).toBe("2026-08-20T14:03:00.000Z");
    const [punch] = JSON.parse(files["json/time_punches.json"]);
    expect(punch.clockOutAt).toBeNull();
    expect(punch.note).toBe('=HYPERLINK("x")\nsecond line');
  });

  it("writes loadable MySQL: UTC session, escaped text, UTC literals, NULLs", async () => {
    const { files } = await exportFiles(false);
    const sql = files["mysql/data.sql"];
    expect(sql).toContain("SET NAMES utf8mb4;");
    expect(sql).toContain("SET time_zone = '+00:00';");
    expect(sql).toContain("REPLACE INTO `employees`");
    expect(sql).toContain("'Amrit \\\"AK\\\" Kaur'");
    expect(sql).toContain("'2026-08-20 14:03:00.000'");
    expect(sql).toMatch(/'15\.50', NULL, 'Manager'/);
    expect(sql).toContain("-- payroll_entries: no rows");
  });

  it("makes CSVs safe to open in a spreadsheet", async () => {
    const { files, raw } = await exportFiles(false);
    expect([...raw["csv/time_punches.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = files["csv/time_punches.csv"];
    expect(csv.startsWith("id,employeeId,")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")\nsecond line"`);
  });

  it("lists the schema migrations and the live feed address in the manifest", async () => {
    const { files } = await exportFiles(false);
    const manifest = JSON.parse(files["manifest.json"]);
    const journal = JSON.parse(
      readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"),
    );
    expect(manifest.schemaMigrations).toEqual(journal.entries.map((e: any) => e.tag));
    expect(manifest.tables.employees).toBe(1);
    expect(manifest.tables.time_punches).toBe(1);
    expect(manifest.liveFeed.url).toBe("https://hotspotpayroll.com/api/portal-feed");
    expect(manifest.exportedAt).toBe(NOW.toISOString());
    expect(files["mysql/schema.sql"]).toContain("CREATE TABLE `employees`");
    expect(files["mysql/schema.sql"]).not.toContain("statement-breakpoint");
  });
});

describe("csv and sql helpers", () => {
  it("quotes and guards cells", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-5.00")).toBe("-5.00");
    expect(csvCell(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  it("batches large tables into several statements", async () => {
    const records = Array.from({ length: 450 }, (_, i) => ({ id: i + 1 }));
    const sql = await toReplaceSql("t", ["id"], records, 200);
    expect(sql.match(/REPLACE INTO/g)).toHaveLength(3);
    expect(sql).toContain("-- t: 450 rows");
  });

  it("builds JSON in slices that match JSON.stringify exactly", async () => {
    const records = Array.from({ length: 4_500 }, (_, i) => ({
      id: i,
      note: i % 7 ? null : `line one\nline "two" \\ ${i}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }));
    expect(await toJsonText(records)).toBe(`${JSON.stringify(records, null, 2)}\n`);
    expect(await toJsonText([])).toBe("[]\n");
  });
});

describe("a large export", () => {
  it("keeps the server responsive while it builds", async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 600_000);
    const punches = Array.from({ length: 40_000 }, (_, i) => ({
      id: i + 1,
      employeeId: (i % 60) + 1,
      storeLocation: "Hotspot Market 11",
      clockInAt: at(i),
      clockOutAt: at(i + 50),
      source: "kiosk",
      note: null,
      createdAt: at(i),
      updatedAt: at(i),
    }));
    let last = performance.now();
    let longestStall = 0;
    const ticker = setInterval(() => {
      const now = performance.now();
      longestStall = Math.max(longestStall, now - last);
      last = now;
    }, 5);
    const { counts } = await buildFullExport({
      includeCredentials: false,
      origin: "https://hotspotpayroll.com",
      loadAll: async (tables) =>
        tables.map((t) => (getTableName(t) === "time_punches" ? punches : [])),
      root: ROOT,
    });
    clearInterval(ticker);
    expect(counts.time_punches).toBe(40_000);
    // Built in one blocking pass, this export holds the loop for well over a second.
    expect(longestStall).toBeLessThan(400);
  }, 30_000);
});

describe("export route", () => {
  function fakeRes() {
    const res: any = { headers: {} as Record<string, string>, statusCode: 200 };
    res.setHeader = (k: string, v: string) => (res.headers[k.toLowerCase()] = v);
    res.status = (c: number) => ((res.statusCode = c), res);
    res.json = (b: unknown) => ((res.body = b), res);
    res.send = (b: unknown) => ((res.body = b), res);
    return res;
  }
  const req = (query: Record<string, string> = {}) =>
    ({
      query,
      headers: { host: "hotspotpayroll.com", "x-forwarded-proto": "https" },
      header(name: string) {
        return (this.headers as Record<string, string>)[name.toLowerCase()];
      },
      protocol: "http",
    }) as any;
  const deps = (session: any) => ({
    verifySession: vi.fn(async () => session),
    build: vi.fn(async () => ({
      filename: "x.zip",
      zip: new Uint8Array([80, 75]),
      counts: { employees: 1 },
    })),
    audit: vi.fn(async () => {}),
  });

  it("refuses anyone not signed in", async () => {
    const res = fakeRes();
    const d = deps(null);
    await handleFullExport(req(), res, d);
    expect(res.statusCode).toBe(401);
    expect(d.build).not.toHaveBeenCalled();
  });

  it("refuses store managers and the CFO", async () => {
    for (const session of [
      { scope: "Hotspot Market 11", role: "manager", store: "Hotspot Market 11" },
      { scope: "cfo", role: "cfo", store: null },
    ]) {
      const res = fakeRes();
      const d = deps(session);
      await handleFullExport(req(), res, d);
      expect(res.statusCode).toBe(403);
      expect(d.build).not.toHaveBeenCalled();
    }
  });

  it("serves the CEO a zip, records it, and passes the credentials choice through", async () => {
    const res = fakeRes();
    const d = deps({ scope: "ceo", role: "admin", store: null });
    await handleFullExport(req({ credentials: "1" }), res, d);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="x.zip"');
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(d.build).toHaveBeenCalledWith({
      includeCredentials: true,
      origin: "https://hotspotpayroll.com",
    });
    expect(d.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorScope: "ceo", action: "export.full" }),
    );
  });
});
