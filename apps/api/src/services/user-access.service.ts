import type { FastifyRequest } from "fastify";
import type { AccountType, Prisma } from "@prisma/client";
import { auditFromRequest } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import {
  diffCapabilities,
  findUnassignableCapability,
  hasCapability,
  normalizeCapabilities,
  type CapabilityMap,
} from "../lib/capabilities.js";
import {
  generatePasswordSetupToken,
  hashPassword,
  hashPasswordSetupToken,
} from "./auth.service.js";

/**
 * The mutations behind user access, lifted out of the route handlers so the
 * immediate path (the company owner saving a change) and the deferred path (the
 * owner approving an access manager's proposal) apply *exactly* the same change
 * and write exactly the same audit rows. The only difference between them is
 * `source`, which records who proposed a change the owner then allowed.
 */

export type TxClient = Prisma.TransactionClient;

export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  accountType: true,
  jobTitle: true,
  isActive: true,
  companyId: true,
  capabilities: true,
  createdAt: true,
} as const;

export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Everything the guards need to know about whoever is proposing a change. */
export interface AccessActor {
  id: string;
  isOwner: boolean;
  isActive: boolean;
  capabilities: unknown;
}

/** Everything the guards need to know about the account being changed. */
export interface AccessTarget {
  id: string;
  email: string;
  accountType: AccountType;
  jobTitle: string | null;
  isActive: boolean;
  capabilities: unknown;
  isOwner: boolean;
}

export interface AccessGuardError {
  status: 400 | 403;
  message: string;
}

/** Set when the change is being applied because the owner approved a proposal. */
export interface AccessChangeSource {
  requestId: string;
  requestedById: string;
  requestedByEmail?: string | null;
  /** True when the owner applied a proposal whose before-state had since drifted. */
  driftAcknowledged?: boolean;
}

export interface UserCreatePayload {
  name: string;
  email: string;
  accountType: AccountType;
  jobTitle: string | null;
  isActive: boolean;
  capabilities: CapabilityMap;
  sendSetupLink: boolean;
  /** Only ever set on the immediate path — a proposal never carries a password. */
  password?: string;
}

export interface UserUpdatePayload {
  name?: string;
  email?: string;
  accountType?: AccountType;
  jobTitle?: string | null;
  isActive?: boolean;
  capabilities?: CapabilityMap;
}

function sourceMetadata(source: AccessChangeSource | null) {
  if (!source) return {};
  return {
    requestId: source.requestId,
    requestedById: source.requestedById,
    ...(source.requestedByEmail ? { requestedByEmail: source.requestedByEmail } : {}),
    ...(source.driftAcknowledged ? { driftAcknowledged: true } : {}),
  };
}

/**
 * The capabilities this change would newly grant. Only additions are checked for
 * escalation: taking access away is always allowed to anyone who may edit.
 */
export function capabilityAdditions(before: unknown, requested: CapabilityMap): CapabilityMap {
  const previous = normalizeCapabilities(before);
  const additions: CapabilityMap = {};
  for (const [path, capabilities] of Object.entries(requested)) {
    const newlyGranted = capabilities.filter(
      (capability) => !(previous[path] ?? []).includes(capability)
    );
    if (newlyGranted.length) additions[path] = newlyGranted;
  }
  return additions;
}

function escalationError(actor: AccessActor, additions: CapabilityMap): AccessGuardError | null {
  const unassignable = findUnassignableCapability(actor, additions);
  if (!unassignable) return null;
  return {
    status: 403,
    message: `You cannot assign ${unassignable.capability} access for ${unassignable.path}`,
  };
}

export function checkUserCreateAllowed(
  actor: AccessActor,
  capabilities: CapabilityMap
): AccessGuardError | null {
  return escalationError(actor, capabilities);
}

