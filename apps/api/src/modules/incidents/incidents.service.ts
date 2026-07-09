import type { IncidentSeverity, IncidentStatus, IncidentType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { upsertAlert } from "../alerts/alerts.service.js";
import { createNotification, notifyModuleUsers } from "../notifications/notifications.service.js";
import { createApprovalRequest } from "../approvals/approvals.service.js";

function severityToAlertPriority(severity: IncidentSeverity) {
  if (severity === "CRITICAL") return "CRITICAL" as const;
  if (severity === "HIGH") return "MEDIUM" as const;
  return "LOW" as const;
}

export async function nextIncidentNumber(companyId: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `INC-${day}-`;
  const latest = await prisma.incident.findFirst({
    where: { companyId, incidentNumber: { startsWith: prefix } },
    orderBy: { incidentNumber: "desc" },
    select: { incidentNumber: true },
  });
  let seq = 1;
  if (latest?.incidentNumber) {
    const part = latest.incidentNumber.split("-").pop();
    const n = Number(part);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function createIncident(params: {
  companyId: string;
  reportedById: string;
  siteId: string;
  incidentDateTime: Date;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  peopleInvolved?: string;
  witnesses?: string;
  clientVisible?: boolean;
  assignedSupervisorId?: string | null;
  followUpRequired?: boolean;
  submit?: boolean;
}) {
  const site = await prisma.site.findFirst({
    where: { id: params.siteId, companyId: params.companyId },
  });
  if (!site) return { error: "site_not_found" as const };

  const incidentNumber = await nextIncidentNumber(params.companyId);
  const status: IncidentStatus = params.submit ? "SUBMITTED" : "DRAFT";

  const incident = await prisma.incident.create({
    data: {
      companyId: params.companyId,
      incidentNumber,
      siteId: params.siteId,
      reportedById: params.reportedById,
      assignedSupervisorId: params.assignedSupervisorId ?? site.supervisorId,
      incidentDateTime: params.incidentDateTime,
      incidentType: params.incidentType,
      severity: params.severity,
      title: params.title,
      description: params.description,
      peopleInvolved: params.peopleInvolved,
      witnesses: params.witnesses,
      clientVisible: params.clientVisible ?? false,
      followUpRequired: params.followUpRequired ?? false,
      status,
      supervisorApprovalStatus: "PENDING",
    },
    include: {
      site: { select: { id: true, name: true } },
      reportedBy: { select: { id: true, name: true } },
    },
  });

  await createAuditLog({
    userId: params.reportedById,
    companyId: params.companyId,
    action: params.submit ? "incident.submit" : "incident.create",
    entityType: "Incident",
    entityId: incident.id,
    metadata: { incidentNumber, severity: params.severity },
  });

  if (params.submit) {
    await onIncidentSubmitted({
      ...incident,
      reportedById: params.reportedById,
    });
  }

  return { incident };
}

async function onIncidentSubmitted(incident: {
  id: string;
  companyId: string;
  title: string;
  severity: IncidentSeverity;
  siteId: string;
  assignedSupervisorId: string | null;
  incidentNumber: string;
  reportedById: string;
}) {
  if (incident.severity === "CRITICAL" || incident.severity === "HIGH") {
    await upsertAlert({
      companyId: incident.companyId,
      title:
        incident.severity === "CRITICAL"
          ? "High-risk incident submitted"
          : "Incident submitted",
      message: `${incident.incidentNumber}: ${incident.title}`,
      priority: severityToAlertPriority(incident.severity),
      sourceModule: "INCIDENTS",
      dedupeKey: `incident_submitted:${incident.id}`,
      sourceId: incident.id,
      siteId: incident.siteId,
      assignedToId: incident.assignedSupervisorId,
    });
  }

  await notifyModuleUsers({
    companyId: incident.companyId,
    modulePath: "/incidents",
    title: "Incident submitted",
    message: `${incident.incidentNumber}: ${incident.title}`,
    dedupeKeyPrefix: `incident_notify:${incident.id}`,
    sourceModule: "INCIDENTS",
    sourceId: incident.id,
    linkUrl: `/incidents/${incident.id}`,
  });

  if (incident.assignedSupervisorId && incident.assignedSupervisorId !== incident.reportedById) {
    await createApprovalRequest({
      companyId: incident.companyId,
      approvalType: "INCIDENT",
      entityType: "Incident",
      entityId: incident.id,
      requestedById: incident.reportedById,
      approverId: incident.assignedSupervisorId,
      comment: `Review incident ${incident.incidentNumber}`,
    }).catch(() => undefined);
  }
}

export async function listIncidents(
  companyId: string,
  query: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    siteId?: string;
    incidentType?: IncidentType;
    clientVisible?: boolean;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }
) {
  const where: Prisma.IncidentWhereInput = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.incidentType ? { incidentType: query.incidentType } : {}),
    ...(query.clientVisible != null ? { clientVisible: query.clientVisible } : {}),
    ...(query.from || query.to
      ? {
          incidentDateTime: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      orderBy: [{ severity: "asc" }, { incidentDateTime: "desc" }],
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      include: {
        site: { select: { id: true, name: true } },
        reportedBy: { select: { id: true, name: true } },
        assignedSupervisor: { select: { id: true, name: true } },
      },
    }),
    prisma.incident.count({ where }),
  ]);
  return { items, total };
}

