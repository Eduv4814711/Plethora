import { createAuditLog } from "../../lib/audit.js";
import { upsertAlert } from "../../modules/alerts/alerts.service.js";
import { prisma } from "../../lib/prisma.js";
import { sessionManager } from "./session.service.js";
import {
  dispatchSupervisorEscalation,
  type SupervisorEscalationResult,
} from "./supervisor-escalation.service.js";
import { format } from "date-fns";

export async function handleSupervisorHandoff(
  from: string,
  employeeId: string,
  companyId: string,
  reason?: string
): Promise<{ reply: string }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });

  const empName = employee ? `${employee.firstName} ${employee.lastName}` : "Employee";
  const refCode = `SUP-${format(new Date(), "yyyyMMdd")}-${employeeId.slice(-4).toUpperCase()}`;

  // Find active site if any
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId, companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { select: { siteId: true, site: { select: { name: true } } } } },
  });

  const siteId = activeAttendance?.shift.siteId;
  const siteName = activeAttendance?.shift.site?.name;

  // Create Operational Alert for control room & supervisors
  await upsertAlert({
    companyId,
    title: `🙋 WhatsApp Assistance Request: ${empName}`,
    message: `${empName} (${from}) requested supervisor assistance via WhatsApp.${siteName ? ` Location: ${siteName}.` : ""}${reason ? ` Context: ${reason}` : ""}`,
    priority: "CRITICAL",
    sourceModule: "WHATSAPP",
    dedupeKey: `whatsapp_handoff_${employeeId}_${Date.now()}`,
    siteId: siteId ?? undefined,
    employeeId,
  }).catch((err) => console.warn("[WhatsApp Handoff Alert Error]", err));

  // Automatically dispatch WhatsApp notification to supervisor's phone
  const escalationResult = await dispatchSupervisorEscalation({
    companyId,
    siteId,
    guardName: empName,
    guardPhone: from,
    reason,
    refCode,
  }).catch((err): SupervisorEscalationResult => {
    console.warn("[Supervisor Escalation Dispatch Error]", err);
    return {
      dispatched: false,
      refCode,
      reason: err instanceof Error ? err.message : "Escalation failed",
    };
  });

  // Create Audit Log
  await createAuditLog({
    companyId,
    action: "whatsapp.supervisor_handoff",
    entityType: "Employee",
    entityId: employeeId,
    metadata: {
      source: "whatsapp",
      from,
      refCode,
      reason,
      siteId,
      dispatched: escalationResult.dispatched,
      recipient: escalationResult.recipient,
    },
  });

  sessionManager.clearSession(from);

  const supervisorNotice = escalationResult.dispatched && escalationResult.supervisorName
    ? `• Supervisor: *${escalationResult.supervisorName}* (Alerted via WhatsApp)\n`
    : "";

  return {
    reply:
      `🙋 *Supervisor Assistance Requested*\n\n` +
      `Your request has been forwarded directly to the operational control room and site supervisor on duty.\n\n` +
      `• Tracking Ref: *${refCode}*\n` +
      supervisorNotice +
      `• Status: *Dispatched to Supervisor & Control Room*\n\n` +
      `A supervisor or controller will contact your phone (*${from}*) shortly.\n\n` +
      `If this is an immediate life-safety emergency, please contact 10111 or your local emergency dispatcher immediately.\n\n` +
      `Reply *menu* at any time to return to automated commands.`,
  };
}
