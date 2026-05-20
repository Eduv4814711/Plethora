import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import type { UserRole } from "@prisma/client";

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiresAt(): Date {
  const ms = 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

export interface RefreshTokenMeta {
  userAgent?: string;
  ipAddress?: string;
}

export async function persistRefreshToken(
  userId: string,
  refreshToken: string,
  meta?: RefreshTokenMeta
): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt(),
      userAgent: meta?.userAgent?.slice(0, 512),
      ipAddress: meta?.ipAddress?.slice(0, 64),
    },
  });
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function rotateRefreshToken(
  oldToken: string,
  newToken: string,
  userId: string,
  meta?: RefreshTokenMeta
): Promise<boolean> {
  const oldHash = hashRefreshToken(oldToken);
  const now = new Date();

  const existing = await prisma.refreshToken.findFirst({
    where: {
      userId,
      tokenHash: oldHash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });

  if (!existing) return false;

  const newRecord = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(newToken),
      expiresAt: refreshExpiresAt(),
      userAgent: meta?.userAgent?.slice(0, 512),
      ipAddress: meta?.ipAddress?.slice(0, 64),
      replacedByTokenId: undefined,
    },
  });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: now, replacedByTokenId: newRecord.id },
  });

  return true;
}

export async function isRefreshTokenActive(refreshToken: string, userId: string): Promise<boolean> {
  const tokenHash = hashRefreshToken(refreshToken);
  const row = await prisma.refreshToken.findFirst({
    where: {
      userId,
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return !!row;
}

export function signRefreshJwt(payload: {
  sub: string;
  email: string;
  companyId: string;
  role: UserRole;
  moduleAccess?: unknown;
}): string {
  return jwt.sign(
    { ...payload, type: "refresh" },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry }
  );
}

export function generateRefreshJwtId(): string {
  return randomBytes(16).toString("hex");
}