export async function getIncident(companyId: string, id: string) {
  return prisma.incident.findFirst({
    where: { id, companyId },
    include: {
      site: { select: { id: true, name: true, clientId: true } },
      reportedBy: { select: { id: true, name: true } },
      assignedSupervisor: { select: { id: true, name: true } },
      attachments: true,
      followUpTask: { select: { id: true, title: true, status: true } },
    },
  });
}

export async function reviewIncident(params: {
  companyId: string;
  incidentId: string;
  reviewerId: string;
  action: "approve" | "reject" | "query" | "close" | "submit";
  note?: string;
  createFollowUpTask?: boolean;
}) {
  const incident = await prisma.incident.findFirst({
    where: { id: params.incidentId, companyId: params.companyId },
  });
  if (!incident) return { error: "not_found" as const };

  let data: Prisma.IncidentUpdateInput = {};
  if (params.action === "submit") {
    data = { status: "SUBMITTED", supervisorApprovalStatus: "PENDING" };
  } else if (params.action === "approve") {
    data = {
      status: "APPROVED",
      supervisorApprovalStatus: "APPROVED",
      supervisorNote: params.note,
    };
  } else if (params.action === "reject") {
    data = {
      status: "REJECTED",
      supervisorApprovalStatus: "REJECTED",
      supervisorNote: params.note,
    };
  } else if (params.action === "query") {
    data = {
      status: "UNDER_REVIEW",
      supervisorApprovalStatus: "QUERY_RAISED",
      supervisorNote: params.note,
    };
  } else if (params.action === "close") {
    data = { status: "CLOSED", closedAt: new Date(), supervisorNote: params.note };
  }

  let followUpTaskId: string | undefined;
  if (params.createFollowUpTask || (params.action === "approve" && incident.followUpRequired)) {
    const task = await prisma.task.create({
      data: {
        companyId: params.companyId,
        title: `Follow-up: ${incident.title}`,
        description: `Follow-up for incident ${incident.incidentNumber}`,
        status: "todo",
        priority: incident.severity === "CRITICAL" ? "critical" : "high",
        siteId: incident.siteId,
        createdById: params.reviewerId,
        assigneeType: "user",
        assigneeId: incident.assignedSupervisorId ?? params.reviewerId,
      },
    });
    followUpTaskId = task.id;
    data.followUpTask = { connect: { id: task.id } };
    data.followUpRequired = true;
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data,
  });

  await createAuditLog({
    userId: params.reviewerId,
    companyId: params.companyId,
    action: `incident.${params.action}`,
    entityType: "Incident",
    entityId: incident.id,
    metadata: { note: params.note, followUpTaskId },
  });

  if (params.action === "submit") {
    await onIncidentSubmitted({
      id: updated.id,
      companyId: updated.companyId,
      title: updated.title,
      severity: updated.severity,
      siteId: updated.siteId,
      assignedSupervisorId: updated.assignedSupervisorId,
      incidentNumber: updated.incidentNumber,
      reportedById: incident.reportedById,
    });
  }

  await createNotification({
    companyId: params.companyId,
    userId: incident.reportedById,
    title: `Incident ${params.action}`,
    message: `${incident.incidentNumber} was ${params.action}${params.note ? `: ${params.note}` : ""}`,
    dedupeKey: `incident_${params.action}:${incident.id}`,
    sourceModule: "INCIDENTS",
    sourceId: incident.id,
    linkUrl: `/incidents/${incident.id}`,
  });

  return { incident: updated, followUpTaskId };
}

export async function updateIncident(params: {
  companyId: string;
  incidentId: string;
  userId: string;
  data: {
    title?: string;
    description?: string;
    peopleInvolved?: string | null;
    witnesses?: string | null;
    clientVisible?: boolean;
    followUpRequired?: boolean;
    severity?: IncidentSeverity;
    incidentType?: IncidentType;
  };
}) {
  const incident = await prisma.incident.findFirst({
    where: { id: params.incidentId, companyId: params.companyId },
  });
  if (!incident) return { error: "not_found" as const };
  if (incident.status !== "DRAFT") return { error: "not_editable" as const };

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: params.data,
  });

  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: "incident.update",
    entityType: "Incident",
    entityId: incident.id,
  });

  return { incident: updated };
}
