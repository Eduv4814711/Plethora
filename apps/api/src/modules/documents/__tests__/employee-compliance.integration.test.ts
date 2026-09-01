import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import {
  createDocumentRecord,
  listDocuments,
  updateDocumentMetadata,
  verifyDocument,
  rejectDocument,
} from "../documents.service.js";
import {
  calculateEmployeeCompliance,
  getCompanyComplianceSummary,
  getCompanyComplianceReport,
} from "../compliance.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("Employee Documents & Compliance Service (Integration)", () => {
  let companyId: string;
  let otherCompanyId: string;
  let employeeId: string;
  let otherEmployeeId: string;
  let uploaderId: string;
  let verifierId: string;
  const suffix = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Compliance Test Co ${suffix}` } });
    companyId = company.id;

    const uploader = await prisma.user.create({
      data: {
        companyId,
        name: "Doc Uploader",
        email: `uploader-${suffix}@plethora-test.local`,
        passwordHash: await hashPassword("compliance-test-password-32chars!!"),
      },
    });
    uploaderId = uploader.id;

    const verifier = await prisma.user.create({
      data: {
        companyId,
        name: "Compliance Manager",
        email: `verifier-${suffix}@plethora-test.local`,
        passwordHash: await hashPassword("compliance-test-password-32chars!!"),
      },
    });
    verifierId = verifier.id;

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `COMP-${suffix}`,
        firstName: "Sipho",
        lastName: "Nkosi",
        status: "active",
        employeeType: "security_officer",
        jobRole: "Security Guard",
        psiraGrade: "C",
        psiraRegistrationNumber: `PSIRA-${suffix}`,
      },
    });
    employeeId = employee.id;

    const otherCompany = await prisma.company.create({ data: { name: `Other Co ${suffix}` } });
    otherCompanyId = otherCompany.id;

    const otherEmployee = await prisma.employee.create({
      data: {
        companyId: otherCompanyId,
        employeeNumber: `OTHER-${suffix}`,
        firstName: "Other",
        lastName: "Person",
        status: "active",
        employeeType: "general",
      },
    });
    otherEmployeeId = otherEmployee.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  });

  it("calculates initial employee compliance as non-compliant when mandatory docs are missing", async () => {
    const result = await calculateEmployeeCompliance(companyId, employeeId);
    expect(result).not.toBeNull();
    expect(result!.overallStatus).toBe("NON_COMPLIANT");
    expect(result!.summary.missingCount).toBeGreaterThan(0);
    expect(result!.summary.verifiedCount).toBe(0);
  });

  it("creates document record with metadata and verifies it", async () => {
    const doc = await createDocumentRecord({
      companyId,
      uploadedById: uploaderId,
      employeeId,
      title: "South African ID Document",
      documentType: "sa_id",
      category: "EMPLOYEE",
      documentCategory: "PERSONAL",
      documentNumber: "9001015800080",
      issuingAuthority: "Department of Home Affairs",
      doesNotExpire: true,
      fileUrl: `documents/${companyId}/test-sa-id.pdf`,
      fileName: "sa-id.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    expect(doc.id).toBeDefined();
    expect(doc.verificationStatus).toBe("PENDING_VERIFICATION");
    expect(doc.documentNumber).toBe("9001015800080");

    // Verify document
    const verified = await verifyDocument(companyId, doc.id, verifierId);
    expect(verified).not.toBeNull();
    expect(verified!.verificationStatus).toBe("VERIFIED");
    expect(verified!.verifiedById).toBe(verifierId);
    expect(verified!.verifiedAt).toBeInstanceOf(Date);
  });

  it("supports document rejection with structured reason", async () => {
    const doc = await createDocumentRecord({
      companyId,
      uploadedById: uploaderId,
      employeeId,
      title: "Employment Contract (Draft)",
      documentType: "employment_contract",
      category: "EMPLOYEE",
      documentCategory: "EMPLOYMENT",
      fileUrl: `documents/${companyId}/contract-draft.pdf`,
      fileName: "contract-draft.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });

    const rejected = await rejectDocument(
      companyId,
      doc.id,
      verifierId,
      "Missing employee signature on page 4"
    );

    expect(rejected).not.toBeNull();
    expect(rejected!.verificationStatus).toBe("REJECTED");
    expect(rejected!.rejectionReason).toBe("Missing employee signature on page 4");
  });

  it("updates document metadata cleanly", async () => {
    const doc = await createDocumentRecord({
      companyId,
      uploadedById: uploaderId,
      employeeId,
      title: "PSiRA Card",
      documentType: "psira_card",
      category: "EMPLOYEE",
      documentCategory: "PSIRA",
      fileUrl: `documents/${companyId}/psira-card.pdf`,
      fileName: "psira-card.pdf",
      mimeType: "application/pdf",
      size: 512,
    });

    const expiry = new Date(Date.now() + 365 * 24 * 3600_000);
    const updated = await updateDocumentMetadata(companyId, doc.id, verifierId, {
      title: "PSiRA Renewal Card 2027",
      documentNumber: "PSIRA-CARD-999",
      issuingAuthority: "PSiRA",
      expiryDate: expiry,
      doesNotExpire: false,
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("PSiRA Renewal Card 2027");
    expect(updated!.documentNumber).toBe("PSIRA-CARD-999");
    expect(updated!.issuingAuthority).toBe("PSiRA");
    expect(updated!.expiryDate).toEqual(expiry);
  });

  it("generates company compliance summary and report accurately", async () => {
    const summary = await getCompanyComplianceSummary(companyId);
    expect(summary.totalEmployees).toBeGreaterThanOrEqual(1);

    const report = await getCompanyComplianceReport(companyId, { limit: 10 });
    expect(report.total).toBeGreaterThanOrEqual(1);
    const empReport = report.items.find((i) => i.employeeId === employeeId);
    expect(empReport).toBeDefined();
    expect(empReport!.requirements.length).toBeGreaterThan(0);
  });

  it("strictly isolates documents across companies", async () => {
    // List documents for other company should not see first company's docs
    const otherDocs = await listDocuments(otherCompanyId, {});
    const leakedDoc = otherDocs.items.find((d) => d.employeeId === employeeId);
    expect(leakedDoc).toBeUndefined();

    // Compliance calculation for employee belonging to another company returns null
    const crossCompanyCompliance = await calculateEmployeeCompliance(otherCompanyId, employeeId);
    expect(crossCompanyCompliance).toBeNull();
  });
});

