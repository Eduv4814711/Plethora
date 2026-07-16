import type { FastifyRequest, FastifyReply } from "fastify";
import {
  getUserAccessCached,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  type UserAccessRecord,
} from "../services/user-access.service.js";
import { auditContextFromRequest, createAuditLog } from "../lib/audit.js";
import { config } from "../lib/config.js";

export function hasPermission(request: FastifyRequest, permission: string): boolean {
  return checkPermission(request.access, permission);
}

export function hasAnyPermission(request: FastifyRequest, permissions: string[]): boolean {
  return checkAnyPermission(request.access, permissions);
}

export async function accessMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return;
  }

  const tokenVersion = request.user.accessVersion ?? 1;
  const access = await getUserAccessCached(request.user.sub, tokenVersion);
  if (!access) {
    reply.code(401).send({ error: "Unauthorized", message: "User not found" });
    return;
  }

  if (access.accessVersion !== tokenVersion) {
    reply.code(401).send({
      error: "Unauthorized",
      code: "ACCESS_STALE",
      message: "Your access has changed. Please sign in again.",
    });
    return;
  }

  if (access.disabledAt) {
    reply.code(401).send({ error: "Unauthorized", code: "ACCOUNT_DISABLED", message: "This account is disabled" });
    return;
  }

  if (access.companyId !== request.user.companyId) {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid session" });
    return;
  }

  if (config.security.mfaEnforcementEnabled && access.mfaRequired && !access.mfaEnabled) {
    reply.code(403).send({
      error: "MFA enrollment required",
      code: "MFA_ENROLLMENT_REQUIRED",
      message: "Set up multi-factor authentication before continuing.",
    });
    return;
  }

  request.access = access;
}

export function requirePermission(permission: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.access) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!checkPermission(request.access, permission)) {
      await createAuditLog({
        ...auditContextFromRequest(request),
        userId: request.user?.sub,
        companyId: request.user!.companyId,
        action: "authorization.denied",
        entityType: "route",
        entityId: request.routeOptions.url,
        result: "denied",
        riskLevel: "HIGH",
        metadata: { permission, method: request.method },
      }).catch(() => undefined);
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

export function requireAnyPermission(permissions: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.access) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!checkAnyPermission(request.access, permissions)) {
      await createAuditLog({
        ...auditContextFromRequest(request),
        userId: request.user?.sub,
        companyId: request.user!.companyId,
        action: "authorization.denied",
        entityType: "route",
        entityId: request.routeOptions.url,
        result: "denied",
        riskLevel: "HIGH",
        metadata: { anyOfPermissions: permissions, method: request.method },
      }).catch(() => undefined);
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}
