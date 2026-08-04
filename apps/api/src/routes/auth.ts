import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  login,
  refreshAccessToken,
  hashPassword,
  hashPasswordSetupToken,
  issueTokensForUser,
  logoutUser,
} from "../services/auth.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { findUniqueUserForMe } from "../lib/user-access.js";
import { validatePassword, PASSWORD_MIN_LENGTH } from "../lib/password-policy.js";
import { badRequest } from "../lib/api-response.js";
import {
  assertCsrfForCookieAuth,
  clearAuthCookies,
  readRefreshTokenFromRequest,
  setAuthCookies,
  toPublicAuthResponse,
} from "../lib/auth-cookies.js";
import { env } from "../lib/env.js";
import { auditFromRequest, type AuditOutcome } from "../lib/audit.js";

const AUTH_RATE = { max: 30, timeWindow: "15 minutes" as const };

function refreshMeta(request: FastifyRequest) {
  const ua = request.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua : undefined,
    ipAddress: request.ip,
  };
}

/**
 * Authentication events are recorded against the company they concern. Most of
 * these routes run before authMiddleware, so the actor is supplied explicitly:
 * an email for anonymous attempts, a user id once one is known.
 */
async function auditAuthEvent(
  request: FastifyRequest,
  params: {
    action: string;
    companyId: string;
    userId?: string;
    actorLabel?: string;
    outcome?: AuditOutcome;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await auditFromRequest(request, {
    action: params.action,
    entityType: "user",
    entityId: params.userId,
    companyId: params.companyId,
    actorLabel: params.actorLabel,
    outcome: params.outcome,
    metadata: params.metadata,
  });
}

/**
 * A failed login has no session, so resolve the company from the email to keep
 * the attempt visible on that company's audit trail. Returns null for an email
 * that matches nobody — there is no company to attribute it to, and recording
 * it against an arbitrary one would be misleading.
 */
/**
 * Reads the claims of a rejected refresh token without trusting them. The token
 * failed verification, so this is only used to attribute the attempt to a
 * company — never to grant anything.
 */
function decodeRefreshClaims(token: string): { sub: string; email: string; companyId: string } | null {
  try {
    const decoded = jwt.decode(token) as { sub?: string; email?: string; companyId?: string } | null;
    if (!decoded?.sub || !decoded.companyId) return null;
    return { sub: decoded.sub, email: decoded.email ?? decoded.sub, companyId: decoded.companyId };
  } catch {
    return null;
  }
}

async function companyForEmail(email: string): Promise<{ companyId: string; userId: string } | null> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
    select: { id: true, companyId: true },
  });
  return user ? { companyId: user.companyId, userId: user.id } : null;
}

function sendAuthSuccess(
  reply: FastifyReply,
  result: { refreshToken: string; accessToken: string; user: unknown; expiresIn: number },
  statusCode = 200
) {
  setAuthCookies(reply, result.refreshToken);
  return reply.code(statusCode).send(toPublicAuthResponse(result));
}

