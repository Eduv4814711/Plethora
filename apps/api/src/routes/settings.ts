import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  getEmailConfig,
  sendEmail,
  encryptPasswordForStorage,
} from "../services/email.service.js";

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

const emailConfigSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  from: z.string().optional(),
  enabled: z.boolean().optional(),
  imapHost: z.string().optional(),
  imapPort: z.number().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
});

const emailTemplateSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
});

const emailTemplatesSchema = z.object({
  payslipOnApproval: emailTemplateSchema.optional(),
  leaveRequestSubmitted: emailTemplateSchema.optional(),
  leaveRequestApproved: emailTemplateSchema.optional(),
  leaveRequestRejected: emailTemplateSchema.optional(),
});

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  businessDetails: businessDetailsSchema.optional(),
  businessSettings: businessSettingsSchema.optional(),
  emailConfig: emailConfigSchema.optional(),
  emailTemplates: emailTemplatesSchema.optional(),
});

const emailTestSchema = z.object({
  to: z.string().email(),
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

    const settings = company.settings as Record<string, unknown> | null;
    if (settings?.emailConfig && typeof settings.emailConfig === "object") {
      const cfg = settings.emailConfig as Record<string, unknown>;
      settings.emailConfig = { ...cfg, password: cfg.password ? "********" : "" };
    }

    return reply.send(company);
  });

  app.post("/email/test", { preHandler: [authMiddleware, requireAdmin()] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const parsed = emailTestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const config = await getEmailConfig(companyId);
    if (!config || !config.enabled || !config.password) {
      return reply.code(400).send({
        error: "Email not configured",
        message: "Configure SMTP in Settings > Email and ensure it is enabled.",
      });
    }
    const ok = await sendEmail(companyId, {
      to: parsed.data.to,
      subject: "Plethora – Test Email",
      body: "This is a test email from your Plethora email configuration. If you received this, your SMTP settings are working correctly.",
    });
    if (!ok) {
      return reply.code(500).send({
        error: "Send failed",
        message: "Could not send test email. Check your SMTP settings and try again.",
      });
    }
    return reply.send({ success: true, message: "Test email sent" });
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
    if (data.businessSettings !== undefined || data.emailConfig !== undefined || data.emailTemplates !== undefined) {
      const companyBefore = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const currentSettings = { ...((companyBefore?.settings as Record<string, unknown>) ?? {}) };

      if (data.businessSettings !== undefined) {
        Object.assign(currentSettings, data.businessSettings);
      }

      if (data.emailConfig !== undefined) {
        const cfg = { ...(currentSettings.emailConfig as Record<string, unknown>) } as Record<string, unknown>;
        const incoming = data.emailConfig;
        if (incoming.host !== undefined) cfg.host = incoming.host;
        if (incoming.port !== undefined) cfg.port = incoming.port;
        if (incoming.secure !== undefined) cfg.secure = incoming.secure;
        if (incoming.user !== undefined) cfg.user = incoming.user;
        if (incoming.from !== undefined) cfg.from = incoming.from;
        if (incoming.enabled !== undefined) cfg.enabled = incoming.enabled;
        if (incoming.imapHost !== undefined) cfg.imapHost = incoming.imapHost;
        if (incoming.imapPort !== undefined) cfg.imapPort = incoming.imapPort;
        if (incoming.imapSecure !== undefined) cfg.imapSecure = incoming.imapSecure;
        if (incoming.password !== undefined && incoming.password !== "" && incoming.password !== "********") {
          cfg.password = encryptPasswordForStorage(incoming.password);
        }
        currentSettings.emailConfig = cfg;
      }

      if (data.emailTemplates !== undefined) {
        const tpl = { ...(currentSettings.emailTemplates as Record<string, unknown>) } as Record<string, unknown>;
        const incoming = data.emailTemplates;
        if (incoming.payslipOnApproval !== undefined) tpl.payslipOnApproval = incoming.payslipOnApproval;
        if (incoming.leaveRequestSubmitted !== undefined) tpl.leaveRequestSubmitted = incoming.leaveRequestSubmitted;
        if (incoming.leaveRequestApproved !== undefined) tpl.leaveRequestApproved = incoming.leaveRequestApproved;
        if (incoming.leaveRequestRejected !== undefined) tpl.leaveRequestRejected = incoming.leaveRequestRejected;
        currentSettings.emailTemplates = tpl;
      }

      updateData.settings = currentSettings;
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
    const attendanceEmployeeId = parsed.data.attendanceEmployeeId;

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

    const DEFAULT_PAY_RULES = [
      { ruleType: "overtime", multiplier: 1.5 },
      { ruleType: "sunday", multiplier: 2.0 },
      { ruleType: "public_holiday", multiplier: 2.0 },
    ];

    const DEFAULT_DEDUCTION_RULES = [
      { name: "UIF", type: "percentage" as const, rate: 1, appliesTo: "all" as const },
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

    const runAll = !modules || modules.length === 0;
    const has = (m: (typeof FACTORY_RESET_MODULES)[number]) => runAll || modules!.includes(m);

    try {
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

      // Attendance only (clears clock-in/out records; shifts remain)
      if (has("attendance")) {
        if (attendanceEmployeeId) {
          const employee = await tx.employee.findFirst({
            where: { id: attendanceEmployeeId, companyId },
          });
          if (!employee) {
            throw new Error("Employee not found");
          }
          const shiftIds = await tx.shift.findMany({
            where: { companyId, employeeId: attendanceEmployeeId },
            select: { id: true },
          });
          const ids = shiftIds.map((s) => s.id);
          if (ids.length > 0) {
            await tx.attendance.deleteMany({ where: { shiftId: { in: ids } } });
            await tx.shift.updateMany({
              where: { id: { in: ids } },
              data: { status: "assigned" },
            });
          }
        } else {
          await tx.attendance.deleteMany({
            where: { shift: { companyId } },
          });
          await tx.shift.updateMany({
            where: { companyId, status: { in: ["active", "completed", "verified"] } },
            data: { status: "assigned" },
          });
        }
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
          await tx.deductionRule.create({
            data: {
              companyId,
              name: dr.name,
              type: dr.type,
              rate: dr.type === "percentage" ? dr.rate : null,
              amount: dr.type === "fixed" ? dr.amount : null,
              appliesTo: dr.appliesTo,
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
        settings: true,
      },
    });

    return reply.send(updated);
  });
}
