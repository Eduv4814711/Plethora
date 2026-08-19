import type { FastifyRequest } from "fastify";
import type { AccessChangeKind, AccessChangeStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { auditFromRequest } from "../lib/audit.js";
import { diffCapabilities, normalizeCapabilities } from "../lib/capabilities.js";
import { createNotification } from "../modules/notifications/notifications.service.js";
import type {
  AccessTarget,
  TxClient,
  UserCreatePayload,
  UserUpdatePayload,
} from "./user-access.service.js";

/**
 * Maker-checker for user access: an access manager proposes a change and the
 * company owner decides. Until the owner approves, the proposal lives only in
 * AccessChangeRequest — User.capabilities is untouched, so a pending request
 * grants nothing.
 */

/** Where a review sends the owner. The access desk lives in the settings tab. */
const REVIEW_LINK = "/settings?tab=users";

export type AccessChangePayload =
  | ({ kind: "CREATE_USER" } & UserCreatePayload)
  | ({ kind: "UPDATE_ACCESS" } & UserUpdatePayload)
  | { kind: "DEACTIVATE_USER" };

/** Snapshot of the target when the request was raised, used to detect drift. */
export interface AccessBeforeState {
  accountType?: string | null;
  jobTitle?: string | null;
  isActive?: boolean | null;
  capabilities: unknown;
}

export function beforeStateOf(target: AccessTarget | null): AccessBeforeState {
  if (!target) return { capabilities: {} };
  return {
    accountType: target.accountType,
    jobTitle: target.jobTitle,
    isActive: target.isActive,
    capabilities: normalizeCapabilities(target.capabilities),
  };
}

const requestInclude = {
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  targetUser: { select: { id: true, name: true, email: true, isActive: true } },
} as const;

export type AccessChangeRow = Prisma.AccessChangeRequestGetPayload<{
  include: typeof requestInclude;
}>;

/**
 * Adds the reviewer-facing view of a request: what would change, in the same
 * "granted Payroll · approve" language the audit trail already speaks.
 */
export function describeAccessChange(row: AccessChangeRow) {
  const before = (row.beforeState ?? {}) as unknown as AccessBeforeState;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const proposedCapabilities =
    row.kind === "DEACTIVATE_USER"
      ? {}
      : (payload.capabilities as unknown) ?? before.capabilities;

  const profileChanges: { field: string; from: unknown; to: unknown }[] = [];
  if (row.kind === "UPDATE_ACCESS") {
    for (const field of ["name", "email", "accountType", "jobTitle", "isActive"] as const) {
      if (payload[field] === undefined) continue;
      const from = (before as unknown as Record<string, unknown>)[field];
      // `name` is not part of the before-state snapshot, so only report a change
      // when there is something to compare against.
      if (from === undefined || from === payload[field]) continue;
      profileChanges.push({ field, from, to: payload[field] });
    }
  }

  return {
    ...row,
    diff:
      payload.capabilities === undefined && row.kind === "UPDATE_ACCESS"
        ? { added: [], removed: [] }
        : diffCapabilities(before.capabilities, proposedCapabilities),
    profileChanges,
  };
}

export type AccessChangeView = ReturnType<typeof describeAccessChange>;

/**
 * True when the target moved on since the request was raised. Applying a stale
 * proposal would silently re-grant access somebody has already revoked, so the
 * owner is shown the drift and has to acknowledge it.
 */
export function hasDrifted(before: AccessBeforeState, current: AccessTarget | null): boolean {
  if (!current) return false;
  const now = beforeStateOf(current);
  return (
    JSON.stringify(normalizeCapabilities(before.capabilities)) !==
      JSON.stringify(now.capabilities) ||
    (before.isActive ?? null) !== now.isActive ||
    (before.accountType ?? null) !== now.accountType
  );
}

export class PendingRequestExistsError extends Error {
  constructor(public readonly existingId: string) {
    super("This user already has an access change awaiting approval");
  }
}

/**
 * Records a proposal and tells the owner about it. Nothing is applied here.
 */
export async function submitAccessChangeRequest(
  request: FastifyRequest,
  params: {
    kind: AccessChangeKind;
    targetUserId: string | null;
    targetLabel: string;
    payload: Record<string, unknown>;
    beforeState: AccessBeforeState;
    requestNote?: string | null;
  }
): Promise<AccessChangeView> {
  const companyId = request.user!.companyId;
  const requestedById = request.user!.sub;

  const created = await prisma.$transaction(async (tx) => {
    if (params.targetUserId) {
      const open = await tx.accessChangeRequest.findFirst({
        where: { companyId, targetUserId: params.targetUserId, status: "PENDING" },
        select: { id: true },
      });
      if (open) throw new PendingRequestExistsError(open.id);
    }
    const row = await tx.accessChangeRequest.create({
      data: {
        companyId,
        kind: params.kind,
        status: "PENDING",
        targetUserId: params.targetUserId,
        targetLabel: params.targetLabel,
        payload: params.payload as Prisma.InputJsonValue,
        beforeState: params.beforeState as unknown as Prisma.InputJsonValue,
        requestedById,
        requestNote: params.requestNote ?? null,
      },
      include: requestInclude,
    });
    await auditFromRequest(
      request,
      {
        action: "user.access.request",
        entityType: "user",
        entityId: params.targetUserId ?? undefined,
        metadata: {
          requestId: row.id,
          kind: params.kind,
          targetLabel: params.targetLabel,
          ...diffCapabilities(
            params.beforeState.capabilities,
            params.kind === "DEACTIVATE_USER"
              ? {}
              : ((params.payload.capabilities as unknown) ?? params.beforeState.capabilities)
          ),
        },
      },
      tx
    );
    return row;
  });

  const owner = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ownerUserId: true },
  });
  if (owner?.ownerUserId) {
    await createNotification({
      companyId,
      userId: owner.ownerUserId,
      title: "Access change needs your approval",
      message: `${request.user!.name ?? request.user!.email} proposed an access change for ${params.targetLabel}.`,
      dedupeKey: `access_request:${created.id}`,
      sourceModule: "USER_ACCESS",
      sourceId: created.id,
      linkUrl: REVIEW_LINK,
    });
  }

  return describeAccessChange(created);
}

