import { createHash, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /password|secret|token|authorization|cookie|idnumber|bank|accountnumber|privatekey/i;

export type AuditRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuditResult = "success" | "denied" | "failed" | "pending";

export interface AuditContext {
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
}

export interface AuditLogInput extends AuditContext {
  userId?: string;
  companyId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
  result?: AuditResult;
  riskLevel?: AuditRiskLevel;
  beforeState?: unknown;
  afterState?: unknown;
  approvalRequestId?: string;
}

export interface PlatformAuditInput extends AuditContext {
  actorUserId?: string;
  targetCompanyId?: string;
  targetUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
  result?: AuditResult;
  riskLevel?: AuditRiskLevel;
  beforeState?: unknown;
  afterState?: unknown;
}

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, seen)])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sanitize(value));
}

export function auditContextFromRequest(request: FastifyRequest): AuditContext {
  const rawAgent = request.headers["user-agent"];
  return {
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: Array.isArray(rawAgent) ? rawAgent[0] : rawAgent,
    source: "api",
  };
}

/**
 * Append a sanitized, hash-linked audit event. Audit rows are never updated by
 * application code; the previous hash makes later tampering detectable.
 */
export async function createAuditLog(params: AuditLogInput) {
  // Serialize each tenant's chain head inside the database. Without this lock,
  // simultaneous requests could both reference the same previous hash.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.companyId}))`;
    const id = randomUUID();
    const timestamp = new Date();
    const previous = await tx.auditLog.findFirst({
      where: { companyId: params.companyId, eventHash: { not: null } },
      select: { eventHash: true },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    });
    const previousHash = previous?.eventHash ?? null;
    const metadata = sanitize(params.metadata) as Record<string, unknown> | undefined;
    const beforeState = sanitize(params.beforeState);
    const afterState = sanitize(params.afterState);
    const hashPayload = {
      id,
      companyId: params.companyId,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      requestId: params.requestId ?? null,
      reason: params.reason ?? null,
      result: params.result ?? "success",
      riskLevel: params.riskLevel ?? "LOW",
      metadata,
      beforeState,
      afterState,
      previousHash,
      timestamp: timestamp.toISOString(),
    };
    const eventHash = createHash("sha256").update(canonicalJson(hashPayload)).digest("hex");

    return tx.auditLog.create({
      data: {
        id,
        userId: params.userId,
        companyId: params.companyId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: metadata as object | undefined,
        requestId: params.requestId,
        sessionId: params.sessionId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        reason: params.reason,
        source: params.source ?? "api",
        result: params.result ?? "success",
        riskLevel: params.riskLevel ?? "LOW",
        beforeState: beforeState as object | undefined,
        afterState: afterState as object | undefined,
        approvalRequestId: params.approvalRequestId,
        previousHash,
        eventHash,
        timestamp,
      },
    });
  });
}

/** Append a sanitized event to the single platform-wide tamper-evident chain. */
export async function createPlatformAuditEvent(params: PlatformAuditInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plethora-platform-audit'))`;
    const id = randomUUID();
    const timestamp = new Date();
    const previous = await tx.platformAuditEvent.findFirst({
      select: { eventHash: true },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    });
    const previousHash = previous?.eventHash ?? null;
    const metadata = sanitize(params.metadata) as Record<string, unknown> | undefined;
    const beforeState = sanitize(params.beforeState);
    const afterState = sanitize(params.afterState);
    const hashPayload = {
      id,
      actorUserId: params.actorUserId ?? null,
      targetCompanyId: params.targetCompanyId ?? null,
      targetUserId: params.targetUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      requestId: params.requestId ?? null,
      reason: params.reason ?? null,
      result: params.result ?? "success",
      riskLevel: params.riskLevel ?? "HIGH",
      metadata,
      beforeState,
      afterState,
      previousHash,
      timestamp: timestamp.toISOString(),
    };
    const eventHash = createHash("sha256").update(canonicalJson(hashPayload)).digest("hex");
    return tx.platformAuditEvent.create({
      data: {
        id,
        actorUserId: params.actorUserId,
        targetCompanyId: params.targetCompanyId,
        targetUserId: params.targetUserId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: metadata as object | undefined,
        requestId: params.requestId,
        sessionId: params.sessionId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        reason: params.reason,
        source: params.source ?? "api",
        result: params.result ?? "success",
        riskLevel: params.riskLevel ?? "HIGH",
        beforeState: beforeState as object | undefined,
        afterState: afterState as object | undefined,
        previousHash,
        eventHash,
        timestamp,
      },
    });
  });
}

export function sanitizeAuditValue(value: unknown): unknown {
  return sanitize(value);
}
