# Moving Hotspot Payroll into your portal

Everything needed to bring the payroll website, every record it has stored
since day one, and every record entered from now on into another system.

| Piece | Where it comes from |
| --- | --- |
| **All history** | CEO login → Executive view → **Live portal** → **Download everything** (this .zip) |
| **New data, live** | `GET https://hotspotpayroll.com/api/portal-feed` with the access key (same tab → **Show key**) |
| **The website itself** | GitHub: `deepakdhunna-cloud/hotspot-payroll` |

## What's in the download

```
hotspot-payroll-export-<date>/
  README.md          this guide
  manifest.json      export time, source address, schema migrations, row count per table
  json/<table>.json  every row, exactly as stored
  csv/<table>.csv    the same rows for spreadsheets
  mysql/schema.sql   the site's own migrations, in order (recreates the schema)
  mysql/data.sql     every row as REPLACE INTO (safe to re-run)
```

- **Timestamps are UTC.** JSON and CSV use ISO-8601 (`2026-08-20T14:03:00.000Z`);
  `data.sql` sets `time_zone = '+00:00'` before loading.
- **Money is USD as exact decimal strings** (`"15.50"`). Don't parse it as a float.
- **Ids are stable.** Every table's `id` is its primary key and never
  changes. Key your copy on it so live updates (below) match the right rows.
- **The JSON is the exact copy.** In the CSVs, a text cell that a spreadsheet
  would run as a formula (starting `=`, `+`, `-` or `@`) is prefixed with `'`.
