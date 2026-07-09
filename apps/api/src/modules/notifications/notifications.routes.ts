import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import {
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service.js";

/** In-app notifications are scoped to the authenticated user — any logged-in role. */
export async function notificationsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { unreadOnly?: string; limit?: string };
    const result = await listNotificationsForUser(user.companyId, user.sub, {
      unreadOnly: q.unreadOnly === "true",
      limit: q.limit ? Number(q.limit) : 50,
    });
    return reply.send(result);
  });

  app.post("/:id/read", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const n = await markNotificationRead({
      companyId: user.companyId,
      userId: user.sub,
      notificationId: id,
    });
    if (!n) {
      return reply.code(404).send({ error: "Not found", message: "Notification not found" });
    }
    return reply.send(n);
  });

  app.post("/read-all", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    await markAllNotificationsRead(user.companyId, user.sub);
    return reply.send({ ok: true });
  });
}
