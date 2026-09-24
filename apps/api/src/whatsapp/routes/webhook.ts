import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import { verifyWhatsAppWebhookSignature } from "../../lib/whatsapp-signature.js";
import {
  processAndSend,
  processLocationAndSend,
  processLeaveDocumentAndSend,
  findEmployeeByPhone,
  sendUnsupportedTypeReply,
} from "../services/handler.service.js";
import {
  recordInboundWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from "../services/webhook-event.service.js";

interface WhatsAppWebhookQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  location?: { latitude: number; longitude: number };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string; filename?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
}

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  messages?: WhatsAppIncomingMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppChange {
  field?: string;
  value?: WhatsAppValue;
}

interface WhatsAppEntry {
  id?: string;
  changes?: WhatsAppChange[];
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: WhatsAppEntry[];
}

const WEBHOOK_ROUTE_CONFIG = { config: { rateLimit: false } } as const;

type WebhookRequest = FastifyRequest & { rawBody?: string };

function verifyWebhookPostSignature(request: WebhookRequest, reply: FastifyReply): boolean {
  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    if (config.isProduction && config.whatsapp.enabled) {
      request.log.error("WhatsApp is enabled without an app secret; refusing unsigned webhook");
      reply.code(503).send("Webhook signature verification is unavailable");
      return false;
    }
    return true;
  }

  const signature = request.headers["x-hub-signature-256"];
  const header = Array.isArray(signature) ? signature[0] : signature;
  const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
  if (!verifyWhatsAppWebhookSignature(rawBody, header, appSecret)) {
    request.log.warn("Rejected WhatsApp webhook with invalid signature");
    reply.code(403).send("Forbidden");
    return false;
  }
  return true;
}

function isWebhookForConfiguredNumber(metadata?: { phone_number_id?: string }): boolean {
  const configuredId = config.whatsapp.phoneNumberId;
  if (!configuredId || !metadata?.phone_number_id) return true;
  return metadata.phone_number_id === configuredId;
}

async function storeInboundMessage(
  from: string,
  msg: WhatsAppIncomingMessage,
  msgType: string,
  text: string,
  log: FastifyRequest["log"]
): Promise<void> {
  const employee = await findEmployeeByPhone(from);
  if (!employee) return;

  const existing = await prisma.whatsAppMessage.findFirst({
    where: { whatsappMessageId: msg.id, direction: "inbound" },
    select: { id: true },
  });
  if (existing) return;

  await prisma.whatsAppMessage
    .create({
      data: {
        companyId: employee.companyId,
        employeeId: employee.id,
        whatsappMessageId: msg.id,
        direction: "inbound",
        type: msgType,
        text,
      },
    })
    .catch((err) => log.warn(err, "Failed to store inbound WhatsApp message"));
}

export async function handleInboundMessage(
  msg: WhatsAppIncomingMessage,
  log: FastifyRequest["log"]
): Promise<void> {
  const from = msg.from;
  let text: string | undefined;
  let msgType = "text";

  if (msg.type === "text" && msg.text?.body) {
    text = msg.text.body;
  } else if (msg.type === "interactive" && msg.interactive) {
    const id = msg.interactive.button_reply?.id ?? msg.interactive.list_reply?.id;
    if (id) {
      text = id;
      msgType = "interactive";
    }
  } else if (msg.type === "location" && msg.location) {
    await storeInboundMessage(
      from,
      msg,
      "location",
      `${msg.location.latitude},${msg.location.longitude}`,
      log
    );
    await processLocationAndSend(from, msg.location.latitude, msg.location.longitude);
    return;
  } else if ((msg.type === "image" && msg.image?.id) || (msg.type === "document" && msg.document?.id)) {
    const media = msg.type === "image" ? msg.image! : msg.document!;
    const caption = media.caption;
    await storeInboundMessage(from, msg, msg.type, caption ?? `[${msg.type}]`, log);
    await processLeaveDocumentAndSend(
      from,
      media.id,
      media.mime_type ?? (msg.type === "image" ? "image/jpeg" : "application/pdf"),
      msg.type === "document" ? msg.document?.filename : undefined,
      caption
    );
    return;
  }

  if (!text) {
    log.info({ from, messageType: msg.type, messageId: msg.id }, "Unsupported WhatsApp message type");
    await sendUnsupportedTypeReply(from);
    return;
  }

  log.info({ from, messageType: msgType, messageId: msg.id }, "Processing inbound WhatsApp message");
  await storeInboundMessage(from, msg, msgType, text, log);
  await processAndSend(from, text);
}

