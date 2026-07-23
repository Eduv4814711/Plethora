import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile } from "fs/promises";
import { join } from "path";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability } from "../middleware/authorization.js";
import { createAuditLog } from "../lib/audit.js";
import {
  parseAndValidateEmployees,
  parseAndValidateSites,
  parseAndValidateEmployeeGroups,
  executeSelfImport,
  checkFileSize,
  exportEmployeesToCsv,
  exportSitesToCsv,
  exportEmployeeGroupsToCsv,
  type ValidatedEmployee,
  type ValidatedSite,
  type ValidatedEmployeeGroup,
} from "../services/migration.service.js";
import { prisma } from "../lib/prisma.js";
import { hasCapability, type Capability } from "../lib/capabilities.js";

const TEMPLATES_DIR = join(process.cwd(), "src", "templates");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIGRATION_FILE_SIZE = 10 * 1024 * 1024; // 10MB for multipart (3 files)

const migrationModuleByType = {
  employees: "/employees",
  groups: "/employees",
  sites: "/sites",
} as const;

function denyMissingMigrationCapabilities(
  request: FastifyRequest,
  reply: import("fastify").FastifyReply,
  fileTypes: string[],
  capability: Capability
): boolean {
  const denied = fileTypes.filter((type) => {
    const modulePath = migrationModuleByType[type as keyof typeof migrationModuleByType];
    return !modulePath || !hasCapability(request.user!, modulePath, capability);
  });
  if (denied.length === 0) return false;
  reply.code(403).send({
    error: "Forbidden",
    message: `${capability} access is required for: ${denied.join(", ")}`,
  });
  return true;
}

/** Collect multipart files by field name. Uses request.files() for multiple files. */
async function collectMultipartFiles(
  request: FastifyRequest,
  fieldNames: string[]
): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  try {
    const files = request.files({ limits: { fileSize: MIGRATION_FILE_SIZE } });
    for await (const part of files) {
      if (fieldNames.includes(part.fieldname)) {
        result[part.fieldname] = await part.toBuffer();
      }
    }
  } catch {
    // No files or error - return empty
  }
  return result;
}

