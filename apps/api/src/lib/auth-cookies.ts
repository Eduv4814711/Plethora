import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

export const REFRESH_COOKIE_NAME = "plethora_refresh";
export const CSRF_COOKIE_NAME = "plethora_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Refresh token lifetime aligned with JWT refresh expiry (7 days). */
export const REFRESH_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const baseCookieOptions = () => ({
  path: "/",
  secure: env.isProduction,
  sameSite: "strict" as const,
});

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setAuthCookies(reply: FastifyReply, refreshToken: string, csrfToken?: string): void {
  const csrf = csrfToken ?? generateCsrfToken();
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions(),
    httpOnly: true,
    maxAge: REFRESH_COOKIE_MAX_AGE_SEC,
  });
  reply.setCookie(CSRF_COOKIE_NAME, csrf, {
    ...baseCookieOptions(),
    httpOnly: false,
    maxAge: REFRESH_COOKIE_MAX_AGE_SEC,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const opts = baseCookieOptions();
  reply.clearCookie(REFRESH_COOKIE_NAME, opts);
  reply.clearCookie(CSRF_COOKIE_NAME, opts);
}

export function readRefreshTokenFromRequest(request: FastifyRequest): string | undefined {
  const fromCookie = request.cookies[REFRESH_COOKIE_NAME];
  if (typeof fromCookie === "string" && fromCookie.length > 0) {
    return fromCookie;
  }
  const body = request.body as { refreshToken?: string } | undefined;
  if (typeof body?.refreshToken === "string" && body.refreshToken.length > 0) {
    return body.refreshToken;
  }
  return undefined;
}

/**
 * CSRF is required when the HttpOnly refresh cookie is present.
 * Legacy body-only refresh (one-time localStorage migration) skips CSRF.
 */
export function assertCsrfForCookieAuth(request: FastifyRequest): boolean {
  const hasRefreshCookie =
    typeof request.cookies[REFRESH_COOKIE_NAME] === "string" &&
    request.cookies[REFRESH_COOKIE_NAME].length > 0;
  if (!hasRefreshCookie) return true;

  const headerRaw = request.headers[CSRF_HEADER_NAME];
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  const cookie = request.cookies[CSRF_COOKIE_NAME];
  return typeof header === "string" && typeof cookie === "string" && header.length > 0 && header === cookie;
}

/** Public auth JSON — refresh token is never returned to browser clients. */
export function toPublicAuthResponse<T extends { refreshToken: string }>(
  result: T
): Omit<T, "refreshToken"> {
  const { refreshToken: _removed, ...rest } = result;
  return rest;
}
