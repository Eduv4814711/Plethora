import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { config } from "../lib/config.js";
import type { UserRole } from "@prisma/client";
import { resolveEffectiveModuleAccess } from "../lib/module-access.js";
import { findFirstUserAuthScalars, findManyUserAuthScalars, findUniqueUserAuthScalars } from "../lib/user-module-column.js";
import { loadUserAccess } from "./user-access.service.js";
import { ALL_PERMISSIONS } from "../lib/permissions.js";
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
  role: UserRole;
  roleLabel?: string | null;
  companyId: string;
  moduleAccess: string[] | null;
  accessVersion: number;
  isSystemOwner: boolean;
  permissions: string[];
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

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function buildPayload(user: {
  id: string;
  email: string;
  companyId: string;
  role: UserRole;
  moduleAccess?: unknown;
  accessVersion?: number;
  isSystemOwner?: boolean;
}) {
  const isSystemOwner = user.isSystemOwner === true;
  const moduleAccess = resolveEffectiveModuleAccess({
    role: user.role,
    moduleAccess: user.moduleAccess,
    isSystemOwner,
  });
  return {
    sub: user.id,
    email: user.email,
    companyId: user.companyId,
    role: user.role,
    accessVersion: user.accessVersion ?? 1,
    isSystemOwner,
    ...(moduleAccess ? { moduleAccess } : {}),
  };
}

async function buildPublicUser(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleLabel?: string | null;
  companyId: string;
  moduleAccess?: unknown;
  accessVersion?: number;
  isSystemOwner?: boolean;
}): Promise<AuthUserPublic> {
  const access = await loadUserAccess(user.id);
  const isSystemOwner = user.isSystemOwner ?? access?.isSystemOwner ?? false;
  const moduleAccess = resolveEffectiveModuleAccess({
    role: user.role,
    moduleAccess: user.moduleAccess,
    isSystemOwner,
  });
  const permissions = isSystemOwner
    ? [...ALL_PERMISSIONS]
    : access
      ? [...access.permissions]
      : [];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleLabel: user.roleLabel ?? null,
    companyId: user.companyId,
    moduleAccess,
    accessVersion: user.accessVersion ?? access?.accessVersion ?? 1,
    isSystemOwner,
    permissions,
  };
}

function issueJwtPair(user: {
  id: string;
  email: string;
  companyId: string;
  role: UserRole;
  moduleAccess?: unknown;
  accessVersion?: number;
  isSystemOwner?: boolean;
  name: string;
  roleLabel?: string | null;
}): Promise<AuthResult> {
  const payload = buildPayload(user);

  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry,
  });

  const refreshToken = jwt.sign(
    { ...payload, type: "refresh" },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry }
  );

  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;

  return buildPublicUser(user).then((publicUser) => ({
    user: publicUser,
    accessToken,
    refreshToken,
    expiresIn,
  }));
}

export async function login(
  input: LoginInput,
  meta?: RefreshTokenMeta
): Promise<AuthResult | null> {
  const email = input.email.toLowerCase();

  const user = input.companyId
    ? await findFirstUserAuthScalars({ email, companyId: input.companyId })
    : null;

  if (user) {
    if (user.passwordSetupRequired) return null;
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) return null;
  } else if (input.companyId) {
    return null;
  }

  let matchedUser = user;
  if (!matchedUser) {
    const candidates = await findManyUserAuthScalars({ email });
    for (const candidate of candidates) {
      if (candidate.passwordSetupRequired) continue;
      const valid = await verifyPassword(input.password, candidate.passwordHash);
      if (valid) {
        matchedUser = candidate;
        break;
      }
    }
  }
  if (!matchedUser) return null;

  const result = await issueJwtPair(matchedUser);
  await persistRefreshToken(matchedUser.id, result.refreshToken, meta);
  return result;
}

export interface UserForTokens {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleLabel?: string | null;
  companyId: string;
  moduleAccess?: unknown;
  accessVersion?: number;
  isSystemOwner?: boolean;
}

export function generatePasswordSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueTokensForUser(
  user: UserForTokens,
  meta?: RefreshTokenMeta
): Promise<AuthResult> {
  const result = await issueJwtPair(user);
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
      role: UserRole;
      moduleAccess?: unknown;
      type?: string;
    };

    if (decoded.type !== "refresh") return null;

    const active = await isRefreshTokenActive(refreshToken, decoded.sub);
    if (!active) return null;

    const user = await findUniqueUserAuthScalars({ id: decoded.sub });
    if (!user) return null;

    const result = await issueJwtPair(user);
    const rotated = await rotateRefreshToken(
      refreshToken,
      result.refreshToken,
      user.id,
      meta
    );
    if (!rotated) return null;

    return result;
  } catch {
    return null;
  }
}

export async function logoutUser(userId?: string, refreshToken?: string): Promise<void> {
  if (refreshToken) {
    const { revokeRefreshToken } = await import("./refresh-token.service.js");
    await revokeRefreshToken(refreshToken);
    return;
  }
  if (userId) {
    await revokeAllUserRefreshTokens(userId);
  }
}
