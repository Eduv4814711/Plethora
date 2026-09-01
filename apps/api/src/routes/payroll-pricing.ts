import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  activateSitePricing,
  getSitePricingReadiness,
} from "../services/payroll-pricing.service.js";
import { parsePayrollSettings } from "../lib/payroll-settings.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const namedCatalogItem = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
const updateCatalogItem = namedCatalogItem.partial();
const rateSchema = z.object({
  areaId: z.string().min(1),
  gradeId: z.string().min(1),
  hourlyRate: z.number().positive().max(1_000_000),
  effectiveFrom: dateOnly,
});
const homeSiteSchema = z.object({
  siteId: z.string().min(1),
  effectiveFrom: dateOnly,
});

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function duplicateName(
  model: "area" | "grade",
  companyId: string,
  name: string,
  excludeId?: string
) {
  const where = {
    companyId,
    name: { equals: name, mode: "insensitive" as const },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
  return model === "area"
    ? prisma.payArea.findFirst({ where, select: { id: true } })
    : prisma.payGradeDefinition.findFirst({ where, select: { id: true } });
}

export async function payrollPricingRoutes(app: FastifyInstance) {
  const readProtect = [
    authMiddleware,
    requireCrudCapability({ anyOfModules: ["/payroll", "/sites", "/employees"] }),
  ];
  const payrollProtect = [authMiddleware, requireCrudCapability({ module: "/payroll" })];
  const activateProtect = [authMiddleware, requireCapability("/payroll", "edit")];

  app.get("/catalog", { preHandler: readProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const [company, areas, grades, rates] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }),
      prisma.payArea.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.payGradeDefinition.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.payAreaGradeRate.findMany({
        where: { companyId },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return reply.send({
      rateSource: parsePayrollSettings(company.settings).rateSource,
      areas,
      grades,
      rates,
    });
  });

  app.post("/areas", { preHandler: payrollProtect }, async (request, reply) => {
    const parsed = namedCatalogItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    if (await duplicateName("area", companyId, parsed.data.name)) {
      return reply.code(409).send({ error: "Duplicate Area", message: "An Area with this name already exists." });
    }
    const area = await prisma.payArea.create({ data: { companyId, ...parsed.data } });
    await createAuditLog({ userId: request.user!.sub, companyId, action: "pay_area.create", entityType: "pay_area", entityId: area.id });
    return reply.code(201).send(area);
  });

  app.put("/areas/:id", { preHandler: payrollProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCatalogItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    const existing = await prisma.payArea.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Area not found" });
    if (parsed.data.name && await duplicateName("area", companyId, parsed.data.name, id)) {
      return reply.code(409).send({ error: "Duplicate Area", message: "An Area with this name already exists." });
    }
    const area = await prisma.payArea.update({ where: { id }, data: parsed.data });
    await createAuditLog({ userId: request.user!.sub, companyId, action: "pay_area.update", entityType: "pay_area", entityId: id });
    return reply.send(area);
  });

  app.post("/grades", { preHandler: payrollProtect }, async (request, reply) => {
    const parsed = namedCatalogItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    if (await duplicateName("grade", companyId, parsed.data.name)) {
      return reply.code(409).send({ error: "Duplicate Grade", message: "A Grade with this name already exists." });
    }
    const grade = await prisma.payGradeDefinition.create({ data: { companyId, ...parsed.data } });
    await createAuditLog({ userId: request.user!.sub, companyId, action: "pay_grade_definition.create", entityType: "pay_grade_definition", entityId: grade.id });
    return reply.code(201).send(grade);
  });

  app.put("/grades/:id", { preHandler: payrollProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCatalogItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    const existing = await prisma.payGradeDefinition.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Grade not found" });
    if (parsed.data.name && await duplicateName("grade", companyId, parsed.data.name, id)) {
      return reply.code(409).send({ error: "Duplicate Grade", message: "A Grade with this name already exists." });
    }
    const grade = await prisma.payGradeDefinition.update({ where: { id }, data: parsed.data });
    await createAuditLog({ userId: request.user!.sub, companyId, action: "pay_grade_definition.update", entityType: "pay_grade_definition", entityId: id });
    return reply.send(grade);
  });

  app.post("/rates", { preHandler: payrollProtect }, async (request, reply) => {
    const parsed = rateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    const [area, grade] = await Promise.all([
      prisma.payArea.findFirst({ where: { id: parsed.data.areaId, companyId } }),
      prisma.payGradeDefinition.findFirst({ where: { id: parsed.data.gradeId, companyId } }),
    ]);
    if (!area || !grade) return reply.code(404).send({ error: "Area or Grade not found" });
    const effectiveFrom = parseDateOnly(parsed.data.effectiveFrom);
    const rate = await prisma.payAreaGradeRate.upsert({
      where: { areaId_gradeId_effectiveFrom: { areaId: area.id, gradeId: grade.id, effectiveFrom } },
      create: { companyId, areaId: area.id, gradeId: grade.id, hourlyRate: parsed.data.hourlyRate, effectiveFrom },
      update: { hourlyRate: parsed.data.hourlyRate },
    });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_area_grade_rate.set",
      entityType: "pay_area_grade_rate",
      entityId: rate.id,
      metadata: { areaId: area.id, gradeId: grade.id, effectiveFrom: parsed.data.effectiveFrom },
    });
    return reply.code(201).send(rate);
  });

  app.get("/readiness", { preHandler: payrollProtect }, async (request, reply) => {
    return reply.send(await getSitePricingReadiness(request.user!.companyId));
  });

  app.post("/activate", { preHandler: activateProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const readiness = await activateSitePricing(companyId);
    if (!readiness.ready) {
      return reply.code(409).send({
        error: "Site pricing is not ready",
        message: "Complete every item in payroll pricing readiness before activation.",
        readiness,
      });
    }
    await createAuditLog({ userId: request.user!.sub, companyId, action: "payroll_site_pricing.activate", entityType: "company", entityId: companyId });
    return reply.send(readiness);
  });

  app.put("/employees/:employeeId/home-site", { preHandler: payrollProtect }, async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string };
    const parsed = homeSiteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const companyId = request.user!.companyId;
    const effectiveFrom = parseDateOnly(parsed.data.effectiveFrom);
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true,
        siteAssignments: {
          where: {
            siteId: parsed.data.siteId,
            isActive: true,
            OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveFrom } }],
            AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] }],
          },
          select: { id: true },
        },
      },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    if (employee.siteAssignments.length === 0) {
      return reply.code(400).send({ error: "Invalid primary site", message: "The employee must have an active assignment to this site." });
    }
    const home = await prisma.employeePayrollHomeSite.upsert({
      where: { employeeId_effectiveFrom: { employeeId, effectiveFrom } },
      create: { companyId, employeeId, siteId: parsed.data.siteId, effectiveFrom },
      update: { siteId: parsed.data.siteId },
    });
    await createAuditLog({ userId: request.user!.sub, companyId, action: "employee_payroll_home_site.set", entityType: "employee", entityId: employeeId, metadata: { siteId: parsed.data.siteId, effectiveFrom: parsed.data.effectiveFrom } });
    return reply.send(home);
  });
}
