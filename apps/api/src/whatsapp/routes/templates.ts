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
    const wabaId = config.whatsapp.wabaId;

    if (wabaId && config.whatsapp.enabled && config.whatsapp.accessToken) {
      try {
        const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${encodeURIComponent(wabaId)}/message_templates`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Array<{ name: string; language: string; status: string; category?: string }>;
          };
          const templates = (json.data ?? [])
            .filter((t) => t.status === "APPROVED")
            .map((t) => ({ name: t.name, language: t.language, status: t.status }));
          return reply.send({ data: templates });
        } else {
          request.log.warn(
            { statusCode: res.status },
            "Meta message_templates API returned non-OK status; using fallback templates"
          );
        }
      } catch (err) {
        request.log.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to fetch templates from Meta; using fallback templates"
        );
      }
    }

    // Fallback: return default templates
    const defaults = [{ name: "hello_world", language: "en", status: "APPROVED" }];
    return reply.send({ data: defaults });
  });
}
