import { prisma } from "../../lib/prisma.js";
import { normalizeWhatsAppPhone } from "../../lib/phone.js";
import { sendText } from "./send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { operationalEventBus } from "../../lib/events.js";
import { format } from "date-fns";

export interface SupervisorEscalationParams {
  companyId: string;
  siteId?: string | null;
  guardName: string;
  guardPhone: string;
  reason?: string | null;
  refCode?: string | null;
  incidentId?: string | null;
  severity?: string | null;
}

export interface SupervisorEscalationResult {
  dispatched: boolean;
  recipient?: string;
  refCode: string;
  supervisorName?: string;
  reason?: string;
}

export async function resolveSupervisorPhone(
  companyId: string,
  siteId?: string | null
): Promise<{ phone: string | null; supervisorName: string | null; supervisorUserId?: string | null; supervisorEmployeeId?: string | null }> {
  // 1. Check Site's assigned supervisor
  if (siteId && prisma.site?.findUnique) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: {
        supervisorId: true,
        supervisor: { select: { id: true, name: true, email: true } },
      },
    });

    if (site?.supervisor?.email && prisma.employee?.findFirst) {
      const supervisorEmp = await prisma.employee.findFirst({
        where: {
          companyId,
          email: site.supervisor.email,
          phone: { not: null },
          status: "active",
        },
        select: { id: true, phone: true, firstName: true, lastName: true },
      });

      if (supervisorEmp?.phone) {
        const normalized = normalizeWhatsAppPhone(supervisorEmp.phone);
        if (normalized) {
          return {
            phone: normalized,
            supervisorName: `${supervisorEmp.firstName} ${supervisorEmp.lastName}`.trim(),
            supervisorUserId: site.supervisorId,
            supervisorEmployeeId: supervisorEmp.id,
          };
        }
      }
    }
  }

  // 2. Check company settings for designated supervisor / emergency phone
  const company = prisma.company?.findUnique
    ? await prisma.company.findUnique({
        where: { id: companyId },
        select: { phone: true, settings: true, ownerUserId: true },
      })
    : null;

  const settings = (company?.settings as Record<string, unknown>) ?? {};
  const settingsPhone =
    (typeof settings.designatedSupervisorPhone === "string" && settings.designatedSupervisorPhone) ||
    (typeof settings.emergencyPhone === "string" && settings.emergencyPhone) ||
    (Array.isArray(settings.designatedOfficePhones) && settings.designatedOfficePhones[0]) ||
    company?.phone;

  if (settingsPhone) {
    const normalized = normalizeWhatsAppPhone(String(settingsPhone));
    if (normalized) {
      return {
        phone: normalized,
        supervisorName: "Designated Operations Controller",
      };
    }
  }

  // 3. Fallback to company owner if registered as an employee with phone
  if (company?.ownerUserId && prisma.user?.findUnique) {
    const owner = await prisma.user.findUnique({
      where: { id: company.ownerUserId },
      select: { email: true, name: true },
    });
    if (owner?.email && prisma.employee?.findFirst) {
      const ownerEmp = await prisma.employee.findFirst({
        where: { companyId, email: owner.email, phone: { not: null } },
        select: { id: true, phone: true, firstName: true, lastName: true },
      });
      if (ownerEmp?.phone) {
        const normalized = normalizeWhatsAppPhone(ownerEmp.phone);
        if (normalized) {
          return {
            phone: normalized,
            supervisorName: owner.name,
            supervisorUserId: company.ownerUserId,
            supervisorEmployeeId: ownerEmp.id,
          };
        }
      }
    }
  }

  return { phone: null, supervisorName: null };
}

