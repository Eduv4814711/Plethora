import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

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
});

const businessSettingsSchema = z.object({
  currency: z.string().optional(),
  dateFormat: z.string().optional(),
  timezone: z.string().optional(),
  payrollPeriod: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  employeeIdPrefix: z.string().max(20).optional(),
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
});

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
    }
    if (data.businessSettings !== undefined) {
      updateData.settings = data.businessSettings;
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

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }

    const DEFAULT_SETTINGS = {
      currency: "ZAR",
      dateFormat: "DD/MM/YYYY",
      timezone: "Africa/Johannesburg",
      payrollPeriod: "monthly" as const,
      employeeIdPrefix: "EMP",
    };

    const runAll = !modules || modules.length === 0;
    const has = (m: (typeof FACTORY_RESET_MODULES)[number]) => runAll || modules!.includes(m);

    await prisma.$transaction(async (tx) => {
      const posts = await tx.post.findMany({
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

      // Sites: PostAssignment, SiteAssignment, Shift, Post, Site
      if (has("sites")) {
        if (postIds.length > 0) {
          await tx.postAssignment.deleteMany({ where: { postId: { in: postIds } } });
          await tx.shift.deleteMany({ where: { postId: { in: postIds } } });
        }
        if (siteIds.length > 0) {
          await tx.siteAssignment.deleteMany({ where: { siteId: { in: siteIds } } });
        }
        await tx.post.deleteMany({ where: { site: { companyId } } });
        await tx.site.deleteMany({ where: { companyId } });
      }

      // Payroll: Payslip, PayrollItem, PayrollRun
      if (has("payroll")) {
        const payrollRuns = await tx.payrollRun.findMany({
          where: { companyId },
          select: { id: true },
        });
        const payrollRunIds = payrollRuns.map((r) => r.id);
        if (payrollRunIds.length > 0) {
          const payrollItems = await tx.payrollItem.findMany({
            where: { payrollRunId: { in: payrollRunIds } },
            select: { id: true },
          });
          const payrollItemIds = payrollItems.map((i) => i.id);
          if (payrollItemIds.length > 0) {
            await tx.payslip.deleteMany({ where: { payrollItemId: { in: payrollItemIds } } });
          }
          await tx.payrollItem.deleteMany({ where: { payrollRunId: { in: payrollRunIds } } });
        }
        await tx.payrollRun.deleteMany({ where: { companyId } });
      }

      // Timesheets
      if (has("timesheets")) {
        await tx.timesheet.deleteMany({ where: { companyId } });
      }

      // Employees: PostAssignment, SiteAssignment, LeaveRecord, EmployeeDeduction, Shift, PayrollItem, Timesheet, Employee
      if (has("employees")) {
        if (postIds.length > 0) {
          await tx.postAssignment.deleteMany({ where: { postId: { in: postIds } } });
        }
        if (siteIds.length > 0) {
          await tx.siteAssignment.deleteMany({ where: { siteId: { in: siteIds } } });
        }
        await tx.shift.deleteMany({ where: { companyId } });
        const payrollRuns = await tx.payrollRun.findMany({
          where: { companyId },
          select: { id: true },
        });
        const payrollRunIds = payrollRuns.map((r) => r.id);
        if (payrollRunIds.length > 0) {
          const payrollItems = await tx.payrollItem.findMany({
            where: { payrollRunId: { in: payrollRunIds } },
            select: { id: true },
          });
          const payrollItemIds = payrollItems.map((i) => i.id);
          if (payrollItemIds.length > 0) {
            await tx.payslip.deleteMany({ where: { payrollItemId: { in: payrollItemIds } } });
          }
          await tx.payrollItem.deleteMany({ where: { payrollRunId: { in: payrollRunIds } } });
        }
        await tx.timesheet.deleteMany({ where: { companyId } });
        if (employeeIds.length > 0) {
          await tx.leaveRecord.deleteMany({ where: { employeeId: { in: employeeIds } } });
          await tx.employeeDeduction.deleteMany({ where: { employeeId: { in: employeeIds } } });
        }
        await tx.employee.deleteMany({ where: { companyId } });
      }

      // Pay rules: PayGrade, PayRule, EarningsRule, DeductionRule
      if (has("payRules")) {
        await tx.employee.updateMany({ where: { companyId }, data: { gradeId: null } });
        await tx.payGrade.deleteMany({ where: { companyId } });
        await tx.payRule.deleteMany({ where: { companyId } });
        await tx.earningsRule.deleteMany({ where: { companyId } });
        await tx.deductionRule.deleteMany({ where: { companyId } });
      }

      // Public holidays
      if (has("publicHolidays")) {
        await tx.publicHoliday.deleteMany({ where: { companyId } });
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
          metadata: modules ? { modules } : undefined,
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
            settings: DEFAULT_SETTINGS,
            theme: Prisma.JsonNull,
          },
        });
      }
    });

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
        settings: true,
      },
    });

    return reply.send(updated);
  });
}
