import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, type AcademyInstructorStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { hasCapability } from "../../lib/capabilities.js";
import { privateDownloadUrl, sendPrivateStoredFile } from "../../lib/private-download.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import {
  academyProtect,
  ACADEMY_DOCUMENT_ALLOWED_TYPES,
  ACADEMY_MAX_FILE_BYTES,
} from "./constants.js";
import { readStreamToBuffer, storage } from "../../lib/storage.js";
import { INSTRUCTOR_RESTRICTED_FIELDS, canAccessSensitiveData, hasRestrictedFields, omitFields } from "../../lib/sensitive-data.js";
import {
  extensionForMime,
  matchesMagicBytes,
  sanitizeUploadFilename,
} from "../../lib/upload-validation.js";
const STATUS_VALUES = ["active", "inactive", "suspended", "contract_ended"] as const;
const SORT_VALUES = [
  "newest",
  "oldest",
  "name_asc",
  "name_desc",
  "contract_expiry_soonest",
  "updated_desc",
  "compliance_risk_highest",
] as const;
const DOCUMENT_VERIFICATION_VALUES = ["verified", "pending_review", "missing", "expired"] as const;
const CONTRACT_EXPIRY_FILTERS = ["all", "expiring_30", "expired", "valid"] as const;
const COMPLIANCE_FILTERS = [
  "compliant",
  "attention_needed",
  "high_risk",
  "pending_review",
  "missing_contract",
  "missing_certificate",
  "expired_contract",
  "expired_certificate",
] as const;
const REQUIRED_DOCUMENT_TYPES = ["instructor_certificate", "employment_contract", "confirmation_letter"] as const;
const EXPIRY_SOON_DAYS = 30;

const optionalString = z.string().trim().optional().nullable();
const optionalStringArray = z.array(z.string().trim().min(1)).optional().nullable();
const statusSchema = z.enum(STATUS_VALUES) satisfies z.ZodType<AcademyInstructorStatus>;

const createSchema = z
  .object({
    fullName: z.string().trim().min(1),
    idNumber: optionalString,
    phone: optionalString,
    email: z.string().email().optional().nullable(),
    dateOfBirth: optionalString,
    gender: optionalString,
    residentialAddress: optionalString,
    emergencyContact: optionalString,
    psiraInstructorNumber: optionalString,
    instructorGrade: optionalString,
    qualification: optionalString,
    accreditationScope: optionalString,
    accreditationStatus: optionalString,
    certificateNumber: optionalString,
    certificateIssueDate: optionalString,
    certificateExpiryDate: optionalString,
    employmentType: optionalString,
    contractStartDate: optionalString,
    contractEndDate: optionalString,
    contractStatus: optionalString,
    assignedBranchId: optionalString,
    assignedCourseIds: optionalStringArray,
    complianceStatus: optionalString,
    status: statusSchema.optional(),
    saveAsDraft: z.boolean().optional(),
    notes: optionalString,
  })
  .superRefine((d, ctx) => {
    const isDraft = Boolean(d.saveAsDraft);
    if (!isDraft && !d.phone?.trim() && !d.email?.trim()) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Provide at least phone or email" });
    }
    if (d.idNumber?.trim() && !/^\d{13}$/.test(d.idNumber.trim())) {
      ctx.addIssue({ code: "custom", path: ["idNumber"], message: "ID number must be 13 digits" });
    }
    if (d.psiraInstructorNumber?.trim() && !/^[A-Za-z0-9/-]{5,40}$/.test(d.psiraInstructorNumber.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["psiraInstructorNumber"],
        message: "Invalid PSIRA instructor number format",
      });
    }
    if (!isDraft && !d.psiraInstructorNumber?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["psiraInstructorNumber"],
        message: "PSIRA instructor number is required",
      });
    }
    const contractStart = parseDate(d.contractStartDate);
    const contractEnd = parseDate(d.contractEndDate);
    if (!isDraft && !contractStart) {
      ctx.addIssue({ code: "custom", path: ["contractStartDate"], message: "Invalid contractStartDate" });
    }
    if (!isDraft && !contractEnd) {
      ctx.addIssue({ code: "custom", path: ["contractEndDate"], message: "Invalid contractEndDate" });
    }
    if (contractStart && contractEnd && contractEnd < contractStart) {
      ctx.addIssue({
        code: "custom",
        path: ["contractEndDate"],
        message: "Contract end date cannot be before start date",
      });
    }
  });

