import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { login, refreshAccessToken, hashPassword, hashPasswordSetupToken, issueTokensForUser } from "../services/auth.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { findUniqueUserForMe } from "../lib/user-module-column.js";

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
    password: z.string().min(8, "Admin password must be at least 8 characters"),
  }),
});

const setupPasswordValidateSchema = z.object({
  token: z.string().min(20),
});

const setupPasswordCompleteSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/onboard", async (request, reply) => {
    const parsed = onboardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const { company: companyInput, admin: adminInput } = parsed.data;
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
            role: "admin",
          },
          select: { id: true, name: true, email: true, role: true, companyId: true },
        });

        return { company, adminUser };
      });

      const result = issueTokensForUser(adminUser);
      return reply.code(201).send(result);
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
        message: err instanceof Error ? err.message : "An error occurred during signup",
      });
    }
  });

  app.post("/login", async (request, reply) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation error",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await login(parsed.data);
      if (!result) {
        return reply.code(401).send({
          error: "Invalid credentials",
          message: "Invalid email or password",
        });
      }

      return reply.send(result);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: "Login failed",
        message: err instanceof Error ? err.message : "An error occurred during login",
      });
    }
  });

  app.post("/setup-password/validate", async (request, reply) => {
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
  });

  app.post("/setup-password/complete", async (request, reply) => {
    const parsed = setupPasswordCompleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
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
      select: { id: true },
    });
    if (!found) {
      return reply.code(400).send({ error: "Invalid or expired setup link" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: found.id },
      data: {
        passwordHash,
        passwordSetupRequired: false,
        passwordSetupTokenHash: null,
        passwordSetupTokenExpiresAt: null,
        passwordSetupTokenConsumedAt: now,
      },
    });

    return reply.send({ success: true });
  });

  app.post("/refresh", async (request, reply) => {
    const schema = z.object({ refreshToken: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: "refreshToken is required",
      });
    }

    const result = await refreshAccessToken(parsed.data.refreshToken);
    if (!result) {
      return reply.code(401).send({
        error: "Invalid refresh token",
        message: "Token is invalid or expired",
      });
    }

    return reply.send(result);
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

  app.post("/logout", { preHandler: [authMiddleware] }, async (_request, reply) => {
    return reply.send({ message: "Logged out successfully" });
  });
}
