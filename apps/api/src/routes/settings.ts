import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { basename } from "node:path";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { runAutoRosterForCompany } from "../services/auto-roster.service.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import { storage } from "../lib/storage.js";
const businessDetailsSchema = z.object({
  legalName: z.string().optional(),
  registrationNumber: z.string().optional(),
  taxNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  logoUrl: z.string().optional(),
  website: z.string().optional(),
  fax: z.string().optional(),
  psiraRegistration: z.string().optional(),
  uifReference: z.string().optional(),
  payeReference: z.string().optional(),
  sdlReference: z.string().optional(),
});

const businessSettingsSchema = z.object({
  currency: z.string().optional(),
  dateFormat: z.string().optional(),
  timezone: z.string().optional(),
  payrollPeriod: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  employeeIdPrefix: z.string().max(20).optional(),
  payPeriodStartDay: z.number().int().min(1).max(31).optional(),
  payPeriodEndDay: z.number().int().min(1).max(31).optional(),
  autoRosterHorizonPeriods: z.number().int().min(1).max(6).optional(),
});

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  businessDetails: businessDetailsSchema.optional(),
  businessSettings: businessSettingsSchema.optional(),
});

const FACTORY_RESET_MODULES = [
  "employees",
  "sites",
  "shifts",
  "attendance",
  "payroll",
  "timesheets",
  "payRules",
  "publicHolidays",
  "auditLogs",
  "companySettings",
] as const;

const factoryResetSchema = z.object({
  modules: z
    .array(z.enum(FACTORY_RESET_MODULES))
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  attendanceEmployeeId: z.string().min(1).optional(),
  attendanceFromDate: z.string().optional().transform((v) => (v ? v : undefined)),
});

const COMPANY_LOGO_EXTENSIONS = ["jpeg", "jpg", "png", "gif", "webp"] as const;
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;

function buildKnownCompanyLogoFilenames(companyId: string, logoUrl?: string | null): string[] {
  const filenames = new Set<string>();

  if (logoUrl) {
    const withoutQuery = logoUrl.split("?")[0]?.split("#")[0] ?? logoUrl;
    const extracted = basename(withoutQuery);
    if (extracted && SAFE_FILENAME_RE.test(extracted)) {
      filenames.add(extracted);
    }
  }

  for (const ext of COMPANY_LOGO_EXTENSIONS) {
    filenames.add(`company-${companyId}.${ext}`);
  }

  return Array.from(filenames);
}

