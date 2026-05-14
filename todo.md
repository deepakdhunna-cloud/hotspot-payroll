# Hotspot Market Payroll TODO

## Foundation
- [x] Initialize project scaffold
- [x] Upload logo asset and reference site-wide
- [x] Apply brand colors (red accent)
- [x] Add shared constants: STORES (4) + ROLES (6)

## Schema & Backend
- [x] Add `employees` table
- [x] Add `payrollEntries` table
- [x] Add `userStoreAssignment` (manager_stores)
- [x] Generate + apply migration
- [x] Add db helpers for employees & payroll
- [x] Add tRPC routers: employees, payroll, schedule, dashboard, ceo

## Role-Based Access
- [x] PIN-based sessions (CEO + per-store manager)
- [x] adminProcedure / managerProcedure scope checks

## Employee Management UI
- [x] Employees list page with filters
- [x] Add Employee dialog/form
- [x] Employee profile page with details + payroll history

## Weekly Payroll Entry
- [x] Bulk weekly entry grid
- [x] Auto compute gross = hours × rate (no overtime)
- [x] Save to payrollEntries with weekStart
- [x] Editable pay rate column on the grid (live recalc + saves back to profile)

## Schedule Import
- [x] Upload PDF/photo of Homebase schedule
- [x] Server-side vision call → extract { employeeName, scheduledHours }
- [x] Match names to employees, populate scheduledHours for the week
- [x] Show preview/edit before commit
- [x] Quick Add unmatched rows (one + bulk)

## Manager Dashboard
- [x] Per-store cards: total hours, total gross pay
- [x] Scheduled vs Actual variance per employee
- [x] Week selector

## CEO Dashboard
- [x] All 4 stores summary
- [x] Per-employee gross pay + federal + state withholding estimates
- [x] Store-level totals & grand total
- [x] Store filter switch
- [x] Access PINs management (CEO PIN + one per store)

## PIN Authentication
- [x] Numeric keypad sign-in with branding
- [x] Default PINs seeded (CEO 9999, store 1111/1313/1414/7777)
- [x] CEO can rotate any PIN
- [x] Tests for verification + session

## Bulk Edit Employees
- [x] employees.bulkUpdate with permission checks
- [x] Row + header checkbox + selection toolbar (move store, change role)
- [x] Tests

## Delete + Light Theme + Polish (v5/v6)
- [x] Server employees.delete (cascades payroll history)
- [x] Delete button on EmployeeProfile with confirm dialog (Deactivate kept)
- [x] Switch site to light/white theme
- [x] Use clean transparent HOTSPOT wordmark + CSS MARKET pill (centered below)
- [x] Remove sidebar side "Payroll" label
- [x] Remove every visible "AI / Smart / sparkles" mention from pages
- [x] Greeting: store's Manager-role employee name → falls back to "Manager"; CEO sessions show "CEO"
- [x] Editable pay rate column on Weekly Payroll grid
- [x] Pay period anchored Thursday–Wednesday across server + all client pages
- [x] Edit/pencil button on week selector to pick a custom start date
- [x] Remove overtime everywhere (gross = hours × rate)

## Tests
- [x] All 30/30 vitest passing (includes delete permission + scope tests)

## Delivery
- [x] Checkpoint v6 saved

## v6.1 \u2014 Pay period bugfix
- [x] Diagnosed: default was the in-progress week (May 14–20); changed default to most-recent-closed (May 7–13)
- [x] Added getCurrentPayPeriodStart shared helper; getWeekStart was already correctly anchored
- [x] fmtWeekRange already labels start … end+6 correctly; verified with new tests
- [x] Tests covering May 7–13, May 6, and May 14–20 boundaries — 34/34 passing

## v6.2 — Dashboard layout tweak
- [x] Reorder KPI cards: Total Hours → Scheduled Hours → Total Gross Pay → Over/Under
- [x] Per-store cards grid now adapts to count (1=full width, 2=halves, 3=thirds, 4=quarters)
- [x] Save checkpoint

## v7 — Time Clock subsystem
- [x] Schema: add `clockCodeHash` to employees; create `time_punches` table (employeeId, storeLocation, clockInAt, clockOutAt nullable, source, durationMinutes, isManual flag, note) — no `createdBy` column needed (manager scope is enforced server-side, audit not required for this internal tool)
- [x] Migration SQL applied
- [x] db helpers: setClockCode, findOpenPunch, openPunch, closePunch, listPunches(filter), createManualPunch, updatePunch, deletePunch, hoursWorkedForWeek(employeeId, weekStart)
- [x] Server procedure: clock.punch (public; takes store + 4-digit; toggles in/out; rejects if employee inactive or wrong store)
- [x] Server procedures (protected, scope-checked): clock.list, clock.createManual, clock.update, clock.delete, clock.setCode (plus clock.weekHours and clock.weekHoursBulk for payroll prefill)
- [x] Kiosk page at `/clock` (public route) — pick a store once, then number keypad to punch in/out
- [x] Time Clock page inside app showing punches with date+time and duration; manager scope filters to their store
- [x] Manual entry dialog (employee, in datetime, out datetime, note)
- [x] Edit + delete actions on each punch row
- [x] Employee profile: time-clock section with recent punches + "Set clock code" field
- [x] Pace badge on Hours card: "on pace" / "behind pace" / "over" computed from elapsed-week-fraction × scheduled
- [x] Home dashboard defaults to current in-progress week (not the just-closed payable week)
- [x] Auto-prefill Weekly Payroll hours from clock punches (overrideable)
- [x] Tests: clock.* permission + validation gates (9 new tests, 43/43 passing)
- [x] Weekly Payroll: minimize manual entry — hours auto-fill from clock punches by default; manual override hidden behind a pencil icon per row with "(manual)" tag + Reset link
- [ ] Checkpoint and deliver