function csrfForbidden(reply: FastifyReply) {
  return reply.code(403).send({
    error: "Forbidden",
    message: "Invalid or missing CSRF token",
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  companyId: z.string().optional(),
});

const onboardSchema = z.object({
  company: z.object({
    name: z.string().min(1, "Company name is required"),
  }),
  admin: z.object({
    name: z.string().min(1, "Admin name is required"),
    email: z.string().email("Valid admin email is required"),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Admin password must be at least ${PASSWORD_MIN_LENGTH} characters`),
  }),
});

const setupPasswordValidateSchema = z.object({
  token: z.string().min(20),
});

const setupPasswordCompleteSchema = z.object({
  token: z.string().min(20),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

function passwordPolicyError(password: string, companyName?: string) {
  const check = validatePassword(password, { companyName });
  if (!check.valid) return check.message ?? "Password does not meet policy";
  return null;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/onboard", { config: { rateLimit: AUTH_RATE } }, async (request, reply) => {
    const parsed = onboardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const { company: companyInput, admin: adminInput } = parsed.data;
    const policyMsg = passwordPolicyError(adminInput.password, companyInput.name);
    if (policyMsg) {
      return badRequest(reply, policyMsg);
    }

    const passwordHash = await hashPassword(adminInput.password);

    try {
      const { adminUser } = await prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: companyInput.name },
        });

        const adminUser = await tx.user.create({
          data: {
            companyId: company.id,
            name: adminInput.name,
            email: adminInput.email.toLowerCase(),
            passwordHash,
            accountType: "staff",
          },
          select: {
            id: true,
            name: true,
            email: true,
            accountType: true,
            jobTitle: true,
            isActive: true,
            capabilities: true,
            companyId: true,
          },
        });

        await tx.company.update({
          where: { id: company.id },
          data: { ownerUserId: adminUser.id },
        });

        return { company, adminUser: { ...adminUser, isOwner: true } };
      });

      const result = await issueTokensForUser(adminUser, refreshMeta(request));
      await auditAuthEvent(request, {
        action: "company.onboarded",
        companyId: adminUser.companyId,
        userId: adminUser.id,
        actorLabel: adminUser.email,
        metadata: { companyName: companyInput.name, ownerEmail: adminUser.email },
      });
      return sendAuthSuccess(reply, result, 201);
    } catch (err: unknown) {
      const prismaErr = err as { code?: string };
      if (prismaErr.code === "P2002") {
        return reply.code(409).send({
          error: "Email already registered",
          message: "This email is already in use. Please sign in or use a different email.",
        });
      }
      request.log.error(err);
      return reply.code(500).send({
        error: "Onboarding failed",
        message:
          env.isProduction
            ? "An error occurred during signup"
            : err instanceof Error
              ? err.message
              : "An error occurred during signup",
      });
    }
  });

  app.post("/login", { config: { rateLimit: AUTH_RATE } }, async (request, reply) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation error",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await login(parsed.data, refreshMeta(request));
      if (!result) {
        request.log.warn(
          { email: parsed.data.email, requestId: request.requestId },
          "login failed"
        );
        const known = await companyForEmail(parsed.data.email);
        if (known) {
          await auditAuthEvent(request, {
            action: "auth.login.failed",
            companyId: known.companyId,
            userId: known.userId,
            actorLabel: parsed.data.email.toLowerCase(),
            outcome: "failure",
            metadata: { email: parsed.data.email.toLowerCase(), reason: "invalid_credentials" },
          });
        }
        return reply.code(401).send({
          error: "Invalid credentials",
          message: "Invalid email or password",
        });
      }

      await auditAuthEvent(request, {
        action: "auth.login",
        companyId: result.user.companyId,
        userId: result.user.id,
        actorLabel: result.user.email,
        metadata: { email: result.user.email, isOwner: result.user.isOwner },
      });

      return sendAuthSuccess(reply, result);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: "Login failed",
        message:
          env.isProduction
            ? "An error occurred during login"
            : err instanceof Error
              ? err.message
              : "An error occurred during login",
      });
    }
  });

  app.post(
    "/setup-password/validate",
    { config: { rateLimit: AUTH_RATE } },
    async (request, reply) => {
      const parsed = setupPasswordValidateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation error", message: "Valid token is required" });
      }
      const now = new Date();
      const tokenHash = hashPasswordSetupToken(parsed.data.token);
      const found = await prisma.user.findFirst({
        where: {
          passwordSetupRequired: true,
          passwordSetupTokenHash: tokenHash,
          passwordSetupTokenConsumedAt: null,
          passwordSetupTokenExpiresAt: { gt: now },
        },
        select: { id: true, email: true, name: true },
      });
      if (!found) {
        return reply.code(400).send({ error: "Invalid or expired setup link" });
      }
      return reply.send({ valid: true, email: found.email, name: found.name });
    }
  );

  app.post(
    "/setup-password/complete",
    { config: { rateLimit: AUTH_RATE } },
    async (request, reply) => {
      const parsed = setupPasswordCompleteSchema.safeParse(request.body);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        const firstMsg = Object.values(fieldErrors).flat()[0];
        return reply.code(400).send({
          error: "Validation error",
          message: firstMsg ?? "Invalid request",
          details: { fieldErrors },
        });
      }

      const policyMsg = passwordPolicyError(parsed.data.password);
      if (policyMsg) {
        return badRequest(reply, policyMsg);
      }

      const now = new Date();
      const tokenHash = hashPasswordSetupToken(parsed.data.token);
      const found = await prisma.user.findFirst({
        where: {
          passwordSetupRequired: true,
          passwordSetupTokenHash: tokenHash,
          passwordSetupTokenConsumedAt: null,
          passwordSetupTokenExpiresAt: { gt: now },
        },
        select: { id: true, email: true, companyId: true },
      });
      if (!found) {
        return reply.code(400).send({ error: "Invalid or expired setup link" });
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const consumed = await prisma.user.updateMany({
        where: {
          id: found.id,
          passwordSetupRequired: true,
          passwordSetupTokenHash: tokenHash,
          passwordSetupTokenConsumedAt: null,
          passwordSetupTokenExpiresAt: { gt: now },
        },
        data: {
          passwordHash,
          passwordSetupRequired: false,
          passwordSetupTokenHash: null,
          passwordSetupTokenExpiresAt: null,
          passwordSetupTokenConsumedAt: now,
        },
      });
      if (consumed.count !== 1) {
        return reply.code(400).send({ error: "Invalid or expired setup link" });
      }

      await auditAuthEvent(request, {
        action: "auth.password.setup",
        companyId: found.companyId,
        userId: found.id,
        actorLabel: found.email,
        metadata: { email: found.email },
      });

      return reply.send({ success: true });
    }
  );

  app.post("/refresh", { config: { rateLimit: AUTH_RATE } }, async (request, reply) => {
    const parsed = refreshBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Invalid refresh request",
      });
    }

    if (!assertCsrfForCookieAuth(request)) {
      return csrfForbidden(reply);
    }

    const refreshTokenValue = readRefreshTokenFromRequest(request);
    if (!refreshTokenValue) {
      return reply.code(401).send({
        error: "Invalid refresh token",
        message: "Refresh token is required",
      });
    }

    const result = await refreshAccessToken(refreshTokenValue, refreshMeta(request));
    if (!result) {
      // A rejected refresh is how a revoked or reused token shows up. Attribute
      // it if the token still decodes to a real account; otherwise there is
      // nothing to attribute it to and the rate limiter is the control.
      const claimed = decodeRefreshClaims(refreshTokenValue);
      if (claimed) {
        await auditAuthEvent(request, {
          action: "auth.token.refresh.rejected",
          companyId: claimed.companyId,
          userId: claimed.sub,
          actorLabel: claimed.email,
          outcome: "denied",
          metadata: { reason: "invalid_expired_or_revoked" },
        });
      }
      clearAuthCookies(reply);
      return reply.code(401).send({
        error: "Invalid refresh token",
        message: "Token is invalid or expired",
      });
    }

    return sendAuthSuccess(reply, result);
  });

  app.get("/me", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const user = await findUniqueUserForMe(request.user.sub);

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send(user);
  });

  app.post("/logout", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!assertCsrfForCookieAuth(request)) {
      return csrfForbidden(reply);
    }

    const refreshTokenValue = readRefreshTokenFromRequest(request);

    if (request.user?.sub || refreshTokenValue) {
      await logoutUser(request.user?.sub, refreshTokenValue);
    }

    if (request.user) {
      await auditAuthEvent(request, {
        action: "auth.logout",
        companyId: request.user.companyId,
        userId: request.user.sub,
        actorLabel: request.user.email,
      });
    }

    clearAuthCookies(reply);
    return reply.send({ message: "Logged out successfully" });
  });
}
