import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import type { UserRole } from "@prisma/client";

export interface LoginInput {
  email: string;
  password: string;
  companyId?: string;
}

export interface AuthResult {
  user: { id: string; name: string; email: string; role: UserRole; companyId: string };
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

export async function login(input: LoginInput): Promise<AuthResult | null> {
  const user = await prisma.user.findFirst({
    where: {
      email: input.email.toLowerCase(),
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
  });

  if (!user) return null;

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) return null;

  const payload = {
    sub: user.id,
    email: user.email,
    companyId: user.companyId,
    role: user.role,
  };

  const accessToken = jwt.sign(
    payload,
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: "refresh" },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry }
  );

  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    },
    accessToken,
    refreshToken,
    expiresIn,
  };
}

export interface UserForTokens {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId: string;
}

export function issueTokensForUser(user: UserForTokens): AuthResult {
  const payload = {
    sub: user.id,
    email: user.email,
    companyId: user.companyId,
    role: user.role,
  };

  const accessToken = jwt.sign(
    payload,
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: "refresh" },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry }
  );

  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    },
    accessToken,
    refreshToken,
    expiresIn,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthResult | null> {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      sub: string;
      email: string;
      companyId: string;
      role: UserRole;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
    });

    if (!user) return null;

    const payload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
    };

    const accessToken = jwt.sign(
      payload,
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiry }
    );

    const newRefreshToken = jwt.sign(
      { ...payload, type: "refresh" },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiry }
    );

    const accessDecoded = jwt.decode(accessToken) as { exp?: number };
    const expiresIn = accessDecoded?.exp ? accessDecoded.exp - Math.floor(Date.now() / 1000) : 900;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      },
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    };
  } catch {
    return null;
  }
}
