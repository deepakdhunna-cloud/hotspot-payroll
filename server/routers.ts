import { PIN_COOKIE_NAME, PIN_SESSION_TTL_MS } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { storageGetSignedUrl, storagePut } from "./storage";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  closePunch,
  getAttentionItemById,
  resolveAttentionItems,
  countEmployees,
  createEmployee,
  createManualPunch,
  createScheduleImport,
  deactivateEmployee,
  deleteEmployee,
  deletePunch,
  findEmployeesWithClockCodes,
  findOpenPunch,
  findOpenPunches,
  getEmployeeById,
  getEmployeePayrollHistory,
  getEmployeesByIds,
  getPayrollByWeek,
  getPayrollRange,
  getPunchById,
  getScheduleImportById,
  getShiftsForEmployeeWeek,
  getShiftsForWeek,
  hoursWorkedForWeek,
  hoursWorkedForWeekBulk,
  listAuditLog,
  listEmployees,
  listOpenPunches,
  listPunches,
  listPunchesInRange,
  listScheduleImports,
  logAudit,
  markImportCommitted,
  openPunch,
  replaceWeekShifts,
  setClockCodeHash,
  updateEmployee,
  updatePunch,
  upsertPayrollEntry,
} from "./db";
import { hashClockCode, verifyClockCode } from "./_core/clockAuth";
import {
  ROLES,
  STORES,
  type Store,
  businessDayBoundaryUtc,
  businessDayStart,
  computeGrossPay,
  estimateWithholding,
  getWeekStart,
  overclockStatus,
  resolveScheduleDay,
} from "@shared/hotspot";
import { TRPCError } from "@trpc/server";
import {
  ALL_SCOPES,
  checkPinHash,
  listPinScopes,
  listPinScopesWithHashes,
  setPin,
  signPinSession,
  verifyPin,
  type PinScope,
  type PinSession,
} from "./_core/pinAuth";
import { clockPunchLimiter, pinLoginLimiter, requestIp } from "./rateLimit";
import { rankNameMatches } from "./nameMatch";
import { extractPdfText, extractSheetText, isSheetMime } from "./scheduleText";
import { syncAttention } from "./attention";

const StoreEnum = z.enum(STORES);
const RoleEnum = z.enum(ROLES);

function getScope(session: PinSession) {
  if (session.role === "admin") {
    return { isAdmin: true as const, stores: [...STORES] as Store[] };
  }
  return {
    isAdmin: false as const,
    stores: session.store ? ([session.store] as Store[]) : [],
  };
}

type Scope = ReturnType<typeof getScope>;

/**
 * Narrow an optional requested store to what the session may actually see.
 * One implementation for every list/query procedure so the authorization
 * filter can never drift between them:
 * - requested store within scope (or caller is admin) → just that store
 * - otherwise → the caller's own stores; `undefined` means "no filter"
 *   (admin sees everything).
 */
function resolveStores(scope: Scope, requested?: Store): Store[] | undefined {
  if (requested && (scope.isAdmin || scope.stores.includes(requested))) {
    return [requested];
  }
  return scope.isAdmin ? undefined : scope.stores;
}

