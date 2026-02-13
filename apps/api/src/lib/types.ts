import type { UserRole } from "@prisma/client";

export interface JWTPayload {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}
