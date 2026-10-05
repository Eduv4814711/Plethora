import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  aggregateShiftRollCall,
  dispatchShiftRollCall,
  resolveDesignatedOfficePhones,
} from "../services/shift-roll-call.service.js";

const rollCallQuerySchema = z.object({
  shiftType: z.enum(["day", "night", "all"]).optional(),
  date: z.string().optional(),
  siteId: z.string().optional(),
});

const rollCallDispatchSchema = z.object({
  shiftType: z.enum(["day", "night", "all"]).optional(),
  date: z.string().optional(),
  siteId: z.string().optional(),
  overrideRecipients: z.array(z.string()).optional(),
});

const recipientsUpdateSchema = z.object({
  designatedOfficePhones: z.array(z.string()).min(0),
});

export async function rollCallRoutes(app: FastifyInstance) {
  const protectRead = [
    authMiddleware,
    requireCrudCapability({ module: "/attendance" }),
  ];

  const protectDispatch = [
    authMiddleware,
    requireCapability("/attendance", "edit"),
  ];

  // 1. Preview Roll-Call summary and configured recipients
  app.get(
    "/preview",
    { preHandler: protectRead },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user!.companyId;
      const parsed = rollCallQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation error", details: parsed.error.issues });
      }

      const date = parsed.data.date ? new Date(parsed.data.date) : undefined;
      const [summary, recipients] = await Promise.all([
        aggregateShiftRollCall(companyId, {
          shiftType: parsed.data.shiftType,
          date,
          siteId: parsed.data.siteId,
        }),
        resolveDesignatedOfficePhones(companyId),
      ]);

      return reply.send({
        ok: true,
        summary,
        recipients,
      });
    }
  );

  // 2. Dispatch Roll-Call summary via WhatsApp
  app.post(
    "/dispatch",
    { preHandler: protectDispatch },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user!.companyId;
      const parsed = rollCallDispatchSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation error", details: parsed.error.issues });
      }

      const date = parsed.data.date ? new Date(parsed.data.date) : undefined;
      const result = await dispatchShiftRollCall(companyId, {
        shiftType: parsed.data.shiftType,
        siteId: parsed.data.siteId,
        overrideRecipients: parsed.data.overrideRecipients,
      });

      return reply.send(result);
    }
  );

  // 3. Get designated office phone recipients
  app.get(
    "/recipients",
    { preHandler: protectRead },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user!.companyId;
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true, phone: true },
      });

      const settings = (company?.settings as Record<string, unknown>) ?? {};
      const configured: string[] = Array.isArray(settings.designatedOfficePhones)
        ? (settings.designatedOfficePhones as string[])
        : typeof settings.designatedOfficePhones === "string"
        ? (settings.designatedOfficePhones as string).split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const activePhones = await resolveDesignatedOfficePhones(companyId);

      return reply.send({
        ok: true,
        configured,
        activePhones,
        companyPhone: company?.phone || null,
      });
    }
  );

  // 4. Update designated office phone recipients
  app.put(
    "/recipients",
    { preHandler: protectDispatch },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user!.companyId;
      const parsed = recipientsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation error", details: parsed.error.issues });
      }

      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });

      const currentSettings = (company?.settings as Record<string, unknown>) ?? {};
      currentSettings.designatedOfficePhones = parsed.data.designatedOfficePhones;

      await prisma.company.update({
        where: { id: companyId },
        data: { settings: currentSettings as unknown as Prisma.InputJsonObject },
      });

      const activePhones = await resolveDesignatedOfficePhones(companyId);

      return reply.send({
        ok: true,
        designatedOfficePhones: parsed.data.designatedOfficePhones,
        activePhones,
      });
    }
  );
}
