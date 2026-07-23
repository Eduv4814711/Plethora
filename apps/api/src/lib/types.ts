import type { AccountType } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { CapabilityMap } from "./capabilities.js";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  companyId: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser extends AccessTokenPayload {
  name: string;
  accountType: AccountType;
  jobTitle: string | null;
  capabilities: CapabilityMap;
  isOwner: boolean;
  isActive: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
