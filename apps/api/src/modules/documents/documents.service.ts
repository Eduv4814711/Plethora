import { Prisma, type DocumentCategory, type DocumentStatus, type DocumentOrigin, type DocumentLifecycleStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { upsertAlert } from "../alerts/alerts.service.js";

export function contractExpiryPriority(daysUntil: number): "CRITICAL" | "MEDIUM" | "LOW" | null {
  if (daysUntil < 0) return "CRITICAL";
  if (daysUntil <= 7) return "CRITICAL";
  if (daysUntil <= 30) return "MEDIUM";
  if (daysUntil <= 60) return "LOW";
  return null;
}

export function documentExpiryPriority(daysUntil: number): "CRITICAL" | "MEDIUM" | "LOW" | null {
  return contractExpiryPriority(daysUntil);
}

export async function syncContractExpiryAlerts(companyId: string, siteId?: string) {
  const sites = await prisma.site.findMany({
    where: {
      companyId,
      ...(siteId ? { id: siteId } : {}),
      contractEndDate: { not: null },
      siteStatus: { in: ["ACTIVE", "PENDING"] },
    },
    select: {
      id: true,
      name: true,
      contractEndDate: true,
      supervisorId: true,
    },
  });

  const now = new Date();
  let created = 0;
  for (const site of sites) {
    if (!site.contractEndDate) continue;
    const diffMs = site.contractEndDate.getTime() - now.getTime();
    const hasExpired = diffMs <= 0;
    const days = Math.ceil(diffMs / (24 * 3600_000));
    const priority = contractExpiryPriority(days);
    if (!priority) continue;

    const bucket = priority === "CRITICAL" ? "7d" : priority === "MEDIUM" ? "30d" : "60d";
    const result = await upsertAlert({
      companyId,
      title: "Site contract expiring soon",
      message: hasExpired
        ? `Contract for ${site.name} expired ${Math.floor(Math.abs(diffMs) / (24 * 3600_000))} day(s) ago`
        : `Contract for ${site.name} expires in ${days} day(s)`,
      priority,
      sourceModule: "SITES",
      dedupeKey: `contract_expiry:${site.id}:${bucket}`,
      sourceId: site.id,
      siteId: site.id,
      assignedToId: site.supervisorId,
      metadata: { daysUntil: days, contractEndDate: site.contractEndDate.toISOString() },
    });
    if (result.created) created += 1;
  }
  return { scanned: sites.length, created };
}

export async function syncDocumentExpiryAlerts(companyId: string) {
  const docs = await prisma.managedDocument.findMany({
    where: {
      companyId,
      expiryDate: { not: null },
      doesNotExpire: false,
      status: { in: ["ACTIVE", "PENDING_REVIEW"] },
    },
    take: 500,
    include: {
      employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
    },
  });
  const now = new Date();
  let created = 0;
  for (const doc of docs) {
    if (!doc.expiryDate || doc.doesNotExpire) continue;
    const diffMs = doc.expiryDate.getTime() - now.getTime();
    const hasExpired = diffMs <= 0;
    const days = Math.ceil(diffMs / (24 * 3600_000));
    const priority = documentExpiryPriority(days);
    if (!priority) continue;

    if (hasExpired && doc.status === "ACTIVE") {
      await prisma.managedDocument.update({
        where: { id: doc.id },
        data: { status: "EXPIRED" },
      });
    }

    const bucket = priority === "CRITICAL" ? "7d" : priority === "MEDIUM" ? "30d" : "60d";
    const empInfo = doc.employee ? ` for ${doc.employee.firstName} ${doc.employee.lastName} (${doc.employee.employeeNumber})` : "";
    const result = await upsertAlert({
      companyId,
      title: hasExpired ? "Document expired" : "Document expiring soon",
      message: `${doc.title} (${doc.documentType})${empInfo} ${hasExpired ? "has expired" : `expires in ${days} day(s)`}`,
      priority,
      sourceModule: "DOCUMENTS",
      dedupeKey: `doc_expiry:${doc.id}:${bucket}`,
      sourceId: doc.id,
      siteId: doc.siteId,
      employeeId: doc.employeeId,
    });
    if (result.created) created += 1;
  }
  return { scanned: docs.length, created };
}

export const VALID_DOCUMENT_CATEGORIES = new Set<string>([
  "EMPLOYEE",
  "SITE",
  "CLIENT",
  "PAYROLL",
  "ATTENDANCE",
  "INCIDENT",
  "EQUIPMENT",
  "COMPLIANCE",
  "TASK",
  "BILLING",
  "REPORT",
  "ACADEMY",
  "OTHER",
]);

export const CATEGORY_ALIASES: Record<string, DocumentCategory> = {
  HR_COMPLIANCE: "COMPLIANCE",
  CLIENT_CONTRACT: "CLIENT",
  SITE_OPERATIONS: "SITE",
  OPERATIONAL: "SITE",
  VEHICLE_FLEET: "EQUIPMENT",
  FIREARM_LICENSING: "EQUIPMENT",
  INCIDENT_EVIDENCE: "INCIDENT",
  GENERAL: "OTHER",
};

export function resolveDocumentCategory(cat?: string | null): DocumentCategory | undefined {
  if (!cat) return undefined;
  const upper = cat.toUpperCase().trim();
  if (VALID_DOCUMENT_CATEGORIES.has(upper)) {
    return upper as DocumentCategory;
  }
  if (CATEGORY_ALIASES[upper]) {
    return CATEGORY_ALIASES[upper];
  }
  return undefined;
}

export async function listDocuments(
  companyId: string,
  query: {
    category?: DocumentCategory | string;
    documentCategory?: string;
    verificationStatus?: string;
    status?: DocumentStatus;
    origin?: DocumentOrigin;
    lifecycleStatus?: DocumentLifecycleStatus;
    employeeId?: string;
    siteId?: string;
    clientId?: string;
    clientContractId?: string;
    expiringWithinDays?: number;
    search?: string;
    isSensitive?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  const resolvedCategory = resolveDocumentCategory(query.category);
  const where: Prisma.ManagedDocumentWhereInput = {
    companyId,
    ...(resolvedCategory ? { category: resolvedCategory } : {}),
    ...(query.documentCategory
      ? { documentCategory: query.documentCategory }
      : !resolvedCategory && query.category
      ? { documentCategory: query.category }
      : {}),
    ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.lifecycleStatus ? { lifecycleStatus: query.lifecycleStatus } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.clientContractId ? { clientContractId: query.clientContractId } : {}),
    ...(query.isSensitive !== undefined ? { isSensitive: query.isSensitive } : {}),
    ...(query.expiringWithinDays != null
      ? {
          doesNotExpire: false,
          expiryDate: {
            lte: new Date(Date.now() + query.expiringWithinDays * 24 * 3600_000),
            gte: new Date(),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { fileName: { contains: query.search, mode: "insensitive" } },
            { documentType: { contains: query.search, mode: "insensitive" } },
            { documentNumber: { contains: query.search, mode: "insensitive" } },
            { issuingAuthority: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.managedDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        site: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        currentVersion: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.managedDocument.count({ where }),
  ]);
  return { items, total };
}

export async function validateDocumentReferences(
  companyId: string,
  refs: {
    employeeId?: string | null;
    siteId?: string | null;
    clientId?: string | null;
    clientContractId?: string | null;
    incidentId?: string | null;
    taskId?: string | null;
  }
): Promise<string | null> {
  const checks: Array<Promise<boolean>> = [];
  const labels: string[] = [];

  if (refs.employeeId) {
    labels.push("employee");
    checks.push(prisma.employee.findFirst({ where: { id: refs.employeeId, companyId }, select: { id: true } }).then(Boolean));
  }
  if (refs.siteId) {
    labels.push("site");
    checks.push(prisma.site.findFirst({ where: { id: refs.siteId, companyId }, select: { id: true } }).then(Boolean));
  }
  if (refs.clientId) {
    labels.push("client");
    checks.push(prisma.client.findFirst({ where: { id: refs.clientId, companyId }, select: { id: true } }).then(Boolean));
  }
  if (refs.clientContractId) {
    labels.push("contract");
    checks.push(prisma.clientContract.findFirst({ where: { id: refs.clientContractId, companyId }, select: { id: true } }).then(Boolean));
  }
  if (refs.incidentId) {
    labels.push("incident");
    checks.push(prisma.incident.findFirst({ where: { id: refs.incidentId, companyId }, select: { id: true } }).then(Boolean));
  }
  if (refs.taskId) {
    labels.push("task");
    checks.push(prisma.task.findFirst({ where: { id: refs.taskId, companyId }, select: { id: true } }).then(Boolean));
  }

  const results = await Promise.all(checks);
  const invalidIndex = results.findIndex((exists) => !exists);
  if (invalidIndex === -1) return null;
  return `The referenced ${labels[invalidIndex]} was not found`;
}

export async function createDocumentRecord(params: {
  companyId: string;
  uploadedById: string;
  title: string;
  documentType: string;
  category: DocumentCategory;
  documentCategory?: string | null;
  documentNumber?: string | null;
  issuingAuthority?: string | null;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  doesNotExpire?: boolean;
  isSensitive?: boolean;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  origin?: DocumentOrigin;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  lifecycleStatus?: DocumentLifecycleStatus;
  employeeId?: string | null;
  siteId?: string | null;
  clientId?: string | null;
  clientContractId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const doc = await prisma.managedDocument.create({
    data: {
      companyId: params.companyId,
      title: params.title,
      documentType: params.documentType,
      category: (resolveDocumentCategory(params.category) ?? "OTHER") as DocumentCategory,
      documentCategory: params.documentCategory?.trim() || null,
      documentNumber: params.documentNumber?.trim() || null,
      issuingAuthority: params.issuingAuthority?.trim() || null,
      issueDate: params.issueDate ?? null,
      expiryDate: params.doesNotExpire ? null : params.expiryDate ?? null,
      doesNotExpire: Boolean(params.doesNotExpire),
      isSensitive: Boolean(params.isSensitive),
      fileUrl: params.fileUrl,
      fileName: params.fileName,
      mimeType: params.mimeType,
      size: params.size,
      origin: params.origin ?? "UPLOADED",
      sourceModule: params.sourceModule?.trim() || null,
      sourceEntityType: params.sourceEntityType?.trim() || null,
      sourceEntityId: params.sourceEntityId?.trim() || null,
      lifecycleStatus: params.lifecycleStatus ?? "FINAL",
      employeeId: params.employeeId?.trim() || null,
      siteId: params.siteId?.trim() || null,
      clientId: params.clientId?.trim() || null,
      clientContractId: params.clientContractId?.trim() || null,
      incidentId: params.incidentId?.trim() || null,
      taskId: params.taskId?.trim() || null,
      notes: params.notes?.trim() || null,
      metadata: params.metadata ?? Prisma.JsonNull,
      uploadedById: params.uploadedById,
      verificationStatus: "PENDING_VERIFICATION",
      status: "ACTIVE",
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      site: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Create initial DocumentVersion (Version 1)
  const versionData: Prisma.DocumentVersionCreateInput = {
    company: { connect: { id: params.companyId } },
    document: { connect: { id: doc.id } },
    versionNumber: 1,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    mimeType: params.mimeType,
    size: params.size,
    changeSummary: "Initial document record",
    sourceType: params.origin === "GENERATED" ? "SYSTEM_GENERATION" : "INITIAL_UPLOAD",
  };
  if (params.uploadedById) {
    versionData.createdBy = { connect: { id: params.uploadedById } };
  }
  const initialVersion = await prisma.documentVersion.create({
    data: versionData,
  });

  const updatedDoc = await prisma.managedDocument.update({
    where: { id: doc.id },
    data: { currentVersionId: initialVersion.id },
    include: {
      currentVersion: true,
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      site: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // If PSiRA document with registration number/expiry, sync with employee if not already set
  if (params.employeeId && (params.documentCategory === "PSIRA" || params.documentType.startsWith("psira_"))) {
    const updateData: Prisma.EmployeeUpdateInput = {};
    if (params.documentNumber && params.documentType === "psira_registration_certificate") {
      updateData.psiraRegistrationNumber = params.documentNumber;
    }
    if (params.expiryDate && (params.documentType === "psira_card" || params.documentType === "psira_registration_certificate")) {
      updateData.psiraRegistrationExpiry = params.expiryDate;
    }
    if (params.documentType.startsWith("psira_grade_")) {
      const gradeLetter = params.documentType.replace("psira_grade_", "").toUpperCase();
      if (["A", "B", "C", "D", "E"].includes(gradeLetter)) {
        updateData.psiraGrade = gradeLetter;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.employee.updateMany({
        where: { id: params.employeeId, companyId: params.companyId },
        data: updateData,
      });
    }
  }

  await createAuditLog({
    userId: params.uploadedById,
    companyId: params.companyId,
    action: "document.upload",
    entityType: "ManagedDocument",
    entityId: doc.id,
    metadata: {
      category: params.category,
      documentCategory: params.documentCategory,
      documentType: params.documentType,
      employeeId: params.employeeId,
      documentNumber: params.documentNumber,
      versionNumber: 1,
    },
  });

  if (params.expiryDate && !params.doesNotExpire) {
    await syncDocumentExpiryAlerts(params.companyId);
  }

  return updatedDoc;
}

export async function updateDocumentMetadata(
  companyId: string,
  documentId: string,
  userId: string,
  data: {
    title?: string;
    category?: DocumentCategory | string;
    documentType?: string;
    documentCategory?: string | null;
    documentNumber?: string | null;
    issuingAuthority?: string | null;
    issueDate?: Date | null;
    expiryDate?: Date | null;
    doesNotExpire?: boolean;
    isSensitive?: boolean;
    clientContractId?: string | null;
    notes?: string | null;
  }
) {
  const existing = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
  });
  if (!existing) return null;

  const updateData: Prisma.ManagedDocumentUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.category !== undefined) {
    const resolvedCat = resolveDocumentCategory(data.category);
    if (resolvedCat) updateData.category = resolvedCat;
  }
  if (data.documentType !== undefined) updateData.documentType = data.documentType;
  if (data.documentCategory !== undefined) updateData.documentCategory = data.documentCategory;
  if (data.documentNumber !== undefined) updateData.documentNumber = data.documentNumber;
  if (data.issuingAuthority !== undefined) updateData.issuingAuthority = data.issuingAuthority;
  if (data.issueDate !== undefined) updateData.issueDate = data.issueDate;
  if (data.clientContractId !== undefined) {
    updateData.clientContract = data.clientContractId ? { connect: { id: data.clientContractId } } : { disconnect: true };
  }
  if (data.doesNotExpire !== undefined) {
    updateData.doesNotExpire = data.doesNotExpire;
    if (data.doesNotExpire) updateData.expiryDate = null;
  }
  if (data.expiryDate !== undefined && !data.doesNotExpire) {
    updateData.expiryDate = data.expiryDate;
  }
  if (data.isSensitive !== undefined) updateData.isSensitive = data.isSensitive;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const updated = await prisma.managedDocument.update({
    where: { id: documentId },
    data: updateData,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "document.update_metadata",
    entityType: "ManagedDocument",
    entityId: documentId,
    metadata: { fieldsUpdated: Object.keys(data) },
  });

  return updated;
}

export async function verifyDocument(companyId: string, documentId: string, verifiedById: string) {
  const existing = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
  });
  if (!existing) return null;

  const updated = await prisma.managedDocument.update({
    where: { id: documentId },
    data: {
      verificationStatus: "VERIFIED",
      verifiedById,
      verifiedAt: new Date(),
      rejectionReason: null,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    userId: verifiedById,
    companyId,
    action: "document.verify",
    entityType: "ManagedDocument",
    entityId: documentId,
    metadata: {
      documentType: existing.documentType,
      employeeId: existing.employeeId,
      documentNumber: existing.documentNumber,
    },
  });

  return updated;
}

export async function rejectDocument(
  companyId: string,
  documentId: string,
  rejectedById: string,
  rejectionReason: string
) {
  const existing = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
  });
  if (!existing) return null;

  const updated = await prisma.managedDocument.update({
    where: { id: documentId },
    data: {
      verificationStatus: "REJECTED",
      verifiedById: rejectedById,
      verifiedAt: new Date(),
      rejectionReason,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    userId: rejectedById,
    companyId,
    action: "document.reject",
    entityType: "ManagedDocument",
    entityId: documentId,
    metadata: {
      rejectionReason,
      documentType: existing.documentType,
      employeeId: existing.employeeId,
    },
  });

  return updated;
}