/** Uniform "locked out" error with a human-readable wait time. */
function lockedError(ms: number): TRPCError {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    /** Read current session (or null). Replaces auth.me. */
    me: publicProcedure.query(({ ctx }) => {
      if (!ctx.session) return null;
      return {
        role: ctx.session.role,
        store: ctx.session.store,
        scope: ctx.session.scope,
      };
    }),

    /** Verify a PIN; on success, set the session cookie. */
    verifyPin: publicProcedure
      .input(z.object({ pin: z.string().min(4).max(8) }))
      .mutation(async ({ ctx, input }) => {
        const ip = requestIp(ctx.req);
        const lockedMs = pinLoginLimiter.lockedForMs(ip);
        if (lockedMs > 0) throw lockedError(lockedMs);

        const scope = await verifyPin(input.pin);
        if (!scope) {
          pinLoginLimiter.recordFailure(ip);
          void logAudit({
            actorScope: "anonymous",
            action: "auth.pin_failed",
            ip,
          });
          // Brief randomized delay to slow serial guessing.
          await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Incorrect PIN",
          });
        }
        pinLoginLimiter.reset(ip);
        void logAudit({ actorScope: scope, action: "auth.pin_success", ip });
        const token = await signPinSession(scope);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(PIN_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: PIN_SESSION_TTL_MS,
        });
        return {
          role: scope === "ceo" ? ("admin" as const) : ("manager" as const),
          store: scope === "ceo" ? null : (scope as Store),
          scope,
        };
      }),

    /** Sign out by clearing the PIN cookie. */
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(PIN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  meta: router({
    options: publicProcedure.query(() => ({
      stores: [...STORES],
      roles: [...ROLES],
    })),

    myScope: protectedProcedure.query(({ ctx }) => getScope(ctx.session)),

    /**
     * Resolve the display name for the current session.
     * - CEO/admin: returns role "admin" so the UI shows "CEO".
     * - Store manager: returns the full name of the active employee at the store
     *   whose role is "Manager". Falls back to null so the UI shows "Manager".
     */
    greetingName: protectedProcedure.query(async ({ ctx }) => {
      const scope = getScope(ctx.session);
      if (scope.isAdmin) return { role: "admin" as const, name: null };
      const store = scope.stores[0];
      if (!store) return { role: "manager" as const, name: null };
      const list = await listEmployees({ stores: [store] });
      const manager = list.find(
        e => e.role === "Manager" && e.storeLocation === store
      );
      return {
        role: "manager" as const,
        name: manager?.fullName ?? null,
      };
    }),
  }),

  employees: router({
    list: protectedProcedure
      .input(z.object({ store: StoreEnum.optional() }).optional())
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const targetStores = resolveStores(scope, input?.store);
        return listEmployees({ stores: targetStores });
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return emp;
      }),

    /**
     * Quick Add: create an employee from a parsed schedule row with minimal
     * friction. Role and pay rate are optional so managers can fill them in
     * during import review; anything omitted gets a placeholder to edit later.
     */
    quickCreate: protectedProcedure
      .input(
        z.object({
          fullName: z.string().min(1).max(200),
          storeLocation: StoreEnum,
          role: RoleEnum.optional(),
          payRate: z.number().min(0).max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(input.storeLocation)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only add employees to your assigned store.",
          });
        }
        const id = await createEmployee({
          fullName: input.fullName.trim(),
          phone: "—",
          payRate: String(input.payRate ?? 0),
          role: input.role ?? "Cashier",
          storeLocation: input.storeLocation,
        });
        void logAudit({
          actorScope: ctx.session.scope,
          action: "employees.quickCreate",
          entityType: "employee",
          entityId: id,
          detail: JSON.stringify({
            fullName: input.fullName.trim(),
            store: input.storeLocation,
          }),
          ip: requestIp(ctx.req),
        });
        return {
          id,
          fullName: input.fullName.trim(),
          storeLocation: input.storeLocation,
        };
      }),

    create: protectedProcedure
      .input(
        z.object({
          fullName: z.string().min(1).max(200),
          phone: z.string().min(1).max(32),
          payRate: z.number().min(0).max(1000),
          role: RoleEnum,
          storeLocation: StoreEnum,
        })
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(input.storeLocation)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only add employees to your assigned store.",
          });
        }
        const id = await createEmployee({
          fullName: input.fullName,
          phone: input.phone,
          payRate: String(input.payRate),
          role: input.role,
          storeLocation: input.storeLocation,
        });
        void logAudit({
          actorScope: ctx.session.scope,
          action: "employees.create",
          entityType: "employee",
          entityId: id,
          detail: JSON.stringify({
            fullName: input.fullName,
            store: input.storeLocation,
          }),
          ip: requestIp(ctx.req),
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int(),
          fullName: z.string().min(1).max(200).optional(),
          phone: z.string().min(1).max(32).optional(),
          payRate: z.number().min(0).max(1000).optional(),
          role: RoleEnum.optional(),
          storeLocation: StoreEnum.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const update: Record<string, unknown> = {};
        if (input.fullName !== undefined) update.fullName = input.fullName;
        if (input.phone !== undefined) update.phone = input.phone;
        if (input.payRate !== undefined) update.payRate = String(input.payRate);
        if (input.role !== undefined) update.role = input.role;
        if (input.storeLocation !== undefined)
          update.storeLocation = input.storeLocation;
        await updateEmployee(input.id, update);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "employees.update",
          entityType: "employee",
          entityId: input.id,
          detail: JSON.stringify({
            changed: Object.keys(update),
            before: {
              fullName: emp.fullName,
              phone: emp.phone,
              payRate: emp.payRate,
              role: emp.role,
              storeLocation: emp.storeLocation,
            },
          }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),

    /**
     * Bulk edit: change store and/or role for many employees at once.
     * Manager scope: every selected employee's current store AND the target store
     * must be within the manager's assigned stores. CEO/admin: unrestricted.
     */
    bulkUpdate: protectedProcedure
      .input(
        z
          .object({
            ids: z.array(z.number().int()).min(1).max(500),
            storeLocation: StoreEnum.optional(),
            role: RoleEnum.optional(),
          })
          .refine(v => v.storeLocation !== undefined || v.role !== undefined, {
            message: "Provide at least one field to update.",
          })
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          input.storeLocation !== undefined &&
          !scope.stores.includes(input.storeLocation as Store)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only move employees to your assigned stores.",
          });
        }
        const update: Record<string, unknown> = {};
        if (input.storeLocation !== undefined)
          update.storeLocation = input.storeLocation;
        if (input.role !== undefined) update.role = input.role;

        const found = await getEmployeesByIds(input.ids);
        const foundById = new Map(found.map(e => [e.id, e]));
        let updated = 0;
        const skipped: number[] = [];
        for (const id of input.ids) {
          const emp = foundById.get(id);
          if (!emp) {
            skipped.push(id);
            continue;
          }
          if (
            !scope.isAdmin &&
            !scope.stores.includes(emp.storeLocation as Store)
          ) {
            skipped.push(id);
            continue;
          }
          await updateEmployee(id, update);
          updated += 1;
        }
        void logAudit({
          actorScope: ctx.session.scope,
          action: "employees.bulkUpdate",
          entityType: "employee",
          detail: JSON.stringify({ ids: input.ids, update, updated, skipped }),
          ip: requestIp(ctx.req),
        });
        return { updated, skipped };
      }),

    deactivate: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deactivateEmployee(input.id);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "employees.deactivate",
          entityType: "employee",
          entityId: input.id,
          detail: JSON.stringify({
            fullName: emp.fullName,
            store: emp.storeLocation,
          }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),

    /**
     * Permanently delete an employee plus their payroll history, punches and
     * scheduled shifts (single transaction). A full JSON snapshot of the
     * employee and their payroll history is written to the audit log first,
     * so even a hard delete is never silent data loss.
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const history = await getEmployeePayrollHistory(input.id, 520);
        await logAudit({
          actorScope: ctx.session.scope,
          action: "employees.delete",
          entityType: "employee",
          entityId: input.id,
          detail: JSON.stringify({ employee: emp, payrollHistory: history }),
          ip: requestIp(ctx.req),
        });
        await deleteEmployee(input.id);
        return { success: true };
      }),

    history: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getEmployeePayrollHistory(input.id);
      }),
  }),

  payroll: router({
    week: protectedProcedure
      .input(z.object({ weekStart: z.date(), store: StoreEnum.optional() }))
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input.weekStart);
        const stores = resolveStores(scope, input.store);

        const employees = await listEmployees({ stores });
        const entries = await getPayrollByWeek(week, stores);
        const entryByEmp = new Map<number, (typeof entries)[number]>();
        for (const e of entries) entryByEmp.set(e.employeeId, e);

        return {
          weekStart: week,
          employees: employees.map(emp => ({
            employee: emp,
            entry: entryByEmp.get(emp.id) ?? null,
          })),
        };
      }),

    saveHours: protectedProcedure
      .input(
        z.object({
          employeeId: z.number().int(),
          weekStart: z.date(),
          hoursWorked: z.number().min(0).max(168),
          scheduledHours: z.number().min(0).max(168).optional(),
          payRateOverride: z.number().min(0).max(1000).optional(),
          notes: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const payRate =
          input.payRateOverride !== undefined
            ? input.payRateOverride
            : Number(emp.payRate);
        // Persist any rate change back to the employee profile for future weeks.
        if (
          input.payRateOverride !== undefined &&
          input.payRateOverride !== Number(emp.payRate)
        ) {
          await updateEmployee(emp.id, { payRate: String(payRate) });
        }
        const { regularPay, grossPay } = computeGrossPay(
          input.hoursWorked,
          payRate
        );
        const week = getWeekStart(input.weekStart);

        const id = await upsertPayrollEntry({
          employeeId: emp.id,
          storeLocation: emp.storeLocation,
          weekStart: week,
          hoursWorked: String(input.hoursWorked),
          scheduledHours: String(input.scheduledHours ?? 0),
          payRateSnapshot: String(payRate),
          regularPay: String(regularPay.toFixed(2)),
          overtimePay: "0.00",
          grossPay: String(grossPay.toFixed(2)),
          notes: input.notes ?? null,
        });
        void logAudit({
          actorScope: ctx.session.scope,
          action: "payroll.saveHours",
          entityType: "payrollEntry",
          entityId: id,
          detail: JSON.stringify({
            employeeId: emp.id,
            weekStart: week.toISOString(),
            hoursWorked: input.hoursWorked,
            payRate,
            grossPay: Number(grossPay.toFixed(2)),
          }),
          ip: requestIp(ctx.req),
        });
        return { id, grossPay, regularPay };
      }),

    // NOTE: scheduled hours are written via schedule.commit (the single
    // writer), which also stores day-level shifts. The old payroll.saveSchedule
    // procedure was removed when the schedule import moved to commit.

    /**
     * Multi-week payroll history for a Thursday-anchored date range.
     * Returns each saved row (already permanently persisted in `payroll_entries`)
     * along with the originating employee, plus per-employee + grand totals.
     * Scope-aware: managers only ever see their stores; CEO sees all unless
     * a store is explicitly requested.
     */
    range: protectedProcedure
      .input(
        z.object({
          startWeek: z.date(),
          endWeek: z.date(),
          store: StoreEnum.optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const start = getWeekStart(input.startWeek);
        const end = getWeekStart(input.endWeek);
        if (end.getTime() < start.getTime()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "End week must be on or after start week.",
          });
        }
        const stores = resolveStores(scope, input.store);
        const entries = await getPayrollRange(start, end, stores);
        // Hydrate employees so the UI can show names without N+1 calls.
        const empIds = Array.from(new Set(entries.map(e => e.employeeId)));
        const empRows = await getEmployeesByIds(empIds);
        const empById = new Map(
          empRows.map(e => [
            e.id,
            {
              id: e.id,
              fullName: e.fullName,
              storeLocation: e.storeLocation,
              role: e.role,
            },
          ])
        );
        // Build per-employee aggregates.
        type Agg = {
          employeeId: number;
          employeeName: string;
          storeLocation: string;
          role: string;
          hours: number;
          gross: number;
          weekCount: number;
        };
        const agg = new Map<number, Agg>();
        let grandHours = 0;
        let grandGross = 0;
        for (const e of entries) {
          const emp = empById.get(e.employeeId);
          const h = Number(e.hoursWorked) || 0;
          const g = Number(e.grossPay) || 0;
          grandHours += h;
          grandGross += g;
          const row = agg.get(e.employeeId) ?? {
            employeeId: e.employeeId,
            employeeName: emp?.fullName ?? `Employee #${e.employeeId}`,
            storeLocation: emp?.storeLocation ?? e.storeLocation,
            role: emp?.role ?? "",
            hours: 0,
            gross: 0,
            weekCount: 0,
          };
          row.hours += h;
          row.gross += g;
          row.weekCount += 1;
          agg.set(e.employeeId, row);
        }
        return {
          startWeek: start,
          endWeek: end,
          totals: {
            hours: grandHours,
            gross: grandGross,
            weeks: entries.length,
          },
          employees: Array.from(agg.values()).sort((a, b) =>
            a.employeeName.localeCompare(b.employeeName)
          ),
          entries: entries.map(e => ({
            ...e,
            employeeName:
              empById.get(e.employeeId)?.fullName ??
              `Employee #${e.employeeId}`,
          })),
        };
      }),
  }),

  /**
   * The attention center — the site-wide assistant. `list` runs live
   * detection (12h+ punches, schedule-vs-worked mismatches, operational
   * gaps), persists every discrepancy with its first-detected date, and
   * returns the open stack. `resolve` is the human sign-off: approve a long
   * shift's hours (optionally registering the real clock-out first) or mark
   * a mismatch reviewed. Everything is store-scoped and audit-logged.
   */
  attention: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const scope = getScope(ctx.session);
      const stores = resolveStores(scope) ?? [...STORES];
      const items = await syncAttention(stores);
      return { items, count: items.length };
    }),

    resolve: protectedProcedure
      .input(
        z.object({
          id: z.number().int(),
          resolution: z.enum(["approved", "reviewed", "dismissed"]),
          /** For an OPEN 12h+ punch: register the real clock-out first. */
          clockOutAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const item = await getAttentionItemById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        if (
          !scope.isAdmin &&
          item.storeLocation &&
          !scope.stores.includes(item.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (item.status !== "open") {
          return { success: true, alreadyResolved: true };
        }

        // Approving a long punch may include registering the true clock-out.
        if (input.clockOutAt) {
          if (item.kind !== "long_punch" || !item.punchId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A clock-out can only be registered on a long-shift item.",
            });
          }
          const punch = await getPunchById(item.punchId);
          if (!punch) throw new TRPCError({ code: "NOT_FOUND" });
          if (punch.clockOutAt) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "That punch already has a clock-out — edit it from the Punches tab.",
            });
          }
          if (input.clockOutAt.getTime() <= new Date(punch.clockInAt).getTime()) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Clock-out must be after the clock-in.",
            });
          }
          await updatePunch(item.punchId, { clockOutAt: input.clockOutAt });
        }

        await resolveAttentionItems([item.id], input.resolution, ctx.session.scope);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "attention.resolve",
          entityType: "attention",
          entityId: item.id,
          detail: JSON.stringify({
            kind: item.kind,
            title: item.title,
            resolution: input.resolution,
            registeredClockOut: input.clockOutAt?.toISOString() ?? null,
            pendingSince: item.createdAt,
          }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),
  }),

  dashboard: router({
    summary: protectedProcedure
      .input(
        z
          .object({ weekStart: z.date(), store: StoreEnum.optional() })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input?.weekStart ?? new Date());
        const weekEnd = new Date(week);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

        // byStore needs concrete keys, so an unfiltered admin view expands to all stores.
        const storesFilter = resolveStores(scope, input?.store) ?? [...STORES];

        const [employees, entries, clockHours, openPunches, shifts] =
          await Promise.all([
            listEmployees({ stores: storesFilter }),
            getPayrollByWeek(week, storesFilter),
            hoursWorkedForWeekBulk(week, weekEnd, storesFilter),
            listOpenPunches(storesFilter),
            getShiftsForWeek(week, storesFilter),
          ]);

        const byStore: Record<
          string,
          {
            totalHours: number;
            totalScheduled: number;
            totalGross: number;
            employeeCount: number;
            clockedInCount: number;
            overClockedCount: number;
          }
        > = {};
        for (const s of storesFilter) {
          byStore[s] = {
            totalHours: 0,
            totalScheduled: 0,
            totalGross: 0,
            employeeCount: 0,
            clockedInCount: 0,
            overClockedCount: 0,
          };
        }
        for (const e of employees) {
          if (byStore[e.storeLocation])
            byStore[e.storeLocation].employeeCount++;
        }
        // The dashboard's headline numbers are LIVE: hours come straight from
        // clock punches and labor cost from clocked hours × pay rate, so the
        // page moves in real time. Saved payroll entries are reported
        // alongside (totalEntered / totalSavedGross) — money that has
        // actually been committed to payroll.
        for (const emp of employees) {
          if (!byStore[emp.storeLocation]) continue;
          const clocked = clockHours.get(emp.id) ?? 0;
          byStore[emp.storeLocation].totalHours += clocked;
          byStore[emp.storeLocation].totalGross += clocked * Number(emp.payRate);
        }
        for (const e of entries) {
          if (!byStore[e.storeLocation]) continue;
          byStore[e.storeLocation].totalScheduled += Number(e.scheduledHours);
        }

        const totalHours = Object.values(byStore).reduce(
          (a, b) => a + b.totalHours,
          0
        );
        const totalScheduled = Object.values(byStore).reduce(
          (a, b) => a + b.totalScheduled,
          0
        );
        const totalGross = Object.values(byStore).reduce(
          (a, b) => a + b.totalGross,
          0
        );
        const totalEntered = entries.reduce(
          (a, e) => a + Number(e.hoursWorked),
          0
        );
        const totalSavedGross = entries.reduce(
          (a, e) => a + Number(e.grossPay),
          0
        );

        const entryByEmp = new Map(entries.map(e => [e.employeeId, e]));
        // Scheduled hours can come from the payroll entry or, if that is
        // still 0, from the sum of imported day-level shifts.
        const shiftHoursByEmp = new Map<number, number>();
        for (const s of shifts) {
          shiftHoursByEmp.set(
            s.employeeId,
            (shiftHoursByEmp.get(s.employeeId) ?? 0) + Number(s.hours)
          );
        }

        const empBreakdown = employees.map(emp => {
          const entry = entryByEmp.get(emp.id);
          const hoursWorked = Number(entry?.hoursWorked ?? 0);
          const scheduled =
            Number(entry?.scheduledHours ?? 0) ||
            (shiftHoursByEmp.get(emp.id) ?? 0);
          const grossPay = Number(entry?.grossPay ?? 0);
          const clocked = clockHours.get(emp.id) ?? 0;
          const { overClocked, overClockedBy } = overclockStatus(
            clocked,
            scheduled
          );
          return {
            id: emp.id,
            fullName: emp.fullName,
            storeLocation: emp.storeLocation,
            role: emp.role,
            payRate: Number(emp.payRate),
            hoursWorked,
            scheduledHours: scheduled,
            clockHours: clocked,
            variance: hoursWorked - scheduled,
            overClocked,
            overClockedBy,
            grossPay,
          };
        });

        for (const emp of empBreakdown) {
          if (emp.overClocked && byStore[emp.storeLocation]) {
            byStore[emp.storeLocation].overClockedCount++;
          }
        }

        /* Money planning figures.
           - totalScheduledCost: the week's schedule priced at each person's
             pay rate — set the moment a schedule lands.
           - totalProjectedGross: re-computed as each business day closes —
             the ACTUAL labor cost of finished days plus the SCHEDULED cost
             of the days still to come. Before any day closes it equals the
             scheduled figure; after the last day it equals actual cost. */
        const rateByEmp = new Map(employees.map(e => [e.id, Number(e.payRate)]));
        const totalScheduledCost = empBreakdown.reduce(
          (a, e) => a + e.scheduledHours * e.payRate,
          0
        );
        const todayMarker = businessDayStart(new Date());
        const dayBoundary = businessDayBoundaryUtc(new Date());
        let totalProjectedGross = totalScheduledCost;
        if (dayBoundary.getTime() > week.getTime()) {
          const actualEnd = new Date(
            Math.min(dayBoundary.getTime(), weekEnd.getTime())
          );
          const closedClock = await hoursWorkedForWeekBulk(
            week,
            actualEnd,
            storesFilter
          );
          let actual = 0;
          closedClock.forEach((hrs, empId) => {
            actual += hrs * (rateByEmp.get(empId) ?? 0);
          });
          let remaining = 0;
          for (const s of shifts) {
            if (new Date(s.shiftDate).getTime() >= todayMarker.getTime()) {
              remaining += Number(s.hours) * (rateByEmp.get(s.employeeId) ?? 0);
            }
          }
          totalProjectedGross = actual + remaining;
        }

        // Live "on the clock" list with names and shift start times.
        // One row per PERSON: if duplicate open punches exist (manual entry
        // or import glitches), show only the earliest so counts match reality.
        const empById = new Map(employees.map(e => [e.id, e]));
        const earliestOpenByEmp = new Map<number, (typeof openPunches)[number]>();
        for (const p of openPunches) {
          if (!empById.has(p.employeeId)) continue;
          const seen = earliestOpenByEmp.get(p.employeeId);
          if (
            !seen ||
            new Date(p.clockInAt).getTime() < new Date(seen.clockInAt).getTime()
          ) {
            earliestOpenByEmp.set(p.employeeId, p);
          }
        }
        const clockedInNow = Array.from(earliestOpenByEmp.values()).map(p => ({
          punchId: p.id,
          employeeId: p.employeeId,
          fullName: empById.get(p.employeeId)!.fullName,
          role: empById.get(p.employeeId)!.role,
          storeLocation: p.storeLocation,
          clockInAt: p.clockInAt,
        }));
        for (const p of clockedInNow) {
          if (byStore[p.storeLocation])
            byStore[p.storeLocation].clockedInCount++;
        }

        // Day-level schedule coverage for the week (drives the day strip).
        const scheduleByDay = new Map<
          string,
          { date: Date; totalHours: number; shiftCount: number }
        >();
        for (const s of shifts) {
          const key = new Date(s.shiftDate).toISOString();
          const day = scheduleByDay.get(key) ?? {
            date: new Date(s.shiftDate),
            totalHours: 0,
            shiftCount: 0,
          };
          day.totalHours += Number(s.hours);
          day.shiftCount += 1;
          scheduleByDay.set(key, day);
        }

        return {
          weekStart: week,
          scope,
          byStore,
          totals: {
            totalHours,
            totalScheduled,
            totalGross,
            totalEntered,
            totalSavedGross,
            totalScheduledCost,
            totalProjectedGross,
            variance: totalHours - totalScheduled,
          },
          employees: empBreakdown,
          clockedInNow,
          scheduleDays: Array.from(scheduleByDay.values()).sort(
            (a, b) => a.date.getTime() - b.date.getTime()
          ),
          // A schedule exists if we have day-level shifts OR weekly scheduled
          // hours (weeks imported before day-level tracking existed).
          hasScheduleImport: shifts.length > 0 || totalScheduled > 0,
          hasDaySchedule: shifts.length > 0,
          missingClockCodes: employees.filter(e => !e.clockCodeHash).length,
        };
      }),

    /**
     * Week-by-week history for the dashboard trend strip: clocked hours,
     * saved payroll hours/gross and scheduled hours for each of the last N
     * Thursday-anchored pay weeks (newest last). Scope-aware.
     */
    trend: protectedProcedure
      .input(
        z.object({
          weeks: z.number().int().min(2).max(12).optional(),
          store: StoreEnum.optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const stores = resolveStores(scope, input.store);
        const n = input.weeks ?? 8;

        const currentWeek = getWeekStart(new Date());
        const firstWeek = new Date(currentWeek);
        firstWeek.setUTCDate(firstWeek.getUTCDate() - (n - 1) * 7);
        const rangeEnd = new Date(currentWeek);
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 7);

        const [entries, punches] = await Promise.all([
          getPayrollRange(firstWeek, currentWeek, stores),
          listPunchesInRange(firstWeek, rangeEnd, stores),
        ]);

        const weeks = Array.from({ length: n }, (_, i) => {
          const w = new Date(firstWeek);
          w.setUTCDate(w.getUTCDate() + i * 7);
          return {
            weekStart: w,
            savedHours: 0,
            savedGross: 0,
            scheduledHours: 0,
            clockHours: 0,
          };
        });
        const byIso = new Map(weeks.map(w => [w.weekStart.toISOString(), w]));

        for (const e of entries) {
          const bucket = byIso.get(new Date(e.weekStart).toISOString());
          if (!bucket) continue;
          bucket.savedHours += Number(e.hoursWorked);
          bucket.savedGross += Number(e.grossPay);
          bucket.scheduledHours += Number(e.scheduledHours);
        }
        const now = new Date();
        for (const p of punches) {
          const bucket = byIso.get(getWeekStart(new Date(p.clockInAt)).toISOString());
          if (!bucket) continue;
          const weekEnd = new Date(bucket.weekStart);
          weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
          const openCap = Math.min(now.getTime(), weekEnd.getTime());
          const inAt = new Date(p.clockInAt).getTime();
          const outAt = p.clockOutAt ? new Date(p.clockOutAt).getTime() : openCap;
          if (outAt > inAt) bucket.clockHours += (outAt - inAt) / 3_600_000;
        }
        return { weeks };
      }),
  }),

  ceo: router({
    weekly: adminProcedure
      .input(z.object({ weekStart: z.date(), store: StoreEnum.optional() }))
      .query(async ({ input }) => {
        const week = getWeekStart(input.weekStart);
        const weekEnd = new Date(week);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
        const stores = input.store ? [input.store] : [...STORES];
        const [employees, entries, clockHours, openPunches, shifts] =
          await Promise.all([
            listEmployees({ stores }),
            getPayrollByWeek(week, stores),
            hoursWorkedForWeekBulk(week, weekEnd, stores),
            listOpenPunches(stores),
            getShiftsForWeek(week, stores),
          ]);
        // Same scheduled-hours fallback as the manager dashboard, so both
        // views (and the kiosk) always agree on over-clock status.
        const shiftHoursByEmp = new Map<number, number>();
        for (const s of shifts) {
          shiftHoursByEmp.set(
            s.employeeId,
            (shiftHoursByEmp.get(s.employeeId) ?? 0) + Number(s.hours)
          );
        }

        const byStore: Record<
          string,
          {
            totalHours: number;
            totalClockHours: number;
            totalGross: number;
            totalFederal: number;
            totalState: number;
            totalNet: number;
            totalScheduled: number;
            employeeCount: number;
            clockedInCount: number;
            overClockedCount: number;
          }
        > = {};
        for (const s of stores) {
          byStore[s] = {
            totalHours: 0,
            totalClockHours: 0,
            totalGross: 0,
            totalFederal: 0,
            totalState: 0,
            totalNet: 0,
            totalScheduled: 0,
            employeeCount: 0,
            clockedInCount: 0,
            overClockedCount: 0,
          };
        }
        // Count distinct PEOPLE, not open punch rows — duplicates must not
        // inflate the executive headcount.
        const clockedInEmp = new Set<number>();
        for (const p of openPunches) {
          if (clockedInEmp.has(p.employeeId)) continue;
          clockedInEmp.add(p.employeeId);
          if (byStore[p.storeLocation])
            byStore[p.storeLocation].clockedInCount++;
        }

        const entryByEmp = new Map(entries.map(e => [e.employeeId, e]));
        const rows = employees.map(emp => {
          const entry = entryByEmp.get(emp.id);
          const hoursWorked = Number(entry?.hoursWorked ?? 0);
          const scheduled =
            Number(entry?.scheduledHours ?? 0) ||
            (shiftHoursByEmp.get(emp.id) ?? 0);
          const grossPay = Number(entry?.grossPay ?? 0);
          const clocked = clockHours.get(emp.id) ?? 0;
          const { overClocked } = overclockStatus(clocked, scheduled);
          const { federal, state, totalTax, netPay } =
            estimateWithholding(grossPay);
          if (byStore[emp.storeLocation]) {
            byStore[emp.storeLocation].employeeCount++;
            byStore[emp.storeLocation].totalHours += hoursWorked;
            byStore[emp.storeLocation].totalClockHours += clocked;
            byStore[emp.storeLocation].totalScheduled += scheduled;
            byStore[emp.storeLocation].totalGross += grossPay;
            byStore[emp.storeLocation].totalFederal += federal;
            byStore[emp.storeLocation].totalState += state;
            byStore[emp.storeLocation].totalNet += netPay;
            if (overClocked) byStore[emp.storeLocation].overClockedCount++;
          }
          return {
            id: emp.id,
            fullName: emp.fullName,
            role: emp.role,
            storeLocation: emp.storeLocation,
            payRate: Number(emp.payRate),
            hoursWorked,
            scheduledHours: scheduled,
            clockHours: clocked,
            variance: hoursWorked - scheduled,
            overClocked,
            grossPay,
            federal,
            state,
            totalTax,
            netPay,
          };
        });

        const grand = Object.values(byStore).reduce(
          (acc, s) => ({
            totalHours: acc.totalHours + s.totalHours,
            totalClockHours: acc.totalClockHours + s.totalClockHours,
            totalGross: acc.totalGross + s.totalGross,
            totalFederal: acc.totalFederal + s.totalFederal,
            totalState: acc.totalState + s.totalState,
            totalNet: acc.totalNet + s.totalNet,
            totalScheduled: acc.totalScheduled + s.totalScheduled,
          }),
          {
            totalHours: 0,
            totalClockHours: 0,
            totalGross: 0,
            totalFederal: 0,
            totalState: 0,
            totalNet: 0,
            totalScheduled: 0,
          }
        );

        return {
          weekStart: week,
          byStore,
          rows,
          grand,
          employeeCount: await countEmployees(),
        };
      }),

    /** List PIN scopes (without revealing PIN values). */
    listPins: adminProcedure.query(async () => {
      const rows = await listPinScopes();
      return ALL_SCOPES.map(scope => {
        const row = rows.find(r => r.scope === scope);
        return {
          scope,
          label:
            scope === "ceo" ? "CEO Master PIN" : `${scope} \u2014 Manager PIN`,
          isSet: !!row,
          updatedAt: row?.updatedAt ?? null,
        };
      });
    }),

    /**
     * Update a PIN (CEO master, or any of the four store PINs).
     * Rejects a PIN that already belongs to a different scope — sign-in
     * matches a PIN against every scope, so duplicates would be ambiguous.
     * Rotating a PIN also revokes all sessions issued before the rotation.
     */
    updatePin: adminProcedure
      .input(
        z.object({
          scope: z.enum(["ceo", ...STORES] as [PinScope, ...PinScope[]]),
          pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await listPinScopesWithHashes();
        let conflict: (typeof existing)[number] | undefined;
        for (const row of existing) {
          if (row.scope === input.scope) continue;
          if (await checkPinHash(input.pin, row.scope, row.pinHash)) {
            conflict = row;
            break;
          }
        }
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `That PIN is already in use by ${
              conflict.scope === "ceo" ? "the CEO master PIN" : conflict.scope
            }. Choose a different one.`,
          });
        }
        await setPin(input.scope, input.pin);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "ceo.updatePin",
          entityType: "pin",
          detail: JSON.stringify({ scope: input.scope }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),

    /**
     * Recent audit-log entries — the CEO's paper trail of every sensitive
     * action (logins, deletions, PIN rotations, payroll edits).
     */
    auditLog: adminProcedure
      .input(
        z
          .object({
            actorScope: z.string().max(64).optional(),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return listAuditLog({
          actorScope: input?.actorScope,
          limit: input?.limit ?? 100,
        });
      }),
  }),

  clock: router({
    /**
     * Public kiosk endpoint: punch in (creates an open punch) or punch out
     * (closes the open punch). Takes the store + 4-digit code; tries the code
     * against every active employee at that store and toggles based on whether
     * an open punch already exists.
     */
    punch: publicProcedure
      .input(
        z.object({
          store: StoreEnum,
          code: z.string().regex(/^\d{4}$/),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const limiterKey = `${requestIp(ctx.req)}:${input.store}`;
        const lockedMs = clockPunchLimiter.lockedForMs(limiterKey);
        if (lockedMs > 0) throw lockedError(lockedMs);

        const employees = await findEmployeesWithClockCodes(input.store);
        let matched: (typeof employees)[number] | undefined;
        for (const emp of employees) {
          if (verifyClockCode(input.code, emp.id, emp.clockCodeHash)) {
            matched = emp;
            break;
          }
        }
        if (!matched) {
          clockPunchLimiter.recordFailure(limiterKey);
          void logAudit({
            actorScope: "kiosk",
            action: "clock.punch_failed",
            detail: JSON.stringify({ store: input.store }),
            ip: requestIp(ctx.req),
          });
          await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Code not recognized at this store.",
          });
        }
        clockPunchLimiter.reset(limiterKey);

        const now = new Date();
        // Resolve "today" and the pay week in STORE-LOCAL time: an evening
        // punch (e.g. Wed 9pm Central = Thu 2am UTC) must summarize the week
        // and day the employee is actually working, not the UTC date.
        const today = businessDayStart(now);
        const week = getWeekStart(today);
        const weekEnd = new Date(week);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

        /**
         * Week context shown on the kiosk after a punch: hours worked so far,
         * hours scheduled, and how far over schedule the employee is. This is
         * how over-clocked hours get reported at the source.
         */
        const buildWeekSummary = async () => {
          const [worked, entryRows, empShifts] = await Promise.all([
            hoursWorkedForWeek(matched!.id, week, weekEnd, now),
            getPayrollByWeek(week, [matched!.storeLocation]),
            getShiftsForEmployeeWeek(matched!.id, week),
          ]);
          const entry = entryRows.find(e => e.employeeId === matched!.id);
          const shiftHours = empShifts.reduce(
            (sum, s) => sum + Number(s.hours),
            0
          );
          const scheduled = Number(entry?.scheduledHours ?? 0) || shiftHours;
          const { overClocked, overClockedBy } = overclockStatus(
            worked,
            scheduled
          );
          const todayShifts = empShifts.filter(
            s => new Date(s.shiftDate).getTime() === today.getTime()
          );
          return {
            workedHours: worked,
            scheduledHours: scheduled,
            overClocked,
            overClockedBy,
            todayShifts: todayShifts.map(s => ({
              startLabel: s.startLabel,
              endLabel: s.endLabel,
              hours: Number(s.hours),
            })),
          };
        };

        // Sweep EVERY open punch — duplicates can sneak in via manual entry
        // or imports, and leaving one open double-counts the employee forever.
        const openAll = await findOpenPunches(matched.id);
        const open = openAll[0];
        const weekSummary = await buildWeekSummary();
        if (open) {
          for (const p of openAll) {
            await closePunch(p.id, now);
          }
          const durationMs = now.getTime() - new Date(open.clockInAt).getTime();
          const durationHours = Math.max(0, durationMs / 3_600_000);
          return {
            action: "out" as const,
            employee: { id: matched.id, fullName: matched.fullName },
            at: now,
            durationHours,
            // The open punch was already counted up to `now`, so the summary
            // includes the shift that just closed.
            week: weekSummary,
          };
        }
        await openPunch({
          employeeId: matched.id,
          storeLocation: matched.storeLocation,
          clockInAt: now,
          source: "kiosk",
        });
        return {
          action: "in" as const,
          employee: { id: matched.id, fullName: matched.fullName },
          at: now,
          durationHours: null,
          week: weekSummary,
        };
      }),

    /**
     * Set or clear an employee's 4-digit code. Manager-scoped to their store.
     * Pass an empty string to remove the code.
     */
    setCode: protectedProcedure
      .input(
        z.object({
          employeeId: z.number().int(),
          code: z
            .string()
            .regex(/^\d{4}$|^$/, "Code must be 4 digits or empty"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (input.code === "") {
          await setClockCodeHash(emp.id, null);
          void logAudit({
            actorScope: ctx.session.scope,
            action: "clock.clearCode",
            entityType: "employee",
            entityId: emp.id,
            detail: JSON.stringify({ fullName: emp.fullName }),
            ip: requestIp(ctx.req),
          });
          return { success: true, cleared: true };
        }
        // Uniqueness within store: any other active employee with a matching hash blocks reuse.
        const peers = await findEmployeesWithClockCodes(emp.storeLocation);
        const conflict = peers.find(
          p =>
            p.id !== emp.id &&
            verifyClockCode(input.code, p.id, p.clockCodeHash)
        );
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Code already used by ${conflict.fullName} at this store.`,
          });
        }
        const hash = hashClockCode(input.code, emp.id);
        await setClockCodeHash(emp.id, hash);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "clock.setCode",
          entityType: "employee",
          entityId: emp.id,
          detail: JSON.stringify({ fullName: emp.fullName }),
          ip: requestIp(ctx.req),
        });
        return { success: true, cleared: false };
      }),

    /**
     * List punches for the current scope.
     * Manager: only their store. CEO: all stores or a chosen store.
     */
    list: protectedProcedure
      .input(
        z
          .object({
            store: StoreEnum.optional(),
            employeeId: z.number().int().optional(),
            startDate: z.date().optional(),
            endDate: z.date().optional(),
            limit: z.number().int().min(1).max(2000).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const stores = resolveStores(scope, input?.store);
        if (input?.employeeId !== undefined) {
          const emp = await getEmployeeById(input.employeeId);
          if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
          if (
            !scope.isAdmin &&
            !scope.stores.includes(emp.storeLocation as Store)
          ) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
        }
        const punches = await listPunches({
          stores,
          employeeId: input?.employeeId,
          startDate: input?.startDate,
          endDate: input?.endDate,
          limit: input?.limit,
        });
        // Attach employee names for convenience
        const empIds = Array.from(new Set(punches.map(p => p.employeeId)));
        const empMap = new Map<number, { id: number; fullName: string }>();
        for (const id of empIds) {
          const e = await getEmployeeById(id);
          if (e) empMap.set(id, { id: e.id, fullName: e.fullName });
        }
        return punches.map(p => ({
          ...p,
          employeeName: empMap.get(p.employeeId)?.fullName ?? "Unknown",
          durationHours: p.clockOutAt
            ? Math.max(
                0,
                (new Date(p.clockOutAt).getTime() -
                  new Date(p.clockInAt).getTime()) /
                  3_600_000
              )
            : null,
        }));
      }),

    /** Manually add a punch (both in and out timestamps). */
    createManual: protectedProcedure
      .input(
        z
          .object({
            employeeId: z.number().int(),
            clockInAt: z.date(),
            clockOutAt: z.date().optional(),
            note: z.string().max(500).optional(),
          })
          .refine(
            v =>
              !v.clockOutAt || v.clockOutAt.getTime() > v.clockInAt.getTime(),
            { message: "Clock-out must be after clock-in." }
          )
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // A person can only be "on the clock" once. Adding a second open
        // punch would double them on every dashboard.
        if (!input.clockOutAt) {
          const alreadyOpen = await findOpenPunch(emp.id);
          if (alreadyOpen) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `${emp.fullName} is already clocked in (since ${new Date(alreadyOpen.clockInAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}). Close or edit that punch instead of adding another open one.`,
            });
          }
        }
        const id = await createManualPunch({
          employeeId: emp.id,
          storeLocation: emp.storeLocation,
          clockInAt: input.clockInAt,
          clockOutAt: input.clockOutAt ?? null,
          source: "manual",
          note: input.note ?? null,
        });
        void logAudit({
          actorScope: ctx.session.scope,
          action: "clock.createManual",
          entityType: "punch",
          entityId: id,
          detail: JSON.stringify({
            employeeId: emp.id,
            clockInAt: input.clockInAt.toISOString(),
            clockOutAt: input.clockOutAt?.toISOString() ?? null,
          }),
          ip: requestIp(ctx.req),
        });
        return { id };
      }),

    /** Edit a punch's in/out times or note. */
    update: protectedProcedure
      .input(
        z
          .object({
            id: z.number().int(),
            clockInAt: z.date().optional(),
            clockOutAt: z.date().nullable().optional(),
            note: z.string().max(500).nullable().optional(),
          })
          .refine(
            v =>
              !v.clockInAt ||
              !v.clockOutAt ||
              v.clockOutAt.getTime() > v.clockInAt.getTime(),
            { message: "Clock-out must be after clock-in." }
          )
      )
      .mutation(async ({ ctx, input }) => {
        const punch = await getPunchById(input.id);
        if (!punch) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(punch.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const update: Record<string, unknown> = {};
        if (input.clockInAt !== undefined) update.clockInAt = input.clockInAt;
        if (input.clockOutAt !== undefined)
          update.clockOutAt = input.clockOutAt;
        if (input.note !== undefined) update.note = input.note;
        await updatePunch(input.id, update as any);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "clock.updatePunch",
          entityType: "punch",
          entityId: input.id,
          detail: JSON.stringify({
            before: {
              clockInAt: punch.clockInAt,
              clockOutAt: punch.clockOutAt,
              note: punch.note,
            },
          }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),

    /** Delete a punch. */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const punch = await getPunchById(input.id);
        if (!punch) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(punch.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deletePunch(input.id);
        void logAudit({
          actorScope: ctx.session.scope,
          action: "clock.deletePunch",
          entityType: "punch",
          entityId: input.id,
          detail: JSON.stringify({ deleted: punch }),
          ip: requestIp(ctx.req),
        });
        return { success: true };
      }),

    /** Sum of hours worked for one employee in a given week. */
    weekHours: protectedProcedure
      .input(z.object({ employeeId: z.number().int(), weekStart: z.date() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (
          !scope.isAdmin &&
          !scope.stores.includes(emp.storeLocation as Store)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const start = getWeekStart(input.weekStart);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const hours = await hoursWorkedForWeek(emp.id, start, end);
        return { employeeId: emp.id, weekStart: start, hours };
      }),

    /** Bulk hours-worked map for a week, scoped to the caller's stores. */
    weekHoursBulk: protectedProcedure
      .input(z.object({ weekStart: z.date(), store: StoreEnum.optional() }))
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const stores = resolveStores(scope, input.store);
        const start = getWeekStart(input.weekStart);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const map = await hoursWorkedForWeekBulk(start, end, stores);
        return {
          weekStart: start,
          entries: Array.from(map.entries()).map(([employeeId, hours]) => ({
            employeeId,
            hours,
          })),
        };
      }),
  }),

  schedule: router({
    /**
     * Parse an uploaded Homebase schedule (PDF or photo) into day-level
     * shifts per employee. Returns matched/unmatched rows for review; nothing
     * is written to payroll until `schedule.commit`.
     */
    parseUpload: protectedProcedure
      .input(
        z.object({
          fileBase64: z.string().min(1).max(12_000_000), // ~8.5MB decoded
          mimeType: z.string().min(1),
          filename: z.string().min(1).max(200),
          weekStart: z.date(),
          store: StoreEnum.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // A manager may only upload schedules for their own store.
        const callerScope = getScope(ctx.session);
        if (
          input.store &&
          !callerScope.isAdmin &&
          !callerScope.stores.includes(input.store)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only import schedules for your assigned store.",
          });
        }

        const buf = Buffer.from(input.fileBase64, "base64");
        const safeName = input.filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
        const key = `schedules/${ctx.session.scope}-${Date.now()}.${ext}`;
        const { url, key: storedKey } = await storagePut(
          key,
          buf,
          input.mimeType
        );

        const week = getWeekStart(input.weekStart);
        const isPdf = input.mimeType === "application/pdf";
        // Hand the model a direct signed link to the stored file. Routing it
        // back through our own domain adds a redirect hop and can downgrade
        // to http behind the proxy — both silent ways to feed the model
        // nothing and get garbage back.
        let fileFetchUrl: string;
        try {
          fileFetchUrl = await storageGetSignedUrl(storedKey);
        } catch {
          fileFetchUrl = `https://${ctx.req.get("host")}${url}`;
        }

        const instructions =
          "Extract EVERY employee and EVERY shift from this weekly schedule. " +
          "It may be a printed export, a spreadsheet, or a photo of a handwritten grid — read whatever is there. " +
          "For each employee output their full name exactly as written, and one entry per scheduled shift: " +
          'the day (as written, e.g. "Thursday" or a date like "5/7"), the written start and end times, ' +
          "and the shift length in hours (use the written hours if shown, otherwise compute from the times, subtracting any noted unpaid break). " +
          "Also output each employee's total weekly hours. Return JSON.";

        /**
         * The reader must handle anything: digital PDFs and spreadsheets
         * carry their own text, which is extracted server-side and fed
         * directly (deterministic, immune to upstream file-size limits).
         * Photos, scans and handwriting have no text layer — those go to
         * the model as the file itself, read visually. Strategies run in
         * reliability order until one parses.
         */
        type UserContent =
          | { type: "text"; text: string }
          | { type: "file_url"; file_url: { url: string; mime_type: "application/pdf" } }
          | { type: "image_url"; image_url: { url: string; detail: "high" } };
        const withText = (kind: string, text: string): UserContent[] => [
          {
            type: "text",
            text: `${instructions}\n\nBelow is the schedule's extracted ${kind} content:\n\n${text}`,
          },
        ];
        const isSheet = isSheetMime(input.mimeType, safeName);
        const strategies: { label: string; content: UserContent[] }[] = [];
        if (isPdf) {
          const text = await extractPdfText(buf);
          if (text) strategies.push({ label: "pdf-text", content: withText("text", text) });
          strategies.push({
            label: "pdf-file",
            content: [
              { type: "text", text: instructions },
              {
                type: "file_url",
                file_url: { url: fileFetchUrl, mime_type: "application/pdf" },
              },
            ],
          });
        } else if (isSheet) {
          const text = await extractSheetText(buf, input.mimeType, safeName);
          if (!text) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Couldn't read that spreadsheet. Export it as .xlsx or .csv (File → Download in Google Sheets) and try again.",
            });
          }
          strategies.push({ label: "sheet-text", content: withText("spreadsheet", text) });
        } else {
          strategies.push({
            label: "image",
            content: [
              { type: "text", text: instructions },
              { type: "image_url", image_url: { url: fileFetchUrl, detail: "high" } },
            ],
          });
        }
        // Every path gets at least two shots — one flaky response must not
        // cost the manager a re-upload.
        while (strategies.length < 2) {
          strategies.push({ ...strategies[0], label: `${strategies[0].label}-retry` });
        }

        const llmRequestFor = (content: UserContent[]) => ({
          messages: [
            {
              role: "system" as const,
              content:
                "You are a precise data-extraction assistant reading a weekly work schedule (printed export, spreadsheet text, or a photo — possibly handwritten). " +
                "Output every employee with their individual shifts per day. Names must be copied exactly as written. " +
                "Never invent employees, days, or hours. If a shift's hours are not written, compute them from the start/end times. " +
                "Only output JSON matching the provided schema.",
            },
            { role: "user" as const, content },
          ],
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: "homebase_schedule",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  employees: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: {
                          type: "string",
                          description: "Employee full name as printed",
                        },
                        days: {
                          type: "array",
                          description: "One entry per scheduled shift",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                              day: {
                                type: "string",
                                description:
                                  "Day of the shift as printed, e.g. 'Thursday', 'Thu', or '5/7'",
                              },
                              start: {
                                type: ["string", "null"],
                                description:
                                  "Printed start time, e.g. '9:00am'",
                              },
                              end: {
                                type: ["string", "null"],
                                description: "Printed end time, e.g. '5:00pm'",
                              },
                              hours: {
                                type: "number",
                                description: "Length of this shift in hours",
                              },
                            },
                            required: ["day", "start", "end", "hours"],
                          },
                        },
                        totalHours: {
                          type: "number",
                          description: "Total scheduled hours for the week",
                        },
                      },
                      required: ["name", "days", "totalHours"],
                    },
                  },
                },
                required: ["employees"],
              },
            },
          },
        });

        type ExtractedDay = {
          day: string;
          start: string | null;
          end: string | null;
          hours: number;
        };
        type ExtractedEmployee = {
          name: string;
          days: ExtractedDay[];
          totalHours: number;
        };

        // Models occasionally wrap the JSON in prose or code fences, or get
        // cut off mid-answer. Extract tolerantly, and walk the strategy
        // ladder until one attempt parses.
        const extractJson = (text: string): { employees: ExtractedEmployee[] } => {
          let t = text.trim();
          const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
          if (fence) t = fence[1].trim();
          const start = t.indexOf("{");
          const end = t.lastIndexOf("}");
          if (start >= 0 && end > start) t = t.slice(start, end + 1);
          const obj = JSON.parse(t);
          if (!Array.isArray(obj.employees)) throw new Error("bad shape");
          return obj;
        };

        let parsed: { employees: ExtractedEmployee[] } | null = null;
        for (const strategy of strategies) {
          if (parsed) break;
          let text = "";
          try {
            const response = await invokeLLM(llmRequestFor(strategy.content));
            const raw = response.choices[0]?.message?.content;
            text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
            parsed = extractJson(text);
          } catch (err) {
            console.error(
              `[Schedule] extraction strategy "${strategy.label}" failed for ${safeName}:`,
              err instanceof Error ? err.message : err,
              text
                ? `— response head: ${text.slice(0, 400)}`
                : "— no response text"
            );
          }
        }
        if (!parsed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Couldn't read that schedule. It can be a PDF, a photo (even handwritten), or a spreadsheet (.xlsx/.csv) — if it's a photo, retake it flat-on in good light and try again.",
          });
        }

        const scope = getScope(ctx.session);
        const stores = resolveStores(scope, input.store);
        const dbEmployees = await listEmployees({ stores });

        // Confident matches auto-link; anything below the bar gets ranked
        // suggestions so a manager can link the person in one click instead
        // of accidentally creating a duplicate employee.
        const AUTO_MATCH_SCORE = 0.87;

        const rows = parsed.employees.map(row => {
          // Resolve each printed day to a concrete date within the pay week.
          const days = (row.days ?? [])
            .filter(d => Number.isFinite(d.hours) && d.hours >= 0)
            .map(d => ({
              ref: d.day,
              date: resolveScheduleDay(week, d.day),
              startLabel: d.start ?? null,
              endLabel: d.end ?? null,
              hours: Math.min(24, Math.max(0, d.hours)),
            }));
          // Trust the itemized shifts over the printed total when they disagree.
          const daySum = days.reduce((sum, d) => sum + d.hours, 0);
          const totalHours =
            days.length > 0 && Math.abs(daySum - row.totalHours) > 0.51
              ? daySum
              : row.totalHours;

          const ranked = rankNameMatches(
            row.name,
            dbEmployees,
            e => e.fullName,
            { limit: 3, minScore: 0.55 }
          );
          const top = ranked[0];
          const emp =
            top && top.score >= AUTO_MATCH_SCORE ? top.record : undefined;
          return {
            extractedName: row.name,
            scheduledHours: Math.round(totalHours * 100) / 100,
            days,
            matchedEmployeeId: emp?.id ?? null,
            matchedFullName: emp?.fullName ?? null,
            matchedStore: emp?.storeLocation ?? null,
            matchScore: emp && top ? Math.round(top.score * 100) : null,
            suggestions: emp
              ? []
              : ranked.map(c => ({
                  employeeId: c.record.id,
                  fullName: c.record.fullName,
                  storeLocation: c.record.storeLocation,
                  score: Math.round(c.score * 100),
                })),
          };
        });

        const matchedCount = rows.filter(
          r => r.matchedEmployeeId !== null
        ).length;
        const totalHours = rows.reduce((sum, r) => sum + r.scheduledHours, 0);

        let importId: number | null = null;
        try {
          importId = await createScheduleImport({
            uploadedBy: ctx.session.scope,
            storeLocation:
              input.store ?? (scope.isAdmin ? null : (scope.stores[0] ?? null)),
            weekStart: week,
            fileUrl: url,
            filename: safeName,
            status: "parsed",
            employeeCount: rows.length,
            matchedCount,
            unmatchedCount: rows.length - matchedCount,
            totalHours: String(totalHours.toFixed(2)),
          });
        } catch (error) {
          // Import bookkeeping must not block the parse result.
          console.warn("[Schedule] Failed to record import:", error);
        }

        return {
          importId,
          fileUrl: url,
          weekStart: week,
          rows,
          totalExtracted: rows.length,
          totalHours: Math.round(totalHours * 100) / 100,
        };
      }),

    /**
     * Commit a reviewed schedule: writes each employee's total scheduled
     * hours into the payroll week AND stores the day-level shifts that power
     * the dashboard day strip and kiosk shift hints.
     */
    commit: protectedProcedure
      .input(
        z.object({
          weekStart: z.date(),
          importId: z.number().int().nullable().optional(),
          entries: z
            .array(
              z.object({
                employeeId: z.number().int(),
                scheduledHours: z.number().min(0).max(168),
                shifts: z
                  .array(
                    z.object({
                      date: z.date().nullable(),
                      startLabel: z.string().max(32).nullable().optional(),
                      endLabel: z.string().max(32).nullable().optional(),
                      hours: z.number().min(0).max(24),
                    })
                  )
                  .optional(),
              })
            )
            .min(1)
            .max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input.weekStart);
        const emps = await getEmployeesByIds(
          input.entries.map(e => e.employeeId)
        );
        const empById = new Map(emps.map(e => [e.id, e]));
        const existing = await getPayrollByWeek(week);
        const existingByEmp = new Map(existing.map(e => [e.employeeId, e]));

        let saved = 0;
        const skipped: number[] = [];
        for (const item of input.entries) {
          const emp = empById.get(item.employeeId);
          if (
            !emp ||
            (!scope.isAdmin &&
              !scope.stores.includes(emp.storeLocation as Store))
          ) {
            skipped.push(item.employeeId);
            continue;
          }

          const payRate = Number(emp.payRate);
          const hoursWorked = Number(
            existingByEmp.get(emp.id)?.hoursWorked ?? 0
          );
          const { regularPay, grossPay } = computeGrossPay(
            hoursWorked,
            payRate
          );

          await upsertPayrollEntry({
            employeeId: emp.id,
            storeLocation: emp.storeLocation,
            weekStart: week,
            hoursWorked: String(hoursWorked),
            scheduledHours: String(item.scheduledHours),
            payRateSnapshot: String(payRate),
            regularPay: String(regularPay.toFixed(2)),
            overtimePay: "0.00",
            grossPay: String(grossPay.toFixed(2)),
          });

          // Day-level shifts: only dated shifts are persisted.
          const shifts = (item.shifts ?? []).filter(s => s.date !== null);
          await replaceWeekShifts(
            emp.id,
            week,
            shifts.map(s => ({
              storeLocation: emp.storeLocation,
              shiftDate: s.date!,
              startLabel: s.startLabel ?? null,
              endLabel: s.endLabel ?? null,
              hours: String(s.hours),
              source: "import" as const,
              importId: input.importId ?? null,
            }))
          );
          saved++;
        }

        if (input.importId) {
          try {
            const imp = await getScheduleImportById(input.importId);
            // Only the uploader's scope (or the CEO) may mark an import
            // committed — a store manager cannot touch another store's record.
            const mayCommit =
              imp &&
              (scope.isAdmin ||
                imp.uploadedBy === ctx.session.scope ||
                (imp.storeLocation !== null &&
                  scope.stores.includes(imp.storeLocation as Store)));
            if (mayCommit) {
              await markImportCommitted(input.importId, {
                matchedCount: saved,
              });
            }
          } catch (error) {
            console.warn("[Schedule] Failed to mark import committed:", error);
          }
        }

        void logAudit({
          actorScope: ctx.session.scope,
          action: "schedule.commit",
          entityType: "scheduleImport",
          entityId: input.importId ?? undefined,
          detail: JSON.stringify({
            weekStart: week.toISOString(),
            saved,
            skipped,
          }),
          ip: requestIp(ctx.req),
        });
        return { saved, skipped };
      }),

    /** Day-level shifts for a week, hydrated with employee names. */
    week: protectedProcedure
      .input(z.object({ weekStart: z.date(), store: StoreEnum.optional() }))
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input.weekStart);
        const stores = resolveStores(scope, input.store);
        const shifts = await getShiftsForWeek(week, stores);
        const empRows = await getEmployeesByIds(
          Array.from(new Set(shifts.map(s => s.employeeId)))
        );
        const empById = new Map(empRows.map(e => [e.id, e]));
        return {
          weekStart: week,
          shifts: shifts.map(s => ({
            ...s,
            hours: Number(s.hours),
            employeeName:
              empById.get(s.employeeId)?.fullName ??
              `Employee #${s.employeeId}`,
          })),
        };
      }),

    /** Recent schedule uploads for this scope (audit trail of imports). */
    imports: protectedProcedure
      .input(
        z
          .object({ limit: z.number().int().min(1).max(50).optional() })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        return listScheduleImports({
          stores: scope.isAdmin ? undefined : scope.stores,
          limit: input?.limit ?? 10,
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;
