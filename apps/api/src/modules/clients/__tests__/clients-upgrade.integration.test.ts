import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../../lib/prisma.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { config } from "../../../lib/config.js";
import { hashPassword } from "../../../services/auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("Client Module Upgrade — Integration Tests", () => {
  let app: FastifyInstance;
  const runId = randomBytes(6).toString("hex");

  let companyAId: string;
  let tokenA: string;
  let tokenASensitive: string;
  let tokenANoClients: string;
  let tokenALegacySites: string;

  let companyBId: string;
  let tokenB: string;

  let clientAId: string;
  let siteAId: string;
  let siteBId: string;
  let otherCompanySiteId: string;

  async function provisionCompany(label: string, capabilities: Record<string, string[]>) {
    const company = await prisma.company.create({
      data: { name: `Upgrade Test ${label} ${runId}` },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: `User ${label}`,
        email: `client-up-${label.toLowerCase()}-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("test-pw-32-chars-long-secure!"),
        capabilities,
      },
    });
    await prisma.company.update({ where: { id: company.id }, data: { ownerUserId: user.id } });
    return {
      companyId: company.id,
      userId: user.id,
      token: jwt.sign(
        { sub: user.id, email: user.email, companyId: company.id },
        config.jwt.accessSecret,
        { expiresIn: "1h" }
      ),
    };
  }

  async function addUser(companyId: string, label: string, capabilities: Record<string, string[]>) {
    const user = await prisma.user.create({
      data: {
        companyId,
        name: `User ${label}`,
        email: `sub-${label.toLowerCase()}-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("test-pw-32-chars-long-secure!"),
        capabilities,
      },
    });
    return jwt.sign({ sub: user.id, email: user.email, companyId }, config.jwt.accessSecret, {
      expiresIn: "1h",
    });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const tenantA = await provisionCompany("A", {
      "/clients": ["view", "create", "edit", "delete", "export"],
      "/documents": ["view", "create", "edit", "delete", "export"],
    });
    companyAId = tenantA.companyId;
    tokenA = tenantA.token;

    tokenASensitive = await addUser(companyAId, "SensitiveA", {
      "/clients": ["view", "view_sensitive", "create", "edit"],
      "/documents": ["view", "view_sensitive"],
    });

    tokenANoClients = await addUser(companyAId, "NoClients", {
      "/employees": ["view", "view_sensitive"],
      "/payroll": ["view", "view_sensitive"],
    });

    tokenALegacySites = await addUser(companyAId, "LegacySites", {
      "/sites": ["view", "edit"],
    });

    const tenantB = await provisionCompany("B", {
      "/clients": ["view", "create", "edit", "delete"],
    });
    companyBId = tenantB.companyId;
    tokenB = tenantB.token;

    // Create client for tenant A
    const clientA = await prisma.client.create({
      data: {
        companyId: companyAId,
        name: `Gold Star Protection ${runId}`,
        legalName: `Gold Star Protection Services (Pty) Ltd`,
        entityType: "PRIVATE_COMPANY",
        onboardingStatus: "DRAFT",
      },
    });
    clientAId = clientA.id;

    const siteA = await prisma.site.create({
      data: {
        companyId: companyAId,
        name: `Gold Site 1 ${runId}`,
        clientId: clientAId,
        siteStatus: "ACTIVE",
      },
    });
    siteAId = siteA.id;

    const siteB = await prisma.site.create({
      data: {
        companyId: companyAId,
        name: `Gold Site 2 ${runId}`,
        clientId: clientAId,
        siteStatus: "ACTIVE",
      },
    });
    siteBId = siteB.id;

    const otherSite = await prisma.site.create({
      data: {
        companyId: companyBId,
        name: `Company B Site ${runId}`,
        siteStatus: "ACTIVE",
      },
    });
    otherCompanySiteId = otherSite.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
    await app.close();
  });

  // ==========================================
  // 1. Legal Identity Fields & Status Updates
  // ==========================================
  it("creates a client with new legal identity, tax, and onboarding fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        name: `Sapphire Holdings ${runId}`,
        legalName: `Sapphire Corporate Holdings (Pty) Ltd`,
        tradingName: `Sapphire Properties`,
        entityType: "PRIVATE_COMPANY",
        registrationNumber: "2023/888999/07",
        taxNumber: "9876543210",
        vatNumber: "4987654321",
        registeredAddress: "100 Grayston Drive, Sandton, 2196",
        physicalAddress: "100 Grayston Drive, Sandton",
        billingEmail: `billing-${runId}@sapphire-test.local`,
        paymentTermsDays: 45,
        onboardingStatus: "READY",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.legalName).toBe("Sapphire Corporate Holdings (Pty) Ltd");
    expect(body.tradingName).toBe("Sapphire Properties");
    expect(body.entityType).toBe("PRIVATE_COMPANY");
    expect(body.registrationNumber).toBe("2023/888999/07");
    expect(body.taxNumber).toBe("9876543210");
    expect(body.registeredAddress).toBe("100 Grayston Drive, Sandton, 2196");
    expect(body.onboardingStatus).toBe("READY");
    expect(body.paymentTermsDays).toBe(45);
  });

  it("updates onboarding status and legal address safely", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/clients/${clientAId}`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        tradingName: "Gold Star Security Ops",
        onboardingStatus: "ACTIVE",
        registeredAddress: "45 West Street, Sandton, 2196",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tradingName).toBe("Gold Star Security Ops");
    expect(body.onboardingStatus).toBe("ACTIVE");
    expect(body.onboardingCompletedAt).toBeDefined();
    expect(body.registeredAddress).toBe("45 West Street, Sandton, 2196");
  });

  // ==========================================
  // 2. Tenant Isolation & Permissions
  // ==========================================
  it("rejects tenant B from reading tenant A client details", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}`,
      headers: authHeader(tokenB),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects user without /clients or /sites capability", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}`,
      headers: authHeader(tokenANoClients),
    });
    expect(res.statusCode).toBe(403);
  });

  it("permits user with legacy /sites capability to view client", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}`,
      headers: authHeader(tokenALegacySites),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(clientAId);
  });

  // ==========================================
  // 3. Multi-Contact Management & Primary Sync
  // ==========================================
  let contact1Id: string;
  let contact2Id: string;

  it("creates multiple client contacts with types and auto-primary assignment", async () => {
    // Contact 1 (first contact -> auto isPrimary = true)
    const res1 = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/contacts`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        firstName: "Nolwazi",
        lastName: "Cele",
        jobTitle: "Head of Security",
        contactType: "OPERATIONS",
        email: `nolwazi-${runId}@goldstar-test.local`,
        mobile: "0823334444",
      },
    });
    expect(res1.statusCode).toBe(201);
    const body1 = res1.json().data;
    expect(body1.firstName).toBe("Nolwazi");
    expect(body1.isPrimary).toBe(true);
    contact1Id = body1.id;

    // Contact 2 (Billing contact)
    const res2 = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/contacts`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        firstName: "Francois",
        lastName: "du Plessis",
        jobTitle: "Financial Director",
        contactType: "BILLING",
        email: `francois-${runId}@goldstar-test.local`,
        mobile: "0835556666",
        isPrimary: false,
      },
    });
    expect(res2.statusCode).toBe(201);
    contact2Id = res2.json().data.id;

    // Verify client record was synced with primary contact
    const clientCheck = await prisma.client.findUnique({ where: { id: clientAId } });
    expect(clientCheck?.contactPersonName).toBe("Nolwazi Cele");
    expect(clientCheck?.contactPersonRole).toBe("Head of Security");
    expect(clientCheck?.contactPersonMobile).toBe("0823334444");
  });

  it("switching primary contact updates isPrimary flags and syncs client master", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/clients/${clientAId}/contacts/${contact2Id}`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: { isPrimary: true },
    });
    expect(res.statusCode).toBe(200);

    // Verify contact 1 was unset and contact 2 is primary
    const c1 = await prisma.clientContact.findUnique({ where: { id: contact1Id } });
    const c2 = await prisma.clientContact.findUnique({ where: { id: contact2Id } });
    expect(c1?.isPrimary).toBe(false);
    expect(c2?.isPrimary).toBe(true);

    // Verify client master synced with Francois
    const clientCheck = await prisma.client.findUnique({ where: { id: clientAId } });
    expect(clientCheck?.contactPersonName).toBe("Francois du Plessis");
    expect(clientCheck?.contactPersonRole).toBe("Financial Director");
    expect(clientCheck?.contactPersonMobile).toBe("0835556666");
  });

  it("lists all client contacts tenant-isolated", async () => {
    const resA = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/contacts`,
      headers: authHeader(tokenA),
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json().data).toHaveLength(2);

    // Tenant B cannot list Tenant A's contacts
    const resB = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/contacts`,
      headers: authHeader(tokenB),
    });
    expect(resB.statusCode).toBe(404);
  });

  // ==========================================
  // 4. Related Parties & Authorised Representatives
  // ==========================================
  let partyId: string;

  it("creates, updates, and lists related parties", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/related-parties`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        fullName: "Dr. Trevor Matthews",
        relationshipType: "DIRECTOR",
        ownershipPercent: 35.5,
        isAuthorisedSignatory: true,
        authorityReference: "Board Resolution 2026-03",
        notes: "Executive Director & Shareholder",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.fullName).toBe("Dr. Trevor Matthews");
    expect(Number(body.ownershipPercent)).toBe(35.5);
    expect(body.isAuthorisedSignatory).toBe(true);
    partyId = body.id;

    // Update ownership
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/clients/${clientAId}/related-parties/${partyId}`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: { ownershipPercent: 40.0 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(Number(patchRes.json().data.ownershipPercent)).toBe(40.0);

    // Tenant B cannot access
    const resB = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/related-parties`,
      headers: authHeader(tokenB),
    });
    expect(resB.statusCode).toBe(404);
  });

  // ==========================================
  // 5. Commercial Contracts & Site Linking
  // ==========================================
  let contractId: string;

  it("creates a client contract and links operational sites", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/contracts`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        contractNumber: `MSA-${runId}-001`,
        title: "Master Security Agreement — Commercial Division",
        status: "ACTIVE",
        signedDate: "2026-01-15",
        effectiveFrom: "2026-02-01",
        effectiveTo: "2027-01-31",
        noticePeriodDays: 60,
        renewalType: "EVERGREEN",
        autoRenew: true,
        serviceTypes: ["Physical Guarding", "Access Control", "CCTV Monitoring"],
      },
    });

    expect(res.statusCode).toBe(201);
    const contract = res.json().data;
    expect(contract.contractNumber).toBe(`MSA-${runId}-001`);
    expect(contract.status).toBe("ACTIVE");
    expect(contract.renewalType).toBe("EVERGREEN");
    contractId = contract.id;

    // Link siteA and siteB to the contract
    const linkRes = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/contracts/${contractId}/sites`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: { siteIds: [siteAId, siteBId] },
    });

    expect(linkRes.statusCode).toBe(200);
    const linkedSites = linkRes.json().data;
    expect(linkedSites).toHaveLength(2);
  });

  it("rejects linking a site belonging to another company to the contract", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientAId}/contracts/${contractId}/sites`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: { siteIds: [otherCompanySiteId] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("unlinks a site from the contract", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/clients/${clientAId}/contracts/${contractId}/sites/${siteBId}`,
      headers: authHeader(tokenA),
    });

    expect(res.statusCode).toBe(200);
    const updatedContract = res.json().data;
    expect(updatedContract.sites).toHaveLength(1);
    expect(updatedContract.sites[0].siteId).toBe(siteAId);
  });

  // ==========================================
  // 6. Documents & Least-Privilege Sensitive Access
  // ==========================================
  it("enforces least-privilege for client-sensitive documents", async () => {
    const userA = await prisma.user.findFirst({ where: { companyId: companyAId } });

    // Create a sensitive client document record directly in prisma
    const sensitiveDoc = await prisma.managedDocument.create({
      data: {
        companyId: companyAId,
        title: "Confidential Beneficial Ownership Register",
        fileName: "beneficial_owners.pdf",
        fileUrl: "/api/documents/test-beneficial-owners.pdf",
        size: 1024,
        mimeType: "application/pdf",
        category: "CLIENT",
        documentType: "BENEFICIAL_OWNERSHIP_REGISTER",
        clientId: clientAId,
        isSensitive: true,
        uploadedById: userA!.id,
        verificationStatus: "PENDING_VERIFICATION",
      },
    });

    // 1. User with only employee-sensitive capability cannot view the sensitive client document
    const resNoClientSens = await app.inject({
      method: "GET",
      url: `/documents/${sensitiveDoc.id}`,
      headers: authHeader(tokenANoClients),
    });
    expect(resNoClientSens.statusCode).toBe(403);

    // 2. User with /clients view_sensitive CAN view the sensitive client document
    const resSens = await app.inject({
      method: "GET",
      url: `/documents/${sensitiveDoc.id}`,
      headers: authHeader(tokenASensitive),
    });
    expect(resSens.statusCode).toBe(200);
    expect(resSens.json().id).toBe(sensitiveDoc.id);

    // 3. Document listing by clientId
    const listRes = await app.inject({
      method: "GET",
      url: `/documents?clientId=${clientAId}`,
      headers: authHeader(tokenASensitive),
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(1);
  });

  // ==========================================
  // 7. Compliance & Readiness Evaluation Engine
  // ==========================================
  it("calculates structured compliance readiness evaluation", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/compliance`,
      headers: authHeader(tokenA),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.clientId).toBe(clientAId);
    expect(body.checks).toBeDefined();

    // Verify structured checks are present
    const checkKeys = body.checks.map((c: any) => c.key);
    expect(checkKeys).toContain("legal_identity");
    expect(checkKeys).toContain("primary_contact");
    expect(checkKeys).toContain("service_contract");
    expect(checkKeys).toContain("authorised_signatory");
    expect(checkKeys).toContain("popia_compliance");

    // Primary contact and written contract should be COMPLETE
    const contractCheck = body.checks.find((c: any) => c.key === "service_contract");
    expect(contractCheck?.status).toBe("COMPLETE");

    const primaryCheck = body.checks.find((c: any) => c.key === "primary_contact");
    expect(primaryCheck?.status).toBe("COMPLETE");

    // Overall status is structured
    expect(["COMPLETE", "ATTENTION", "MISSING"]).toContain(body.overallStatus);
  });

  // ==========================================
  // 8. POPIA & Data Processing Profile
  // ==========================================
  it("creates and updates POPIA data processing profile", async () => {
    // Initial fetch returns null or empty
    const initialRes = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/data-processing`,
      headers: authHeader(tokenA),
    });
    expect(initialRes.statusCode).toBe(200);

    // Patch to create profile
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/clients/${clientAId}/data-processing`,
      headers: { ...authHeader(tokenA), "content-type": "application/json" },
      payload: {
        responsiblePartyName: "Gold Star Protection Services (Pty) Ltd",
        processingPurposes: ["Physical Access Control", "CCTV Video Surveillance"],
        dataCategories: ["National ID Numbers", "CCTV Footage"],
        operatorAgreementStatus: "SIGNED",
        operatorAgreementSignedDate: "2026-02-01",
        hasCrossBorderTransfer: false,
        privacyNoticeProvided: true,
        privacyNoticeDate: "2026-02-01",
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const profile = patchRes.json().data;
    expect(profile.operatorAgreementStatus).toBe("SIGNED");
    expect(profile.processingPurposes).toContain("Physical Access Control");
    expect(profile.privacyNoticeProvided).toBe(true);
  });

  // ==========================================
  // 9. Existing Month-End Reporting Unbroken
  // ==========================================
  it("ensures month-end reporting endpoint continues to function", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientAId}/month-end/summary?month=2026-08`,
      headers: authHeader(tokenA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.client.id).toBe(clientAId);
    expect(body.period).toBeDefined();
    expect(body.sites).toBeDefined();
  });
});
