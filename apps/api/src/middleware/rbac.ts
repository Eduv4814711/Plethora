import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";

export function requireRole(roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    if (!roles.includes(request.user.role)) {
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

export function requireAdmin() {
  return requireRole(["admin"]);
}