const updateSchema = z
  .object({
    fullName: z.string().trim().min(1).optional(),
    idNumber: optionalString,
    phone: optionalString,
    email: z.string().email().optional().nullable(),
    dateOfBirth: optionalString,
    gender: optionalString,
    residentialAddress: optionalString,
    emergencyContact: optionalString,
    psiraInstructorNumber: optionalString,
    instructorGrade: optionalString,
    qualification: optionalString,
    accreditationScope: optionalString,
    accreditationStatus: optionalString,
    certificateNumber: optionalString,
    certificateIssueDate: optionalString,
    certificateExpiryDate: optionalString,
    employmentType: optionalString,
    contractStartDate: optionalString,
    contractEndDate: optionalString,
    contractStatus: optionalString,
    assignedBranchId: optionalString,
    assignedCourseIds: optionalStringArray,
    complianceStatus: optionalString,
    status: statusSchema.optional(),
    saveAsDraft: z.boolean().optional(),
    notes: optionalString,
  })
  .superRefine((d, ctx) => {
    if (d.idNumber?.trim() && !/^\d{13}$/.test(d.idNumber.trim())) {
      ctx.addIssue({ code: "custom", path: ["idNumber"], message: "ID number must be 13 digits" });
    }
    if (d.psiraInstructorNumber?.trim() && !/^[A-Za-z0-9/-]{5,40}$/.test(d.psiraInstructorNumber.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["psiraInstructorNumber"],
        message: "Invalid PSIRA instructor number format",
      });
    }
    const contractStart =
      d.contractStartDate !== undefined ? parseDate(d.contractStartDate) : null;
    const contractEnd = d.contractEndDate !== undefined ? parseDate(d.contractEndDate) : null;
    if (d.contractStartDate !== undefined && !contractStart) {
      ctx.addIssue({ code: "custom", path: ["contractStartDate"], message: "Invalid contractStartDate" });
    }
    if (d.contractEndDate !== undefined && !contractEnd) {
      ctx.addIssue({ code: "custom", path: ["contractEndDate"], message: "Invalid contractEndDate" });
    }
    if (contractStart && contractEnd && contractEnd < contractStart) {
      ctx.addIssue({
        code: "custom",
        path: ["contractEndDate"],
        message: "Contract end date cannot be before start date",
      });
    }
  });

const documentPatchSchema = z.object({
  documentType: optionalString,
  issueDate: optionalString,
  expiryDate: optionalString,
  verificationStatus: z.enum(DOCUMENT_VERIFICATION_VALUES).optional(),
  notes: optionalString,
});

const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum([
    "archive",
    "delete",
    "assign_branch",
    "assign_courses",
    "status",
    "mark_documents_requested",
  ]),
  assignedBranchId: optionalString,
  assignedCourseIds: optionalStringArray,
  status: statusSchema.optional(),
});

function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((target.getTime() - startNow.getTime()) / (1000 * 60 * 60 * 24));
}

function isExpiredDate(date: Date | null): boolean {
  const days = daysUntil(date);
  return days != null && days < 0;
}

function normalizeNullableString(v?: string | null): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(v?: string[] | null): string[] | null {
  if (!v) return null;
  const out = [...new Set(v.map((x) => x.trim()).filter(Boolean))];
  return out.length ? out : null;
}

type AcademyAccessSubject = { isOwner?: boolean; capabilities?: unknown; isActive?: boolean };

function isOwner(user: AcademyAccessSubject): boolean {
  return Boolean(user.isOwner);
}

function canEditInstructorRecords(user: AcademyAccessSubject): boolean {
  return hasCapability(user, "/academy", "edit");
}

function canCreateInstructorRecords(user: AcademyAccessSubject): boolean {
  return hasCapability(user, "/academy", "create");
}

function canManageComplianceDocuments(user: AcademyAccessSubject): boolean {
  return hasCapability(user, "/academy", "approve");
}

function canArchiveOrDeleteInstructors(user: AcademyAccessSubject): boolean {
  return hasCapability(user, "/academy", "delete");
}

