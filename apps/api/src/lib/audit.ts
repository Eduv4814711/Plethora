import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

/** Anything with the Prisma model methods we need — the client or a transaction. */
type AuditClient = Pick<typeof prisma, "auditLog">;

export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditParams {
  userId?: string | null;
  companyId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  outcome?: AuditOutcome;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Used when the actor is not a User row, e.g. a failed login or a script. */
  actorLabel?: string | null;
}

/**
 * Writes an audit row.
 *
 * Pass `tx` to write inside the same transaction as the change being recorded,
 * so a rolled-back mutation cannot leave a log entry claiming it happened (and
 * a committed mutation cannot go unlogged). Prefer `auditFromRequest` in route
 * handlers — it fills in the actor and request forensics for you.
 */
export async function createAuditLog(params: AuditParams, tx?: AuditClient) {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      userId: params.userId ?? null,
      companyId: params.companyId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? undefined) as object | undefined,
      outcome: params.outcome ?? "success",
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      requestId: params.requestId ?? null,
      actorLabel: params.actorLabel ?? null,
    },
  });
}

const MAX_USER_AGENT = 512;

function forensics(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, MAX_USER_AGENT) : null,
    requestId: request.requestId ?? null,
  };
}

export interface RequestAuditParams {
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  outcome?: AuditOutcome;
  /** Overrides the authenticated user's company, for pre-auth events. */
  companyId?: string;
  /** Overrides the actor, for events with no authenticated user. */
  actorLabel?: string;
}

/**
 * Records an action performed through an HTTP request, attaching the actor, IP,
 * user-agent and request id automatically.
 *
 * A failure here is logged and swallowed: an audit write must never turn a
 * committed mutation into a 500. Pass `tx` when the caller wants the stricter
 * all-or-nothing guarantee instead.
 */
export async function auditFromRequest(
  request: FastifyRequest,
  params: RequestAuditParams,
  tx?: AuditClient
): Promise<void> {
  const companyId = params.companyId ?? request.user?.companyId;
  if (!companyId) {
    request.log.warn({ action: params.action }, "audit skipped: no company context");
    return;
  }
  const payload: AuditParams = {
    ...params,
    companyId,
    userId: request.user?.sub ?? null,
    actorLabel: params.actorLabel ?? (request.user ? null : "anonymous"),
    ...forensics(request),
  };
  if (tx) {
    // Inside a transaction the caller wants the write to be atomic with the
    // change, so a failure must propagate and roll the whole thing back.
    await createAuditLog(payload, tx);
    return;
  }
  try {
    await createAuditLog(payload);
  } catch (error) {
    request.log.error({ err: error, action: params.action }, "failed to write audit log");
  }
}
