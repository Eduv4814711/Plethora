import type { FastifyRequest, FastifyReply } from "fastify";
import {
  hasAnyCapability,
  hasCapability,
  normalizeCapabilities,
  type Capability,
  type CapabilityMap,
} from "../lib/capabilities.js";

export { normalizeCapabilities };
export type { Capability, CapabilityMap };

function forbidden(reply: FastifyReply, message = "You do not have permission to perform this action"): void {
  reply.code(403).send({ error: "Forbidden", message });
}

export function requireCapability(modulePath: string, capability: Capability) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!hasCapability(request.user, modulePath, capability)) forbidden(reply);
  };
}

export function requireAnyCapability(modulePaths: readonly string[], capability: Capability) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!hasAnyCapability(request.user, modulePaths, capability)) forbidden(reply);
  };
}

export function requireOwner() {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!request.user.isOwner) forbidden(reply, "Only the company owner may perform this action");
  };
}

/**
 * Module-level route guard used by CRUD route groups. It maps the request
 * operation to the matching explicit capability; special operations use
 * requireCapability directly.
 */
export function requireCrudCapability(options: { module?: string; anyOfModules?: string[] }) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const capability: Capability =
      request.method === "GET" || request.method === "HEAD"
        ? "view"
        : request.method === "POST"
          ? "create"
          : request.method === "DELETE"
            ? "delete"
            : "edit";
    const paths = options.anyOfModules ?? (options.module ? [options.module] : []);
    if (!paths.length || !hasAnyCapability(request.user, paths, capability)) forbidden(reply);
  };
}

/** Sensitive company data is available only to the owner or an explicit editor. */
export function canViewSensitiveCompanyFields(user: FastifyRequest["user"]): boolean {
  if (!user || !user.isActive) return false;
  return (
    user.isOwner ||
    hasCapability(user, "/settings", "edit") ||
    hasCapability(user, "/payroll", "view_sensitive")
  );
}
