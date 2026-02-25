import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../lib/config.js";
import { processAndSend } from "../services/whatsapp-handler.service.js";

interface WhatsAppWebhookQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  messages?: WhatsAppMessage[];
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

export async function whatsappWebhookRoutes(app: FastifyInstance) {
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
        if (change.field !== "messages") continue;
        const value = change.value;
        if (!value?.messages) continue;

        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;

          const from = msg.from;
          const text = msg.text.body;

          processAndSend(from, text).catch((err) => {
            request.log.error(err, "WhatsApp message processing failed");
          });
        }
      }
    }

    return reply.code(200).send();
  });
}
