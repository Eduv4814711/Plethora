import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireAnyCapability, requireCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { checkLlmHealth, chatWithLlm, type LlmMessage } from "../services/ai/llm-client.js";
import { polishIncidentSummary } from "../services/ai/whatsapp-intent.service.js";
import { getGuardsOnDutyNow } from "../services/dashboard-guards-on-duty.service.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import { getCurrentPayPeriod } from "../services/payroll-period.service.js";
import { getPeriodExportReadiness } from "../modules/attendance-exceptions/exceptions.service.js";
import { dateKeyInTimeZone, parseDateOnly } from "../lib/timezone.js";

const incidentPolishSchema = z.object({
  rawNotes: z.string().trim().min(5).max(2000),
});

const copilotSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(1200),
      })
    )
    .max(10)
    .optional(),
});

interface CopilotMetricsSnapshot {
  companyName: string;
  totalEmployees: number;
  activeEmployees: number;
  guardsOnDutyNow: number;
  totalSites: number;
  activeSites: number;
  totalPosts: number;
  activeClients: number;
  openIncidents: number;
  criticalIncidents: number;
  pendingLeaveRequests: number;
  onLeaveToday: number;
  pendingSiteTimesheetRows: number;
  openAttendanceExceptions: number;
  currentPayPeriod: {
    label: string;
    periodStart: string;
    periodEnd: string;
  };
  exportReadinessStatus: string;
}

