import type { FastifyInstance } from "fastify";
import { webhookRoutes } from "./routes/webhook.js";
import { sendRoutes } from "./routes/send.js";
import { contactsRoutes } from "./routes/contacts.js";
import { messagesRoutes } from "./routes/messages.js";
import { templatesRoutes } from "./routes/templates.js";

export async function registerWhatsApp(app: FastifyInstance): Promise<void> {
  app.register(webhookRoutes);
  app.register(
    async (api) => {
      api.register(sendRoutes);
      api.register(contactsRoutes);
      api.register(messagesRoutes);
      api.register(templatesRoutes);
    },
    { prefix: "/whatsapp" }
  );
}
