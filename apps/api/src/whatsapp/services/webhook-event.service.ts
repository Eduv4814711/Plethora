import { prisma } from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";

export type RecordEventResult = {
  isDuplicate: boolean;
  canProcess: boolean;
  isRetry: boolean;
  eventId?: string;
};

/**
 * Attempts to record an inbound webhook event atomically in the database.
 * If the event was already recorded:
 * - If PROCESSED or currently PROCESSING, prevents duplicate execution and safely returns canProcess: false.
 * - If FAILED, atomically claims the event for retry (status: "PROCESSING") and returns canProcess: true.
 * - Prevents concurrent duplicate deliveries from executing retries simultaneously.
 */
export async function recordInboundWebhookEvent(params: {
  metaEventId: string;
  eventType: string;
  phoneNumberId?: string;
  payload?: unknown;
}): Promise<RecordEventResult> {
  const { metaEventId, eventType, phoneNumberId, payload } = params;

  if (!metaEventId) {
    return { isDuplicate: false, canProcess: true, isRetry: false };
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
    return { isDuplicate: false, canProcess: true, isRetry: false, eventId: event.id };
  } catch (error) {
    // Check if error is Prisma Unique constraint violation (P2002)
    const isP2002 =
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
      (error as { code?: string })?.code === "P2002";

    if (!isP2002) {
      throw error;
    }

    // Unique constraint violation: The event exists. Check if it is eligible for retry.
    const existing = await prisma.whatsAppWebhookEvent.findUnique({
      where: { metaEventId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return { isDuplicate: true, canProcess: false, isRetry: false };
    }

    if (existing.status === "PROCESSED") {
      // Successfully processed events must NEVER run again
      return { isDuplicate: true, canProcess: false, isRetry: false, eventId: existing.id };
    }

    if (existing.status === "PROCESSING") {
      // Active in-flight processing; block concurrent duplicates
      return { isDuplicate: true, canProcess: false, isRetry: false, eventId: existing.id };
    }

    if (existing.status === "FAILED") {
      // Atomically claim the failed event for retry so only ONE concurrent request can retry
      const claim = await prisma.whatsAppWebhookEvent.updateMany({
        where: {
          metaEventId,
          status: "FAILED",
        },
        data: {
          status: "PROCESSING",
          errorMessage: null,
          payload: payload ? (payload as Prisma.InputJsonValue) : undefined,
        },
      });

      if (claim.count === 1) {
        return { isDuplicate: false, canProcess: true, isRetry: true, eventId: existing.id };
      }

      // Another concurrent delivery claimed the retry
      return { isDuplicate: true, canProcess: false, isRetry: false, eventId: existing.id };
    }

    return { isDuplicate: true, canProcess: false, isRetry: false, eventId: existing.id };
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

/**
 * Programmatically retries a failed webhook event.
 * Atomically transitions FAILED -> PROCESSING and executes the handler.
 * Guarantees that a PROCESSED event cannot run twice and that concurrent retries cannot execute in parallel.
 */
export async function retryFailedWebhookEvent(
  metaEventId: string,
  handler: (payload: unknown) => Promise<void>
): Promise<{ success: boolean; status: string; error?: string }> {
  if (!metaEventId) {
    return { success: false, status: "INVALID_ID", error: "metaEventId is required" };
  }

  const existing = await prisma.whatsAppWebhookEvent.findUnique({
    where: { metaEventId },
    select: { id: true, status: true, payload: true },
  });

  if (!existing) {
    return { success: false, status: "NOT_FOUND", error: "Webhook event not found" };
  }

  if (existing.status === "PROCESSED") {
    return {
      success: false,
      status: "PROCESSED",
      error: "Event has already been processed successfully and cannot run twice",
    };
  }

  // Atomically claim the retry lease from FAILED -> PROCESSING
  const claim = await prisma.whatsAppWebhookEvent.updateMany({
    where: {
      metaEventId,
      status: "FAILED",
    },
    data: {
      status: "PROCESSING",
      errorMessage: null,
    },
  });

  if (claim.count === 0) {
    return {
      success: false,
      status: existing.status,
      error: "Event is already processing or not in FAILED status",
    };
  }

  try {
    await handler(existing.payload);
    await markWebhookEventProcessed(metaEventId);
    return { success: true, status: "PROCESSED" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await markWebhookEventFailed(metaEventId, errMsg);
    return { success: false, status: "FAILED", error: errMsg };
  }
}