export function checkUserUpdateAllowed(
  actor: AccessActor,
  target: AccessTarget,
  payload: UserUpdatePayload
): AccessGuardError | null {
  if (target.isOwner && actor.id !== target.id) {
    return { status: 403, message: "Only the company owner may update the owner account" };
  }
  if (target.isOwner && payload.isActive === false) {
    return { status: 400, message: "Transfer ownership before deactivating the company owner" };
  }
  const targetManagesAccess = hasCapability(
    { capabilities: target.capabilities, isActive: target.isActive },
    "/settings/access",
    "manage_access"
  );
  if (!actor.isOwner && targetManagesAccess) {
    return { status: 403, message: "Only the company owner may update another access manager" };
  }
  if (!actor.isOwner && target.id === actor.id && payload.capabilities !== undefined) {
    return { status: 403, message: "Access managers cannot change their own capabilities" };
  }
  if (payload.capabilities !== undefined) {
    return escalationError(actor, capabilityAdditions(target.capabilities, payload.capabilities));
  }
  return null;
}

export function checkUserDeactivateAllowed(
  actor: AccessActor,
  target: AccessTarget
): AccessGuardError | null {
  if (target.isOwner) {
    return { status: 400, message: "Transfer ownership before deleting the company owner" };
  }
  if (target.id === actor.id) {
    return { status: 400, message: "You cannot delete your own account" };
  }
  if (
    !actor.isOwner &&
    hasCapability(
      { capabilities: target.capabilities, isActive: target.isActive },
      "/settings/access",
      "manage_access"
    )
  ) {
    return { status: 403, message: "Only the company owner may delete another access manager" };
  }
  return null;
}

/**
 * Creates the account and records it. The setup token is returned rather than
 * stored, so the caller can hand the invite link to whoever performed the
 * change — the creating manager on the immediate path, the owner on approval.
 */
export async function applyUserCreate(
  request: FastifyRequest,
  tx: TxClient,
  params: {
    companyId: string;
    payload: UserCreatePayload;
    source?: AccessChangeSource | null;
  }
): Promise<{ user: UserRow; setupToken: string | null }> {
  const { payload } = params;
  const inviteMode = payload.sendSetupLink;
  const setupToken = inviteMode ? generatePasswordSetupToken() : null;
  const passwordHash = payload.password
    ? await hashPassword(payload.password)
    : await hashPassword(generatePasswordSetupToken());

  const user = await tx.user.create({
    data: {
      companyId: params.companyId,
      name: payload.name,
      email: payload.email.toLowerCase(),
      passwordHash,
      passwordSetupRequired: inviteMode,
      passwordSetupTokenHash: setupToken ? hashPasswordSetupToken(setupToken) : null,
      passwordSetupTokenExpiresAt: setupToken ? new Date(Date.now() + SETUP_TOKEN_TTL_MS) : null,
      accountType: payload.accountType,
      jobTitle: payload.jobTitle || null,
      isActive: payload.isActive,
      capabilities: payload.capabilities,
    },
    select: USER_SELECT,
  });

  await auditFromRequest(
    request,
    {
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      metadata: {
        targetEmail: user.email,
        accountType: user.accountType,
        capabilities: payload.capabilities,
        invited: inviteMode,
        ...diffCapabilities({}, payload.capabilities),
        ...sourceMetadata(params.source ?? null),
      },
    },
    tx
  );

  return { user, setupToken };
}

