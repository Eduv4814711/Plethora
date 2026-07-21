import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";
import type { JWTPayload } from "../lib/types.js";

/** Normalize DB/JWT value: non-empty string[] → list; else null (full admin only; others must be assigned modules). */
export function normalizeModuleAccess(raw: unknown): string[] | null {
  const permissions = normalizeModulePermissions(raw);
  return permissions ? Object.keys(permissions) : null;
}

export type ModulePermission = "read" | "write";
export type ModulePermissions = Record<string, ModulePermission>;

/** Normalize both the legacy path array and the granular permission map. */
export function normalizeModulePermissions(raw: unknown): ModulePermissions | null {
  if (raw == null) return null;
  const out: ModulePermissions = {};
  if (Array.isArray(raw)) {
    for (const path of raw) if (typeof path === "string" && path.startsWith("/")) out[path] = "write";
  } else if (typeof raw === "object") {
    for (const [path, permission] of Object.entries(raw as Record<string, unknown>)) {
      if (path.startsWith("/") && (permission === "read" || permission === "write")) out[path] = permission;
    }
  }
  return Object.keys(out).length ? out : null;
}

function matchesModule(granted: string[], modulePath: string): boolean {
  return granted.some((m) => modulePath === m || modulePath.startsWith(`${m}/`));
}

function userMatchesModule(user: JWTPayload, modulePath: string): boolean {
  return Boolean(findModulePermission(user, modulePath));
}

function findModulePermission(user: JWTPayload, modulePath: string): ModulePermission | null {
  const permissions = normalizeModulePermissions(user.moduleAccess);
  if (!permissions) return null;
  // A nested grant is more specific than its parent. Without this ordering,
  // object insertion order could make `/employees:read` override an explicit
  // `/employees/leave:write` grant (or vice versa).
  const match = Object.keys(permissions)
    .filter((m) => modulePath === m || modulePath.startsWith(`${m}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? permissions[match] : null;
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
      const requiresWrite = request.method !== "GET" && request.method !== "HEAD";
      if (opts?.anyOfModules?.length) {
        if (opts.anyOfModules.some((p) => {
          const permission = findModulePermission(u, p);
          return permission === "write" || (!requiresWrite && permission === "read");
        })) {
          return;
        }
        reply.code(403).send({
          error: "Forbidden",
          message: "No access to this module",
        });
        return;
      }
      if (opts?.module) {
        const permission = findModulePermission(u, opts.module);
        if (permission === "write" || (!requiresWrite && permission === "read")) {
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
  return ["/settings", "/payroll"].some((module) => findModulePermission(user, module) === "write");
}
