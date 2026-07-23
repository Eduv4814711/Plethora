import type { NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hasCapability, normalizeCapabilities } from "../../lib/capabilities.js";
import { sendText } from "../../whatsapp/services/send.service.js";

export type CreateNotificationInput = {
  companyId: string;
  userId: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  dedupeKey: string;
  sourceModule?: string;
  sourceId?: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function createNotification(input: CreateNotificationInput) {
  try {
    const existing = await prisma.appNotification.findFirst({
      where: {
        companyId: input.companyId,
        dedupeKey: input.dedupeKey,
      },
    });
    if (existing) return { notification: existing, created: false as const };

    const notification = await prisma.appNotification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        title: input.title,
        message: input.message,
        channel: input.channel ?? "IN_APP",
        status: "SENT",
        sentAt: new Date(),
        dedupeKey: input.dedupeKey,
        sourceModule: input.sourceModule,
        sourceId: input.sourceId,
        linkUrl: input.linkUrl,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    if (input.channel === "WHATSAPP") {
      void dispatchWhatsAppNotification(input.userId, input.message).catch(() => undefined);
    }

    return { notification, created: true as const };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { notification: null, created: false as const };
    }
    const again = await prisma.appNotification.findFirst({
      where: { companyId: input.companyId, dedupeKey: input.dedupeKey },
    }).catch(() => null);
    if (again) return { notification: again, created: false as const };
    throw new Error("Failed to create notification");
  }
}

function isMissingTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2021"
  );
}

async function dispatchWhatsAppNotification(userId: string, message: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, companyId: true },
  });
  if (!user?.email) return;
  const employee = await prisma.employee.findFirst({
    where: {
      companyId: user.companyId,
      email: user.email,
      phone: { not: null },
    },
    select: { phone: true },
  });
  const phone = employee?.phone?.trim();
  if (!phone) return;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return;
  await sendText(digits, message.slice(0, 1000));
}

export async function listNotificationsForUser(
  companyId: string,
  userId: string,
  opts?: { unreadOnly?: boolean; limit?: number }
) {
  try {
    const items = await prisma.appNotification.findMany({
      where: {
        companyId,
        userId,
        ...(opts?.unreadOnly ? { readAt: null, status: { not: "READ" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 50,
    });
    const unreadCount = await prisma.appNotification.count({
      where: { companyId, userId, readAt: null, status: { not: "READ" } },
    });
    return { items, unreadCount };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { items: [], unreadCount: 0 };
    }
    throw err;
  }
}

export async function markNotificationRead(params: {
  companyId: string;
  userId: string;
  notificationId: string;
}) {
  const n = await prisma.appNotification.findFirst({
    where: {
      id: params.notificationId,
      companyId: params.companyId,
      userId: params.userId,
    },
  });
  if (!n) return null;
  return prisma.appNotification.update({
    where: { id: n.id },
    data: { status: "READ", readAt: new Date() },
  });
}

export async function markAllNotificationsRead(companyId: string, userId: string) {
  await prisma.appNotification.updateMany({
    where: { companyId, userId, readAt: null },
    data: { status: "READ", readAt: new Date() },
  });
}

/** Notify active users who can currently view the module (plus the company owner). */
export async function notifyModuleUsers(params: {
  companyId: string;
  modulePath: string;
  title: string;
  message: string;
  dedupeKeyPrefix: string;
  sourceModule?: string;
  sourceId?: string;
  linkUrl?: string;
}) {
  const users = await prisma.user.findMany({
    where: { companyId: params.companyId, isActive: true },
    select: {
      id: true,
      capabilities: true,
      company: { select: { ownerUserId: true } },
    },
  });

  let created = 0;
  for (const u of users) {
    if (!hasCapability(
      {
        isOwner: u.company.ownerUserId === u.id,
        isActive: true,
        capabilities: normalizeCapabilities(u.capabilities),
      },
      params.modulePath,
      "view"
    )) continue;

    const result = await createNotification({
      companyId: params.companyId,
      userId: u.id,
      title: params.title,
      message: params.message,
      dedupeKey: `${params.dedupeKeyPrefix}:user:${u.id}`,
      sourceModule: params.sourceModule,
      sourceId: params.sourceId,
      linkUrl: params.linkUrl,
      channel: params.title.toLowerCase().includes("critical") ? "WHATSAPP" : "IN_APP",
    });
    if (result.created) created += 1;
  }
  return { created };
}
