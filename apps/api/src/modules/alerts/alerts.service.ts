import type {
  AlertPriority,
  AlertSourceModule,
  AlertStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { notifyModuleUsers } from "../notifications/notifications.service.js";
import type { ListAlertsQuery } from "./alerts.schemas.js";

const MODULE_PATH_BY_SOURCE: Partial<Record<AlertSourceModule, string>> = {
  ATTENDANCE: "/attendance",
  TASKS: "/tasks",
  INCIDENTS: "/incidents",
  SITES: "/sites",
  DOCUMENTS: "/documents",
  APPROVALS: "/approvals",
  PAYROLL: "/payroll",
  ROSTERING: "/rostering",
};

function alertLinkUrl(sourceModule: AlertSourceModule, sourceId?: string | null, siteId?: string | null): string | undefined {
  switch (sourceModule) {
    case "ATTENDANCE":
      return "/attendance/exceptions";
    case "TASKS":
      return sourceId ? `/tasks/${sourceId}` : "/tasks";
    case "INCIDENTS":
      return sourceId ? `/incidents/${sourceId}` : "/incidents";
    case "SITES":
      return siteId ? `/sites/${siteId}` : "/sites";
    case "DOCUMENTS":
      return "/documents";
    case "APPROVALS":
      return "/approvals";
    case "PAYROLL":
      return "/payroll";
    default:
      return undefined;
  }
}

export type UpsertAlertInput = {
  companyId: string;
  title: string;
  message: string;
  priority: AlertPriority;
  sourceModule: AlertSourceModule;
  dedupeKey: string;
  sourceId?: string | null;
  siteId?: string | null;
  employeeId?: string | null;
  assignedToId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Create an operational alert, or return the existing open/acknowledged one
 * with the same dedupeKey so modules do not spam duplicates.
 */
export async function upsertAlert(input: UpsertAlertInput) {
  const existing = await prisma.operationalAlert.findFirst({
    where: {
      companyId: input.companyId,
      dedupeKey: input.dedupeKey,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  if (existing) {
    return { alert: existing, created: false as const };
  }

  try {
    const alert = await prisma.operationalAlert.create({
      data: {
        companyId: input.companyId,
        title: input.title,
        message: input.message,
        priority: input.priority,
        sourceModule: input.sourceModule,
        dedupeKey: input.dedupeKey,
        sourceId: input.sourceId ?? null,
        siteId: input.siteId ?? null,
        employeeId: input.employeeId ?? null,
        assignedToId: input.assignedToId ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        status: "OPEN",
      },
    });

    if (input.priority === "CRITICAL") {
      const modulePath = MODULE_PATH_BY_SOURCE[input.sourceModule] ?? "/";
      const linkUrl = alertLinkUrl(input.sourceModule, input.sourceId, input.siteId);
      void notifyModuleUsers({
        companyId: input.companyId,
        modulePath,
        title: input.title,
        message: input.message,
        dedupeKeyPrefix: `alert:${alert.id}`,
        sourceModule: input.sourceModule,
        sourceId: alert.id,
        linkUrl,
      }).catch(() => undefined);
    }

    return { alert, created: true as const };
  } catch (err) {
    // Race on unique (companyId, dedupeKey) — return existing
    const again = await prisma.operationalAlert.findFirst({
      where: { companyId: input.companyId, dedupeKey: input.dedupeKey },
    });
    if (again) return { alert: again, created: false as const };
    throw err;
  }
}

export async function getAlertCounts(companyId: string) {
  const openStatuses: AlertStatus[] = ["OPEN", "ACKNOWLEDGED"];
  const [critical, medium, low, allOpen, resolved] = await Promise.all([
    prisma.operationalAlert.count({
      where: { companyId, priority: "CRITICAL", status: { in: openStatuses } },
    }),
    prisma.operationalAlert.count({
      where: { companyId, priority: "MEDIUM", status: { in: openStatuses } },
    }),
    prisma.operationalAlert.count({
      where: { companyId, priority: "LOW", status: { in: openStatuses } },
    }),
    prisma.operationalAlert.count({
      where: { companyId, status: { in: openStatuses } },
    }),
    prisma.operationalAlert.count({
      where: { companyId, status: { in: ["RESOLVED", "DISMISSED"] } },
    }),
  ]);
  return { critical, medium, low, allOpen, resolved, total: allOpen };
}

export async function listAlerts(companyId: string, query: ListAlertsQuery) {
  const where: Prisma.OperationalAlertWhereInput = {
    companyId,
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.sourceModule ? { sourceModule: query.sourceModule } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
  };

  const [items, total, counts] = await Promise.all([
    prisma.operationalAlert.findMany({
      where,
      orderBy: [
        { priority: "asc" }, // CRITICAL first alphabetically? No — use custom
        { createdAt: "desc" },
      ],
      take: query.limit,
      skip: query.offset,
      include: {
        site: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.operationalAlert.count({ where }),
    getAlertCounts(companyId),
  ]);

  // Sort CRITICAL → MEDIUM → LOW then newest
  const priorityOrder: Record<AlertPriority, number> = {
    CRITICAL: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  items.sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return { items, total, counts };
}

export async function acknowledgeAlert(params: {
  companyId: string;
  alertId: string;
  userId: string;
}) {
  const alert = await prisma.operationalAlert.findFirst({
    where: { id: params.alertId, companyId: params.companyId },
  });
  if (!alert) return null;
  if (alert.status === "RESOLVED" || alert.status === "DISMISSED") return alert;

  const updated = await prisma.operationalAlert.update({
    where: { id: alert.id },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
  });
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: "alert.acknowledge",
    entityType: "OperationalAlert",
    entityId: alert.id,
    metadata: { previousStatus: alert.status },
  });
  return updated;
}

export async function resolveAlert(params: {
  companyId: string;
  alertId: string;
  userId: string;
  note?: string;
}) {
  const alert = await prisma.operationalAlert.findFirst({
    where: { id: params.alertId, companyId: params.companyId },
  });
  if (!alert) return null;

  const updated = await prisma.operationalAlert.update({
    where: { id: alert.id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedById: params.userId,
      metadata: params.note
        ? ({
            ...(typeof alert.metadata === "object" && alert.metadata
              ? (alert.metadata as object)
              : {}),
            resolveNote: params.note,
          } as Prisma.InputJsonValue)
        : undefined,
    },
  });
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: "alert.resolve",
    entityType: "OperationalAlert",
    entityId: alert.id,
    metadata: { previousStatus: alert.status, note: params.note },
  });
  return updated;
}

export async function dismissAlert(params: {
  companyId: string;
  alertId: string;
  userId: string;
}) {
  const alert = await prisma.operationalAlert.findFirst({
    where: { id: params.alertId, companyId: params.companyId },
  });
  if (!alert) return null;

  const updated = await prisma.operationalAlert.update({
    where: { id: alert.id },
    data: {
      status: "DISMISSED",
      resolvedAt: new Date(),
      resolvedById: params.userId,
    },
  });
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: "alert.dismiss",
    entityType: "OperationalAlert",
    entityId: alert.id,
    metadata: { previousStatus: alert.status },
  });
  return updated;
}
