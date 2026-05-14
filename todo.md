# Hotspot Market Payroll TODO

## Foundation
- [x] Initialize project scaffold
- [x] Upload logo asset and reference site-wide
- [x] Apply dark theme + brand colors (red accent like logo)
- [x] Add shared constants: STORES (4) + ROLES (6)

## Schema & Backend
- [x] Add `employees` table (name, phone, payRate, role, storeLocation)
- [x] Add `payrollEntries` table (employeeId, weekStart, hoursWorked, scheduledHours, grossPay)
- [x] Add `userStoreAssignment` (manager_stores) for manager -> store
- [x] Generate + apply migration
- [x] Add db helpers for employees & payroll
- [x] Add tRPC routers: employees, payroll, schedule, dashboard, ceo

## Role-Based Access
- [x] Use user.role: admin = CEO, user = Manager
- [x] adminProcedure for CEO-only routes (tax data, cross-store)
- [x] Manager scopes by assigned store(s)

## Employee Management UI
- [x] Employees list page with filters (store, role)
- [x] Add Employee dialog/form (name, phone, payRate, role, store)
- [x] Employee profile page with details + payroll history

## Weekly Payroll Entry
- [x] Form: select employee + hours -> auto compute (regular + OT @ 1.5x)
- [x] Save to payrollEntries with weekStart
- [x] Bulk weekly entry table (all employees in store, hours column)

## AI Schedule Import
- [x] Upload PDF/photo of Homebase schedule
- [x] Server-side LLM vision call -> extract { employeeName, scheduledHours }[]
- [x] Match names to employees, populate scheduledHours for the week
- [x] Show preview/edit before commit

## Manager Dashboard
- [x] Per-store cards: total hours, total gross pay
- [x] Scheduled vs Actual table per employee (over/under variance)
- [x] Week selector

## CEO Dashboard
- [x] All 4 stores summary
- [x] Per-employee gross pay + federal + state withholding estimates
- [x] Store-level totals & grand total
- [x] Store filter switch
- [x] Manager access management (assign stores, promote to CEO)

## Polish & Delivery
- [x] Vitest tests for payroll calculations & withholding
- [x] All tests passing (15/15)
- [x] Save checkpoint and deliver


## PIN Authentication (v2)
- [x] Swap site-wide logo to new dark-background PNG
- [x] Add `pin_codes` table (scope: 'ceo' | store name, hashed pin)
- [x] Seed default PINs (CEO: 9999, HM11: 1111, HM13: 1313, HM14: 1414, Travel: 7777)
- [x] Build PIN session cookie (signed JWT, 1-year TTL)
- [x] tRPC `auth.verifyPin` (public) and `auth.me` returns PIN session
- [x] Replace OAuth gating with PIN check in DashboardLayout
- [x] On-screen numeric keypad sign-in page with Hotspot branding
- [x] CEO panel: change CEO PIN + change each store's manager PIN
- [x] Tests: PIN verification + session round-trip (21/21 passing)
- [x] Save checkpoint and deliver

## Quick Add from Schedule Import (v3)
- [x] Per-row "Quick Add" button on unmatched rows
- [x] Defaults: phone "—", payRate 0, role Cashier, store = current filter
- [x] After create, re-match row to new employee automatically
- [x] Bulk "Create all unmatched" button at top
- [x] Tests for quickCreate procedure (24/24 passing)
- [x] Checkpoint and deliver

## Bulk Edit Employees (v4)
- [x] Server: employees.bulkUpdate (ids[], optional store, optional role) with permission checks
- [x] UI: row checkbox + header "select all" on Employees page
- [x] UI: selection toolbar with store + role dropdowns + Apply
- [x] Vitest: permission denial + zod validation (28/28 passing)
- [x] Checkpoint and deliver

## Delete Employee + Light Theme (v5)
- [ ] Server: employees.delete (cascades payroll history)
- [ ] UI: Delete button on EmployeeProfile with red confirm dialog
- [ ] Keep Deactivate action as a separate option
- [ ] Theme: switch defaultTheme to light, swap palette in index.css to white background
- [ ] Use dark version of logo on white bg (the original red+grey on white logo)
- [ ] Tests for delete permission + cascade
- [ ] Checkpoint and deliver

## v5 Continued — AI wording + Manager greeting
- [ ] Remove every visible "AI" mention from the site (replace with "Smart" / neutral wording)
- [ ] Show "Welcome back, Manager" when a store-manager session is active
- [ ] Swap to white-bg logo for the light theme
- [ ] Server: meta.greetingName resolves Manager-role employee at the signed-in store
- [ ] Frontend: show employee name when present, else "Manager"; CEO stays "CEO"
- [ ] Revert to dark-bg HOTSPOT MARKET logo with a styled chip for light-theme placement
- [ ] Editable pay rate column on Weekly Payroll grid (live recalc + save back to profile)
- [ ] Default pay-period week to Thursday\u2013Wednesday across server (getWeekStart) and all client pages
- [ ] Add edit/pencil button on week selector to pick a custom start date
- [ ] Remove overtime: server computeGrossPay = hours\u00d7rate (no 1.5x); drop OT column on Weekly Payroll grid; drop OT from totals and tests
- [ ] Sidebar logo: center MARKET pill directly below HOTSPOT wordmark; remove side "Payroll" label
