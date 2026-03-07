import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile } from "fs/promises";
import { join } from "path";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { requireRole } from "../middleware/rbac.js";
import { createAuditLog } from "../lib/audit.js";
import {
  parseAndValidateCompanies,
  parseAndValidateEmployees,
  parseAndValidateSites,
  executeSelfImport,
  checkFileSize,
  exportEmployeesToCsv,
  exportSitesToCsv,
  type ValidatedCompany,
  type ValidatedEmployee,
  type ValidatedSite,
} from "../services/migration.service.js";
import { prisma } from "../lib/prisma.js";

const TEMPLATES_DIR = join(process.cwd(), "src", "templates");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIGRATION_FILE_SIZE = 10 * 1024 * 1024; // 10MB for multipart (3 files)

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
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"])];
  const adminProtect = [authMiddleware, requireAdmin()];

  // GET /migrations/templates/:type - Download CSV template
  app.get("/templates/:type", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const filename =
      type === "company"
        ? "company-import-template.csv"
        : type === "employees"
          ? "employees-import-template.csv"
          : type === "sites"
            ? "sites-import-template.csv"
            : null;

    if (!filename) {
      return reply.code(400).send({ error: "Invalid template type", message: "Use: company, employees, or sites" });
    }

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
  app.get("/export/employees", { preHandler: protect }, async (request, reply) => {
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
  app.get("/export/sites", { preHandler: protect }, async (request, reply) => {
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

  // POST /migrations/preview - Validate upload, return preview + errors (no DB write)
  app.post("/preview", { preHandler: protect }, async (request, reply) => {
    const fieldNames = ["companies", "employees", "sites"];
    const filesCollected = await collectMultipartFiles(request, fieldNames);

    let companies = { valid: [] as ValidatedCompany[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let employees = { valid: [] as ValidatedEmployee[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let sites = { valid: [] as ValidatedSite[], errors: [] as { row: number; field: string; value: string; message: string }[] };

    const isAdmin = request.user!.role === "admin";

    if (filesCollected.companies) {
      if (!checkFileSize(filesCollected.companies, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "companies.csv must be under 5MB" });
      }
      companies = parseAndValidateCompanies(filesCollected.companies);
    }

    if (filesCollected.employees) {
      if (!checkFileSize(filesCollected.employees, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "employees.csv must be under 5MB" });
      }
      employees = parseAndValidateEmployees(filesCollected.employees, {
        requireCompanyName: isAdmin && !!filesCollected.companies,
      });
    }

    if (filesCollected.sites) {
      if (!checkFileSize(filesCollected.sites, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "sites.csv must be under 5MB" });
      }
      sites = parseAndValidateSites(filesCollected.sites, {
        requireCompanyName: isAdmin && !!filesCollected.companies,
      });
    }

    return reply.send({
      companies: { validCount: companies.valid.length, valid: companies.valid, errors: companies.errors },
      employees: { validCount: employees.valid.length, valid: employees.valid, errors: employees.errors },
      sites: { validCount: sites.valid.length, valid: sites.valid, errors: sites.errors },
    });
  });

  // POST /migrations/import - Company self-migration (employees + sites only)
  app.post("/import", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const filesCollected = await collectMultipartFiles(request, ["employees", "sites"]);

    if (!filesCollected.employees && !filesCollected.sites) {
      return reply.code(400).send({
        error: "No files",
        message: "Upload at least employees.csv or sites.csv",
      });
    }

    let employees = { valid: [] as ValidatedEmployee[], errors: [] as { row: number; field: string; value: string; message: string }[] };
    let sites = { valid: [] as ValidatedSite[], errors: [] as { row: number; field: string; value: string; message: string }[] };

    if (filesCollected.employees) {
      if (!checkFileSize(filesCollected.employees, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "employees.csv must be under 5MB" });
      }
      employees = parseAndValidateEmployees(filesCollected.employees, { requireCompanyName: false });
    }

    if (filesCollected.sites) {
      if (!checkFileSize(filesCollected.sites, MAX_FILE_BYTES)) {
        return reply.code(400).send({ error: "File too large", message: "sites.csv must be under 5MB" });
      }
      sites = parseAndValidateSites(filesCollected.sites, { requireCompanyName: false });
    }

    if (employees.errors.length > 0 || sites.errors.length > 0) {
      return reply.code(400).send({
        error: "Validation failed",
        message: "Fix errors before importing",
        employees: { errors: employees.errors },
        sites: { errors: sites.errors },
      });
    }

    const result = await executeSelfImport(companyId, employees.valid, sites.valid);

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "migration.self_import",
      entityType: "migration",
      metadata: {
        employeesCreated: result.employeesCreated,
        sitesCreated: result.sitesCreated,
        errors: result.errors,
      },
    });

    return reply.send(result);
  });

  // POST /migrations/admin/bulk-create - Disabled: no platform admin; new companies via POST /auth/onboard only
  app.post("/admin/bulk-create", { preHandler: adminProtect }, async (_request, reply) => {
    return reply.code(403).send({
      error: "Forbidden",
      message: "Creating multiple companies is not available. New companies sign up via the Register page.",
    });
  });
}
