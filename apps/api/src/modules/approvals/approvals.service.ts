import type { ApprovalStatus, ApprovalType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { createNotification } from "../notifications/notifications.service.js";
import { upsertAlert } from "../alerts/alerts.service.js";
import { applyApprovedPermissionGrants } from "../../services/user-access.service.js";

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
  reason?: string;
  payload?: Record<string, unknown>;
  riskLevel?: string;
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
      reason: params.reason,
      payload: params.payload as object | undefined,
      riskLevel: params.riskLevel ?? "MEDIUM",
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
      reason: params.reason,
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

  try {
  if (status === "APPROVED" && approval.approvalType === "ACCESS_CHANGE") {
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const targetUserId = typeof payload.targetUserId === "string" ? payload.targetUserId : approval.entityId;
    if (payload.action === "recertify") {
      await createAuditLog({ userId: params.reviewerId, companyId: params.companyId, action: "access_review.certified", entityType: "User", entityId: targetUserId, reason: approval.reason ?? params.comment, approvalRequestId: approval.id, riskLevel: "HIGH", metadata: { requestedById: approval.requestedById } });
    } else {
      const grants = Array.isArray(payload.grants) ? payload.grants : [];
      await applyApprovedPermissionGrants({
      userId: targetUserId,
      grants: grants.map((raw) => {
        const grant = raw as Record<string, unknown>;
        return {
          permission: String(grant.permission ?? ""),
          scopeType: grant.scopeType === "SITE" ? "SITE" as const : "COMPANY" as const,
          scopeId: typeof grant.scopeId === "string" ? grant.scopeId : null,
          expiresAt: typeof grant.expiresAt === "string" ? new Date(grant.expiresAt) : null,
          emergencyAccess: grant.emergencyAccess === true,
        };
      }).filter((grant) => grant.permission.length > 0),
      requestedById: approval.requestedById,
      approvedById: params.reviewerId,
      approvalRequestId: approval.id,
      reason: approval.reason ?? params.comment ?? "Approved access change",
      });
    }
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { executedAt: new Date() },
    });
  }

  if (status === "APPROVED" && approval.approvalType === "DATA_QUALITY_RESOLUTION") {
    const issue = await prisma.dataQualityIssue.findFirst({
      where: { id: approval.entityId, companyId: params.companyId },
    });
    if (issue) {
      const payload = (approval.payload ?? {}) as Record<string, unknown>;
      const proposed = (payload.proposedResolution ?? {}) as Record<string, unknown>;
      if (issue.ruleKey === "duplicate_leave_day") {
        const canonicalRecordId = typeof proposed.canonicalRecordId === "string" ? proposed.canonicalRecordId : null;
        const affected = (issue.affectedRecords ?? {}) as Record<string, unknown>;
        const recordIds = Array.isArray(affected.recordIds) ? affected.recordIds.filter((id): id is string => typeof id === "string") : [];
        if (!canonicalRecordId || !recordIds.includes(canonicalRecordId)) {
          throw new Error("A valid canonical leave record is required to resolve this issue");
        }
        await prisma.$transaction(async (tx) => {
          await tx.leaveRecord.update({
            where: { id: canonicalRecordId },
            data: { duplicateGroupKey: null, reviewedAt: new Date(), reviewedById: params.reviewerId, reviewReason: approval.reason },
          });
          await tx.leaveRecord.updateMany({
            where: { id: { in: recordIds.filter((id) => id !== canonicalRecordId) } },
            data: { voidedAt: new Date(), voidedById: params.reviewerId, voidReason: approval.reason, reviewedAt: new Date(), reviewedById: params.reviewerId, reviewReason: approval.reason },
          });
          await tx.dataQualityIssue.update({
            where: { id: issue.id },
            data: { status: "RESOLVED", reviewedAt: new Date(), reviewedById: params.reviewerId, reviewReason: approval.reason },
          });
        });
      } else {
        // Operational corrections are made in their source workflow. Independent
        // approval confirms that the reviewer has verified that correction.
        await prisma.dataQualityIssue.update({
          where: { id: issue.id },
          data: { status: "RESOLVED", reviewedAt: new Date(), reviewedById: params.reviewerId, reviewReason: approval.reason },
        });
      }
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { executedAt: new Date() } });
    }
  }

  if (status === "APPROVED" && approval.approvalType === "ROSTER_PUBLICATION") {
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const publicationId = typeof payload.publicationId === "string" ? payload.publicationId : approval.entityId;
    const publication = await prisma.rosterPublication.findFirst({ where: { id: publicationId, companyId: params.companyId } });
    if (!publication) throw new Error("Roster publication request no longer exists");
    const input = payload.publishInput as { siteId: string; startDate: string; endDate: string; replaceExisting?: boolean };
    const { publishRoster } = await import("../rosters/rosters.service.js");
    const result = await publishRoster(params.companyId, input);
    if (!result) throw new Error("Site not found while publishing approved roster");
    await prisma.rosterPublication.update({ where: { id: publication.id }, data: { status: "PUBLISHED", approvedById: params.reviewerId, publishedAt: new Date() } });
    await prisma.rosterPublication.updateMany({ where: { companyId: params.companyId, siteId: publication.siteId, periodStart: publication.periodStart, periodEnd: publication.periodEnd, id: { not: publication.id }, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { executedAt: new Date() } });
  }

  if (status === "APPROVED" && approval.approvalType === "SITE_TIMESHEET") {
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const { approveSiteTimesheet } = await import("../rosters/site-timesheets.service.js");
    const result = await approveSiteTimesheet(params.companyId, approval.entityId, params.reviewerId, {
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
      shiftType: payload.shiftType === "day" || payload.shiftType === "night" ? payload.shiftType : "all",
    });
    if (!result || "error" in result) throw new Error(!result ? "Timesheet not found" : result.error);
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { executedAt: new Date() } });
  }
  } catch (error) {
    // An approval is not complete unless its protected action succeeds. Restore
    // the request so another reviewer can retry after the underlying issue is fixed.
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: "PENDING",
        approverId: approval.approverId,
        reviewedAt: approval.reviewedAt,
        comment: approval.comment,
        executedAt: null,
      },
    });
    throw error;
  }

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
      approvalRequestId: approval.id,
      reason: params.comment ?? approval.reason ?? undefined,
      riskLevel: approval.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH",
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
