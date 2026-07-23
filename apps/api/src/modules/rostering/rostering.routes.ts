import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import {
  applyAutomationRun,
  dismissAutomationRun,
  listAutomationRuns,
  serializeAutomationRun,
} from "../../services/auto-roster.service.js";
import {
  bulkCreateSchema,
  bulkVerifySchema,
  createShiftSchema,
  resetSchema,
  rosterApplySchema,
  rosterPreviewSchema,
  transitionSchema,
  updateShiftSchema,
} from "./rostering.schemas.js";
import {
  isRosteringServiceError,
  rosteringModuleService,
} from "./rostering.service.js";

function sendServiceError(
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  err: { status: number; body: Record<string, unknown> }
) {
  return reply.code(err.status).send(err.body);
}

export async function rosteringRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/rostering",
    }),
  ];
  const verifyProtect = [
    authMiddleware,
    requireAnyCapability(["/rostering", "/payroll"], "approve"),
  ];
  const readProtect = [authMiddleware, requireCapability("/rostering", "view")];
  const editProtect = [authMiddleware, requireCapability("/rostering", "edit")];
  const deleteProtect = [authMiddleware, requireCapability("/rostering", "delete")];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const result = await rosteringModuleService.listShifts(user.companyId, q);
    return reply.send(result);
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createShiftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.createShift(
      request.user!.companyId,
      request.user!.sub,
      parsed.data
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.code(201).send(result.shift);
  });

  app.post("/reset", { preHandler: deleteProtect }, async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.resetShifts(
      request.user!.companyId,
      request.user!.sub,
      parsed.data
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.send(result);
  });

  app.post("/bulk", { preHandler: protect }, async (request, reply) => {
    const parsed = bulkCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.bulkCreate(
      request.user!.companyId,
      request.user!.sub,
      parsed.data
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.code(201).send(result);
  });

  app.post("/roster/preview", { preHandler: readProtect }, async (request, reply) => {
    const parsed = rosterPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.previewRoster(
      request.user!.companyId,
      parsed.data
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.send(result.plan);
  });

  app.post("/roster/apply", { preHandler: editProtect }, async (request, reply) => {
    const parsed = rosterApplySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const result = await rosteringModuleService.applyRoster(
        request.user!.companyId,
        request.user!.sub,
        parsed.data
      );
      if (isRosteringServiceError(result)) {
        return sendServiceError(reply, result);
      }
      return reply.code(201).send(result.result);
    } catch (err) {
      request.log.error({ err }, "roster apply failed");
      return reply.code(500).send({
        error: "Apply failed",
        message: err instanceof Error ? err.message : "Failed to apply roster plan",
      });
    }
  });

  app.get("/roster/automation", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { status?: string };
    const runs = await listAutomationRuns(user.companyId, q.status as never);
    return reply.send({ data: runs.map(serializeAutomationRun) });
  });

  app.post("/roster/automation/:id/apply", { preHandler: editProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await applyAutomationRun(request.user!.companyId, id, request.user!.sub);
    if ("error" in result) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.code(201).send(result);
  });

  app.post("/roster/automation/:id/dismiss", { preHandler: editProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await dismissAutomationRun(request.user!.companyId, id, request.user!.sub);
    if ("error" in result) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.get("/:id/available-relievers", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await rosteringModuleService.listAvailableRelievers(
      request.user!.companyId,
      id
    );
    if ("status" in result && result.status === 404) {
      return reply.code(404).send(result.body);
    }
    return reply.send(result);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await rosteringModuleService.getShift(request.user!.companyId, id);
    if ("status" in result && result.status === 404) {
      return reply.code(404).send(result.body);
    }
    return reply.send(result.shift);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateShiftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.updateShift(
      request.user!.companyId,
      request.user!.sub,
      id,
      parsed.data
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.send(result.shift);
  });

  app.post("/:id/transition", { preHandler: editProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.transitionShift(
      request.user!.companyId,
      request.user!.sub,
      id,
      parsed.data.status
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.send(result.shift);
  });

  app.post("/bulk-verify", { preHandler: verifyProtect }, async (request, reply) => {
    const parsed = bulkVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rosteringModuleService.bulkVerify(
      request.user!.companyId,
      request.user!.sub,
      parsed.data.shiftIds
    );
    return reply.send(result);
  });

  app.post("/:id/verify", { preHandler: verifyProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await rosteringModuleService.verifyShift(
      request.user!.companyId,
      request.user!.sub,
      id
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.send(result.shift);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await rosteringModuleService.deleteShift(
      request.user!.companyId,
      request.user!.sub,
      id
    );
    if (isRosteringServiceError(result)) {
      return sendServiceError(reply, result);
    }
    return reply.code(204).send();
  });
}

/** @deprecated Use rosteringRoutes — kept for existing imports. */
export const shiftsRoutes = rosteringRoutes;
