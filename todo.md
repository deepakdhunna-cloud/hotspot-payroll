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
- [ ] Diagnose: for May 14, 2026 (Thursday) verify the displayed week range
- [ ] Fix server getWeekStart to anchor Thu and end on Wed
- [ ] Fix fmtWeekRange to label start=Thu \u2026 end=Wed (6 days later)
- [ ] Add tests covering May 7\u201313 and May 14\u201320 boundaries
