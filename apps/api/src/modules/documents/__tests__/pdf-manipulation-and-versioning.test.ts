import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { randomBytes } from "node:crypto";
import {
  PdfManipulationService,
} from "../pdf-manipulation.service.js";
import {
  getSourceEntityInfo,
} from "../generated-document.service.js";
import {
  createDocumentVersion,
  listDocumentVersions,
} from "../document-version.service.js";
import {
  resolveDocumentCategory,
  listDocuments,
} from "../documents.service.js";
import { prisma } from "../../../lib/prisma.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

async function createSamplePdf(pageCount = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 550, size: 24, color: rgb(0.1, 0.1, 0.1) });
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("PdfManipulationService", () => {
  it("validates PDF magic headers and loads documents", async () => {
    const validPdf = await createSamplePdf(1);
    const loaded = await PdfManipulationService.loadPdf(validPdf);
    expect(loaded.getPageCount()).toBe(1);

    const invalidPdf = Buffer.from("NOT A REAL PDF FILE HEADER");
    await expect(PdfManipulationService.loadPdf(invalidPdf)).rejects.toThrow("INVALID_PDF");
  });

  it("rotates specified PDF pages", async () => {
    const originalPdf = await createSamplePdf(3);
    const resultBuffer = await PdfManipulationService.rotatePages(originalPdf, {
      angleDegrees: 90,
      pageIndices: [0, 2], // rotate page 1 and page 3
    });

    const doc = await PDFDocument.load(resultBuffer);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
    expect(doc.getPage(2).getRotation().angle).toBe(90);
  });

  it("rotates all pages when pageIndices is omitted", async () => {
    const originalPdf = await createSamplePdf(2);
    const resultBuffer = await PdfManipulationService.rotatePages(originalPdf, {
      angleDegrees: 180,
    });

    const doc = await PDFDocument.load(resultBuffer);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(180);
    expect(doc.getPage(1).getRotation().angle).toBe(180);
  });

  it("reorders pages correctly", async () => {
    const originalPdf = await createSamplePdf(3);
    // Reverse the order: page 3, then 2, then 1 (indices 2, 1, 0)
    const resultBuffer = await PdfManipulationService.reorderPages(originalPdf, {
      pageOrder: [2, 1, 0],
    });

    const doc = await PDFDocument.load(resultBuffer);
    expect(doc.getPageCount()).toBe(3);
  });

  it("rejects invalid page reordering sequences", async () => {
    const originalPdf = await createSamplePdf(3);
    // Missing page index 2
    await expect(
      PdfManipulationService.reorderPages(originalPdf, { pageOrder: [0, 1] })
    ).rejects.toThrow();
  });

  it("deletes specified pages", async () => {
    const originalPdf = await createSamplePdf(4);
    // Delete page 2 (index 1) and page 4 (index 3)
    const resultBuffer = await PdfManipulationService.deletePages(originalPdf, {
      pageIndices: [1, 3],
    });

    const doc = await PDFDocument.load(resultBuffer);
    expect(doc.getPageCount()).toBe(2);
  });

  it("rejects deleting all pages of a document", async () => {
    const originalPdf = await createSamplePdf(2);
    await expect(
      PdfManipulationService.deletePages(originalPdf, { pageIndices: [0, 1] })
    ).rejects.toThrow("CANNOT_DELETE_ALL_PAGES");
  });

  it("stamps electronic signature and audit verification block", async () => {
    const originalPdf = await createSamplePdf(2);
    const resultBuffer = await PdfManipulationService.applySignatureStamp(originalPdf, {
      signerName: "John Inspector",
      signerRole: "Compliance Officer",
      notes: "PSIRA Verified & Approved",
    });

    expect(resultBuffer.length).toBeGreaterThan(originalPdf.length);
    const loaded = await PdfManipulationService.loadPdf(resultBuffer);
    expect(loaded.getPageCount()).toBe(2);
  });
});

describe("GeneratedDocumentService", () => {
  it("resolves source entity edit link for billing invoices", () => {
    const info = getSourceEntityInfo("BILLING", "Invoice", "inv-12345");

    expect(info.isGenerated).toBe(true);
    expect(info.sourceLabel).toContain("Invoice");
    expect(info.editSourceUrl).toBe("/payroll/billing?tab=invoices&invoiceId=inv-12345");
  });

  it("resolves source entity edit link for billing quotes", () => {
    const info = getSourceEntityInfo("BILLING", "Quote", "quote-9988");

    expect(info.isGenerated).toBe(true);
    expect(info.sourceLabel).toContain("Quotation");
    expect(info.editSourceUrl).toBe("/payroll/billing?tab=quotes&quoteId=quote-9988");
  });

  it("resolves source entity edit link for payslips", () => {
    const info = getSourceEntityInfo("PAYROLL", "PayrollItem", "pay-67890");

    expect(info.isGenerated).toBe(true);
    expect(info.sourceLabel).toContain("Payroll");
    expect(info.editSourceUrl).toBe("/payroll?runId=pay-67890");
  });

  it("returns uploaded status when source references are absent", () => {
    const info = getSourceEntityInfo(null, null, null);
    expect(info.isGenerated).toBe(false);
    expect(info.sourceLabel).toBe("Uploaded File");
  });
});

