import type { UserRole } from "@prisma/client";

export interface JWTPayload {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  /** Legacy path list or granular module permission map; omitted/null = full/default access. */
  moduleAccess?: unknown;
  iat?: number;
  exp?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}
