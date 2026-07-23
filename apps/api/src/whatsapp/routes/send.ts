import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { prisma } from "../../lib/prisma.js";
import { sendText, sendTemplate } from "../services/send.service.js";

const MESSAGE_MAX_LENGTH = 4096;

const sendSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(MESSAGE_MAX_LENGTH, `Message must be at most ${MESSAGE_MAX_LENGTH} characters`),
});

const sendTemplateSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  templateName: z.string().min(1, "Template name is required"),
  languageCode: z.string().default("en"),
  components: z.array(z.unknown()).optional(),
});

export async function sendRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.post("/send", { preHandler: protect }, async (request, reply) => {
    const parsed = sendSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors;
      return reply.code(400).send({
        success: false,
        error: Object.values(msg)
          .flat()
          .filter(Boolean)[0] ?? "Invalid request",
      });
    }

    const { employeeId, message } = parsed.data;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, phone: true, firstName: true, lastName: true },
    });

    if (!employee) {
      return reply.code(404).send({
        success: false,
        error: "Employee not found",
      });
    }

    if (!employee.phone || !employee.phone.trim()) {
      return reply.code(400).send({
        success: false,
        error: "Employee has no phone number. Add a phone number in Team first.",
      });
    }

    const result = await sendText(employee.phone, message);

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: result.error ?? "Failed to send message",
        requiresTemplate: result.requiresTemplate ?? false,
      });
    }

    // Store outbound message
    if (result.messageId) {
      await prisma.whatsAppMessage.create({
        data: {
          companyId,
          employeeId: employee.id,
          whatsappMessageId: result.messageId,
          direction: "outbound",
          type: "text",
          text: message,
          status: "sent",
          sentByUserId: userId,
        },
      });
    }

    return reply.send({ success: true });
  });

  app.post("/send-template", { preHandler: protect }, async (request, reply) => {
    const parsed = sendTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors;
      return reply.code(400).send({
        success: false,
        error: Object.values(msg)
          .flat()
          .filter(Boolean)[0] ?? "Invalid request",
      });
    }

    const { employeeId, templateName, languageCode, components } = parsed.data;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, phone: true },
    });

    if (!employee) {
      return reply.code(404).send({
        success: false,
        error: "Employee not found",
      });
    }

    if (!employee.phone || !employee.phone.trim()) {
      return reply.code(400).send({
        success: false,
        error: "Employee has no phone number. Add a phone number in Team first.",
      });
    }

    const result = await sendTemplate(
      employee.phone,
      templateName,
      languageCode,
      components
    );

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: result.error ?? "Failed to send template",
      });
    }

    // Store outbound template message (no text body for template)
    if (result.messageId) {
      await prisma.whatsAppMessage.create({
        data: {
          companyId,
          employeeId: employee.id,
          whatsappMessageId: result.messageId,
          direction: "outbound",
          type: "template",
          text: `[Template: ${templateName}]`,
          status: "sent",
          sentByUserId: userId,
        },
      });
    }

    return reply.send({ success: true });
  });
}