- **Credentials are only included when the CEO ticked the box** at download
  time (`manifest.json` → `includesCredentials`). See [Security](#security).

## 1. Load the history

### A. Your portal runs this website's code (the whole site moves)

This is the path the site itself used to move off Manus, and it copies the
database directly with no files involved.

1. Deploy the repository: Node 22+, pnpm 10,
   `pnpm install --frozen-lockfile && pnpm build && pnpm start`.
2. Give the new deployment these environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | a **new, empty** MySQL 8 or TiDB database |
   | `JWT_SECRET` | **copy it from the current Railway service**. It signs sessions and peppers every PIN hash, so existing PINs keep working |
   | `COPY_FROM_DATABASE_URL` | the current site's `DATABASE_URL` (Railway → service → Variables) |
   | `PORTAL_FEED_TOKEN` | a long random secret, if the new deployment should serve the feed and the `/portal` page too |
   | `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | only for schedule-photo reading and file uploads. These were Manus services; set them only if you still have working values |

3. Boot it **once with `COPY_FROM_DATABASE_URL` already set**. On first boot
   the app creates its schema, copies every table row for row, verifies each
   count and logs `[Bootstrap] Data import complete`. The copy only ever runs
   into an empty database: if the app booted before the variable was set,
   start again from an empty database. Remove the variable afterwards.
4. Compare the row counts in the logs with `manifest.json`.
5. **Switch-over day.** The current site keeps taking punches until you
   switch. Set `TOPUP_FROM_DATABASE_URL` (the same value) for one restart to
   pull in everything that changed since the copy. Then point the store
   tablets (`/clock`) and managers at the new address, remove the variable,
   and retire the old service. Clock codes keep working because a
   database-to-database copy carries every column.

### B. Your portal has its own database

- **MySQL or TiDB:** run `mysql/schema.sql`, then `mysql/data.sql`. Already
  have matching tables? `data.sql` alone works: `REPLACE INTO` lets exported
  rows win and can be re-run safely.
- **Anything else:** load `json/<table>.json` (or the CSVs). Field names are
  the column names in [Tables](#tables).

## 2. Keep it live

### Pull (recommended)

```http
GET https://hotspotpayroll.com/api/portal-feed
Authorization: Bearer <access key>
Accept-Encoding: gzip
```

- **Every response is the complete, current data set**: everything in the
  download plus whatever was entered since. Polling every 1–5 minutes keeps
  your portal live.
- Add `?include=audit` to also receive the activity log.
- Responses are gzip-compressed when the request allows it.
- Missing or wrong key → `401`. Feed not configured on the server → `503`.
- **Call it from your portal's server, never from browser code.** The key
  unlocks everything.

Response (`schemaVersion` `"1.1"`):

| Feed key | Same rows as | Notes |
| --- | --- | --- |
| `employees` | `employees` | never includes `clockCodeHash` |
| `payrollEntries` | `payroll_entries` | |
| `timePunches` | `time_punches` | |
| `scheduleShifts` | `schedule_shifts` | |
| `scheduleImports` | `schedule_imports` | |
| `attentionItems` | `attention_items` | |
| `appSettings` | `app_settings` | |
| `auditLog` | `audit_log` | only with `?include=audit` |

Plus `schemaVersion` and `generatedAt`. Row fields are identical to the
download's JSON, so the same import code handles both.

**Sync rule:** for each array, upsert every row by `id`, then delete your
rows whose `id` is no longer in the response. Deletions only reach you this
way, for example a manager removing a wrong punch, or a schedule re-import
replacing a week's shifts.

```js
// Node 18+ example: run every few minutes on your portal's server.
const res = await fetch("https://hotspotpayroll.com/api/portal-feed", {
  headers: { Authorization: `Bearer ${process.env.HOTSPOT_FEED_KEY}` },
});
if (!res.ok) throw new Error(`Hotspot feed answered HTTP ${res.status}`);
const feed = await res.json();
for (const [key, rows] of Object.entries(feed)) {
  if (!Array.isArray(rows)) continue; // schemaVersion, generatedAt
  await upsertAllAndDeleteMissing(key, rows); // your storage code
}
```

### Push (optional)

To have the site send the data instead, set on the current Railway service:

| Variable | Value |
| --- | --- |
| `PORTAL_SYNC_URL` | your portal's HTTPS endpoint |
| `PORTAL_SYNC_TOKEN` | a shared secret, sent as `Authorization: Bearer …` |
| `PORTAL_SYNC_INTERVAL_SECONDS` | safety-net cadence, default 60 (15–3600) |

The site then POSTs the same JSON as the feed (without `auditLog`) at boot,
about 3 seconds after every change, and on the interval. Answer `2xx` to
accept it. Executive view → Live portal shows each delivery and the exact
error of any failure.

## Tables

Store names: `Hotspot Market 11`, `Hotspot Market 13`, `Hotspot Market 14`,
`Hotspot Market 17`, `Hotspot Travel Center`. Pay weeks run **Thursday to
Wednesday**; every `weekStart` is a Thursday at 00:00 UTC.

| Table | What a row is | Columns worth knowing |
| --- | --- | --- |
| `employees` | one person | `fullName`, `phone`, `payRate` (hourly), `weeklyPay` (flat set pay; null = hourly), `role`, `storeLocation`, `active` (1/0), `clockCodeHash` (credentials only) |
| `time_punches` | one clock-in/out | `employeeId` → employees, `clockInAt`, `clockOutAt` (null = still on the clock), `source` kiosk/manual, `note` |
| `payroll_entries` | one employee's pay for one week | `weekStart`, `hoursWorked`, `scheduledHours`, `payRateSnapshot` (rate at the time), `grossPay`, `notes` (`fixed-pay` = set-pay week, `schedule-only` = created by a schedule import). `overtimePay` is always 0 |
| `schedule_shifts` | one scheduled shift on one day | `employeeId`, `weekStart`, `shiftDate`, `startLabel`/`endLabel` as printed, `hours`, `importId` → schedule_imports |
| `schedule_imports` | one uploaded schedule | `uploadedBy`, `weekStart`, `filename`, `status`, counts. `fileUrl` may point at retired Manus storage |
| `audit_log` | one recorded action (append-only) | `actorScope` (ceo, cfo, store name or kiosk), `action`, `entityType`/`entityId`, `detail` (JSON text; deletes keep a snapshot of what was removed), `ip` |
| `attention_items` | one alert or task | `refKey` (unique), `kind`, `status` open/resolved, `resolution` |
| `app_settings` | one setting | `key`/`value`, e.g. `auto_clockout_hours` |
| `pin_codes` | one sign-in PIN (credentials only) | `scope` (ceo, cfo or a store name), `pinHash` |
| `users`, `manager_stores` | legacy sign-in tables from the original template | usually empty |

## Security

- **The download holds personal data**: names, phone numbers and pay rates.
  Keep it private and delete spare copies once it's loaded.
- **Treat the access key like a password.** To revoke it, change
  `PORTAL_FEED_TOKEN` on Railway and give your portal the new one (the
  `/portal` page link changes too).
- **Clock-code hashes are effectively the codes.** They're unsalted
  `sha256("hotspot:clock:<employeeId>:<4 digits>")`, and with only 10,000
  possible codes anyone holding one can recover it instantly. That's why they
  only travel when the box is ticked. If your portal takes over the time
  clock, verify codes with the same formula, or have managers set fresh ones.
- **PIN hashes** are `scrypt$<salt>$<hash>` over `<scope>:<pin>:<JWT_SECRET>`.
  They verify only where the same `JWT_SECRET` is configured. Without it,
  set new PINs in the new system.
