import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";
import type { JWTPayload } from "../lib/types.js";
import type { UserAccessRecord } from "../services/user-access.service.js";
import { hasPermission } from "../services/user-access.service.js";
import { PERMISSIONS } from "../lib/permissions.js";
import {
  normalizeModuleAccess,
  resolveEffectiveModuleAccess,
} from "../lib/module-access.js";

export { normalizeModuleAccess } from "../lib/module-access.js";

function matchesModule(granted: string[], modulePath: string): boolean {
  return granted.some((m) => modulePath === m || modulePath.startsWith(`${m}/`));
}

function effectiveModules(user: JWTPayload): string[] | null {
  return resolveEffectiveModuleAccess({
    role: user.role,
    moduleAccess: user.moduleAccess,
    isSystemOwner: user.isSystemOwner === true,
  });
}

function userMatchesModule(user: JWTPayload, modulePath: string): boolean {
  const list = effectiveModules(user);
  if (!list) return false;
  return matchesModule(list, modulePath);
}

function userMatchesAnyModule(user: JWTPayload, modulePaths: string[]): boolean {
  const list = effectiveModules(user);
  if (!list) return false;
  return modulePaths.some((p) => matchesModule(list, p));
}

/** Authoritative ownership comes from DB-backed accessMiddleware, not the JWT claim alone. */
function isOwner(request: FastifyRequest): boolean {
  return request.access?.isSystemOwner === true;
}

/**
 * Module-path gate for navigation-assigned access.
 * System owners bypass. Everyone else needs matching moduleAccess (explicit or role defaults).
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
    const access = request.access;

    if (isOwner(request)) {
      return;
    }

    const adminOnlyRoute = roles.length === 1 && roles[0] === "admin";
    if (adminOnlyRoute) {
      if (!hasPermission(access, PERMISSIONS.USERS_MANAGE) && !access?.isSystemOwner) {
        reply.code(403).send({
          error: "Forbidden",
          message: "Insufficient permissions for this action",
        });
        return;
      }
      return;
    }

    const custom = effectiveModules(u);
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

/** System-owner only (not ordinary administrators). */
export function requireSystemOwner() {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    if (!isOwner(request)) {
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

/** @deprecated Use requireSystemOwner — this gate has always meant system owner, not role=admin. */
export const requireAdmin = requireSystemOwner;

/** Tax / statutory company fields */
export function canViewSensitiveCompanyFields(access?: UserAccessRecord): boolean {
  return hasPermission(access, PERMISSIONS.SETTINGS_MANAGE_STATUTORY);
}

export function isSystemOwnerAccess(access?: UserAccessRecord): boolean {
  return access?.isSystemOwner === true;
}

/** @deprecated Use canViewSensitiveCompanyFields(access) */
export function canViewSensitiveCompanyFieldsFromJwt(user: JWTPayload): boolean {
  if (user.isSystemOwner) return true;
  if (user.role === "admin" && !normalizeModuleAccess(user.moduleAccess)) return true;
  return userMatchesAnyModule(user, ["/settings", "/payroll"]);
}
