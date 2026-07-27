import type { DocumentCategory, DocumentStatus, Prisma } from "@prisma/client";
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
      status: { in: ["ACTIVE", "PENDING_REVIEW"] },
    },
    take: 500,
  });
  const now = new Date();
  let created = 0;
  for (const doc of docs) {
    if (!doc.expiryDate) continue;
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
    const result = await upsertAlert({
      companyId,
      title: hasExpired ? "Document expired" : "Document expiring soon",
      message: `${doc.title} (${doc.documentType}) ${hasExpired ? "has expired" : `expires in ${days} day(s)`}`,
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

export async function listDocuments(
  companyId: string,
  query: {
    category?: DocumentCategory;
    status?: DocumentStatus;
    employeeId?: string;
    siteId?: string;
    clientId?: string;
    expiringWithinDays?: number;
    limit?: number;
    offset?: number;
  }
) {
  const where: Prisma.ManagedDocumentWhereInput = {
    companyId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.expiringWithinDays != null
      ? {
          expiryDate: {
            lte: new Date(Date.now() + query.expiringWithinDays * 24 * 3600_000),
            gte: new Date(),
          },
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
        employee: { select: { id: true, firstName: true, lastName: true } },
        site: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.managedDocument.count({ where }),
  ]);
  return { items, total };
}

/**
 * Confirms every optional foreign key on an upload belongs to the uploading company before
 * it's persisted. Without this, a client-supplied id pointing at another tenant's row would
 * link a document (and leak its name/id via the document's `include`) across tenants.
 */
export async function validateDocumentReferences(
  companyId: string,
  refs: {
    employeeId?: string | null;
    siteId?: string | null;
    clientId?: string | null;
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
  fileUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  employeeId?: string | null;
  siteId?: string | null;
  clientId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  expiryDate?: Date | null;
}) {
  const doc = await prisma.managedDocument.create({
    data: {
      companyId: params.companyId,
      title: params.title,
      documentType: params.documentType,
      category: params.category,
      fileUrl: params.fileUrl,
      fileName: params.fileName,
      mimeType: params.mimeType,
      size: params.size,
      employeeId: params.employeeId ?? null,
      siteId: params.siteId ?? null,
      clientId: params.clientId ?? null,
      incidentId: params.incidentId ?? null,
      taskId: params.taskId ?? null,
      uploadedById: params.uploadedById,
      expiryDate: params.expiryDate ?? null,
      status: "ACTIVE",
    },
  });

  await createAuditLog({
    userId: params.uploadedById,
    companyId: params.companyId,
    action: "document.upload",
    entityType: "ManagedDocument",
    entityId: doc.id,
    metadata: { category: params.category, documentType: params.documentType },
  });

  if (params.expiryDate) {
    await syncDocumentExpiryAlerts(params.companyId);
  }

  return doc;
}
