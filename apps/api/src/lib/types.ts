import type { UserRole } from "@prisma/client";
import type { UserAccessRecord } from "../services/user-access.service.js";

export interface JWTPayload {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  /** Non-empty list of dashboard module paths when admin assigned custom access; omitted/null = role defaults */
  moduleAccess?: unknown;
  /** Must match DB accessVersion or token is rejected */
  accessVersion?: number;
  /** System owner bypasses module gates even without accessMiddleware */
  isSystemOwner?: boolean;
  iat?: number;
  exp?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
    access?: UserAccessRecord;
  }
}
