import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import {
  syncDocumentExpiryAlerts,
  validateDocumentReferences,
} from "../documents.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("documents service (PostgreSQL integration)", () => {
  let companyId: string;
  let otherCompanyId: string;
  let employeeId: string;
  let otherCompanyEmployeeId: string;
  let uploaderId: string;
  const suffix = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Documents Test Co ${suffix}` } });
    companyId = company.id;
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DOC-${suffix}`, firstName: "Doc", lastName: "Owner", status: "active", employeeType: "security_officer" },
    });
    employeeId = employee.id;
    const uploader = await prisma.user.create({
      data: {
        companyId,
        name: "Doc Uploader",
        email: `doc-uploader-${suffix}@plethora-test.local`,
        passwordHash: await hashPassword("documents-test-password-32chars!!"),
      },
    });
    uploaderId = uploader.id;

    const otherCompany = await prisma.company.create({ data: { name: `Documents Other Co ${suffix}` } });
    otherCompanyId = otherCompany.id;
    const otherEmployee = await prisma.employee.create({
      data: { companyId: otherCompanyId, employeeNumber: `DOC-OTHER-${suffix}`, firstName: "Other", lastName: "Employee", status: "active", employeeType: "security_officer" },
    });
    otherCompanyEmployeeId = otherEmployee.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  });

  it("rejects a reference to another company's employee", async () => {
    const error = await validateDocumentReferences(companyId, { employeeId: otherCompanyEmployeeId });
    expect(error).toBe("The referenced employee was not found");
  });

  it("accepts a reference to the same company's employee", async () => {
    const error = await validateDocumentReferences(companyId, { employeeId });
    expect(error).toBeNull();
  });

  it("accepts an upload with no optional references at all", async () => {
    const error = await validateDocumentReferences(companyId, {});
    expect(error).toBeNull();
  });

  it("flips a document that expired within the last 24 hours from ACTIVE to EXPIRED", async () => {
    // Created directly (bypassing createDocumentRecord's own auto-sync) so this test
    // exercises syncDocumentExpiryAlerts in isolation.
    const doc = await prisma.managedDocument.create({
      data: {
        companyId,
        title: "Expiring soon test doc",
        documentType: "certificate",
        category: "EMPLOYEE",
        fileUrl: "https://example.test/doc.pdf",
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        size: 100,
        employeeId,
        uploadedById: uploaderId,
        status: "ACTIVE",
        expiryDate: new Date(Date.now() - 60 * 60 * 1000), // expired 1 hour ago
      },
    });

    const result = await syncDocumentExpiryAlerts(companyId);
    expect(result.scanned).toBeGreaterThan(0);

    const updated = await prisma.managedDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(updated.status).toBe("EXPIRED");
  });
});
