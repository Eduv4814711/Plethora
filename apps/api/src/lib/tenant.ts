import type { FastifyRequest } from "fastify";
import type { JWTPayload } from "./types.js";
import { prisma } from "./prisma.js";

export function getUserCompanyId(request: FastifyRequest): string {
  if (!request.user?.companyId) {
    throw new Error("Authenticated user with companyId required");
  }
  return request.user.companyId;
}

export function companyScopedWhere(companyId: string, id: string) {
  return { id, companyId };
}

export async function requireTenantRecord<T extends { id: string; companyId: string }>(
  find: () => Promise<T | null>,
  companyId: string
): Promise<T | null> {
  const record = await find();
  if (!record || record.companyId !== companyId) return null;
  return record;
}

export function tenantUser(user: JWTPayload) {
  return { companyId: user.companyId, userId: user.sub };
}
