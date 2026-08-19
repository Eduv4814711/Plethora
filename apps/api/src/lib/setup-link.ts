import type { FastifyRequest } from "fastify";
import { env } from "./env.js";

/**
 * The password-setup URL handed to whoever performed an account creation — the
 * owner directly, or the owner when they approve a manager's proposal.
 */
export function buildPasswordSetupLink(request: FastifyRequest, token: string): string {
  const configuredWebUrl =
    env.frontendUrl ?? (env.corsOrigins.length > 0 ? env.corsOrigins[0] : undefined);
  if (configuredWebUrl) {
    return `${configuredWebUrl.replace(/\/+$/, "")}/setup-password?token=${encodeURIComponent(token)}`;
  }
  const protoRaw = request.headers["x-forwarded-proto"];
  const hostRaw = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = Array.isArray(protoRaw) ? protoRaw[0] : protoRaw;
  const host = Array.isArray(hostRaw) ? hostRaw[0] : hostRaw;
  return proto && host
    ? `${proto}://${host}/setup-password?token=${encodeURIComponent(token)}`
    : `http://localhost:3000/setup-password?token=${encodeURIComponent(token)}`;
}
