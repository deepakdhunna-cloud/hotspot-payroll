import { PIN_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  closePunch,
  countEmployees,
  createEmployee,
  createManualPunch,
  deactivateEmployee,
  deleteEmployee,
  deletePunch,
  findEmployeesWithClockCodes,
  findOpenPunch,
  getEmployeeById,
  getEmployeePayrollHistory,
  getPayrollByWeek,
  getPunchById,
  hoursWorkedForWeek,
  hoursWorkedForWeekBulk,
  listEmployees,
  listPunches,
  openPunch,
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
  computeGrossPay,
  estimateWithholding,
  getWeekStart,
} from "@shared/hotspot";
import { TRPCError } from "@trpc/server";
import {
  ALL_SCOPES,
  listPinScopes,
  setPin,
  signPinSession,
  verifyPin,
  type PinScope,
  type PinSession,
} from "./_core/pinAuth";

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
        const scope = await verifyPin(input.pin);
        if (!scope) {
          // Brief delay to slow brute force.
          await new Promise((r) => setTimeout(r, 400));
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect PIN" });
        }
        const token = await signPinSession(scope);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(PIN_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
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
        (e) => e.role === "Manager" && e.storeLocation === store,
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
        const targetStores =
          input?.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? undefined
              : scope.stores;
        return listEmployees({ stores: targetStores });
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return emp;
      }),

    /**
     * Quick Add: create a placeholder employee from a parsed schedule row.
     * Pay rate is 0, role is Cashier, phone is "—". Edit later from the profile.
     */
    quickCreate: protectedProcedure
      .input(
        z.object({
          fullName: z.string().min(1).max(200),
          storeLocation: StoreEnum,
        }),
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
          payRate: "0",
          role: "Cashier",
          storeLocation: input.storeLocation,
        });
        return { id, fullName: input.fullName.trim(), storeLocation: input.storeLocation };
      }),

    create: protectedProcedure
      .input(
        z.object({
          fullName: z.string().min(1).max(200),
          phone: z.string().min(1).max(32),
          payRate: z.number().positive().max(1000),
          role: RoleEnum,
          storeLocation: StoreEnum,
        }),
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
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int(),
          fullName: z.string().min(1).max(200).optional(),
          phone: z.string().min(1).max(32).optional(),
          payRate: z.number().positive().max(1000).optional(),
          role: RoleEnum.optional(),
          storeLocation: StoreEnum.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const update: Record<string, unknown> = {};
        if (input.fullName !== undefined) update.fullName = input.fullName;
        if (input.phone !== undefined) update.phone = input.phone;
        if (input.payRate !== undefined) update.payRate = String(input.payRate);
        if (input.role !== undefined) update.role = input.role;
        if (input.storeLocation !== undefined) update.storeLocation = input.storeLocation;
        await updateEmployee(input.id, update);
        return { success: true };
      }),

    /**
     * Bulk edit: change store and/or role for many employees at once.
     * Manager scope: every selected employee's current store AND the target store
     * must be within the manager's assigned stores. CEO/admin: unrestricted.
     */
    bulkUpdate: protectedProcedure
      .input(
        z.object({
          ids: z.array(z.number().int()).min(1).max(500),
          storeLocation: StoreEnum.optional(),
          role: RoleEnum.optional(),
        }).refine(
          (v) => v.storeLocation !== undefined || v.role !== undefined,
          { message: "Provide at least one field to update." },
        ),
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
        if (input.storeLocation !== undefined) update.storeLocation = input.storeLocation;
        if (input.role !== undefined) update.role = input.role;

        let updated = 0;
        const skipped: number[] = [];
        for (const id of input.ids) {
          const emp = await getEmployeeById(id);
          if (!emp) {
            skipped.push(id);
            continue;
          }
          if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
            skipped.push(id);
            continue;
          }
          await updateEmployee(id, update);
          updated += 1;
        }
        return { updated, skipped };
      }),

    deactivate: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deactivateEmployee(input.id);
        return { success: true };
      }),

    /**
     * Permanently delete an employee plus their full payroll history.
     * Cannot be undone. Manager scope: must own the employee's store.
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deleteEmployee(input.id);
        return { success: true };
      }),

    history: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.id);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
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
        const stores =
          input.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? undefined
              : scope.stores;

        const employees = await listEmployees({ stores });
        const entries = await getPayrollByWeek(week, stores);
        const entryByEmp = new Map<number, (typeof entries)[number]>();
        for (const e of entries) entryByEmp.set(e.employeeId, e);

        return {
          weekStart: week,
          employees: employees.map((emp) => ({
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
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
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
          payRate,
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
        return { id, grossPay, regularPay };
      }),

    saveSchedule: protectedProcedure
      .input(
        z.object({
          weekStart: z.date(),
          entries: z.array(
            z.object({
              employeeId: z.number().int(),
              scheduledHours: z.number().min(0).max(168),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input.weekStart);
        let saved = 0;
        for (const item of input.entries) {
          const emp = await getEmployeeById(item.employeeId);
          if (!emp) continue;
          if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) continue;

          const payRate = Number(emp.payRate);
          const existing = await getPayrollByWeek(week);
          const existingForEmp = existing.find((e) => e.employeeId === emp.id);
          const hoursWorked = Number(existingForEmp?.hoursWorked ?? 0);
          const { regularPay, grossPay } = computeGrossPay(hoursWorked, payRate);

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
          saved++;
        }
        return { saved };
      }),
  }),

  dashboard: router({
    summary: protectedProcedure
      .input(
        z.object({ weekStart: z.date(), store: StoreEnum.optional() }).optional(),
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const week = getWeekStart(input?.weekStart ?? new Date());

        const storesFilter =
          input?.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? [...STORES]
              : scope.stores;

        const employees = await listEmployees({ stores: storesFilter });
        const entries = await getPayrollByWeek(week, storesFilter);

        const byStore: Record<
          string,
          { totalHours: number; totalScheduled: number; totalGross: number; employeeCount: number }
        > = {};
        for (const s of storesFilter) {
          byStore[s] = { totalHours: 0, totalScheduled: 0, totalGross: 0, employeeCount: 0 };
        }
        for (const e of employees) {
          if (byStore[e.storeLocation]) byStore[e.storeLocation].employeeCount++;
        }
        for (const e of entries) {
          if (!byStore[e.storeLocation]) continue;
          byStore[e.storeLocation].totalHours += Number(e.hoursWorked);
          byStore[e.storeLocation].totalScheduled += Number(e.scheduledHours);
          byStore[e.storeLocation].totalGross += Number(e.grossPay);
        }

        const totalHours = Object.values(byStore).reduce((a, b) => a + b.totalHours, 0);
        const totalScheduled = Object.values(byStore).reduce((a, b) => a + b.totalScheduled, 0);
        const totalGross = Object.values(byStore).reduce((a, b) => a + b.totalGross, 0);

        const empBreakdown = employees.map((emp) => {
          const entry = entries.find((e) => e.employeeId === emp.id);
          const hoursWorked = Number(entry?.hoursWorked ?? 0);
          const scheduled = Number(entry?.scheduledHours ?? 0);
          const grossPay = Number(entry?.grossPay ?? 0);
          return {
            id: emp.id,
            fullName: emp.fullName,
            storeLocation: emp.storeLocation,
            role: emp.role,
            payRate: Number(emp.payRate),
            hoursWorked,
            scheduledHours: scheduled,
            variance: hoursWorked - scheduled,
            grossPay,
          };
        });

        return {
          weekStart: week,
          scope,
          byStore,
          totals: {
            totalHours,
            totalScheduled,
            totalGross,
            variance: totalHours - totalScheduled,
          },
          employees: empBreakdown,
        };
      }),
  }),

  ceo: router({
    weekly: adminProcedure
      .input(z.object({ weekStart: z.date(), store: StoreEnum.optional() }))
      .query(async ({ input }) => {
        const week = getWeekStart(input.weekStart);
        const stores = input.store ? [input.store] : [...STORES];
        const employees = await listEmployees({ stores });
        const entries = await getPayrollByWeek(week, stores);

        const byStore: Record<
          string,
          {
            totalHours: number;
            totalGross: number;
            totalFederal: number;
            totalState: number;
            totalNet: number;
            totalScheduled: number;
            employeeCount: number;
          }
        > = {};
        for (const s of stores) {
          byStore[s] = {
            totalHours: 0,
            totalGross: 0,
            totalFederal: 0,
            totalState: 0,
            totalNet: 0,
            totalScheduled: 0,
            employeeCount: 0,
          };
        }

        const rows = employees.map((emp) => {
          const entry = entries.find((e) => e.employeeId === emp.id);
          const hoursWorked = Number(entry?.hoursWorked ?? 0);
          const scheduled = Number(entry?.scheduledHours ?? 0);
          const grossPay = Number(entry?.grossPay ?? 0);
          const { federal, state, totalTax, netPay } = estimateWithholding(grossPay);
          if (byStore[emp.storeLocation]) {
            byStore[emp.storeLocation].employeeCount++;
            byStore[emp.storeLocation].totalHours += hoursWorked;
            byStore[emp.storeLocation].totalScheduled += scheduled;
            byStore[emp.storeLocation].totalGross += grossPay;
            byStore[emp.storeLocation].totalFederal += federal;
            byStore[emp.storeLocation].totalState += state;
            byStore[emp.storeLocation].totalNet += netPay;
          }
          return {
            id: emp.id,
            fullName: emp.fullName,
            role: emp.role,
            storeLocation: emp.storeLocation,
            payRate: Number(emp.payRate),
            hoursWorked,
            scheduledHours: scheduled,
            variance: hoursWorked - scheduled,
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
            totalGross: acc.totalGross + s.totalGross,
            totalFederal: acc.totalFederal + s.totalFederal,
            totalState: acc.totalState + s.totalState,
            totalNet: acc.totalNet + s.totalNet,
            totalScheduled: acc.totalScheduled + s.totalScheduled,
          }),
          {
            totalHours: 0,
            totalGross: 0,
            totalFederal: 0,
            totalState: 0,
            totalNet: 0,
            totalScheduled: 0,
          },
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
      return ALL_SCOPES.map((scope) => {
        const row = rows.find((r) => r.scope === scope);
        return {
          scope,
          label:
            scope === "ceo" ? "CEO Master PIN" : `${scope} \u2014 Manager PIN`,
          isSet: !!row,
          updatedAt: row?.updatedAt ?? null,
        };
      });
    }),

    /** Update a PIN (CEO master, or any of the four store PINs). */
    updatePin: adminProcedure
      .input(
        z.object({
          scope: z.enum(["ceo", ...STORES] as [PinScope, ...PinScope[]]),
          pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits"),
        }),
      )
      .mutation(async ({ input }) => {
        await setPin(input.scope, input.pin);
        return { success: true };
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
        }),
      )
      .mutation(async ({ input }) => {
        const employees = await findEmployeesWithClockCodes(input.store);
        let matched: (typeof employees)[number] | undefined;
        for (const emp of employees) {
          if (verifyClockCode(input.code, emp.id, emp.clockCodeHash)) {
            matched = emp;
            break;
          }
        }
        if (!matched) {
          await new Promise((r) => setTimeout(r, 400));
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Code not recognized at this store.",
          });
        }
        const open = await findOpenPunch(matched.id);
        const now = new Date();
        if (open) {
          await closePunch(open.id, now);
          const durationMs = now.getTime() - new Date(open.clockInAt).getTime();
          return {
            action: "out" as const,
            employee: { id: matched.id, fullName: matched.fullName },
            at: now,
            durationHours: Math.max(0, durationMs / 3_600_000),
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
          code: z.string().regex(/^\d{4}$|^$/, "Code must be 4 digits or empty"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (input.code === "") {
          await setClockCodeHash(emp.id, null);
          return { success: true, cleared: true };
        }
        // Uniqueness within store: any other active employee with a matching hash blocks reuse.
        const peers = await findEmployeesWithClockCodes(emp.storeLocation);
        const conflict = peers.find(
          (p) => p.id !== emp.id && verifyClockCode(input.code, p.id, p.clockCodeHash),
        );
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Code already used by ${conflict.fullName} at this store.`,
          });
        }
        const hash = hashClockCode(input.code, emp.id);
        await setClockCodeHash(emp.id, hash);
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
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const scope = getScope(ctx.session);
        const stores =
          input?.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? undefined
              : scope.stores;
        if (input?.employeeId !== undefined) {
          const emp = await getEmployeeById(input.employeeId);
          if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
          if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
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
        const empIds = Array.from(new Set(punches.map((p) => p.employeeId)));
        const empMap = new Map<number, { id: number; fullName: string }>();
        for (const id of empIds) {
          const e = await getEmployeeById(id);
          if (e) empMap.set(id, { id: e.id, fullName: e.fullName });
        }
        return punches.map((p) => ({
          ...p,
          employeeName: empMap.get(p.employeeId)?.fullName ?? "Unknown",
          durationHours:
            p.clockOutAt
              ? Math.max(
                  0,
                  (new Date(p.clockOutAt).getTime() - new Date(p.clockInAt).getTime()) /
                    3_600_000,
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
            (v) => !v.clockOutAt || v.clockOutAt.getTime() > v.clockInAt.getTime(),
            { message: "Clock-out must be after clock-in." },
          ),
      )
      .mutation(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const id = await createManualPunch({
          employeeId: emp.id,
          storeLocation: emp.storeLocation,
          clockInAt: input.clockInAt,
          clockOutAt: input.clockOutAt ?? null,
          source: "manual",
          note: input.note ?? null,
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
            (v) =>
              !v.clockInAt ||
              !v.clockOutAt ||
              v.clockOutAt.getTime() > v.clockInAt.getTime(),
            { message: "Clock-out must be after clock-in." },
          ),
      )
      .mutation(async ({ ctx, input }) => {
        const punch = await getPunchById(input.id);
        if (!punch) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(punch.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const update: Record<string, unknown> = {};
        if (input.clockInAt !== undefined) update.clockInAt = input.clockInAt;
        if (input.clockOutAt !== undefined) update.clockOutAt = input.clockOutAt;
        if (input.note !== undefined) update.note = input.note;
        await updatePunch(input.id, update as any);
        return { success: true };
      }),

    /** Delete a punch. */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const punch = await getPunchById(input.id);
        if (!punch) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(punch.storeLocation as Store)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await deletePunch(input.id);
        return { success: true };
      }),

    /** Sum of hours worked for one employee in a given week. */
    weekHours: protectedProcedure
      .input(z.object({ employeeId: z.number().int(), weekStart: z.date() }))
      .query(async ({ ctx, input }) => {
        const emp = await getEmployeeById(input.employeeId);
        if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
        const scope = getScope(ctx.session);
        if (!scope.isAdmin && !scope.stores.includes(emp.storeLocation as Store)) {
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
        const stores =
          input.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? undefined
              : scope.stores;
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
    parseUpload: protectedProcedure
      .input(
        z.object({
          fileBase64: z.string().min(1),
          mimeType: z.string().min(1),
          filename: z.string().min(1).max(200),
          weekStart: z.date(),
          store: StoreEnum.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const buf = Buffer.from(input.fileBase64, "base64");
        const safeName = input.filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
        const key = `schedules/${ctx.session.scope}-${Date.now()}.${ext}`;
        const { url } = await storagePut(key, buf, input.mimeType);

        const isPdf = input.mimeType === "application/pdf";
        const origin = `${ctx.req.protocol}://${ctx.req.get("host")}`;
        const absoluteUrl = `${origin}${url}`;

        const userContent = isPdf
          ? [
              {
                type: "text" as const,
                text:
                  "This is a Homebase weekly schedule export. Extract every employee's full name and total scheduled hours for the week. Return JSON.",
              },
              {
                type: "file_url" as const,
                file_url: { url: absoluteUrl, mime_type: "application/pdf" as const },
              },
            ]
          : [
              {
                type: "text" as const,
                text:
                  "This is a Homebase weekly schedule (photo or screenshot). Extract every employee's full name and total scheduled hours for the week. If only daily shift times are shown, sum them across the week. Return JSON.",
              },
              {
                type: "image_url" as const,
                image_url: { url: absoluteUrl, detail: "high" as const },
              },
            ];

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "You are a precise data-extraction assistant. Read a Homebase schedule (PDF or image) and output the total weekly scheduled hours for each employee. Names should be the employee's full name as printed. If a name appears multiple times, sum the hours. Only output JSON matching the provided schema. Do not invent employees.",
            },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
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
                        name: { type: "string", description: "Employee full name" },
                        scheduledHours: {
                          type: "number",
                          description: "Total scheduled hours for the week",
                        },
                      },
                      required: ["name", "scheduledHours"],
                    },
                  },
                },
                required: ["employees"],
              },
            },
          },
        });

        let parsed: { employees: { name: string; scheduledHours: number }[] } = {
          employees: [],
        };
        try {
          const raw = response.choices[0]?.message?.content;
          const text = typeof raw === "string" ? raw : JSON.stringify(raw);
          parsed = JSON.parse(text);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Could not parse the schedule. Try a clearer photo or PDF.",
          });
        }

        const scope = getScope(ctx.session);
        const stores =
          input.store && (scope.isAdmin || scope.stores.includes(input.store))
            ? [input.store]
            : scope.isAdmin
              ? undefined
              : scope.stores;
        const dbEmployees = await listEmployees({ stores });

        const normalize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

        const matched = parsed.employees.map((row) => {
          const target = normalize(row.name);
          let emp = dbEmployees.find((e) => normalize(e.fullName) === target);
          if (!emp) {
            const parts = target.split(" ").filter(Boolean);
            const first = parts[0] ?? "";
            const last = parts[parts.length - 1] ?? "";
            emp = dbEmployees.find((e) => {
              const en = normalize(e.fullName).split(" ").filter(Boolean);
              const ef = en[0] ?? "";
              const el = en[en.length - 1] ?? "";
              return (
                (last && el === last && first && (ef === first || ef.startsWith(first[0]))) ||
                (last && el === last && first.length === 1 && ef.startsWith(first))
              );
            });
          }
          return {
            extractedName: row.name,
            scheduledHours: row.scheduledHours,
            matchedEmployeeId: emp?.id ?? null,
            matchedFullName: emp?.fullName ?? null,
            matchedStore: emp?.storeLocation ?? null,
          };
        });

        return {
          fileUrl: url,
          weekStart: getWeekStart(input.weekStart),
          rows: matched,
          totalExtracted: parsed.employees.length,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
