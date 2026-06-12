import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import {
  processAndSend,
  processLocationAndSend,
  findEmployeeByPhone,
  sendUnsupportedTypeReply,
} from "../services/handler.service.js";

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

const WEBHOOK_ROUTE_CONFIG = { config: { rateLimit: false } };

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

export async function webhookRoutes(app: FastifyInstance) {
  app.get(
    "/webhook",
    WEBHOOK_ROUTE_CONFIG,
    async (request: FastifyRequest<{ Querystring: WhatsAppWebhookQuery }>, reply: FastifyReply) => {
      const mode = request.query["hub.mode"];
      const token = request.query["hub.verify_token"];
      const challenge = request.query["hub.challenge"];

      if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
        return reply.send(challenge);
      }
      return reply.code(403).send("Forbidden");
    }
  );

  app.post(
    "/webhook",
    WEBHOOK_ROUTE_CONFIG,
    async (request: FastifyRequest<{ Body: WhatsAppWebhookBody }>, reply: FastifyReply) => {
      if (request.body?.object !== "whatsapp_business_account") {
        return reply.code(404).send();
      }

      if (!config.whatsapp.enabled) {
        request.log.warn("WhatsApp webhook received but WhatsApp is not configured");
        return reply.code(200).send();
      }

      const body = request.body as WhatsAppWebhookBody;
      const entries = body.entry ?? [];

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
            let text: string | undefined;
            let msgType = "text";

            if (msg.type === "text" && msg.text?.body) {
              text = msg.text.body;
            } else if (msg.type === "interactive" && msg.interactive) {
              const id =
                msg.interactive.button_reply?.id ?? msg.interactive.list_reply?.id;
              if (id) {
                text = id;
                msgType = "interactive";
              }
            } else if (msg.type === "location" && msg.location) {
              const from = msg.from;
              await storeInboundMessage(
                from,
                msg,
                "location",
                `${msg.location.latitude},${msg.location.longitude}`,
                request.log
              );
              try {
                await processLocationAndSend(
                  from,
                  msg.location.latitude,
                  msg.location.longitude
                );
              } catch (err) {
                request.log.error(err, "WhatsApp location processing failed");
              }
              continue;
            }

            const from = msg.from;

            if (!text) {
              request.log.info(
                { from, messageType: msg.type, messageId: msg.id },
                "Unsupported WhatsApp message type"
              );
              try {
                await sendUnsupportedTypeReply(from);
              } catch (err) {
                request.log.error(err, "Failed to reply to unsupported WhatsApp message type");
              }
              continue;
            }

            request.log.info(
              { from, messageType: msgType, messageId: msg.id },
              "Processing inbound WhatsApp message"
            );

            await storeInboundMessage(from, msg, msgType, text, request.log);

            try {
              await processAndSend(from, text);
            } catch (err) {
              request.log.error(err, "WhatsApp message processing failed");
            }
          }
        }
      }

      return reply.code(200).send();
    }
  );
}
