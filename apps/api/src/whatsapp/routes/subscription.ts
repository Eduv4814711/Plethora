import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { subscribeAppToWaba, getSubscribedApps } from "../services/waba.service.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.post("/subscription", { preHandler: protect }, async (request, reply) => {
    const result = await subscribeAppToWaba();
    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: result.error ?? "Failed to subscribe app to WABA",
      });
    }
    return reply.send({ success: true, data: result.data });
  });

  app.get("/subscription", { preHandler: protect }, async (request, reply) => {
    const result = await getSubscribedApps();
    if (!result.success) {
      return reply.code(400).send({
        success: false,
        error: result.error ?? "Failed to get subscribed apps from WABA",
      });
    }
    return reply.send({ success: true, data: result.data });
  });
}
