import { prisma } from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";

export type RecordEventResult = {
  isDuplicate: boolean;
  eventId?: string;
};

/**
 * Attempts to record an inbound webhook event atomically in the database.
 * If the event was already recorded (or a concurrent duplicate arrives at the same millisecond),
 * the unique constraint on `metaEventId` prevents duplicate execution and safely returns isDuplicate: true.
 */
export async function recordInboundWebhookEvent(params: {
  metaEventId: string;
  eventType: string;
  phoneNumberId?: string;
  payload?: unknown;
}): Promise<RecordEventResult> {
  const { metaEventId, eventType, phoneNumberId, payload } = params;

  if (!metaEventId) {
    return { isDuplicate: false };
  }

  try {
    const event = await prisma.whatsAppWebhookEvent.create({
      data: {
        metaEventId,
        eventType,
        phoneNumberId,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.DbNull,
        status: "PROCESSING",
      },
      select: { id: true },
    });
    return { isDuplicate: false, eventId: event.id };
  } catch (error) {
    // Check if error is Prisma Unique constraint violation (P2002)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { isDuplicate: true };
    }
    // Also handle generic check if mock or different driver
    if ((error as { code?: string })?.code === "P2002") {
      return { isDuplicate: true };
    }
    throw error;
  }
}

/**
 * Marks the webhook event as successfully processed.
 */
export async function markWebhookEventProcessed(metaEventId: string): Promise<void> {
  if (!metaEventId) return;
  try {
    await prisma.whatsAppWebhookEvent.updateMany({
      where: { metaEventId },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });
  } catch {
    // Non-fatal if status update fails
  }
}

/**
 * Marks the webhook event as failed.
 */
export async function markWebhookEventFailed(
  metaEventId: string,
  errorMessage: string
): Promise<void> {
  if (!metaEventId) return;
  try {
    await prisma.whatsAppWebhookEvent.updateMany({
      where: { metaEventId },
      data: {
        status: "FAILED",
        errorMessage: errorMessage.slice(0, 1000),
      },
    });
  } catch {
    // Non-fatal if status update fails
  }
}