export async function applyUserUpdate(
  request: FastifyRequest,
  tx: TxClient,
  params: {
    id: string;
    existing: AccessTarget;
    payload: UserUpdatePayload;
    source?: AccessChangeSource | null;
  }
): Promise<UserRow> {
  const { payload, existing } = params;
  const updateData: Prisma.UserUpdateInput = {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.email !== undefined ? { email: payload.email.toLowerCase() } : {}),
    ...(payload.accountType !== undefined ? { accountType: payload.accountType } : {}),
    ...(payload.jobTitle !== undefined ? { jobTitle: payload.jobTitle || null } : {}),
    ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
    ...(payload.capabilities !== undefined ? { capabilities: payload.capabilities } : {}),
  };

  const user = await tx.user.update({
    where: { id: params.id },
    data: updateData,
    select: USER_SELECT,
  });

  if (payload.isActive === false) {
    await tx.refreshToken.updateMany({
      where: { userId: params.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await auditFromRequest(
    request,
    {
      action: "user.access.update",
      entityType: "user",
      entityId: params.id,
      metadata: {
        targetEmail: user.email,
        before: {
          accountType: existing.accountType,
          jobTitle: existing.jobTitle,
          isActive: existing.isActive,
          capabilities: existing.capabilities,
        },
        after: {
          accountType: user.accountType,
          jobTitle: user.jobTitle,
          isActive: user.isActive,
          capabilities: user.capabilities,
        },
        // Plain-language view of what actually changed, so the audit page
        // does not have to diff two JSON blobs to say "granted Payroll · approve".
        ...diffCapabilities(existing.capabilities, user.capabilities),
        deactivated: payload.isActive === false ? true : undefined,
        ...sourceMetadata(params.source ?? null),
      },
    },
    tx
  );

  return user;
}

export function checkPasswordResetAllowed(
  actor: AccessActor,
  target: AccessTarget
): AccessGuardError | null {
  if (!target.isActive) {
    return { status: 400, message: "Reactivate this account before issuing a reset link" };
  }
  if (target.isOwner && actor.id !== target.id) {
    return { status: 403, message: "Only the company owner may reset the owner's password" };
  }
  // Whoever holds the link controls the account, so the peer protection that
  // governs editing an access manager has to govern resetting one too.
  if (
    !actor.isOwner &&
    target.id !== actor.id &&
    hasCapability(
      { capabilities: target.capabilities, isActive: target.isActive },
      "/settings/access",
      "manage_access"
    )
  ) {
    return {
      status: 403,
      message: "Only the company owner may reset another access manager's password",
    };
  }
  return null;
}

/**
 * Issues a single-use link that lets someone set their own password, reusing the
 * same token the invite flow uses. The current password keeps working until the
 * link is used, so issuing one can never lock a person out; any link issued
 * earlier stops working, because only the newest hash is stored.
 */
export async function issuePasswordResetToken(
  request: FastifyRequest,
  tx: TxClient,
  params: { id: string; targetEmail: string }
): Promise<{ token: string; expiresAt: Date }> {
  const token = generatePasswordSetupToken();
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);

  await tx.user.update({
    where: { id: params.id },
    data: {
      passwordSetupRequired: true,
      passwordSetupTokenHash: hashPasswordSetupToken(token),
      passwordSetupTokenExpiresAt: expiresAt,
      // A previously used token leaves this set, and the validate query demands
      // it be null, so a re-issued link would be dead on arrival without this.
      passwordSetupTokenConsumedAt: null,
    },
  });

  await auditFromRequest(
    request,
    {
      action: "user.password.reset_link",
      entityType: "user",
      entityId: params.id,
      metadata: { targetEmail: params.targetEmail, expiresAt },
    },
    tx
  );

  return { token, expiresAt };
}

export async function applyUserDeactivate(
  request: FastifyRequest,
  tx: TxClient,
  params: {
    id: string;
    existing: Pick<AccessTarget, "capabilities">;
    source?: AccessChangeSource | null;
  }
): Promise<void> {
  await tx.user.update({
    where: { id: params.id },
    data: {
      isActive: false,
      capabilities: {},
      passwordSetupRequired: false,
      passwordSetupTokenHash: null,
      passwordSetupTokenExpiresAt: null,
    },
  });
  await tx.refreshToken.updateMany({
    where: { userId: params.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await auditFromRequest(
    request,
    {
      action: "user.deactivate",
      entityType: "user",
      entityId: params.id,
      metadata: {
        previousCapabilities: params.existing.capabilities,
        ...diffCapabilities(params.existing.capabilities, {}),
        ...sourceMetadata(params.source ?? null),
      },
    },
    tx
  );
}

/** Loads the guard-relevant view of an account, including whether it is the owner. */
export async function loadAccessTarget(
  companyId: string,
  id: string
): Promise<AccessTarget | null> {
  const row = await prisma.user.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      jobTitle: true,
      isActive: true,
      capabilities: true,
      company: { select: { ownerUserId: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    accountType: row.accountType,
    jobTitle: row.jobTitle,
    isActive: row.isActive,
    capabilities: row.capabilities,
    isOwner: row.company.ownerUserId === row.id,
  };
}

/** The actor view of whoever raised a request, re-read at apply time. */
export async function loadAccessActor(
  companyId: string,
  id: string
): Promise<AccessActor | null> {
  const row = await prisma.user.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      isActive: true,
      capabilities: true,
      company: { select: { ownerUserId: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    isActive: row.isActive,
    capabilities: row.capabilities,
    isOwner: row.company.ownerUserId === row.id,
  };
}