async function cleanupKnownCompanyLogoFiles(
  companyId: string,
  logoUrl: string | null | undefined,
  log: FastifyInstance["log"]
) {
  const filenames = buildKnownCompanyLogoFilenames(companyId, logoUrl);

  for (const filename of filenames) {
    try {
      await storage.deleteFile(`logos/${filename}`);
    } catch (err) {
      log.error({ err, filename, companyId }, "Failed logo cleanup after full factory reset");
    }
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authMiddleware] }, async (request, reply) => {
    const companyId = request.user!.companyId;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        registrationNumber: true,
        taxNumber: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        website: true,
        fax: true,
        psiraRegistration: true,
        uifReference: true,
        payeReference: true,
        sdlReference: true,
        sdlLiableFrom: true,
        monthlyPayrollTotals: true,
        settings: true,
      },
    });

    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }

    return reply.send(company);
  });

  app.put("/", { preHandler: [authMiddleware, requireAdmin()] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const parsed = updateSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.businessDetails !== undefined) {
      const d = data.businessDetails;
      if (d.legalName !== undefined) updateData.legalName = d.legalName || null;
      if (d.registrationNumber !== undefined) updateData.registrationNumber = d.registrationNumber || null;
      if (d.taxNumber !== undefined) updateData.taxNumber = d.taxNumber || null;
      if (d.address !== undefined) updateData.address = d.address || null;
      if (d.phone !== undefined) updateData.phone = d.phone || null;
      if (d.email !== undefined) updateData.email = d.email || null;
      if (d.logoUrl !== undefined) updateData.logoUrl = d.logoUrl || null;
      if (d.website !== undefined) updateData.website = d.website || null;
      if (d.fax !== undefined) updateData.fax = d.fax || null;
      if (d.psiraRegistration !== undefined) updateData.psiraRegistration = d.psiraRegistration || null;
      if (d.uifReference !== undefined) updateData.uifReference = d.uifReference || null;
      if (d.payeReference !== undefined) updateData.payeReference = d.payeReference || null;
      if (d.sdlReference !== undefined) updateData.sdlReference = d.sdlReference || null;
    }
    if (data.businessSettings !== undefined) {
      const companyBefore = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const currentSettings = { ...((companyBefore?.settings as Record<string, unknown>) ?? {}) };
      const beforeCalendar = parsePayrollCalendarSettings(currentSettings);
      Object.assign(currentSettings, data.businessSettings);
      updateData.settings = currentSettings;

      const afterCalendar = parsePayrollCalendarSettings(currentSettings);
      const calendarChanged =
        beforeCalendar.payrollPeriod !== afterCalendar.payrollPeriod ||
        beforeCalendar.payPeriodStartDay !== afterCalendar.payPeriodStartDay ||
        beforeCalendar.payPeriodEndDay !== afterCalendar.payPeriodEndDay ||
        beforeCalendar.autoRosterHorizonPeriods !== afterCalendar.autoRosterHorizonPeriods;

      if (calendarChanged) {
        void runAutoRosterForCompany(companyId, {
          triggeredBy: "settings_changed",
          userId: request.user!.sub,
        }).catch((err) => {
          request.log.error({ err }, "auto-roster after settings change failed");
        });
      }
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
      select: {
        id: true,
        name: true,
        legalName: true,
        registrationNumber: true,
        taxNumber: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        website: true,
        fax: true,
        psiraRegistration: true,
        uifReference: true,
        payeReference: true,
        sdlReference: true,
        sdlLiableFrom: true,
        monthlyPayrollTotals: true,
        settings: true,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "settings.update",
      entityType: "company",
      entityId: companyId,
    });

    return reply.send(company);
  });

  app.post("/factory-reset", { preHandler: [authMiddleware, requireAdmin()] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = factoryResetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const modules = parsed.data.modules;
    const attendanceEmployeeId = parsed.data.attendanceEmployeeId;
    const attendanceFromDate = parsed.data.attendanceFromDate;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, logoUrl: true },
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }

    const selectedModules = modules ?? [];
    const runAll = selectedModules.length === 0;

    if (runAll) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.company.delete({ where: { id: companyId } });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Factory reset failed";
        return reply.code(400).send({ error: "Factory reset failed", message: msg });
      }

      await cleanupKnownCompanyLogoFiles(companyId, company.logoUrl, request.log);
      return reply.send({ companyDeleted: true });
    }

    const DEFAULT_SETTINGS = {
      currency: "ZAR",
      dateFormat: "DD/MM/YYYY",
      timezone: "Africa/Johannesburg",
      payrollPeriod: "monthly" as const,
      employeeIdPrefix: "EMP",
      payPeriodStartDay: 26,
      payPeriodEndDay: 25,
      autoRosterHorizonPeriods: 2,
    };

    const DEFAULT_PAY_RULES = [
      { ruleType: "overtime", multiplier: 1.5 },
      { ruleType: "sunday", multiplier: 2.0 },
      { ruleType: "public_holiday", multiplier: 2.0 },
    ];

    const DEFAULT_DEDUCTION_RULES = [
      // UIF is calculated by tax service (with R17,712 ceiling) - do not add as deduction rule
      { name: "PSIRA", type: "fixed" as const, amount: 75, appliesTo: "security" as const },
    ];

    const SA_PUBLIC_HOLIDAYS = [
      { date: "2025-01-01", name: "New Year's Day" },
      { date: "2025-03-21", name: "Human Rights Day" },
      { date: "2025-04-18", name: "Good Friday" },
      { date: "2025-04-21", name: "Family Day" },
      { date: "2025-04-27", name: "Freedom Day" },
      { date: "2025-05-01", name: "Workers' Day" },
      { date: "2025-06-16", name: "Youth Day" },
      { date: "2025-08-09", name: "Women's Day" },
      { date: "2025-09-24", name: "Heritage Day" },
      { date: "2025-12-16", name: "Day of Reconciliation" },
      { date: "2025-12-25", name: "Christmas Day" },
      { date: "2025-12-26", name: "Day of Goodwill" },
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-03-21", name: "Human Rights Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-06", name: "Family Day" },
      { date: "2026-04-27", name: "Freedom Day" },
      { date: "2026-05-01", name: "Workers' Day" },
      { date: "2026-06-16", name: "Youth Day" },
      { date: "2026-08-09", name: "Women's Day" },
      { date: "2026-09-24", name: "Heritage Day" },
      { date: "2026-12-16", name: "Day of Reconciliation" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Day of Goodwill" },
    ];

    const has = (m: (typeof FACTORY_RESET_MODULES)[number]) => selectedModules.includes(m);

    try {
    await prisma.$transaction(async (tx) => {
      const posts = await tx.sitePost.findMany({
        where: { site: { companyId } },
        select: { id: true },
      });
      const postIds = posts.map((p) => p.id);
      const sites = await tx.site.findMany({
        where: { companyId },
        select: { id: true },
      });
      const siteIds = sites.map((s) => s.id);
      const employees = await tx.employee.findMany({
        where: { companyId },
        select: { id: true },
      });
      const employeeIds = employees.map((e) => e.id);

      // Shifts (includes Attendance via cascade)
      if (has("shifts")) {
        await tx.shift.deleteMany({ where: { companyId } });
      }

      // Attendance only (clears clock-in/out records; shifts remain)
      if (has("attendance")) {
        const shiftWhere: Record<string, unknown> = { companyId };
        if (attendanceEmployeeId) {
          const employee = await tx.employee.findFirst({
            where: { id: attendanceEmployeeId, companyId },
          });
          if (!employee) {
            throw new Error("Employee not found");
          }
          shiftWhere.employeeId = attendanceEmployeeId;
        }
        if (attendanceFromDate) {
          const fromDate = new Date(attendanceFromDate);
          fromDate.setUTCHours(0, 0, 0, 0);
          shiftWhere.startTime = { gte: fromDate };
        }
        const shiftsToReset = await tx.shift.findMany({
          where: shiftWhere,
          select: { id: true },
        });
        const shiftIds = shiftsToReset.map((s) => s.id);
        if (shiftIds.length > 0) {
          await tx.attendance.deleteMany({ where: { shiftId: { in: shiftIds } } });
          await tx.shift.updateMany({
            where: { id: { in: shiftIds }, status: { in: ["active", "completed", "verified"] } },
            data: { status: "assigned" },
          });
        }
      }

      // Sites: GuardSiteEligibility, SiteAssignment, Shift, SitePost, Site
      if (has("sites")) {
        if (postIds.length > 0) {
          await tx.guardSiteEligibility.deleteMany({ where: { sitePostId: { in: postIds } } });
          await tx.coverageRequirement.deleteMany({ where: { sitePostId: { in: postIds } } });
          await tx.shift.deleteMany({ where: { siteId: { in: siteIds } } });
        }
        if (siteIds.length > 0) {
          await tx.siteAssignment.deleteMany({ where: { siteId: { in: siteIds } } });
        }
        await tx.sitePost.deleteMany({ where: { site: { companyId } } });
        await tx.site.deleteMany({ where: { companyId } });
      }

      // Payroll: cascade deletes Payslip + PayrollItem via PayrollRun
      if (has("payroll")) {
        await tx.payrollRun.deleteMany({ where: { companyId } });
      }

      // Timesheets
      if (has("timesheets")) {
        await tx.timesheet.deleteMany({ where: { companyId } });
      }

      // Employees: GuardSiteEligibility, SiteAssignment, LeaveRecord, EmployeeDeduction, Shift, PayrollItem, Timesheet, Employee
      if (has("employees")) {
        if (postIds.length > 0) {
          await tx.guardSiteEligibility.deleteMany({ where: { sitePostId: { in: postIds } } });
        }
        if (siteIds.length > 0) {
          await tx.siteAssignment.deleteMany({ where: { siteId: { in: siteIds } } });
        }
        await tx.shift.deleteMany({ where: { companyId } });
        await tx.payrollRun.deleteMany({ where: { companyId } });
        await tx.timesheet.deleteMany({ where: { companyId } });
        if (employeeIds.length > 0) {
          await tx.leaveRecord.deleteMany({ where: { employeeId: { in: employeeIds } } });
          await tx.employeeDeduction.deleteMany({ where: { employeeId: { in: employeeIds } } });
        }
        await tx.employee.deleteMany({ where: { companyId } });
      }

      // Pay rules: clear and restore to defaults
      if (has("payRules")) {
        await tx.employee.updateMany({ where: { companyId }, data: { gradeId: null } });
        await tx.payGrade.deleteMany({ where: { companyId } });
        await tx.payRule.deleteMany({ where: { companyId } });
        await tx.groupPayRule.deleteMany({ where: { companyId } });
        await tx.groupEarningsRule.deleteMany({ where: { companyId } });
        await tx.groupDeductionRule.deleteMany({ where: { companyId } });
        await tx.earningsRule.deleteMany({ where: { companyId } });
        await tx.deductionRule.deleteMany({ where: { companyId } });
        for (const { ruleType, multiplier } of DEFAULT_PAY_RULES) {
          await tx.payRule.create({
            data: { companyId, ruleType, multiplier },
          });
        }
        for (const dr of DEFAULT_DEDUCTION_RULES) {
          const rule = dr as { name: string; type: string; amount?: number; rate?: number; appliesTo: string };
          await tx.deductionRule.create({
            data: {
              companyId,
              name: rule.name,
              type: rule.type,
              rate: rule.rate ?? null,
              amount: rule.amount ?? null,
              appliesTo: rule.appliesTo,
              isOptional: false,
            },
          });
        }
      }

      // Public holidays: clear and restore to SA defaults
      if (has("publicHolidays")) {
        await tx.publicHoliday.deleteMany({ where: { companyId } });
        for (const h of SA_PUBLIC_HOLIDAYS) {
          await tx.publicHoliday.create({
            data: { companyId, date: new Date(h.date), name: h.name },
          });
        }
      }

      // Audit logs
      if (has("auditLogs")) {
        await tx.auditLog.deleteMany({ where: { companyId } });
      }

      // Audit log for this reset
      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          action: "settings.factory_reset",
          entityType: "company",
          entityId: companyId,
          metadata: { modules: selectedModules },
        },
      });

      // Company settings
      if (has("companySettings")) {
        await tx.company.update({
          where: { id: companyId },
          data: {
            name: "My Company",
            legalName: null,
            registrationNumber: null,
            taxNumber: null,
            address: null,
            phone: null,
            email: null,
            logoUrl: null,
            website: null,
            fax: null,
            psiraRegistration: null,
            uifReference: null,
            payeReference: null,
            sdlReference: null,
            sdlLiableFrom: null,
            monthlyPayrollTotals: Prisma.JsonNull,
            settings: DEFAULT_SETTINGS,
            theme: Prisma.JsonNull,
          },
        });
      }
    }, { maxWait: 10000, timeout: 120000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Factory reset failed";
      return reply.code(400).send({ error: "Factory reset failed", message: msg });
    }

    const updated = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        registrationNumber: true,
        taxNumber: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        website: true,
        fax: true,
        psiraRegistration: true,
        uifReference: true,
        payeReference: true,
        sdlReference: true,
        sdlLiableFrom: true,
        monthlyPayrollTotals: true,
        settings: true,
      },
    });

    return reply.send(updated);
  });
}
