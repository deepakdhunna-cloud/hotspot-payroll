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
  countEmployees,
  createEmployee,
  deactivateEmployee,
  getEmployeeById,
  getEmployeePayrollHistory,
  getPayrollByWeek,
  listEmployees,
  updateEmployee,
  upsertPayrollEntry,
} from "./db";
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
        const payRate = Number(emp.payRate);
        const { regularPay, overtimePay, grossPay } = computeGrossPay(
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
          overtimePay: String(overtimePay.toFixed(2)),
          grossPay: String(grossPay.toFixed(2)),
          notes: input.notes ?? null,
        });
        return { id, grossPay, regularPay, overtimePay };
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
          const { regularPay, overtimePay, grossPay } = computeGrossPay(hoursWorked, payRate);

          await upsertPayrollEntry({
            employeeId: emp.id,
            storeLocation: emp.storeLocation,
            weekStart: week,
            hoursWorked: String(hoursWorked),
            scheduledHours: String(item.scheduledHours),
            payRateSnapshot: String(payRate),
            regularPay: String(regularPay.toFixed(2)),
            overtimePay: String(overtimePay.toFixed(2)),
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
