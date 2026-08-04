import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import type { AccessTokenPayload } from "../lib/types.js";
import { normalizeCapabilities } from "../lib/capabilities.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    reply.code(401).send({ error: "Unauthorized", message: "Missing or invalid token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload & { type?: string };
    if (decoded.type === "refresh") {
      reply.code(401).send({ error: "Unauthorized", message: "Invalid or expired token" });
      return;
    }
    const current = await prisma.user.findFirst({
      where: { id: decoded.sub, companyId: decoded.companyId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        companyId: true,
        accountType: true,
        jobTitle: true,
        isActive: true,
        capabilities: true,
        company: { select: { ownerUserId: true } },
      },
    });
    if (!current) {
      // The token is valid but the account is gone or deactivated. That is worth
      // recording: it is how a revoked person still holding a token shows up.
      try {
        await createAuditLog({
          userId: null,
          companyId: decoded.companyId,
          action: "auth.session.rejected",
          entityType: "user",
          entityId: decoded.sub,
          outcome: "denied",
          actorLabel: decoded.email ?? decoded.sub,
          ipAddress: request.ip,
          userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 512) : null,
          requestId: request.requestId ?? null,
          metadata: { reason: "inactive_or_missing", route: request.routeOptions?.url ?? request.url },
        });
      } catch (error) {
        request.log.error({ err: error }, "failed to write auth.session.rejected audit log");
      }
      reply.code(401).send({ error: "Unauthorized", message: "Account is inactive or no longer exists" });
      return;
    }
    request.user = {
      sub: current.id,
      email: current.email,
      companyId: current.companyId,
      name: current.name,
      accountType: current.accountType,
      jobTitle: current.jobTitle,
      isActive: current.isActive,
      capabilities: normalizeCapabilities(current.capabilities),
      isOwner: current.company.ownerUserId === current.id,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}
