import type { FastifyRequest, FastifyReply } from "fastify";
import {
  getUserAccessCached,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  type UserAccessRecord,
} from "../services/user-access.service.js";

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

  if (access.companyId !== request.user.companyId) {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid session" });
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
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

export type { UserAccessRecord };