export async function webhookRoutes(app: FastifyInstance) {
  if (app.hasContentTypeParser("application/json")) {
    app.removeContentTypeParser("application/json");
  }
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      try {
        const raw = typeof body === "string" ? body : body.toString("utf8");
        (request as WebhookRequest).rawBody = raw;
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  app.get(
    "/webhook",
    WEBHOOK_ROUTE_CONFIG,
    async (request: FastifyRequest<{ Querystring: WhatsAppWebhookQuery }>, reply: FastifyReply) => {
      const mode = request.query["hub.mode"];
      const token = request.query["hub.verify_token"];
      const challenge = request.query["hub.challenge"];

      const configuredToken = config.whatsapp.verifyToken;
      if (
        mode === "subscribe" &&
        configuredToken &&
        token === configuredToken
      ) {
        return reply.code(200).send(challenge);
      }
      return reply.code(403).send("Forbidden");
    }
  );

  app.post(
    "/webhook",
    WEBHOOK_ROUTE_CONFIG,
    async (request: WebhookRequest, reply: FastifyReply) => {
      if (!config.whatsapp.enabled) {
        request.log.info("Ignoring WhatsApp webhook because the integration is disabled");
        return reply.code(200).send();
      }

      if (!verifyWebhookPostSignature(request, reply)) return;

      const payload = request.body as WhatsAppWebhookBody | undefined;
      if (payload?.object !== "whatsapp_business_account") {
        return reply.code(404).send();
      }

      const body = payload;
      const entries = body.entry ?? [];

      let hasFailures = false;
      let hasInFlightEvents = false;

      for (const entry of entries) {
        const changes = entry.changes ?? [];
        for (const change of changes) {
          const value = change.value;
          if (!value) continue;

          if (!isWebhookForConfiguredNumber(value.metadata)) {
            request.log.warn(
              { phoneNumberId: value.metadata?.phone_number_id },
              "Ignoring WhatsApp webhook for unconfigured phone number"
            );
            continue;
          }

          if (value.statuses) {
            for (const status of value.statuses) {
              await prisma.whatsAppMessage
                .updateMany({
                  where: { whatsappMessageId: status.id },
                  data: { status: status.status },
                })
                .catch((err) =>
                  request.log.warn(err, "Failed to update WhatsApp message status")
                );
            }
          }

          if (!value.messages) continue;

          for (const msg of value.messages) {
            // Check idempotency and retry eligibility before processing
            const deduplication = await recordInboundWebhookEvent({
              metaEventId: msg.id,
              eventType: `message:${msg.type}`,
              phoneNumberId: value.metadata?.phone_number_id,
              payload: msg,
            });

            if (!deduplication.canProcess) {
              if (deduplication.isProcessing) hasInFlightEvents = true;
              request.log.info(
                { messageId: msg.id, from: msg.from },
                deduplication.isProcessing
                  ? "WhatsApp webhook message is still processing"
                  : "Duplicate WhatsApp webhook message ignored"
              );
              continue;
            }

            if (deduplication.isRetry) {
              request.log.info(
                { messageId: msg.id, from: msg.from },
                "Retrying previously failed WhatsApp webhook message"
              );
            }

            try {
              await handleInboundMessage(msg, request.log);
            } catch (err) {
              hasFailures = true;
              const errMsg = err instanceof Error ? err.message : String(err);
              request.log.error(err, "WhatsApp message processing failed");
              await markWebhookEventFailed(msg.id, errMsg);
              continue;
            }

            if (!(await markWebhookEventProcessed(msg.id))) {
              hasInFlightEvents = true;
              request.log.error(
                { messageId: msg.id },
                "WhatsApp message processed, but completion could not be stored; reconcile before retrying"
              );
            }
          }
        }
      }

      if (hasFailures) {
        return reply.code(500).send({
          error: "One or more WhatsApp messages failed processing",
        });
      }

      if (hasInFlightEvents) {
        return reply.code(503).send({
          error: "One or more WhatsApp messages are still processing",
        });
      }

      return reply.code(200).send();
    }
  );
}
