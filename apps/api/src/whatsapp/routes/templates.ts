import type { FastifyInstance } from "fastify";
import { authProtect } from "../../middleware/auth-protect.js";
import { requireRole } from "../../middleware/rbac.js";
import { config } from "../../lib/config.js";

const GRAPH_URL = "https://graph.facebook.com";

/**
 * Returns list of approved WhatsApp message templates.
 * Uses Meta's Message Templates API when WABA ID is configured,
 * otherwise returns default templates (hello_world is pre-approved for testing).
 */
export async function templatesRoutes(app: FastifyInstance) {
  const protect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      module: "/whatsapp",
    }),
  ];

  app.get("/templates", { preHandler: protect }, async (request, reply) => {
    const wabaId = process.env.WHATSAPP_WABA_ID;
    const customTemplates = process.env.WHATSAPP_TEMPLATES?.split(",").map((s) => s.trim()).filter(Boolean);

    if (wabaId && config.whatsapp.enabled) {
      try {
        const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${wabaId}/message_templates`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
        });
        if (res.ok) {
          const json = (await res.json()) as { data?: Array<{ name: string; language: string; status: string }> };
          const templates = (json.data ?? [])
            .filter((t) => t.status === "APPROVED")
            .map((t) => ({ name: t.name, language: t.language }));
          return reply.send({ data: templates });
        }
      } catch (err) {
        request.log.warn(err, "Failed to fetch templates from Meta");
      }
    }

    // Fallback: return default templates
    const defaults = ["hello_world"];
    const names = customTemplates?.length ? customTemplates : defaults;
    const data = names.map((name) => ({ name, language: "en" }));
    return reply.send({ data });
  });
}
