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
- [ ] Swap site-wide logo to new dark-background PNG
- [ ] Add `pin_codes` table (scope: 'ceo' | store name, hashed pin)
- [ ] Seed default PINs (CEO: 9999, HM11: 1111, HM13: 1313, HM14: 1414, Travel: 7777)
- [ ] Build PIN session cookie (sign role + store scope, 7-day TTL)
- [ ] tRPC `auth.verifyPin` (public) and `auth.session` (replaces auth.me)
- [ ] Replace OAuth gating with PIN check in DashboardLayout
- [ ] On-screen numeric keypad sign-in page with Hotspot branding
- [ ] CEO panel: change CEO PIN + change each store's manager PIN
- [ ] Tests: PIN verification, scope enforcement (manager can't read other stores)
- [ ] Save checkpoint and deliver
