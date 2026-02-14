import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
});

const businessSettingsSchema = z.object({
  currency: z.string().optional(),
  dateFormat: z.string().optional(),
  timezone: z.string().optional(),
  payrollPeriod: z.enum(["weekly", "biweekly", "monthly"]).optional(),
});

const themeSchema = z.object({
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  mode: z.enum(["light", "dark", "system"]).optional(),
});

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  businessDetails: businessDetailsSchema.optional(),
  businessSettings: businessSettingsSchema.optional(),
  theme: themeSchema.optional(),
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
        settings: true,
        theme: true,
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
    }
    if (data.businessSettings !== undefined) {
      updateData.settings = data.businessSettings;
    }
    if (data.theme !== undefined) {
      updateData.theme = data.theme;
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
        settings: true,
        theme: true,
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
}
