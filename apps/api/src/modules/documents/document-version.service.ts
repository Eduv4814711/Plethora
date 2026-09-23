import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { uploadsRoot } from "../../lib/uploads-root.js";
import { createAuditLog } from "../../lib/audit.js";
import { sanitizeUploadFilename } from "../../lib/upload-validation.js";
import { resolvePrivateStorageKey } from "../../lib/private-download.js";

export interface CreateDocumentVersionParams {
  companyId: string;
  documentId: string;
  userId?: string | null;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  changeSummary?: string | null;
  sourceType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function listDocumentVersions(companyId: string, documentId: string) {
  // Ensure document exists and belongs to company
  const doc = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
    select: { id: true, currentVersionId: true },
  });
  if (!doc) return null;

  return prisma.documentVersion.findMany({
    where: { documentId, companyId },
    orderBy: { versionNumber: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getDocumentVersion(companyId: string, documentId: string, versionIdOrNumber: string | number) {
  const isNumber = typeof versionIdOrNumber === "number" || /^\d+$/.test(String(versionIdOrNumber));
  return prisma.documentVersion.findFirst({
    where: {
      documentId,
      companyId,
      ...(isNumber ? { versionNumber: Number(versionIdOrNumber) } : { id: String(versionIdOrNumber) }),
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Loads the raw buffer of a document version, falling back to document root file if version is not specified.
 */
export async function readDocumentFileBuffer(
  companyId: string,
  documentId: string,
  versionId?: string
): Promise<{ buffer: Buffer; fileName: string; mimeType: string; versionNumber: number } | null> {
  const doc = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
    include: {
      currentVersion: true,
    },
  });
  if (!doc) return null;

  let targetVersion = doc.currentVersion;
  if (versionId) {
    targetVersion = await prisma.documentVersion.findFirst({
      where: { id: versionId, documentId, companyId },
    });
    if (!targetVersion) return null;
  }

  const storedReference = targetVersion?.fileUrl || doc.fileUrl;
  const fileName = targetVersion?.fileName || doc.fileName;
  const mimeType = targetVersion?.mimeType || doc.mimeType;
  const versionNumber = targetVersion?.versionNumber || 1;

  const key = resolvePrivateStorageKey(storedReference, [`documents/${companyId}`]);
  if (!key) return null;

  const root = resolve(uploadsRoot);
  const candidatePath = resolve(join(root, ...key.split("/")));
  try {
    const buffer = await readFile(candidatePath);
    return { buffer, fileName, mimeType, versionNumber };
  } catch {
    return null;
  }
}

/**
 * Creates and persists a new DocumentVersion, automatically incrementing versionNumber
 * and updating ManagedDocument.currentVersionId and root file fields.
 */
export async function createDocumentVersion(params: CreateDocumentVersionParams) {
  const { companyId, documentId, userId, fileBuffer, fileName, mimeType, changeSummary, sourceType, metadata } = params;

  const doc = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
  });
  if (!doc) {
    throw new Error("DOCUMENT_NOT_FOUND");
  }

  if (doc.status === "ARCHIVED") {
    throw new Error("CANNOT_MODIFY_ARCHIVED_DOCUMENT: Archived documents cannot receive new versions.");
  }

  // Determine next version number
  const latestVersion = await prisma.documentVersion.findFirst({
    where: { documentId, companyId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  // Sanitize filename & create unique storage key
  const safeName = sanitizeUploadFilename(fileName, mimeType);
  const ext = safeName.includes(".") ? safeName.split(".").pop() : "pdf";
  const storageFilename = `${randomUUID()}.${ext}`;
  const key = `documents/${companyId}/${documentId}/v${nextVersionNumber}/${storageFilename}`;

  // Upload to storage
  await storage.uploadFile({
    key,
    body: fileBuffer,
    contentType: mimeType,
  });

  const fileUrl = storage.getAssetUrl(key);
  const checksum = createHash("sha256").update(fileBuffer).digest("hex");

  // Create version record and update document in transaction
  const result = await prisma.$transaction(async (tx) => {
    const versionData: Prisma.DocumentVersionCreateInput = {
      company: { connect: { id: companyId } },
      document: { connect: { id: documentId } },
      versionNumber: nextVersionNumber,
      fileUrl,
      fileName: safeName,
      mimeType,
      size: fileBuffer.length,
      checksum,
      changeSummary: changeSummary || null,
      sourceType: sourceType || "MANUAL_REVISION",
    };
    if (userId) {
      versionData.createdBy = { connect: { id: userId } };
    }
    if (metadata) {
      versionData.metadata = metadata as never;
    }

    const version = await tx.documentVersion.create({
      data: versionData,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    const updatedDoc = await tx.managedDocument.update({
      where: { id: documentId },
      data: {
        currentVersionId: version.id,
        fileUrl: version.fileUrl,
        fileName: version.fileName,
        mimeType: version.mimeType,
        size: version.size,
        updatedAt: new Date(),
      },
      include: {
        currentVersion: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        site: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return { version, document: updatedDoc };
  });

  await createAuditLog({
    userId,
    companyId,
    action: "document.version_create",
    entityType: "ManagedDocument",
    entityId: documentId,
    metadata: {
      versionNumber: nextVersionNumber,
      versionId: result.version.id,
      changeSummary: changeSummary || null,
      sourceType: sourceType || "MANUAL_REVISION",
      size: fileBuffer.length,
    },
  });

  return result;
}