export async function dispatchSupervisorEscalation(
  params: SupervisorEscalationParams
): Promise<SupervisorEscalationResult> {
  const refCode =
    params.refCode ||
    `SUP-${format(new Date(), "yyyyMMdd")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // Look up site details if siteId provided
  let siteName = "Post Location (Field)";
  if (params.siteId && prisma.site?.findUnique) {
    const site = await prisma.site.findUnique({
      where: { id: params.siteId },
      select: { name: true },
    });
    if (site?.name) {
      siteName = site.name;
    }
  }

  const { phone: supervisorPhone, supervisorName, supervisorUserId, supervisorEmployeeId } = await resolveSupervisorPhone(
    params.companyId,
    params.siteId
  );

  const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  const urgencyLabel = params.severity ? `[${params.severity} PRIORITY]` : "[URGENT]";

  const message =
    `🚨 *PLETHORA — SUPERVISOR ESCALATION* ${urgencyLabel}\n\n` +
    `An urgent assistance call has been triggered:\n` +
    `• *Guard*: ${params.guardName} (${params.guardPhone})\n` +
    `• *Site*: ${siteName}\n` +
    `• *Ref*: *${refCode}*\n` +
    `• *Reason*: ${params.reason || "Guard requested immediate supervisor assistance"}\n` +
    `• *Time*: ${timestamp}\n\n` +
    `👉 Please contact the guard directly or log in to the Plethora Control Room.`;

  // Always emit to real-time Control Room event bus
  operationalEventBus.broadcast("SUPERVISOR_ESCALATION", params.companyId, {
    refCode,
    guardName: params.guardName,
    guardPhone: params.guardPhone,
    siteId: params.siteId,
    siteName,
    reason: params.reason,
    supervisorName,
    supervisorPhone,
    timestamp,
    incidentId: params.incidentId,
  });

  if (!supervisorPhone) {
    console.warn(`[Supervisor Escalation] No valid phone found for supervisor of site ${params.siteId ?? "unspecified"}`);
    return {
      dispatched: false,
      refCode,
      reason: "No supervisor phone configured for site or company",
    };
  }

  try {
    await sendText(supervisorPhone, message);

    // Record outbound communication in WhatsAppMessage table
    if (prisma.whatsAppMessage?.create) {
      let targetEmpId = supervisorEmployeeId;
      if (!targetEmpId && supervisorPhone && prisma.employee?.findFirst) {
        const emp = await prisma.employee.findFirst({
          where: { companyId: params.companyId, phone: { contains: supervisorPhone.slice(-9) } },
          select: { id: true },
        });
        targetEmpId = emp?.id;
      }
      if (!targetEmpId && prisma.employee?.findFirst) {
        const emp = await prisma.employee.findFirst({
          where: { companyId: params.companyId },
          select: { id: true },
        });
        targetEmpId = emp?.id;
      }

      if (targetEmpId) {
        await prisma.whatsAppMessage.create({
          data: {
            companyId: params.companyId,
            employeeId: targetEmpId,
            whatsappMessageId: `outbound_sup_${Date.now()}_${refCode}`,
            direction: "outbound",
            type: "text",
            text: message,
          },
        }).catch((err) => console.warn("[Escalation Message Log Error]", err));
      }
    }

    // Audit log
    await createAuditLog({
      companyId: params.companyId,
      action: "whatsapp.supervisor_escalation_dispatched",
      entityType: "Site",
      entityId: params.siteId || params.companyId,
      metadata: {
        refCode,
        guardName: params.guardName,
        guardPhone: params.guardPhone,
        supervisorPhone,
        supervisorName,
        supervisorUserId,
        siteName,
        reason: params.reason,
      },
    }).catch(() => undefined);

    return {
      dispatched: true,
      recipient: supervisorPhone,
      refCode,
      supervisorName: supervisorName || undefined,
    };
  } catch (err) {
    console.error("[Supervisor Escalation Dispatch Error]", err);
    return {
      dispatched: false,
      refCode,
      recipient: supervisorPhone,
      reason: err instanceof Error ? err.message : "Failed to dispatch WhatsApp message",
    };
  }
}
