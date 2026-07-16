import type { UserRole } from "@prisma/client";

export interface JWTPayload {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  /** Non-empty list of dashboard module paths when admin assigned custom access; omitted/null = role defaults */
  moduleAccess?: unknown;
  iat?: number;
  exp?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}