function buildFallbackCopilotAnswer(question: string, s: CopilotMetricsSnapshot): string {
  const q = question.toLowerCase();

  if (q.includes("payroll") || q.includes("export") || q.includes("blocker") || q.includes("sage")) {
    const statusText =
      s.exportReadinessStatus === "READY" && s.openAttendanceExceptions === 0
        ? "Payroll export is currently clear for the active cycle."
        : `Payroll export is currently marked ${s.exportReadinessStatus} with ${s.openAttendanceExceptions} open attendance exception(s) and ${s.pendingSiteTimesheetRows} unconfirmed shift row(s).`;
    return `${statusText} Active pay period: ${s.currentPayPeriod.label} (${s.currentPayPeriod.periodStart} to ${s.currentPayPeriod.periodEnd}). Review Attendance & Exceptions before locking Sage/CSV export.`;
  }

  if (q.includes("attendance") || q.includes("shift") || q.includes("duty") || q.includes("confirm")) {
    return `${s.guardsOnDutyNow} guard(s) are currently on duty across ${s.activeSites} active site(s) (${s.totalPosts} active posts). There are ${s.pendingSiteTimesheetRows} unconfirmed attendance row(s) and ${s.openAttendanceExceptions} open attendance exception(s).`;
  }

  if (q.includes("incident") || q.includes("alert") || q.includes("risk") || q.includes("summar")) {
    const risks: string[] = [];
    if (s.criticalIncidents > 0) risks.push(`${s.criticalIncidents} critical incident(s)`);
    if (s.openIncidents > 0) risks.push(`${s.openIncidents} open incident(s) total`);
    if (s.pendingSiteTimesheetRows > 0) risks.push(`${s.pendingSiteTimesheetRows} unconfirmed attendance row(s)`);
    if (s.openAttendanceExceptions > 0) risks.push(`${s.openAttendanceExceptions} open attendance exception(s)`);
    if (s.pendingLeaveRequests > 0) risks.push(`${s.pendingLeaveRequests} pending leave request(s)`);
    const summaryLine =
      risks.length > 0 ? `Key items needing attention: ${risks.join(", ")}.` : "No open operational blockers detected right now.";
    return `${summaryLine} Workforce: ${s.guardsOnDutyNow} on duty out of ${s.activeEmployees} active staff (${s.onLeaveToday} on approved leave today) across ${s.activeSites} active sites and ${s.activeClients} active clients.`;
  }

  if (q.includes("leave") || q.includes("staff") || q.includes("employee") || q.includes("workforce")) {
    return `${s.companyName} has ${s.totalEmployees} total employees (${s.activeEmployees} active, ${s.guardsOnDutyNow} on duty now, ${s.onLeaveToday} on approved leave today) with ${s.pendingLeaveRequests} pending leave request(s) awaiting approval.`;
  }

  return `${s.companyName} live snapshot: ${s.guardsOnDutyNow} on duty across ${s.activeSites} active site(s) and ${s.totalPosts} post(s); ${s.pendingSiteTimesheetRows} unconfirmed shift row(s), ${s.openAttendanceExceptions} open exception(s), ${s.openIncidents} open incident(s), and ${s.pendingLeaveRequests} pending leave request(s) in ${s.currentPayPeriod.label}.`;
}

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
    { preHandler: [authMiddleware, requireAnyCapability(["/", "/dashboard"], "view")] },
    async (request, reply) => {
      const parsed = copilotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request", message: "question is required (2-1000 chars)" });
      }

      const companyId = request.user!.companyId;
      const now = new Date();
      const companyRow = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, settings: true },
      });
      const companySettings = (companyRow?.settings as Record<string, unknown>) ?? {};
      const timeZone =
        (typeof companySettings.timezone === "string" && companySettings.timezone.trim()) ||
        "Africa/Johannesburg";
      const todayKey = dateKeyInTimeZone(now, timeZone);
      const todayDateOnly = parseDateOnly(todayKey);
      const payPeriod = getCurrentPayPeriod(parsePayrollCalendarSettings(companyRow?.settings));

      const [
        totalEmployees,
        activeEmployees,
        guardsOnDutyNow,
        totalSites,
        activeSites,
        totalPosts,
        activeClients,
        openIncidents,
        criticalIncidents,
        pendingLeaveRequests,
        onLeaveToday,
        pendingSiteTimesheetRows,
        exportReadiness,
      ] = await Promise.all([
        prisma.employee.count({ where: { companyId } }),
        prisma.employee.count({ where: { companyId, status: "active" } }),
        getGuardsOnDutyNow(companyId, now),
        prisma.site.count({ where: { companyId } }),
        prisma.site.count({ where: { companyId, siteStatus: "ACTIVE" } }),
        prisma.sitePost.count({ where: { isActive: true, site: { companyId } } }),
        prisma.client.count({ where: { companyId, isActive: true } }),
        prisma.incident.count({
          where: { companyId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
        }),
        prisma.incident.count({
          where: { companyId, severity: "CRITICAL", status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
        }),
        prisma.leaveRequest.count({ where: { companyId, status: "PENDING" } }),
        prisma.leaveRequest.count({
          where: {
            companyId,
            status: "APPROVED",
            startDate: { lte: todayDateOnly },
            endDate: { gte: todayDateOnly },
          },
        }),
        prisma.siteTimesheetRow.count({
          where: { companyId, approvalStatus: { in: ["pending", "partially_reviewed"] } },
        }),
        getPeriodExportReadiness(
          companyId,
          payPeriod.periodStart,
          payPeriod.periodEnd,
          payPeriod.periodKey
        ),
      ]);

      const contextSnapshot: CopilotMetricsSnapshot = {
        companyName: companyRow?.name ?? "Your company",
        totalEmployees,
        activeEmployees,
        guardsOnDutyNow,
        totalSites,
        activeSites,
        totalPosts,
        activeClients,
        openIncidents,
        criticalIncidents,
        pendingLeaveRequests,
        onLeaveToday,
        pendingSiteTimesheetRows,
        openAttendanceExceptions: exportReadiness?.openExceptions ?? 0,
        currentPayPeriod: {
          label: payPeriod.label,
          periodStart: payPeriod.periodStart.toISOString().slice(0, 10),
          periodEnd: payPeriod.periodEnd.toISOString().slice(0, 10),
        },
        exportReadinessStatus: exportReadiness?.status ?? "UNKNOWN",
      };

      const historyMessages: LlmMessage[] = (parsed.data.history ?? []).slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const aiReply = await chatWithLlm({
        temperature: 0.2,
        maxTokens: 1536,
        messages: [
          {
            role: "system",
            content:
              `You are Plethora AI, the Operations Copilot for South African private security ERP tenant "${contextSnapshot.companyName}". ` +
              `Answer concisely and practically using ONLY the verified tenant metrics below. Never invent figures, never reveal secrets, and never claim to approve attendance or run external payroll exports directly (remind users that attendance approval and audit gates must be completed in the module). Keep answers under 120 words unless a detailed breakdown is asked.\n\n` +
              `Verified Tenant Snapshot (${todayKey} ${timeZone}): ${JSON.stringify(contextSnapshot)}`,
          },
          ...historyMessages,
          {
            role: "user",
            content: parsed.data.question,
          },
        ],
      });

      return reply.send({
        answer: aiReply?.content ?? buildFallbackCopilotAnswer(parsed.data.question, contextSnapshot),
        metrics: contextSnapshot,
        aiUsed: aiReply !== null,
        model: aiReply?.model ?? null,
        provider: env.ai.provider,
        latencyMs: aiReply?.latencyMs ?? null,
      });
    }
  );
}
