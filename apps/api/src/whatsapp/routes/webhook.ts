import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import { processAndSend, findEmployeeByPhone } from "../services/handler.service.js";

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

export async function webhookRoutes(app: FastifyInstance) {
  app.get("/webhook", async (request: FastifyRequest<{ Querystring: WhatsAppWebhookQuery }>, reply: FastifyReply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
      return reply.send(challenge);
    }
    return reply.code(403).send("Forbidden");
  });

  app.post("/webhook", async (request: FastifyRequest<{ Body: WhatsAppWebhookBody }>, reply: FastifyReply) => {
    if (request.body?.object !== "whatsapp_business_account") {
      return reply.code(404).send();
    }

    const body = request.body as WhatsAppWebhookBody;
    const entries = body.entry ?? [];

    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        const value = change.value;
        if (!value) continue;

        // Handle incoming messages
        if (change.field === "messages" && value.messages) {
          for (const msg of value.messages) {
            if (msg.type !== "text" || !msg.text?.body) continue;

            const from = msg.from;
            const text = msg.text.body;

            // Store inbound message before processing
            const employee = await findEmployeeByPhone(from);
            if (employee) {
              await prisma.whatsAppMessage.create({
                data: {
                  companyId: employee.companyId,
                  employeeId: employee.id,
                  whatsappMessageId: msg.id,
                  direction: "inbound",
                  type: "text",
                  text,
                },
              }).catch((err) => request.log.warn(err, "Failed to store inbound WhatsApp message"));
            }

            processAndSend(from, text).catch((err) => {
              request.log.error(err, "WhatsApp message processing failed");
            });
          }
        }

        // Handle status updates (sent, delivered, read)
        if (change.field === "messages" && value.statuses) {
          for (const status of value.statuses) {
            await prisma.whatsAppMessage.updateMany({
              where: { whatsappMessageId: status.id },
              data: { status: status.status },
            }).catch((err) => request.log.warn(err, "Failed to update WhatsApp message status"));
          }
        }
      }
    }

    return reply.code(200).send();
  });
}
