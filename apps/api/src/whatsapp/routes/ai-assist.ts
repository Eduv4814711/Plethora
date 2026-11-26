import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";
import { createAuditLog } from "../../lib/audit.js";
import { chatWithLlm } from "../../services/ai/llm-client.js";
import {
  buildEmployeeOperationalSnapshot,
  type EmployeeOperationalSnapshot,
} from "../services/whatsapp-assistant.service.js";

const aiAssistSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("suggest"),
    employeeId: z.string().min(1, "Employee ID is required"),
  }),
  z.object({
    mode: z.literal("polish"),
    employeeId: z.string().min(1, "Employee ID is required"),
    draft: z.string().trim().min(2, "Draft is too short").max(2000, "Draft is too long"),
  }),
]);

const suggestResponseSchema = z.object({
  summary: z.string().min(1).max(600),
  suggestions: z.array(z.string().min(2).max(500)).min(1).max(4),
});

function buildDeterministicSuggestions(
  firstName: string,
  snapshot: EmployeeOperationalSnapshot,
  lastInboundText?: string | null
): { summary: string; suggestions: string[] } {
  const nextShift = snapshot.upcomingShifts[0];
  const dutySummary = snapshot.activeDuty.clockedIn
    ? `Clocked in at ${snapshot.activeDuty.siteName} since ${snapshot.activeDuty.clockedInAt}.`
    : nextShift
      ? `Off duty; next shift ${nextShift.date} (${nextShift.startTime}-${nextShift.endTime}) at ${nextShift.site}.`
      : "Off duty with no shifts scheduled in the next 30 days.";

  const summary = lastInboundText
    ? `${dutySummary} Latest message: "${lastInboundText.slice(0, 120)}".`
    : dutySummary;

  const suggestions: string[] = [];
  if (snapshot.activeDuty.clockedIn) {
    suggestions.push(
      `Hi ${firstName}, Control Room received your message. Please confirm everything is secure at ${snapshot.activeDuty.siteName}.`
    );
  } else if (nextShift) {
    suggestions.push(
      `Hi ${firstName}, reminder: your next shift is ${nextShift.date} (${nextShift.startTime}-${nextShift.endTime}) at ${nextShift.site}. Reply 1 when on site to clock in.`
    );
  } else {
    suggestions.push(
      `Hi ${firstName}, Control Room here. How can we assist you today? Reply menu anytime for self-service options.`
    );
  }

  suggestions.push(
    `Hi ${firstName}, we have noted your update and logged it with operations. A supervisor will follow up shortly.`
  );
  suggestions.push(
    `Hi ${firstName}, please reply 4 to receive your latest PDF duty roster or 6 to check your current operational status.`
  );

  return { summary, suggestions: suggestions.slice(0, 3) };
}

export async function aiAssistRoutes(app: FastifyInstance): Promise<void> {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.post("/ai-assist", { preHandler: protect }, async (request, reply) => {
    const parsed = aiAssistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        message: parsed.error.issues[0]?.message ?? "Invalid AI assist payload",
      });
    }

    const companyId = request.user!.companyId;
    const actorUserId = request.user!.sub;
    const payload = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { id: payload.employeeId, companyId },
      select: {
        id: true,
        companyId: true,
        firstName: true,
        lastName: true,
        employeeType: true,
        jobRole: true,
        ordinaryHours: true,
        ordinaryDays: true,
      },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    if (payload.mode === "polish") {
      let polished = payload.draft;
      let aiUsed = false;

      if (env.ai.enabled) {
        const aiResult = await chatWithLlm({
          temperature: 0.2,
          maxTokens: 320,
          messages: [
            {
              role: "system",
              content: [
                "Rewrite the security control room / HR operator's rough draft into a clear, respectful, concise WhatsApp message in plain English.",
                `Address the employee as ${employee.firstName} if natural.`,
                "Do not add facts, times, sites, or promises that are not in the draft. Output ONLY the rewritten message text.",
              ].join("\n"),
            },
            { role: "user", content: payload.draft },
          ],
        });
        if (aiResult?.content) {
          polished = aiResult.content.trim();
          aiUsed = true;
        }
      }

      return reply.send({
        original: payload.draft,
        polished,
        aiUsed,
      });
    }

    const [recentMessages, snapshot] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where: { companyId, employeeId: employee.id },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      buildEmployeeOperationalSnapshot(employee),
    ]);

    const chronological = [...recentMessages].reverse().map((m) => ({
      from:
        m.direction === "inbound"
          ? employee.firstName
          : m.sentByUserId
            ? "Operator"
            : "Plethora Automated",
      text: (m.text ?? "").slice(0, 300),
      at: m.createdAt.toISOString(),
    }));

    const lastInbound = recentMessages.find((m) => m.direction === "inbound")?.text ?? null;
    const fallback = buildDeterministicSuggestions(employee.firstName, snapshot, lastInbound);

    let summary = fallback.summary;
    let suggestions = fallback.suggestions;
    let aiUsed = false;

    if (env.ai.enabled) {
      const aiResult = await chatWithLlm({
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 450,
        messages: [
          {
            role: "system",
            content: [
              "You are Plethora ERP's Control Room WhatsApp Co-Pilot for a South African private security company.",
              "Given the employee's verified operational snapshot and recent WhatsApp thread, return JSON:",
              '{"summary":"1-2 sentence concise brief for the controller","suggestions":["ready-to-send reply 1","ready-to-send reply 2","ready-to-send reply 3"]}',
              "Rules:",
              "- Ground every fact strictly in the snapshot and conversation.",
              "- Each suggestion must be polite, clear, under 280 characters, and ready for a human operator to review & send.",
              "- Never claim leave or payroll was approved unless the snapshot shows APPROVED.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              snapshot,
              recentConversation: chronological,
            }),
          },
        ],
      });

      if (aiResult?.content) {
        try {
          const validated = suggestResponseSchema.safeParse(JSON.parse(aiResult.content));
          if (validated.success) {
            summary = validated.data.summary;
            suggestions = validated.data.suggestions.slice(0, 3);
            aiUsed = true;
          }
        } catch {
          // keep deterministic fallback
        }
      }
    }

    await createAuditLog({
      companyId,
      userId: actorUserId,
      action: "whatsapp.ai_assist_suggest",
      entityType: "employee",
      entityId: employee.id,
      metadata: { aiUsed, model: env.ai.model },
    }).catch(() => undefined);

    return reply.send({
      summary,
      suggestions,
      operationalSnapshot: {
        activeDuty: snapshot.activeDuty,
        nextShift: snapshot.upcomingShifts[0] ?? null,
        recentLeaveRequests: snapshot.recentLeaveRequests,
        compliance: snapshot.compliance,
      },
      aiUsed,
    });
  });
}
