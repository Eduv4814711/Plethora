import type { FastifyReply, FastifyRequest } from "fastify";
import { authMiddleware } from "./auth.js";
import { getUserAccessCached } from "../services/user-access.service.js";
import { auditContextFromRequest, createPlatformAuditEvent } from "../lib/audit.js";

export async function platformAccessMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const tokenVersion = request.user.accessVersion ?? 1;
  const access = await getUserAccessCached(request.user.sub, tokenVersion);
  if (!access || access.accessVersion !== tokenVersion || access.disabledAt) {
    reply.code(401).send({
      error: "Unauthorized",
      code: access && access.accessVersion !== tokenVersion ? "ACCESS_STALE" : undefined,
      message: access?.disabledAt ? "This account is disabled" : "Sign in again",
    });
    return;
  }
  if (access.adminClass !== "ROOT_ADMIN") {
    await createPlatformAuditEvent({
      ...auditContextFromRequest(request),
      actorUserId: access.userId,
      targetCompanyId: access.companyId,
      action: "authorization.platform_access_denied",
      entityType: "route",
      entityId: request.routeOptions.url,
      result: "denied",
      metadata: { method: request.method, adminClass: access.adminClass },
    }).catch(() => undefined);
    reply.code(403).send({ error: "Forbidden", message: "Root administrator access required" });
    return;
  }
  request.access = access;
}

export const platformProtect = [authMiddleware, platformAccessMiddleware];