function canHandleInstructorPrivateData(user: import("../../lib/types.js").AuthenticatedUser) {
  return canAccessSensitiveData(user, "/academy");
}
function sanitizeInstructor<T extends Record<string, unknown>>(row: T, user: import("../../lib/types.js").AuthenticatedUser) {
  return canHandleInstructorPrivateData(user) ? row : omitFields(row, INSTRUCTOR_RESTRICTED_FIELDS);
}
function rejectInstructorPrivateData(request: { user?: import("../../lib/types.js").AuthenticatedUser; body: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (canHandleInstructorPrivateData(request.user!) || !hasRestrictedFields(request.body, INSTRUCTOR_RESTRICTED_FIELDS)) return false;
  reply.code(403).send({ error: "Forbidden", message: "Sensitive instructor data is restricted to HR/payroll users" });
  return true;
}
function sanitizeInstructorDocument<
  T extends Record<string, unknown> & { id: string; instructorId: string; fileUrl: string },
>(row: T, user: import("../../lib/types.js").AuthenticatedUser) {
  const { fileUrl: _fileUrl, ...metadata } = row;
  const privateFieldsFiltered = canHandleInstructorPrivateData(user)
    ? metadata
    : omitFields(metadata, ["notes"]);
  return hasCapability(user, "/academy", "export")
    ? {
        ...privateFieldsFiltered,
        downloadUrl: privateDownloadUrl(
          `/academy/instructors/${row.instructorId}/documents/${row.id}/download`
        ),
      }
    : privateFieldsFiltered;
}

async function ensureAssignedBranchExists(companyId: string, assignedBranchId?: string | null): Promise<boolean> {
  if (!assignedBranchId) return true;
  const branch = await prisma.academyBranch.findFirst({
    where: { id: assignedBranchId, companyId },
    select: { id: true },
  });
  return Boolean(branch);
}

async function ensureAssignedCoursesExist(companyId: string, assignedCourseIds?: string[] | null): Promise<boolean> {
  if (!assignedCourseIds || assignedCourseIds.length === 0) return true;
  const count = await prisma.course.count({
    where: { companyId, id: { in: assignedCourseIds } },
  });
  return count === assignedCourseIds.length;
}

function computeCertificateStatus(instructor: {
  certificateNumber?: string | null;
  certificateExpiryDate?: Date | null;
}) {
  if (!instructor.certificateNumber?.trim()) return "missing";
  const d = daysUntil(instructor.certificateExpiryDate ?? null);
  if (d == null) return "missing";
  if (d < 0) return "expired";
  if (d <= EXPIRY_SOON_DAYS) return "expiring_soon";
  return "valid";
}

function computeContractStatus(instructor: { contractEndDate?: Date | null }) {
  const d = daysUntil(instructor.contractEndDate ?? null);
  if (d == null) return "missing";
  if (d < 0) return "expired";
  if (d <= EXPIRY_SOON_DAYS) return "expiring_soon";
  return "valid";
}

function computeCompliance(
  instructor: {
    status: AcademyInstructorStatus;
    archivedAt: Date | null;
    complianceStatus?: string | null;
    certificateNumber?: string | null;
    certificateExpiryDate?: Date | null;
    contractEndDate?: Date | null;
  },
  docs: Array<{ documentType: string; verificationStatus: string; expiryDate: Date | null }>
) {
  if (instructor.archivedAt) return "archived";
  if (instructor.complianceStatus?.trim()) return instructor.complianceStatus;

  const docTypes = new Set(docs.map((d) => d.documentType));
  const missingContractDoc = !docTypes.has("employment_contract");
  const missingCertificateDoc = !docTypes.has("instructor_certificate");
  const hasExpiredDoc = docs.some((d) => isExpiredDate(d.expiryDate));
  const hasPending = docs.some((d) => d.verificationStatus !== "verified");

  const certStatus = computeCertificateStatus(instructor);
  const contractStatus = computeContractStatus(instructor);

  if (
    instructor.status === "suspended" ||
    missingContractDoc ||
    missingCertificateDoc ||
    hasExpiredDoc ||
    certStatus === "expired" ||
    contractStatus === "expired"
  ) {
    return "high_risk";
  }
  if (hasPending || certStatus === "expiring_soon" || contractStatus === "expiring_soon") {
    return "attention_needed";
  }
  return "compliant";
}

function complianceRiskWeight(v: string): number {
  if (v === "high_risk") return 3;
  if (v === "attention_needed") return 2;
  if (v === "pending_review") return 1;
  return 0;
}

export async function academyInstructorsRoutes(app: FastifyInstance) {
  const complianceProtect = [
    authMiddleware,
    requireCapability("/academy", "approve"),
  ];
  app.get("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;
    const search = q.search?.trim() || "";
    const status = q.status?.trim() || "";
    const complianceFilter = q.complianceStatus?.trim() || "";
    const contractExpiryFilter = q.contractExpiry?.trim() || "all";
    const branchId = q.branchId?.trim() || "";
    const courseId = q.courseId?.trim() || "";
    const sort = q.sort?.trim() || "newest";
    const includeArchived = q.includeArchived === "true";

    if (status && status !== "archived" && !STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid status filter" });
    }
    if (
      complianceFilter &&
      !COMPLIANCE_FILTERS.includes(complianceFilter as (typeof COMPLIANCE_FILTERS)[number])
    ) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid complianceStatus filter" });
    }
    if (
      contractExpiryFilter &&
      !CONTRACT_EXPIRY_FILTERS.includes(contractExpiryFilter as (typeof CONTRACT_EXPIRY_FILTERS)[number])
    ) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid contractExpiry filter" });
    }
    if (sort && !SORT_VALUES.includes(sort as (typeof SORT_VALUES)[number])) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid sort option" });
    }

    const baseWhere: Prisma.AcademyInstructorWhereInput = {
      companyId,
      ...(status === "archived"
        ? { archivedAt: { not: null } }
        : includeArchived
          ? {}
          : { archivedAt: null }),
      ...(status && status !== "archived" ? { status: status as AcademyInstructorStatus } : {}),
      ...(branchId ? { assignedBranchId: branchId } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { psiraInstructorNumber: { contains: search, mode: "insensitive" } },
              ...(canHandleInstructorPrivateData(request.user!) ? [
                { idNumber: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
              ] : []),
            ],
          }
        : {}),
      ...(courseId ? { assignedCourseIds: { array_contains: [courseId] } } : {}),
    };

    const raw = await prisma.academyInstructor.findMany({
      where: baseWhere,
      include: {
        assignedBranch: { select: { id: true, name: true } },
        documents: {
          where: { deletedAt: null },
          select: { id: true, documentType: true, verificationStatus: true, expiryDate: true },
        },
      },
      take: 2000,
    });

    const allCourseIds = [...new Set(
      raw.flatMap((i) =>
        Array.isArray(i.assignedCourseIds) ? (i.assignedCourseIds as string[]).filter((x) => typeof x === "string") : []
      )
    )];
    const courseMap = new Map<string, { id: string; code: string; title: string }>();
    if (allCourseIds.length > 0) {
      const courses = await prisma.course.findMany({
        where: { companyId, id: { in: allCourseIds } },
        select: { id: true, code: true, title: true },
      });
      for (const c of courses) courseMap.set(c.id, c);
    }

    const derived = raw.map((instructor) => {
      const assignedCourseIds = Array.isArray(instructor.assignedCourseIds)
        ? (instructor.assignedCourseIds as string[]).filter((x) => typeof x === "string")
        : [];
      const assignedCourses = assignedCourseIds
        .map((id) => courseMap.get(id))
        .filter((v): v is { id: string; code: string; title: string } => Boolean(v));
      const contractStatus = computeContractStatus(instructor);
      const certificateStatus = computeCertificateStatus(instructor);
      const complianceStatus = computeCompliance(
        instructor,
        instructor.documents.map((d) => ({
          documentType: d.documentType,
          verificationStatus: d.verificationStatus,
          expiryDate: d.expiryDate,
        }))
      );
      const docTypes = new Set(instructor.documents.map((d) => d.documentType));
      const missingDocumentTypes = REQUIRED_DOCUMENT_TYPES.filter((d) => !docTypes.has(d));
      return {
        ...instructor,
        assignedCourseIds,
        assignedCourses,
        contractStatusComputed: contractStatus,
        contractDaysRemaining: daysUntil(instructor.contractEndDate),
        certificateStatus,
        complianceStatusComputed: complianceStatus,
        missingDocumentTypes,
        missingDocumentsCount: missingDocumentTypes.length,
      };
    });

    const filtered = derived.filter((row) => {
      if (contractExpiryFilter === "expiring_30" && row.contractStatusComputed !== "expiring_soon") return false;
      if (contractExpiryFilter === "expired" && row.contractStatusComputed !== "expired") return false;
      if (contractExpiryFilter === "valid" && row.contractStatusComputed !== "valid") return false;
      if (!complianceFilter) return true;
      if (complianceFilter === "missing_contract") return row.missingDocumentTypes.includes("employment_contract");
      if (complianceFilter === "missing_certificate")
        return row.missingDocumentTypes.includes("instructor_certificate");
      if (complianceFilter === "expired_contract") return row.contractStatusComputed === "expired";
      if (complianceFilter === "expired_certificate") return row.certificateStatus === "expired";
      return row.complianceStatusComputed === complianceFilter;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.createdAt.getTime() - b.createdAt.getTime();
        case "name_asc":
          return a.fullName.localeCompare(b.fullName);
        case "name_desc":
          return b.fullName.localeCompare(a.fullName);
        case "contract_expiry_soonest": {
          const av = a.contractDaysRemaining ?? Number.POSITIVE_INFINITY;
          const bv = b.contractDaysRemaining ?? Number.POSITIVE_INFINITY;
          return av - bv;
        }
        case "updated_desc":
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        case "compliance_risk_highest":
          return (
            complianceRiskWeight(b.complianceStatusComputed) - complianceRiskWeight(a.complianceStatusComputed)
          );
        case "newest":
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });

    const paged = sorted.slice(offset, offset + limit);
    const total = sorted.length;

    const compliant = derived.filter((d) => d.complianceStatusComputed === "compliant").length;
    const complianceScore = derived.length ? Math.round((compliant / derived.length) * 100) : 0;
    const summary = {
      totalInstructors: derived.length,
      activeInstructors: derived.filter((d) => d.status === "active" && !d.archivedAt).length,
      expiringContracts: derived.filter((d) => d.contractStatusComputed === "expiring_soon").length,
      missingDocuments: derived.filter((d) => d.missingDocumentsCount > 0).length,
      suspendedInactive: derived.filter(
        (d) => d.status === "suspended" || d.status === "inactive" || d.status === "contract_ended"
      ).length,
      psiraComplianceScore: complianceScore,
      highRisk: derived.filter((d) => d.complianceStatusComputed === "high_risk").length,
      attentionNeeded: derived.filter((d) => d.complianceStatusComputed === "attention_needed").length,
    };

    return { instructors: paged.map((row) => sanitizeInstructor(row, request.user!)), total, limit, offset, summary };
  });

  app.post("/bulk", { preHandler: authMiddleware }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = bulkActionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }

    const ids = [...new Set(body.data.ids)];
    const action = body.data.action;
    const permitted =
      action === "archive" || action === "delete"
        ? canArchiveOrDeleteInstructors(request.user ?? {})
        : action === "mark_documents_requested"
          ? canManageComplianceDocuments(request.user ?? {})
          : canEditInstructorRecords(request.user ?? {});
    if (!permitted) {
      return reply.code(403).send({ error: "Forbidden", message: `No permission to ${action.replaceAll("_", " ")} instructors` });
    }
    const existing = await prisma.academyInstructor.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      return reply.code(400).send({ error: "Validation error", message: "Some instructor IDs are invalid" });
    }

    let count = 0;
    if (body.data.action === "archive") {
      const result = await prisma.academyInstructor.updateMany({
        where: { companyId, id: { in: ids } },
        data: { archivedAt: new Date(), status: "inactive" },
      });
      count = result.count;
    } else if (body.data.action === "delete") {
      const result = await prisma.academyInstructor.updateMany({
        where: { companyId, id: { in: ids } },
        data: { archivedAt: new Date(), status: "inactive" },
      });
      count = result.count;
    } else if (body.data.action === "assign_branch") {
      const branchId = normalizeNullableString(body.data.assignedBranchId);
      if (!(await ensureAssignedBranchExists(companyId, branchId))) {
        return reply.code(400).send({ error: "Validation error", message: "assignedBranchId not found" });
      }
      const result = await prisma.academyInstructor.updateMany({
        where: { companyId, id: { in: ids } },
        data: { assignedBranchId: branchId },
      });
      count = result.count;
    } else if (body.data.action === "assign_courses") {
      const courseIds = normalizeStringArray(body.data.assignedCourseIds);
      if (!(await ensureAssignedCoursesExist(companyId, courseIds))) {
        return reply.code(400).send({ error: "Validation error", message: "Some assignedCourseIds are invalid" });
      }
      const updates = await prisma.$transaction(
        ids.map((id) =>
          prisma.academyInstructor.update({
            where: { id },
            data: { assignedCourseIds: (courseIds as unknown as Prisma.JsonArray) ?? Prisma.JsonNull },
            select: { id: true },
          })
        )
      );
      count = updates.length;
    } else if (body.data.action === "status") {
      if (!body.data.status) {
        return reply.code(400).send({ error: "Validation error", message: "status is required for this action" });
      }
      const result = await prisma.academyInstructor.updateMany({
        where: { companyId, id: { in: ids } },
        data: { status: body.data.status },
      });
      count = result.count;
    } else if (body.data.action === "mark_documents_requested") {
      const rows = await prisma.academyInstructor.findMany({
        where: { id: { in: ids }, companyId },
        select: { id: true, notes: true },
      });
      const updates = await prisma.$transaction(
        rows.map((row) =>
          prisma.academyInstructor.update({
            where: { id: row.id },
            data: {
              notes: `${row.notes ? `${row.notes}\n` : ""}[${new Date().toISOString()}] Supporting documents requested`,
            },
            select: { id: true },
          })
        )
      );
      count = updates.length;
    }

    await createAuditLog({
      userId,
      companyId,
      action: `academy.instructor.bulk_${body.data.action}`,
      entityType: "AcademyInstructor",
      entityId: ids[0],
      metadata: { ids, count },
    });

    return { ok: true, count };
  });

  app.get("/:id/documents", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const instructor = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!instructor) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });

    const documents = await prisma.academyInstructorDocument.findMany({
      where: { companyId, instructorId: id, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });
    return { documents: documents.map((document) => sanitizeInstructorDocument(document, request.user!)) };
  });

  app.get(
    "/:id/documents/:documentId/download",
    { preHandler: [authMiddleware, requireCapability("/academy", "export")] },
    async (request, reply) => {
      const companyId = request.user!.companyId;
      const { id, documentId } = request.params as { id: string; documentId: string };
      const document = await prisma.academyInstructorDocument.findFirst({
        where: { id: documentId, instructorId: id, companyId, deletedAt: null },
        select: { fileUrl: true, fileName: true },
      });
      if (!document) {
        return reply.code(404).send({ error: "Not found", message: "Document not found" });
      }
      return sendPrivateStoredFile(reply, {
        storedReference: document.fileUrl,
        allowedPrefixes: [`academy/instructors/${companyId}/${id}`],
        fileName: document.fileName,
        mimeType: "application/octet-stream",
      });
    }
  );

  app.post("/:id/documents", { preHandler: complianceProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canHandleInstructorPrivateData(request.user!)) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to upload instructor documents" });
    }
    const { id } = request.params as { id: string };

    const instructor = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!instructor) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file", message: "Please attach a file" });
    }

    const mimetype = data.mimetype;
    if (
      !ACADEMY_DOCUMENT_ALLOWED_TYPES.includes(
        mimetype as (typeof ACADEMY_DOCUMENT_ALLOWED_TYPES)[number]
      )
    ) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images, PDF, Word, Excel, text, CSV",
      });
    }

    const q = request.query as Record<string, string | undefined>;
    const documentType = normalizeNullableString(q.documentType) ?? "supporting_document";
    const issueDate = parseDate(q.issueDate ?? null);
    const expiryDate = parseDate(q.expiryDate ?? null);
    const notes = normalizeNullableString(q.notes ?? null);
    const verificationStatus =
      normalizeNullableString(q.verificationStatus ?? null) ?? "pending_review";

    const ext = extensionForMime(mimetype);
    const filename = `${randomUUID()}.${ext}`;
    const storageKey = `academy/instructors/${companyId}/${id}/${filename}`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, ACADEMY_MAX_FILE_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({
          error: "File too large",
          message: "Maximum file size is 10MB",
        });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    if (!matchesMagicBytes(fileBuffer, mimetype)) {
      return reply.code(400).send({
        error: "Invalid file",
        message: "File content does not match the declared type",
      });
    }

    try {
      await storage.uploadFile({
        key: storageKey,
        body: fileBuffer,
        contentType: mimetype,
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not save the file" });
    }

    const size = fileBuffer.length;
    const fileUrl = storage.getAssetUrl(storageKey);

    const originalName = sanitizeUploadFilename(data.filename || filename, mimetype);
    const document = await prisma.academyInstructorDocument.create({
      data: {
        companyId,
        instructorId: id,
        documentType,
        fileUrl,
        fileName: originalName,
        issueDate,
        expiryDate,
        verificationStatus,
        uploadedByUserId: userId,
        notes,
      },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor_document.create",
      entityType: "AcademyInstructorDocument",
      entityId: document.id,
      metadata: { instructorId: id, documentType, fileName: originalName },
    });

    return reply.code(201).send({ document: sanitizeInstructorDocument(document, request.user!) });
  });

  app.patch("/:id/documents/:documentId", { preHandler: complianceProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canHandleInstructorPrivateData(request.user!)) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to update instructor documents" });
    }
    const { id, documentId } = request.params as { id: string; documentId: string };
    const parsed = documentPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }

    const existing = await prisma.academyInstructorDocument.findFirst({
      where: { id: documentId, instructorId: id, companyId, deletedAt: null },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    const d = parsed.data;
    const verificationStatus = d.verificationStatus ?? existing.verificationStatus;
    const next = await prisma.academyInstructorDocument.update({
      where: { id: documentId },
      data: {
        ...(d.documentType !== undefined ? { documentType: normalizeNullableString(d.documentType) ?? "other" } : {}),
        ...(d.issueDate !== undefined ? { issueDate: parseDate(d.issueDate ?? null) } : {}),
        ...(d.expiryDate !== undefined ? { expiryDate: parseDate(d.expiryDate ?? null) } : {}),
        ...(d.notes !== undefined ? { notes: normalizeNullableString(d.notes) } : {}),
        ...(d.verificationStatus !== undefined
          ? {
              verificationStatus,
              verifiedByUserId: verificationStatus === "verified" ? userId : null,
              verifiedAt: verificationStatus === "verified" ? new Date() : null,
            }
          : {}),
      },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor_document.update",
      entityType: "AcademyInstructorDocument",
      entityId: documentId,
      metadata: parsed.data as Record<string, unknown>,
    });

    return { document: sanitizeInstructorDocument(next, request.user!) };
  });

  app.delete("/:id/documents/:documentId", { preHandler: complianceProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canHandleInstructorPrivateData(request.user!)) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to delete instructor documents" });
    }
    const { id, documentId } = request.params as { id: string; documentId: string };
    const existing = await prisma.academyInstructorDocument.findFirst({
      where: { id: documentId, instructorId: id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    await prisma.academyInstructorDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor_document.soft_delete",
      entityType: "AcademyInstructorDocument",
      entityId: documentId,
      metadata: { instructorId: id },
    });
    return { ok: true };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const instructor = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      include: {
        assignedBranch: true,
        documents: {
          where: { deletedAt: null },
          include: {
            uploadedBy: { select: { id: true, name: true, email: true } },
            verifiedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!instructor) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });

    const assignedCourseIds = Array.isArray(instructor.assignedCourseIds)
      ? (instructor.assignedCourseIds as string[]).filter((x) => typeof x === "string")
      : [];
    const assignedCourses =
      assignedCourseIds.length > 0
        ? await prisma.course.findMany({
            where: { companyId, id: { in: assignedCourseIds } },
            select: { id: true, code: true, title: true },
          })
        : [];

    const contractStatusComputed = computeContractStatus(instructor);
    const certificateStatus = computeCertificateStatus(instructor);
    const complianceStatusComputed = computeCompliance(
      instructor,
      instructor.documents.map((d) => ({
        documentType: d.documentType,
        verificationStatus: d.verificationStatus,
        expiryDate: d.expiryDate,
      }))
    );

    return {
      instructor: sanitizeInstructor({
        ...instructor,
        documents: instructor.documents.map((document) => sanitizeInstructorDocument(document, request.user!)),
        assignedCourseIds,
        assignedCourses,
        contractStatusComputed,
        contractDaysRemaining: daysUntil(instructor.contractEndDate),
        certificateStatus,
        complianceStatusComputed,
      }, request.user!),
    };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    if (rejectInstructorPrivateData(request, reply)) return;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canCreateInstructorRecords(request.user ?? {})) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to create instructors" });
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const d = parsed.data;

    const assignedBranchId = normalizeNullableString(d.assignedBranchId);
    const assignedCourseIds = normalizeStringArray(d.assignedCourseIds);
    if (!(await ensureAssignedBranchExists(companyId, assignedBranchId))) {
      return reply.code(400).send({ error: "Validation error", message: "assignedBranchId not found" });
    }
    if (!(await ensureAssignedCoursesExist(companyId, assignedCourseIds))) {
      return reply.code(400).send({ error: "Validation error", message: "Some assignedCourseIds are invalid" });
    }

    const instructor = await prisma.academyInstructor.create({
      data: {
        companyId,
        fullName: d.fullName.trim(),
        idNumber: normalizeNullableString(d.idNumber),
        dateOfBirth: parseDate(d.dateOfBirth ?? null),
        gender: normalizeNullableString(d.gender),
        residentialAddress: normalizeNullableString(d.residentialAddress),
        emergencyContact: normalizeNullableString(d.emergencyContact),
        psiraInstructorNumber: normalizeNullableString(d.psiraInstructorNumber),
        qualification: normalizeNullableString(d.qualification),
        instructorGrade: normalizeNullableString(d.instructorGrade),
        accreditationScope: normalizeNullableString(d.accreditationScope),
        accreditationStatus: normalizeNullableString(d.accreditationStatus),
        certificateNumber: normalizeNullableString(d.certificateNumber),
        certificateIssueDate: parseDate(d.certificateIssueDate ?? null),
        certificateExpiryDate: parseDate(d.certificateExpiryDate ?? null),
        phone: normalizeNullableString(d.phone),
        email: normalizeNullableString(d.email),
        employmentType: normalizeNullableString(d.employmentType),
        contractStartDate: parseDate(d.contractStartDate) ?? undefined,
        contractEndDate: parseDate(d.contractEndDate) ?? undefined,
        contractStatus: normalizeNullableString(d.contractStatus),
        status: d.status ?? "active",
        assignedBranchId,
        assignedCourseIds: (assignedCourseIds as unknown as Prisma.JsonArray) ?? Prisma.JsonNull,
        complianceStatus: normalizeNullableString(d.complianceStatus),
        notes: normalizeNullableString(d.notes),
        ...(d.saveAsDraft ? { status: "inactive" as const } : {}),
      },
      include: { assignedBranch: { select: { id: true, name: true } } },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor.create",
      entityType: "AcademyInstructor",
      entityId: instructor.id,
      metadata: { fullName: instructor.fullName, status: instructor.status },
    });
    return reply.code(201).send({ instructor: sanitizeInstructor(instructor, request.user!) });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    if (rejectInstructorPrivateData(request, reply)) return;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canEditInstructorRecords(request.user ?? {})) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to update instructors" });
    }
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });

    const existing = await prisma.academyInstructor.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });
    const d = parsed.data;

    const nextContractStart = d.contractStartDate !== undefined ? parseDate(d.contractStartDate) : existing.contractStartDate;
    const nextContractEnd = d.contractEndDate !== undefined ? parseDate(d.contractEndDate) : existing.contractEndDate;
    if (d.contractStartDate !== undefined && !nextContractStart) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid contractStartDate" });
    }
    if (d.contractEndDate !== undefined && !nextContractEnd) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid contractEndDate" });
    }
    if (nextContractStart && nextContractEnd && nextContractEnd < nextContractStart) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Contract end date cannot be before start date",
      });
    }

    const assignedBranchId =
      d.assignedBranchId === undefined ? undefined : normalizeNullableString(d.assignedBranchId);
    if (assignedBranchId !== undefined && !(await ensureAssignedBranchExists(companyId, assignedBranchId))) {
      return reply.code(400).send({ error: "Validation error", message: "assignedBranchId not found" });
    }
    const assignedCourseIds =
      d.assignedCourseIds === undefined ? undefined : normalizeStringArray(d.assignedCourseIds);
    if (
      assignedCourseIds !== undefined &&
      !(await ensureAssignedCoursesExist(companyId, assignedCourseIds))
    ) {
      return reply.code(400).send({ error: "Validation error", message: "Some assignedCourseIds are invalid" });
    }

    const instructor = await prisma.academyInstructor.update({
      where: { id },
      data: {
        ...(d.fullName !== undefined ? { fullName: d.fullName.trim() } : {}),
        ...(d.idNumber !== undefined ? { idNumber: normalizeNullableString(d.idNumber) } : {}),
        ...(d.dateOfBirth !== undefined ? { dateOfBirth: parseDate(d.dateOfBirth ?? null) } : {}),
        ...(d.gender !== undefined ? { gender: normalizeNullableString(d.gender) } : {}),
        ...(d.residentialAddress !== undefined
          ? { residentialAddress: normalizeNullableString(d.residentialAddress) }
          : {}),
        ...(d.emergencyContact !== undefined
          ? { emergencyContact: normalizeNullableString(d.emergencyContact) }
          : {}),
        ...(d.psiraInstructorNumber !== undefined
          ? { psiraInstructorNumber: normalizeNullableString(d.psiraInstructorNumber) }
          : {}),
        ...(d.qualification !== undefined ? { qualification: normalizeNullableString(d.qualification) } : {}),
        ...(d.instructorGrade !== undefined ? { instructorGrade: normalizeNullableString(d.instructorGrade) } : {}),
        ...(d.accreditationScope !== undefined
          ? { accreditationScope: normalizeNullableString(d.accreditationScope) }
          : {}),
        ...(d.accreditationStatus !== undefined
          ? { accreditationStatus: normalizeNullableString(d.accreditationStatus) }
          : {}),
        ...(d.certificateNumber !== undefined
          ? { certificateNumber: normalizeNullableString(d.certificateNumber) }
          : {}),
        ...(d.certificateIssueDate !== undefined
          ? { certificateIssueDate: parseDate(d.certificateIssueDate ?? null) }
          : {}),
        ...(d.certificateExpiryDate !== undefined
          ? { certificateExpiryDate: parseDate(d.certificateExpiryDate ?? null) }
          : {}),
        ...(d.phone !== undefined ? { phone: normalizeNullableString(d.phone) } : {}),
        ...(d.email !== undefined ? { email: normalizeNullableString(d.email) } : {}),
        ...(d.employmentType !== undefined ? { employmentType: normalizeNullableString(d.employmentType) } : {}),
        ...(d.contractStartDate !== undefined ? { contractStartDate: nextContractStart } : {}),
        ...(d.contractEndDate !== undefined ? { contractEndDate: nextContractEnd } : {}),
        ...(d.contractStatus !== undefined ? { contractStatus: normalizeNullableString(d.contractStatus) } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.notes !== undefined ? { notes: normalizeNullableString(d.notes) } : {}),
        ...(assignedBranchId !== undefined ? { assignedBranchId } : {}),
        ...(assignedCourseIds !== undefined
          ? { assignedCourseIds: (assignedCourseIds as unknown as Prisma.JsonArray) ?? Prisma.JsonNull }
          : {}),
        ...(d.complianceStatus !== undefined
          ? { complianceStatus: normalizeNullableString(d.complianceStatus) }
          : {}),
      },
      include: { assignedBranch: { select: { id: true, name: true } } },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor.update",
      entityType: "AcademyInstructor",
      entityId: id,
      metadata: d as Record<string, unknown>,
    });
    return { instructor: sanitizeInstructor(instructor, request.user!) };
  });

  app.post("/:id/archive", { preHandler: authMiddleware }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canArchiveOrDeleteInstructors(request.user ?? {})) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to archive instructors" });
    }
    const { id } = request.params as { id: string };

    const existing = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      select: { id: true, archivedAt: true },
    });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });
    if (existing.archivedAt) return { ok: true };

    await prisma.academyInstructor.update({
      where: { id },
      data: { archivedAt: new Date(), status: "inactive" },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor.archive",
      entityType: "AcademyInstructor",
      entityId: id,
    });
    return { ok: true };
  });

  app.post("/:id/restore", { preHandler: authMiddleware }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canArchiveOrDeleteInstructors(request.user ?? {})) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to restore instructors" });
    }
    const { id } = request.params as { id: string };

    const existing = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });

    await prisma.academyInstructor.update({
      where: { id },
      data: { archivedAt: null, status: "active" },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor.restore",
      entityType: "AcademyInstructor",
      entityId: id,
    });
    return { ok: true };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    if (!canArchiveOrDeleteInstructors(request.user ?? {})) {
      return reply.code(403).send({ error: "Forbidden", message: "No permission to delete instructors" });
    }
    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string | undefined>;
    const permanent = q.permanent === "true";

    const exists = await prisma.academyInstructor.findFirst({
      where: { id, companyId },
      select: { id: true, archivedAt: true },
    });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Instructor not found" });

    if (permanent) {
      if (!isOwner(request.user!)) {
        return reply.code(403).send({
          error: "Forbidden",
          message: "Only the company owner can permanently delete an instructor",
        });
      }
      await prisma.$transaction([
        prisma.academyInstructorDocument.deleteMany({ where: { instructorId: id, companyId } }),
        prisma.academyInstructor.delete({ where: { id } }),
      ]);
      await createAuditLog({
        userId,
        companyId,
        action: "academy.instructor.permanent_delete",
        entityType: "AcademyInstructor",
        entityId: id,
      });
      return reply.code(204).send();
    }

    await prisma.academyInstructor.update({
      where: { id },
      data: { archivedAt: new Date(), status: "inactive" },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.instructor.soft_delete",
      entityType: "AcademyInstructor",
      entityId: id,
    });
    return { ok: true };
  });
}