export async function migrationsRoutes(app: FastifyInstance) {
  // Migration access follows the records being imported/exported; settings
  // access alone must not grant bulk access to Team or Sites data.
  app.get("/templates/:type", { preHandler: authMiddleware }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const filename =
      type === "employees"
          ? "employees-import-template.csv"
          : type === "sites"
            ? "sites-import-template.csv"
            : type === "groups"
              ? "employee-groups-import-template.csv"
              : null;

    if (!filename) {
      return reply
        .code(400)
        .send({ error: "Invalid template type", message: "Use: employees, sites, or groups" });
    }
    if (denyMissingMigrationCapabilities(request, reply, [type], "create")) return;

    const filepath = join(TEMPLATES_DIR, filename);
    try {
      const content = await readFile(filepath, "utf-8");
      return reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(content);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Template not found" });
    }
  });

  // GET /migrations/export/employees - Download employees as CSV
  app.get("/export/employees", { preHandler: [authMiddleware, requireCapability("/employees", "export")] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    const companyName = company?.name ?? "Company";
    const csv = await exportEmployeesToCsv(companyId, companyName);
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="employees-export.csv"')
      .send(csv);
  });

  // GET /migrations/export/sites - Download sites as CSV
  app.get("/export/sites", { preHandler: [authMiddleware, requireCapability("/sites", "export")] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    const companyName = company?.name ?? "Company";
    const csv = await exportSitesToCsv(companyId, companyName);
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="sites-export.csv"')
      .send(csv);
  });

  // GET /migrations/export/groups - Employee groups as CSV (same columns as import template)
  app.get("/export/groups", { preHandler: [authMiddleware, requireCapability("/employees", "export")] }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const csv = await exportEmployeeGroupsToCsv(companyId);
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="employee-groups-export.csv"')
      .send(csv);
  });

  // POST /migrations/preview - Validate upload, return preview + errors (no DB write)
  app.post("/preview", { preHandler: authMiddleware }, async (request, reply) => {
    const fieldNames = ["employees", "sites", "groups"];
    const filesCollected = await collectMultipartFiles(request, fieldNames);
    if (
      denyMissingMigrationCapabilities(
        request,
        reply,
        Object.keys(filesCollected),
        "create"
      )
    ) return;

    let employees = { valid: [] as ValidatedEmployee[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let sites = { valid: [] as ValidatedSite[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let groups = { valid: [] as ValidatedEmployeeGroup[], errors: [] as { row: number; field: string; value: string; message: string }[] };

    if (filesCollected.employees) {
      if (!checkFileSize(filesCollected.employees, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "employees.csv must be under 5MB" });
      }
      employees = parseAndValidateEmployees(filesCollected.employees);
    }

    if (filesCollected.sites) {
      if (!checkFileSize(filesCollected.sites, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "sites.csv must be under 5MB" });
      }
      sites = parseAndValidateSites(filesCollected.sites);
    }

    if (filesCollected.groups) {
      if (!checkFileSize(filesCollected.groups, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "groups CSV must be under 5MB" });
      }
      groups = parseAndValidateEmployeeGroups(filesCollected.groups);
    }

    return reply.send({
      employees: { validCount: employees.valid.length, valid: employees.valid, errors: employees.errors },
      sites: { validCount: sites.valid.length, valid: sites.valid, errors: sites.errors },
      groups: { validCount: groups.valid.length, valid: groups.valid, errors: groups.errors },
    });
  });

  // POST /migrations/import - Company self-migration (employees + sites + employee groups)
  app.post("/import", { preHandler: authMiddleware }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const filesCollected = await collectMultipartFiles(request, ["employees", "sites", "groups"]);

    if (!filesCollected.employees && !filesCollected.sites && !filesCollected.groups) {
      return reply.code(400).send({
        error: "No files",
        message: "Upload at least employees.csv, sites.csv, or employee groups CSV",
      });
    }
    if (
      denyMissingMigrationCapabilities(
        request,
        reply,
        Object.keys(filesCollected),
        "create"
      )
    ) return;

    let employees = { valid: [] as ValidatedEmployee[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let sites = { valid: [] as ValidatedSite[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let groups = { valid: [] as ValidatedEmployeeGroup[], errors: [] as { row: number; field: string; value: string; message: string }[] };

    if (filesCollected.employees) {
      if (!checkFileSize(filesCollected.employees, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "employees.csv must be under 5MB" });
      }
      employees = parseAndValidateEmployees(filesCollected.employees);
    }

    if (filesCollected.sites) {
      if (!checkFileSize(filesCollected.sites, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "sites.csv must be under 5MB" });
      }
      sites = parseAndValidateSites(filesCollected.sites);
    }

    if (filesCollected.groups) {
      if (!checkFileSize(filesCollected.groups, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "groups CSV must be under 5MB" });
      }
      groups = parseAndValidateEmployeeGroups(filesCollected.groups);
    }

    if (employees.errors.length > 0 || sites.errors.length > 0 || groups.errors.length > 0) {
      return reply.code(400).send({
        error: "Validation failed",
        message: "Fix errors before importing",
        employees: { errors: employees.errors },
        sites: { errors: sites.errors },
        groups: { errors: groups.errors },
      });
    }

    const result = await executeSelfImport(companyId, employees.valid, sites.valid, groups.valid);

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "migration.self_import",
      entityType: "migration",
      metadata: {
        employeesCreated: result.employeesCreated,
        sitesCreated: result.sitesCreated,
        groupsCreated: result.groupsCreated,
        groupsSkipped: result.groupsSkipped,
        errors: result.errors,
      },
    });

    return reply.send(result);
  });
}
