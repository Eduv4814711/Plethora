import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCrudCapability } from "../../middleware/authorization.js";
import {
  listAlertsQuerySchema,
  resolveAlertBodySchema,
} from "./alerts.schemas.js";
import {
  acknowledgeAlert,
  dismissAlert,
  getAlertCounts,
  listAlerts,
  resolveAlert,
} from "./alerts.service.js";

// Rostering and incidents raise alerts too, so their operators must be able to act on them.
const ALERT_MODULES = [
  "/",
  "/attendance",
  "/sites",
  "/tasks",
  "/payroll",
  "/reports",
  "/rostering",
  "/incidents",
] as const;

export async function alertsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ anyOfModules: [...ALERT_MODULES] }),
  ];
  const editProtect = [
    authMiddleware,
    requireAnyCapability([...ALERT_MODULES], "edit"),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const parsed = listAlertsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid query",
      });
    }
    const result = await listAlerts(user.companyId, parsed.data);
    return reply.send(result);
  });

  app.get("/counts", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const counts = await getAlertCounts(user.companyId);
    return reply.send(counts);
  });

  app.post("/:id/acknowledge", { preHandler: editProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const alert = await acknowledgeAlert({
      companyId: user.companyId,
      alertId: id,
      userId: user.sub,
    });
    if (!alert) {
      return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    }
    return reply.send(alert);
  });

  app.post("/:id/resolve", { preHandler: editProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = resolveAlertBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: body.error.issues[0]?.message ?? "Invalid body",
      });
    }
    const alert = await resolveAlert({
      companyId: user.companyId,
      alertId: id,
      userId: user.sub,
      note: body.data.note,
    });
    if (!alert) {
      return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    }
    return reply.send(alert);
  });

  app.post("/:id/dismiss", { preHandler: editProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const alert = await dismissAlert({
      companyId: user.companyId,
      alertId: id,
      userId: user.sub,
    });
    if (!alert) {
      return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    }
    return reply.send(alert);
  });
}
