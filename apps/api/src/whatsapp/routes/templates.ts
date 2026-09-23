import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { config } from "../../lib/config.js";

const GRAPH_URL = "https://graph.facebook.com";

/**
 * Returns list of approved WhatsApp message templates.
 * Uses Meta's Message Templates API when WABA ID is configured,
 * otherwise returns default templates (hello_world is pre-approved for testing).
 */
export async function templatesRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.get("/templates", { preHandler: protect }, async (request, reply) => {
    if (!config.whatsapp.enabled) {
      return reply.code(400).send({
        error: "WhatsApp integration is not enabled in system configuration",
      });
    }

    const wabaId = config.whatsapp.wabaId;
    if (!wabaId || !config.whatsapp.accessToken) {
      return reply.code(400).send({
        error: "WhatsApp WABA ID or Access Token is not configured",
      });
    }

    try {
      const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${encodeURIComponent(wabaId)}/message_templates`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
      });

      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{
            name: string;
            language: string;
            status: string;
            category?: string;
            components?: Array<{
              type: string;
              text?: string;
              format?: string;
              example?: { body_text?: string[][] };
              [key: string]: unknown;
            }>;
          }>;
        };
        const templates = (json.data ?? [])
          .filter((t) => t.status === "APPROVED")
          .map((t) => ({
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            components: t.components,
          }));
        return reply.send({ data: templates });
      }

      const errText = await res.text();
      request.log.warn(
        { statusCode: res.status },
        "Meta message_templates API returned non-OK status"
      );

      let userMsg = "Failed to fetch approved templates from Meta";
      try {
        const errJson = JSON.parse(errText) as { error?: { message?: string } };
        if (errJson?.error?.message) {
          userMsg = `Meta API error: ${errJson.error.message}`;
        }
      } catch {
        // use default userMsg
      }

      return reply.code(502).send({ error: userMsg });
    } catch (err) {
      request.log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to fetch templates from Meta"
      );
      return reply.code(502).send({
        error: "Network error while connecting to Meta WhatsApp API",
      });
    }
  });
}
