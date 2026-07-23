import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import type { AccountType } from "@prisma/client";
import { config } from "../lib/config.js";
import { normalizeCapabilities, type CapabilityMap } from "../lib/capabilities.js";
import {
  findFirstUserAuthScalars,
  findManyUserAuthScalars,
  findUniqueUserAuthScalars,
  type UserAuthScalars,
} from "../lib/user-access.js";
import {
  isRefreshTokenActive,
  persistRefreshToken,
  revokeAllUserRefreshTokens,
  rotateRefreshToken,
  type RefreshTokenMeta,
} from "./refresh-token.service.js";

export interface LoginInput {
  email: string;
  password: string;
  companyId?: string;
}

export interface AuthUserPublic {
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
  jobTitle: string | null;
  isActive: boolean;
  isOwner: boolean;
  companyId: string;
  capabilities: CapabilityMap;
}

export interface AuthResult {
  user: AuthUserPublic;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcrypt.rounds);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

type TokenUser = Pick<
  UserAuthScalars,
  "id" | "name" | "email" | "companyId" | "accountType" | "jobTitle" | "isActive" | "capabilities"
> & {
  company?: { ownerUserId: string | null };
  isOwner?: boolean;
};

function buildPayload(user: Pick<TokenUser, "id" | "email" | "companyId">) {
  return { sub: user.id, email: user.email, companyId: user.companyId };
}

function issueJwtPair(user: TokenUser): AuthResult {
  const payload = buildPayload(user);
  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry,
  });
  const refreshToken = jwt.sign({ ...payload, type: "refresh" }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry,
  });
  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
  const isOwner = user.isOwner ?? user.company?.ownerUserId === user.id;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      jobTitle: user.jobTitle,
      isActive: user.isActive,
      isOwner,
      companyId: user.companyId,
      capabilities: normalizeCapabilities(user.capabilities),
    },
    accessToken,
    refreshToken,
    expiresIn,
  };
}

export async function login(input: LoginInput, meta?: RefreshTokenMeta): Promise<AuthResult | null> {
  const email = input.email.toLowerCase();
  const requested = input.companyId
    ? await findFirstUserAuthScalars({ email, companyId: input.companyId, isActive: true })
    : null;

  if (requested) {
    if (requested.passwordSetupRequired || !(await verifyPassword(input.password, requested.passwordHash))) {
      return null;
    }
  } else if (input.companyId) {
    return null;
  }

  let matchedUser = requested;
  if (!matchedUser) {
    const candidates = await findManyUserAuthScalars({ email, isActive: true });
    for (const candidate of candidates) {
      if (candidate.passwordSetupRequired) continue;
      if (await verifyPassword(input.password, candidate.passwordHash)) {
        matchedUser = candidate;
        break;
      }
    }
  }
  if (!matchedUser) return null;
  const result = issueJwtPair(matchedUser);
  await persistRefreshToken(matchedUser.id, result.refreshToken, meta);
  return result;
}

export type UserForTokens = TokenUser;

export function generatePasswordSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueTokensForUser(user: UserForTokens, meta?: RefreshTokenMeta): Promise<AuthResult> {
  const result = issueJwtPair(user);
  await persistRefreshToken(user.id, result.refreshToken, meta);
  return result;
}

export async function refreshAccessToken(
  refreshToken: string,
  meta?: RefreshTokenMeta
): Promise<AuthResult | null> {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      sub: string;
      email: string;
      companyId: string;
      type?: string;
    };
    if (decoded.type !== "refresh") return null;
    if (!(await isRefreshTokenActive(refreshToken, decoded.sub))) return null;
    const user = await findUniqueUserAuthScalars({ id: decoded.sub });
    if (!user?.isActive) return null;
    const result = issueJwtPair(user);
    const rotated = await rotateRefreshToken(refreshToken, result.refreshToken, user.id, meta);
    return rotated ? result : null;
  } catch {
    return null;
  }
}

export async function logoutUser(userId?: string, refreshToken?: string): Promise<void> {
  if (refreshToken) {
    const { revokeRefreshToken } = await import("./refresh-token.service.js");
    await revokeRefreshToken(refreshToken);
  } else if (userId) {
    await revokeAllUserRefreshTokens(userId);
  }
}