describe("Document Category Resolution", () => {
  it("resolves valid DocumentCategory enum values", () => {
    expect(resolveDocumentCategory("EMPLOYEE")).toBe("EMPLOYEE");
    expect(resolveDocumentCategory("COMPLIANCE")).toBe("COMPLIANCE");
    expect(resolveDocumentCategory("billing")).toBe("BILLING");
    expect(resolveDocumentCategory("ACADEMY")).toBe("ACADEMY");
  });

  it("safely maps legacy aliases to valid enum values", () => {
    expect(resolveDocumentCategory("HR_COMPLIANCE")).toBe("COMPLIANCE");
    expect(resolveDocumentCategory("CLIENT_CONTRACT")).toBe("CLIENT");
    expect(resolveDocumentCategory("GENERAL")).toBe("OTHER");
    expect(resolveDocumentCategory("SITE_OPERATIONS")).toBe("SITE");
    expect(resolveDocumentCategory("VEHICLE_FLEET")).toBe("EQUIPMENT");
  });

  it("returns undefined for unknown categories without throwing", () => {
    expect(resolveDocumentCategory("NON_EXISTENT_CATEGORY")).toBeUndefined();
    expect(resolveDocumentCategory(null)).toBeUndefined();
    expect(resolveDocumentCategory(undefined)).toBeUndefined();
  });
});

describe.runIf(dbReady)("Document Versioning (Database Integration)", () => {
  let companyId: string;
  let otherCompanyId: string;
  let uploaderId: string;
  let documentId: string;
  const suffix = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Version Test Co ${suffix}` },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: { name: `Other Version Co ${suffix}` },
    });
    otherCompanyId = otherCompany.id;

    const uploader = await prisma.user.create({
      data: {
        companyId,
        name: "Test Uploader",
        email: `uploader-${suffix}@test.plethora.local`,
        passwordHash: "hash-not-real",
      },
    });
    uploaderId = uploader.id;

    // Create a base managed document
    const doc = await prisma.managedDocument.create({
      data: {
        companyId,
        title: "Test Contract Document",
        documentType: "CONTRACT",
        category: "CLIENT",
        status: "ACTIVE",
        origin: "UPLOADED",
        lifecycleStatus: "DRAFT",
        fileName: "contract-v1.pdf",
        fileUrl: "documents/test/contract-v1.pdf",
        mimeType: "application/pdf",
        size: 1024,
        uploadedById: uploaderId,
      },
    });
    documentId = doc.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({
      where: { id: { in: [companyId, otherCompanyId] } },
    });
  });

  it("creates initial version record and lists versions", async () => {
    const sampleBuffer = await createSamplePdf(1);

    const { version: v1 } = await createDocumentVersion({
      companyId,
      documentId,
      userId: uploaderId,
      fileName: "contract-v1.pdf",
      mimeType: "application/pdf",
      fileBuffer: sampleBuffer,
      changeSummary: "Initial contract version",
      sourceType: "INITIAL_UPLOAD",
    });

    expect(v1.versionNumber).toBe(1);
    expect(v1.checksum).toBeDefined();

    const versions = await listDocumentVersions(companyId, documentId);
    expect(versions.length).toBe(1);
    expect(versions[0].versionNumber).toBe(1);
  });

  it("increments version number and updates currentVersion on subsequent revisions", async () => {
    const sampleBufferV2 = await createSamplePdf(2);

    const { version: v2 } = await createDocumentVersion({
      companyId,
      documentId,
      userId: uploaderId,
      fileName: "contract-v2.pdf",
      mimeType: "application/pdf",
      fileBuffer: sampleBufferV2,
      changeSummary: "Rotated first page",
      sourceType: "PAGE_ROTATION",
    });

    expect(v2.versionNumber).toBe(2);

    const doc = await prisma.managedDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(doc.currentVersionId).toBe(v2.id);

    const versions = await listDocumentVersions(companyId, documentId);
    expect(versions.length).toBe(2);
    // Sorted descending by version number
    expect(versions[0].versionNumber).toBe(2);
    expect(versions[1].versionNumber).toBe(1);
  });

  it("enforces tenant isolation across companies", async () => {
    // Attempting to list versions using another company's ID must return null (not found)
    const versions = await listDocumentVersions(otherCompanyId, documentId);
    expect(versions).toBeNull();
  });

  it("does not crash when listDocuments is queried with HR_COMPLIANCE or arbitrary category", async () => {
    // This specifically prevents: Invalid value for argument category. Expected DocumentCategory.
    const resAlias = await listDocuments(companyId, { category: "HR_COMPLIANCE" });
    expect(resAlias).toBeDefined();
    expect(Array.isArray(resAlias.items)).toBe(true);

    const resArbitrary = await listDocuments(companyId, { category: "ARBITRARY_NON_ENUM" });
    expect(resArbitrary).toBeDefined();
    expect(Array.isArray(resArbitrary.items)).toBe(true);
  });
});