/** Tells the requester what the owner decided. */
export async function notifyRequester(params: {
  companyId: string;
  row: AccessChangeRow;
  status: Extract<AccessChangeStatus, "APPROVED" | "DECLINED">;
  reviewNote?: string | null;
}) {
  await createNotification({
    companyId: params.companyId,
    userId: params.row.requestedById,
    title:
      params.status === "APPROVED" ? "Access change approved" : "Access change declined",
    message:
      params.reviewNote ??
      `Your access change for ${params.row.targetLabel} was ${params.status.toLowerCase()}.`,
    dedupeKey: `access_request_result:${params.row.id}:${params.status}`,
    sourceModule: "USER_ACCESS",
    sourceId: params.row.id,
    linkUrl: REVIEW_LINK,
  });
}

export async function findAccessChangeRequest(companyId: string, id: string) {
  return prisma.accessChangeRequest.findFirst({
    where: { id, companyId },
    include: requestInclude,
  });
}

export async function listAccessChangeRequests(params: {
  companyId: string;
  status?: AccessChangeStatus;
  /** Set for a non-owner: they only ever see the proposals they raised. */
  requestedById?: string;
  limit?: number;
}): Promise<AccessChangeView[]> {
  const rows = await prisma.accessChangeRequest.findMany({
    where: {
      companyId: params.companyId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.requestedById ? { requestedById: params.requestedById } : {}),
    },
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    take: params.limit ?? 100,
    include: requestInclude,
  });
  return rows.map(describeAccessChange);
}

export async function closeAccessChangeRequest(
  request: FastifyRequest,
  tx: TxClient,
  params: {
    row: AccessChangeRow;
    status: Extract<AccessChangeStatus, "APPROVED" | "DECLINED" | "CANCELLED">;
    reviewNote?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const auditAction =
    params.status === "APPROVED"
      ? "user.access.request.approved"
      : params.status === "DECLINED"
        ? "user.access.request.declined"
        : "user.access.request.cancelled";

  const updated = await tx.accessChangeRequest.update({
    where: { id: params.row.id },
    data: {
      status: params.status,
      reviewedById: request.user!.sub,
      reviewedAt: new Date(),
      reviewNote: params.reviewNote ?? null,
    },
    include: requestInclude,
  });

  await auditFromRequest(
    request,
    {
      action: auditAction,
      entityType: "user",
      entityId: params.row.targetUserId ?? undefined,
      metadata: {
        requestId: params.row.id,
        kind: params.row.kind,
        targetLabel: params.row.targetLabel,
        requestedById: params.row.requestedById,
        reviewNote: params.reviewNote ?? undefined,
        ...(params.metadata ?? {}),
      },
    },
    tx
  );

  return updated;
}
