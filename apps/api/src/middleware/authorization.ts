import type { FastifyRequest, FastifyReply } from "fastify";
import {
  hasAnyCapability,
  hasCapability,
  normalizeCapabilities,
  type Capability,
  type CapabilityMap,
} from "../lib/capabilities.js";
import { auditFromRequest } from "../lib/audit.js";

export { normalizeCapabilities };
export type { Capability, CapabilityMap };

/**
 * Refused access attempts are worth recording, but a UI that polls a forbidden
 * endpoint must not be able to flood the audit table. The same actor hitting the
 * same module+capability is recorded at most once per window.
 */
const DENIAL_DEDUPE_MS = 5 * 60 * 1000;
const recentDenials = new Map<string, number>();

function shouldRecordDenial(key: string, now = Date.now()): boolean {
  const last = recentDenials.get(key);
  if (last !== undefined && now - last < DENIAL_DEDUPE_MS) return false;
  recentDenials.set(key, now);
  // Opportunistic sweep so the map cannot grow without bound.
  if (recentDenials.size > 5000) {
    for (const [entry, at] of recentDenials) {
      if (now - at >= DENIAL_DEDUPE_MS) recentDenials.delete(entry);
    }
  }
  return true;
}

/** Exposed for tests. */
export function __resetDenialDedupe(): void {
  recentDenials.clear();
}

async function recordDenial(
  request: FastifyRequest,
  modules: readonly string[],
  capability: Capability
): Promise<void> {
  const user = request.user;
  if (!user) return;
  const modulePath = modules.join("|");
  if (!shouldRecordDenial(`${user.sub}:${modulePath}:${capability}`)) return;
  await auditFromRequest(request, {
    action: "access.denied",
    entityType: "capability",
    entityId: modules[0],
    outcome: "denied",
    metadata: {
      modules,
      capability,
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
    },
  });
}

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
}

async function forbidden(
  request: FastifyRequest,
  reply: FastifyReply,
  modules: readonly string[],
  capability: Capability,
  message = "You do not have permission to perform this action"
): Promise<void> {
  await recordDenial(request, modules, capability);
  reply.code(403).send({ error: "Forbidden", message });
}

export function requireCapability(modulePath: string, capability: Capability) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) return unauthorized(reply);
    if (!hasCapability(request.user, modulePath, capability)) {
      await forbidden(request, reply, [modulePath], capability);
    }
  };
}

export function requireAnyCapability(modulePaths: readonly string[], capability: Capability) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) return unauthorized(reply);
    if (!hasAnyCapability(request.user, modulePaths, capability)) {
      await forbidden(request, reply, modulePaths, capability);
    }
  };
}

export function requireOwner() {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) return unauthorized(reply);
    if (!request.user.isOwner) {
      await forbidden(
        request,
        reply,
        ["<owner>"],
        "manage_access",
        "Only the company owner may perform this action"
      );
    }
  };
}

/**
 * Maps an action-shaped route suffix to the capability it really needs, so a
 * POST to `/approve` is not treated as a plain `create`. Longest suffix wins.
 */
export const DEFAULT_ACTION_CAPABILITIES: Readonly<Record<string, Capability>> = {
  "/approve": "approve",
  "/reject": "approve",
  "/decline": "approve",
  "/unapprove": "approve",
  "/revert-to-draft": "approve",
  "/mark-paid": "approve",
  "/lock": "approve",
  "/export": "export",
  "/download": "export",
  "/archive": "delete",
  "/restore": "delete",
};

function actionCapabilityFor(
  request: FastifyRequest,
  overrides?: Record<string, Capability>
): Capability | null {
  const url = request.routeOptions?.url ?? request.url?.split("?")[0];
  if (!url) return null;
  const table = { ...DEFAULT_ACTION_CAPABILITIES, ...(overrides ?? {}) };
  const match = Object.keys(table)
    .filter((suffix) => url.endsWith(suffix))
    .sort((a, b) => b.length - a.length)[0];
  return match ? table[match] : null;
}

/**
 * Module-level route guard used by CRUD route groups. It maps the request
 * operation to the matching explicit capability, treating action-shaped routes
 * (approve, export, archive...) as the action they perform rather than as a
 * generic write. Special operations may still use requireCapability directly.
 */
export function requireCrudCapability(options: {
  module?: string;
  anyOfModules?: string[];
  /** Extra or overriding suffix→capability mappings for this route group. */
  actionCapabilities?: Record<string, Capability>;
}) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) return unauthorized(reply);

    const method = request.method;
    const capability: Capability =
      method === "GET" || method === "HEAD"
        ? (actionCapabilityFor(request, options.actionCapabilities) === "export" ? "export" : "view")
        : (actionCapabilityFor(request, options.actionCapabilities) ??
          (method === "POST" ? "create" : method === "DELETE" ? "delete" : "edit"));

    const paths = options.anyOfModules ?? (options.module ? [options.module] : []);
    if (!paths.length || !hasAnyCapability(request.user, paths, capability)) {
      await forbidden(request, reply, paths.length ? paths : ["<unconfigured>"], capability);
    }
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
