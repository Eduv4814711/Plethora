import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { checkLlmHealth, chatWithLlm } from "../services/ai/llm-client.js";
import { polishIncidentSummary } from "../services/ai/whatsapp-intent.service.js";

const incidentPolishSchema = z.object({
  rawNotes: z.string().trim().min(5).max(2000),
});

const copilotSchema = z.object({
  question: z.string().trim().min(3).max(800),
});

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    { preHandler: [authMiddleware] },
    async (_request, reply) => {
      const status = await checkLlmHealth();
      return reply.send(status);
    }
  );

  app.post(
    "/incident-polish",
    { preHandler: [authMiddleware, requireCapability("/incidents", "create")] },
    async (request, reply) => {
      const parsed = incidentPolishSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request", message: "rawNotes is required (5-2000 chars)" });
      }

      const polished = await polishIncidentSummary(parsed.data.rawNotes);
      return reply.send({
        original: parsed.data.rawNotes,
        polished: polished ?? parsed.data.rawNotes,
        aiUsed: polished !== null,
      });
    }
  );

  app.post(
    "/copilot",
    { preHandler: [authMiddleware, requireCapability("/dashboard", "view")] },
    async (request, reply) => {
      const parsed = copilotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request", message: "question is required (3-800 chars)" });
      }

      const companyId = request.user!.companyId;
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [activeEmployees, totalSites, openIncidents, pendingLeave, recentExceptions] =
        await Promise.all([
          prisma.employee.count({ where: { companyId, status: "active" } }),
          prisma.site.count({ where: { companyId } }),
          prisma.incident.count({
            where: { companyId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
          }),
          prisma.leaveRequest.count({ where: { companyId, status: "PENDING" } }),
          prisma.attendanceException.count({
            where: { companyId, status: "OPEN", detectedAt: { gte: dayAgo } },
          }),
        ]);

      const contextSnapshot = {
        activeEmployees,
        totalSites,
        openIncidents,
        pendingLeaveRequests: pendingLeave,
        openAttendanceExceptionsLast24h: recentExceptions,
      };

      const aiReply = await chatWithLlm({
        temperature: 0.2,
        maxTokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You are Plethora ERP's Operations Copilot for a South African security company. Answer concisely using ONLY the verified tenant metrics provided. Never invent figures or approve attendance changes.",
          },
          {
            role: "user",
            content: `Verified Metrics: ${JSON.stringify(contextSnapshot)}\n\nQuestion: ${parsed.data.question}`,
          },
        ],
      });

      return reply.send({
        answer:
          aiReply?.content ??
          `Live summary: ${activeEmployees} active employees, ${totalSites} sites, ${openIncidents} open incidents, ${pendingLeave} pending leave requests, and ${recentExceptions} open attendance exceptions in the last 24h.`,
        metrics: contextSnapshot,
        aiUsed: aiReply !== null,
      });
    }
  );
}
