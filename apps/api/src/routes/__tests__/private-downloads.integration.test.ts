import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTenantFixture,
  type TenantFixture,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("private stored-file access (integration)", () => {
  let app: FastifyInstance;
  let fixture: TenantFixture;
  let viewToken: string;
  let exportToken: string;
  let ownDocumentId: string;
  let foreignDocumentId: string;
  let publicLogoUrl: string;
  const storageKeys: string[] = [];
  const privateFiles: Array<{ label: string; ownUrl: string; foreignUrl: string }> = [];
  const metadataEndpoints: Array<{
    label: string;
    url: string;
    collection: string;
    recordId: string;
  }> = [];

  async function createUserToken(capabilities: Record<string, string[]>) {
    const user = await prisma.user.create({
      data: {
        companyId: fixture.tenantA.companyId,
        name: `Private File Test ${randomBytes(3).toString("hex")}`,
        email: `private-file-${randomBytes(8).toString("hex")}@test.local`,
        passwordHash: "not-used-in-route-tests",
        capabilities,
      },
    });
    return jwt.sign(
      { sub: user.id, email: user.email, companyId: fixture.tenantA.companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }

  async function createDocument(companyId: string, uploadedById: string, label: string) {
    const key = `documents/${companyId}/${randomBytes(8).toString("hex")}.pdf`;
    storageKeys.push(key);
    await storage.uploadFile({
      key,
      body: Buffer.from(`%PDF-1.4\nprivate-${label}\n%%EOF`, "ascii"),
      contentType: "application/pdf",
    });
    return prisma.managedDocument.create({
      data: {
        companyId,
        title: `Private ${label}`,
        documentType: "test",
        category: "OTHER",
        fileUrl: storage.getAssetUrl(key),
        fileName: `${label}.pdf`,
        mimeType: "application/pdf",
        size: 32,
        uploadedById,
      },
    });
  }

  async function uploadPdf(key: string, label: string): Promise<string> {
    storageKeys.push(key);
    await storage.uploadFile({
      key,
      body: Buffer.from(`%PDF-1.4\nprivate-${label}\n%%EOF`, "ascii"),
      contentType: "application/pdf",
    });
    return storage.getAssetUrl(key);
  }

  beforeAll(async () => {
    app = await buildApp();
    fixture = await provisionTenantFixture();
    viewToken = await createUserToken({
      "/documents": ["view"],
      "/tasks": ["view"],
      "/incidents": ["view"],
      "/academy": ["view"],
      "/employees/leave": ["view"],
    });
    exportToken = await createUserToken({
      "/documents": ["view", "export"],
      "/tasks": ["view", "export"],
      "/incidents": ["view", "export"],
      "/academy": ["view", "export"],
      "/employees/leave": ["view", "export"],
    });
    ownDocumentId = (
      await createDocument(
        fixture.tenantA.companyId,
        fixture.tenantA.userId,
        "tenant-a"
      )
    ).id;
    foreignDocumentId = (
      await createDocument(
        fixture.tenantB.companyId,
        fixture.tenantB.userId,
        "tenant-b"
      )
    ).id;
    privateFiles.push({
      label: "managed document",
      ownUrl: `/documents/${ownDocumentId}/download`,
      foreignUrl: `/documents/${foreignDocumentId}/download`,
    });
    metadataEndpoints.push({
      label: "managed document",
      url: "/documents",
      collection: "items",
      recordId: ownDocumentId,
    });

    const ownTaskAttachment = await prisma.taskAttachment.create({
      data: {
        taskId: fixture.tenantA.taskId,
        filename: "task-a.pdf",
        mimeType: "application/pdf",
        size: 32,
        url: await uploadPdf(
          `tasks/${fixture.tenantA.companyId}/${fixture.tenantA.taskId}/${randomBytes(8).toString("hex")}.pdf`,
          "task-a"
        ),
        uploadedById: fixture.tenantA.userId,
      },
    });
    const foreignTaskAttachment = await prisma.taskAttachment.create({
      data: {
        taskId: fixture.tenantB.taskId,
        filename: "task-b.pdf",
        mimeType: "application/pdf",
        size: 32,
        url: await uploadPdf(
          `tasks/${fixture.tenantB.companyId}/${fixture.tenantB.taskId}/${randomBytes(8).toString("hex")}.pdf`,
          "task-b"
        ),
        uploadedById: fixture.tenantB.userId,
      },
    });
    privateFiles.push({
      label: "task attachment",
      ownUrl: `/task-attachments/attachments/${ownTaskAttachment.id}/download`,
      foreignUrl: `/task-attachments/attachments/${foreignTaskAttachment.id}/download`,
    });
    metadataEndpoints.push({
      label: "task attachment",
      url: `/tasks/${fixture.tenantA.taskId}`,
      collection: "attachments",
      recordId: ownTaskAttachment.id,
    });

    const ownIncident = await prisma.incident.create({
      data: {
        companyId: fixture.tenantA.companyId,
        incidentNumber: `FILE-A-${fixture.runId}`,
        siteId: fixture.tenantA.siteId,
        reportedById: fixture.tenantA.userId,
        incidentDateTime: new Date(),
        incidentType: "OTHER",
        severity: "LOW",
        title: "Private file test",
        description: "Private file test",
      },
    });
    const foreignIncident = await prisma.incident.create({
      data: {
        companyId: fixture.tenantB.companyId,
        incidentNumber: `FILE-B-${fixture.runId}`,
        siteId: fixture.tenantB.siteId,
        reportedById: fixture.tenantB.userId,
        incidentDateTime: new Date(),
        incidentType: "OTHER",
        severity: "LOW",
        title: "Private file test",
        description: "Private file test",
      },
    });
    const ownIncidentAttachment = await prisma.incidentAttachment.create({
      data: {
        incidentId: ownIncident.id,
        filename: "incident-a.pdf",
        mimeType: "application/pdf",
        size: 32,
        url: await uploadPdf(
          `incidents/${fixture.tenantA.companyId}/${ownIncident.id}/${randomBytes(8).toString("hex")}.pdf`,
          "incident-a"
        ),
        uploadedById: fixture.tenantA.userId,
      },
    });
    const foreignIncidentAttachment = await prisma.incidentAttachment.create({
      data: {
        incidentId: foreignIncident.id,
        filename: "incident-b.pdf",
        mimeType: "application/pdf",
        size: 32,
        url: await uploadPdf(
          `incidents/${fixture.tenantB.companyId}/${foreignIncident.id}/${randomBytes(8).toString("hex")}.pdf`,
          "incident-b"
        ),
        uploadedById: fixture.tenantB.userId,
      },
    });
    privateFiles.push({
      label: "incident attachment",
      ownUrl: `/incidents/${ownIncident.id}/attachments/${ownIncidentAttachment.id}/download`,
      foreignUrl: `/incidents/${foreignIncident.id}/attachments/${foreignIncidentAttachment.id}/download`,
    });
    metadataEndpoints.push({
      label: "incident attachment",
      url: `/incidents/${ownIncident.id}`,
      collection: "attachments",
      recordId: ownIncidentAttachment.id,
    });

    const ownStudent = await prisma.student.create({
      data: {
        companyId: fixture.tenantA.companyId,
        studentNumber: `FILE-A-${fixture.runId}`,
        firstName: "File",
        lastName: "Student",
      },
    });
    const foreignStudent = await prisma.student.create({
      data: {
        companyId: fixture.tenantB.companyId,
        studentNumber: `FILE-B-${fixture.runId}`,
        firstName: "File",
        lastName: "Student",
      },
    });
    const ownStudentKey = `academy/${fixture.tenantA.companyId}/${ownStudent.id}/${randomBytes(8).toString("hex")}.pdf`;
    await uploadPdf(ownStudentKey, "student-a");
    const foreignStudentKey = `academy/${fixture.tenantB.companyId}/${foreignStudent.id}/${randomBytes(8).toString("hex")}.pdf`;
    await uploadPdf(foreignStudentKey, "student-b");
    const ownStudentDocument = await prisma.studentDocument.create({
      data: {
        companyId: fixture.tenantA.companyId,
        studentId: ownStudent.id,
        documentType: "other",
        fileName: "student-a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 32,
        storagePath: ownStudentKey,
        uploadedByUserId: fixture.tenantA.userId,
      },
    });
    const foreignStudentDocument = await prisma.studentDocument.create({
      data: {
        companyId: fixture.tenantB.companyId,
        studentId: foreignStudent.id,
        documentType: "other",
        fileName: "student-b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 32,
        storagePath: foreignStudentKey,
        uploadedByUserId: fixture.tenantB.userId,
      },
    });
    privateFiles.push({
      label: "academy student document",
      ownUrl: `/academy/students/${ownStudent.id}/documents/${ownStudentDocument.id}/download`,
      foreignUrl: `/academy/students/${foreignStudent.id}/documents/${foreignStudentDocument.id}/download`,
    });
    metadataEndpoints.push({
      label: "academy student document",
      url: `/academy/students/${ownStudent.id}/documents`,
      collection: "documents",
      recordId: ownStudentDocument.id,
    });

    const logoKey = `logos/${randomBytes(8).toString("hex")}.png`;
    storageKeys.push(logoKey);
    await storage.uploadFile({
      key: logoKey,
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: "image/png",
    });
    publicLogoUrl = storage.getAssetUrl(logoKey);
  }, 120_000);

  afterAll(async () => {
    for (const key of storageKeys) await storage.deleteFile(key);
    await fixture?.teardown();
    await app?.close();
  }, 30_000);

  it("does not expose non-logo uploads through anonymous static serving", async () => {
    const document = await prisma.managedDocument.findUniqueOrThrow({
      where: { id: ownDocumentId },
      select: { fileUrl: true },
    });
    const response = await app.inject({ method: "GET", url: document.fileUrl });
    expect(response.statusCode).toBe(404);
  });

  it("keeps harmless company logos publicly available", async () => {
    const response = await app.inject({ method: "GET", url: publicLogoUrl });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it("denies anonymous download attempts", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: `/documents/${ownDocumentId}/download`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("enforces export capability and tenant scope for every protected file family", async () => {
    for (const file of privateFiles) {
      const viewOnly = await app.inject({
        method: "GET",
        url: file.ownUrl,
        headers: authHeader(viewToken),
      });
      expect(viewOnly.statusCode, `${file.label}: view-only`).toBe(403);

      const crossTenant = await app.inject({
        method: "GET",
        url: file.foreignUrl,
        headers: authHeader(exportToken),
      });
      expect(crossTenant.statusCode, `${file.label}: cross-tenant`).toBe(404);

      const allowed = await app.inject({
        method: "GET",
        url: file.ownUrl,
        headers: authHeader(exportToken),
      });
      expect(allowed.statusCode, `${file.label}: export`).toBe(200);
      expect(allowed.headers["content-disposition"], file.label).toContain("attachment;");
      expect(allowed.headers["cache-control"], file.label).toBe("private, no-store");
      expect(allowed.headers["x-content-type-options"], file.label).toBe("nosniff");
    }
  });

  it("returns API download metadata only to exporters and never returns storage references", async () => {
    for (const endpoint of metadataEndpoints) {
      const viewResponse = await app.inject({
        method: "GET",
        url: endpoint.url,
        headers: authHeader(viewToken),
      });
      expect(viewResponse.statusCode, `${endpoint.label}: view metadata`).toBe(200);
      const viewed = (viewResponse.json()[endpoint.collection] as Array<{ id: string }>).find(
        (item) => item.id === endpoint.recordId
      );
      expect(viewed, endpoint.label).toBeTruthy();
      expect(viewed, endpoint.label).not.toHaveProperty("fileUrl");
      expect(viewed, endpoint.label).not.toHaveProperty("url");
      expect(viewed, endpoint.label).not.toHaveProperty("storagePath");
      expect(viewed, endpoint.label).not.toHaveProperty("downloadUrl");

      const exportResponse = await app.inject({
        method: "GET",
        url: endpoint.url,
        headers: authHeader(exportToken),
      });
      expect(exportResponse.statusCode, `${endpoint.label}: export metadata`).toBe(200);
      const exported = (exportResponse.json()[endpoint.collection] as Array<{
        id: string;
        downloadUrl?: string;
      }>).find((item) => item.id === endpoint.recordId);
      expect(exported, endpoint.label).toBeTruthy();
      expect(exported, endpoint.label).not.toHaveProperty("fileUrl");
      expect(exported, endpoint.label).not.toHaveProperty("url");
      expect(exported, endpoint.label).not.toHaveProperty("storagePath");
      expect(exported?.downloadUrl, endpoint.label).toContain("/download");
    }
  });
});
