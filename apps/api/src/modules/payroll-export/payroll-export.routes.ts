import type { FastifyInstance, FastifyReply } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import {
  createBatchSchema,
  createProfileSchema,
  lockBatchSchema,
  previewExportSchema,
  updateProfileSchema,
  voidBatchSchema,
} from "./payroll-export.schemas.js";
import {
  PayrollExportError,
  createBatch,
  createProfile,
  deleteDraftBatch,
  deleteProfile,
  downloadBatch,
  exportEmployeeMasterCsv,
  getBatchDetail,
  getExportReadinessSummary,
  listBatches,
  listCompanyPeriods,
  listProfiles,
  lockBatch,
  previewExport,
  updateProfile,
  voidBatch,
} from "./payroll-export.service.js";

function handleExportError(reply: FastifyReply, err: unknown) {
  if (err instanceof PayrollExportError) {
    return reply.code(err.statusCode).send({
      error: err.code,
      message: err.message,
      ...(err.details ?? {}),
    });
  }
  throw err;
}

export async function payrollExportRoutes(app: FastifyInstance) {
  const viewAuth = [authMiddleware, requireCapability("/payroll-exports", "view")];
  const createAuth = [authMiddleware, requireCapability("/payroll-exports", "create")];
  const editAuth = [authMiddleware, requireCapability("/payroll-exports", "edit")];
  const approveAuth = [authMiddleware, requireCapability("/payroll-exports", "approve")];
  const exportAuth = [authMiddleware, requireCapability("/payroll-exports", "export")];
  const employeeMasterAuth = [
    authMiddleware,
    requireCapability("/payroll-exports", "export"),
    requireCapability("/employees", "view_sensitive"),
  ];

  app.get("/profiles", { preHandler: viewAuth }, async (request, reply) => {
    const profiles = await listProfiles(request.user!.companyId);
    return reply.send({ profiles });
  });

  app.post("/profiles", { preHandler: editAuth }, async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const profile = await createProfile(request.user!.companyId, request, parsed.data);
      return reply.code(201).send(profile);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.patch("/profiles/:id", { preHandler: editAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProfileSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const profile = await updateProfile(request.user!.companyId, id, request, parsed.data);
      return reply.send(profile);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.delete("/profiles/:id", { preHandler: editAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteProfile(request.user!.companyId, id, request);
      return reply.code(204).send();
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.get("/periods", { preHandler: viewAuth }, async (request, reply) => {
    const periods = await listCompanyPeriods(request.user!.companyId);
    return reply.send({ periods });
  });

  app.get("/readiness", { preHandler: viewAuth }, async (request, reply) => {
    const q = request.query as { periodKey?: string };
    try {
      const result = await getExportReadinessSummary(request.user!.companyId, q.periodKey);
      return reply.send(result);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.get("/preview", { preHandler: viewAuth }, async (request, reply) => {
    const q = request.query as { periodKey?: string; profileId?: string; splitBySite?: string };
    const parsed = previewExportSchema.safeParse({
      periodKey: q.periodKey,
      profileId: q.profileId,
      splitBySite:
        q.splitBySite === "true" ? true : q.splitBySite === "false" ? false : undefined,
    });
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const result = await previewExport(request.user!.companyId, parsed.data);
      return reply.send(result);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.post("/preview", { preHandler: viewAuth }, async (request, reply) => {
    const parsed = previewExportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const result = await previewExport(request.user!.companyId, parsed.data);
      return reply.send(result);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.get("/batches", { preHandler: viewAuth }, async (request, reply) => {
    const q = request.query as { periodKey?: string; status?: string };
    const batches = await listBatches(request.user!.companyId, q);
    return reply.send({ batches });
  });

  app.get("/batches/:id", { preHandler: viewAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const batch = await getBatchDetail(request.user!.companyId, id);
      return reply.send(batch);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.post("/batches", { preHandler: createAuth }, async (request, reply) => {
    const parsed = createBatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const batch = await createBatch(
        request.user!.companyId,
        request.user!.sub,
        request,
        parsed.data
      );
      return reply.code(201).send(batch);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.delete("/batches/:id", { preHandler: editAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteDraftBatch(request.user!.companyId, id, request);
      return reply.code(204).send();
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.post("/batches/:id/lock", { preHandler: approveAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = lockBatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const batch = await lockBatch(
        request.user!.companyId,
        id,
        request.user!.sub,
        request,
        parsed.data
      );
      return reply.send(batch);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.get("/batches/:id/download", { preHandler: exportAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await downloadBatch(
        request.user!.companyId,
        id,
        request.user!.sub,
        request
      );
      if (result.checksumSha256) {
        reply.header("X-Export-Checksum-Sha256", result.checksumSha256);
      }
      return reply
        .header("Content-Type", result.mimeType)
        .header("Content-Disposition", `attachment; filename="${result.filename}"`)
        .send(result.content);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.post("/batches/:id/void", { preHandler: approveAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = voidBatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const batch = await voidBatch(
        request.user!.companyId,
        id,
        request.user!.sub,
        request,
        parsed.data.reason
      );
      return reply.send(batch);
    } catch (err) {
      return handleExportError(reply, err);
    }
  });

  app.get("/employee-master.csv", { preHandler: employeeMasterAuth }, async (request, reply) => {
    const result = await exportEmployeeMasterCsv(request.user!.companyId, request);
    return reply
      .header("Content-Type", result.mimeType)
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.content);
  });
}
