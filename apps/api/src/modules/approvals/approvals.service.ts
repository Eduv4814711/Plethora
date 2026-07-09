import type { ApprovalStatus, ApprovalType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { createNotification } from "../notifications/notifications.service.js";
import { upsertAlert } from "../alerts/alerts.service.js";

export function canSelfApprove(requestedById: string, approverId: string): boolean {
  return requestedById === approverId;
}

export async function createApprovalRequest(params: {
  companyId: string;
  approvalType: ApprovalType;
  entityType: string;
  entityId: string;
  requestedById: string;
  approverId?: string | null;
  comment?: string;
}) {
  const approval = await prisma.approvalRequest.create({
    data: {
      companyId: params.companyId,
      approvalType: params.approvalType,
      entityType: params.entityType,
      entityId: params.entityId,
      requestedById: params.requestedById,
      approverId: params.approverId ?? null,
      comment: params.comment,
      status: "PENDING",
    },
  });

  await createAuditLog({
    userId: params.requestedById,
    companyId: params.companyId,
    action: "approval.request",
    entityType: "ApprovalRequest",
    entityId: approval.id,
    metadata: {
      approvalType: params.approvalType,
      entityType: params.entityType,
      entityId: params.entityId,
    },
  });

  if (params.approverId) {
    await createNotification({
      companyId: params.companyId,
      userId: params.approverId,
      title: "Approval needed",
      message: `A ${params.approvalType.replace(/_/g, " ").toLowerCase()} needs your review.`,
      dedupeKey: `approval_request:${approval.id}`,
      sourceModule: "APPROVALS",
      sourceId: approval.id,
      linkUrl: "/approvals",
    });
  }

  await upsertAlert({
    companyId: params.companyId,
    title: "Supervisor approval pending",
    message: `${params.approvalType.replace(/_/g, " ")} awaiting review`,
    priority: "MEDIUM",
    sourceModule: "APPROVALS",
    dedupeKey: `approval_pending:${params.entityType}:${params.entityId}`,
    sourceId: approval.id,
    assignedToId: params.approverId,
  });

  return approval;
}

export async function listApprovals(
  companyId: string,
  opts?: {
    status?: ApprovalStatus;
    approvalType?: ApprovalType;
    approverId?: string;
    limit?: number;
  }
) {
  const items = await prisma.approvalRequest.findMany({
    where: {
      companyId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.approvalType ? { approvalType: opts.approvalType } : {}),
      ...(opts?.approverId ? { approverId: opts.approverId } : {}),
    },
    orderBy: { requestedAt: "desc" },
    take: opts?.limit ?? 100,
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
    },
  });
  const pendingCount = await prisma.approvalRequest.count({
    where: { companyId, status: "PENDING" },
  });
  return { items, pendingCount };
}

export async function reviewApproval(params: {
  companyId: string;
  approvalId: string;
  reviewerId: string;
  action: "approve" | "reject" | "query";
  comment?: string;
}) {
  const approval = await prisma.approvalRequest.findFirst({
    where: { id: params.approvalId, companyId: params.companyId },
  });
  if (!approval) return { error: "not_found" as const };

  if (canSelfApprove(approval.requestedById, params.reviewerId)) {
    return { error: "self_approve" as const };
  }

  if (approval.status !== "PENDING") {
    return { error: "already_reviewed" as const, approval };
  }

  const status: ApprovalStatus =
    params.action === "approve"
      ? "APPROVED"
      : params.action === "reject"
        ? "REJECTED"
        : "QUERY_RAISED";

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status,
      approverId: params.reviewerId,
      reviewedAt: new Date(),
      comment: params.comment ?? approval.comment,
    },
  });

  await createAuditLog({
    userId: params.reviewerId,
    companyId: params.companyId,
    action: `approval.${params.action}`,
    entityType: "ApprovalRequest",
    entityId: approval.id,
    metadata: {
      previousStatus: approval.status,
      comment: params.comment,
      entityType: approval.entityType,
      entityId: approval.entityId,
    },
  });

  await createNotification({
    companyId: params.companyId,
    userId: approval.requestedById,
    title:
      params.action === "approve"
        ? "Approval approved"
        : params.action === "reject"
          ? "Approval rejected"
          : "Query raised on approval",
    message:
      params.comment ??
      `Your ${approval.approvalType.replace(/_/g, " ").toLowerCase()} was ${status.toLowerCase().replace(/_/g, " ")}.`,
    dedupeKey: `approval_result:${approval.id}:${status}`,
    sourceModule: "APPROVALS",
    sourceId: approval.id,
    linkUrl: "/approvals",
  });

  await prisma.operationalAlert.updateMany({
    where: {
      companyId: params.companyId,
      sourceId: approval.id,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedById: params.reviewerId,
    },
  });

  return { approval: updated };
}
