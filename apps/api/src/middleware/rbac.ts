import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";
import type { JWTPayload } from "../lib/types.js";

/** Normalize DB/JWT value: non-empty string[] → list; else null (full admin only; others must be assigned modules). */
export function normalizeModuleAccess(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is string => typeof x === "string" && x.startsWith("/"));
  return out.length > 0 ? out : null;
}

function matchesModule(granted: string[], modulePath: string): boolean {
  return granted.some((m) => modulePath === m || modulePath.startsWith(`${m}/`));
}

function userMatchesModule(user: JWTPayload, modulePath: string): boolean {
  const list = normalizeModuleAccess(user.moduleAccess);
  if (!list) return false;
  return matchesModule(list, modulePath);
}

function userMatchesAnyModule(user: JWTPayload, modulePaths: string[]): boolean {
  const list = normalizeModuleAccess(user.moduleAccess);
  if (!list) return false;
  return modulePaths.some((p) => matchesModule(list, p));
}

/**
 * RBAC: only **full** admins (`role === admin` and no `moduleAccess` list) bypass checks.
 * All other users must have a non-empty `moduleAccess` matching route module options.
 * Scoped admins (`admin` + list) use the same module checks as other roles.
 * `roles === ['admin']` routes: full admin only.
 */
export function requireRole(
  roles: UserRole[],
  opts?: { module?: string; anyOfModules?: string[] }
) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const u = request.user;
    const custom = normalizeModuleAccess(u.moduleAccess);

    if (u.role === "admin" && !custom) {
      return;
    }

    const adminOnlyRoute = roles.length === 1 && roles[0] === "admin";
    if (adminOnlyRoute) {
      if (u.role !== "admin") {
        reply.code(403).send({
          error: "Forbidden",
          message: "Insufficient permissions for this action",
        });
        return;
      }
      if (custom) {
        reply.code(403).send({
          error: "Forbidden",
          message: "Insufficient permissions for this action",
        });
        return;
      }
      return;
    }

    if (custom) {
      if (opts?.anyOfModules?.length) {
        if (userMatchesAnyModule(u, opts.anyOfModules)) {
          return;
        }
        reply.code(403).send({
          error: "Forbidden",
          message: "No access to this module",
        });
        return;
      }
      if (opts?.module) {
        if (userMatchesModule(u, opts.module)) {
          return;
        }
        reply.code(403).send({
          error: "Forbidden",
          message: "No access to this module",
        });
        return;
      }
      reply.code(403).send({
        error: "Forbidden",
        message: "No access to this module",
      });
      return;
    }

    reply.code(403).send({
      error: "Forbidden",
      message: "No module access assigned. Contact an administrator.",
    });
  };
}

export function requireAdmin() {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    if (request.user.role !== "admin") {
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }

    const custom = normalizeModuleAccess(request.user.moduleAccess);
    if (custom) {
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

/** Tax / statutory company fields — full admin, or settings/payroll module access. */
export function canViewSensitiveCompanyFields(user: JWTPayload): boolean {
  if (user.role === "admin" && !normalizeModuleAccess(user.moduleAccess)) {
    return true;
  }
  return userMatchesAnyModule(user, ["/settings", "/payroll"]);
}
