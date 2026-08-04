import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../../lib/prisma.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { config } from "../../../lib/config.js";
import { hashPassword } from "../../../services/auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("clients & month-end reporting (integration)", () => {
  let app: FastifyInstance;
  const runId = randomBytes(6).toString("hex");

  let companyId: string;
  let token: string;
  /** Only the legacy `/sites` grant — proves existing users keep access after the move. */
  let legacySitesToken: string;
  /** No clients-related grant at all. */
  let outsiderToken: string;

  let otherCompanyId: string;
  let otherToken: string;

  let clientId: string;
  let siteAId: string;
  let siteBId: string;
  let unlinkedSiteId: string;
  let otherCompanySiteId: string;

  async function provision(label: string, capabilities: Record<string, string[]>) {
    const company = await prisma.company.create({
      data: { name: `Clients Test ${label} ${runId}` },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: `Clients ${label}`,
        email: `clients-${label.toLowerCase()}-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("clients-test-password-32chars!!"),
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

  async function addUser(label: string, capabilities: Record<string, string[]>) {
    const user = await prisma.user.create({
      data: {
        companyId,
        name: `Clients ${label}`,
        email: `clients-${label.toLowerCase()}-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("clients-test-password-32chars!!"),
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

    const tenantA = await provision("A", {
      "/clients": ["view", "create", "edit", "export"],
    });
    companyId = tenantA.companyId;
    token = tenantA.token;

    const tenantB = await provision("B", { "/clients": ["view", "create", "edit", "export"] });
    otherCompanyId = tenantB.companyId;
    otherToken = tenantB.token;

    legacySitesToken = await addUser("Legacy", { "/sites": ["view", "edit", "export"] });
    outsiderToken = await addUser("Outsider", { "/tasks": ["view"] });

    const client = await prisma.client.create({
      data: { companyId, name: `Umbrella Security Co ${runId}` },
    });
    clientId = client.id;

    const siteA = await prisma.site.create({
      data: { companyId, name: `Alpha Gate ${runId}`, clientId, siteStatus: "ACTIVE" },
    });
    siteAId = siteA.id;

    const siteB = await prisma.site.create({
      data: { companyId, name: `Beta Depot ${runId}`, siteStatus: "ACTIVE" },
    });
    siteBId = siteB.id;

    const unlinked = await prisma.site.create({
      data: { companyId, name: `Gamma Yard ${runId}`, siteStatus: "ACTIVE" },
    });
    unlinkedSiteId = unlinked.id;

    const foreign = await prisma.site.create({
      data: { companyId: otherCompanyId, name: `Foreign Site ${runId}`, siteStatus: "ACTIVE" },
    });
    otherCompanySiteId = foreign.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await app.close();
  });

  // ——— Contact and reporting fields ———

  it("creates a client with contact details and report recipients", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: {
        name: `Contactful Client ${runId}`,
        email: `ops-${runId}@contactful-test.local`,
        contactPersonName: "Thandi Mokoena",
        contactPersonRole: "Facilities Manager",
        contactPersonMobile: "0821112222",
        physicalAddress: "42 Rivonia Road, Sandton",
        notes: "Prefers reports by the 3rd of the month.",
        reportRecipients: [`fm-${runId}@contactful-test.local`, `ap-${runId}@contactful-test.local`],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contactPersonName).toBe("Thandi Mokoena");
    expect(body.contactPersonRole).toBe("Facilities Manager");
    expect(body.physicalAddress).toBe("42 Rivonia Road, Sandton");
    expect(body.reportRecipients).toHaveLength(2);
  });

  it("rejects an invalid recipient address", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { name: `Bad Recipients ${runId}`, reportRecipients: ["not-an-email"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("patches one field without clearing the others, and can clear the recipient list", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/clients",
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: {
        name: `Partial Patch ${runId}`,
        contactPersonName: "Sipho Dlamini",
        vatNumber: "4123456789",
        reportRecipients: [`one-${runId}@patch-test.local`],
      },
    });
    const id = created.json().id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/clients/${id}`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { contactPersonMobile: "0834445555" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      contactPersonName: "Sipho Dlamini",
      contactPersonMobile: "0834445555",
      vatNumber: "4123456789",
    });
    expect(patched.json().reportRecipients).toEqual([`one-${runId}@patch-test.local`]);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/clients/${id}`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { reportRecipients: [] },
    });
    expect(cleared.json().reportRecipients).toEqual([]);
    expect(cleared.json().contactPersonName).toBe("Sipho Dlamini");
  });

  // ——— Site linking ———

  it("links sites to a client and returns the refreshed list", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientId}/sites`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { siteIds: [siteBId] },
    });
    expect(res.statusCode).toBe(200);
    const names = (res.json().data as { id: string }[]).map((s) => s.id);
    expect(names).toContain(siteAId);
    expect(names).toContain(siteBId);
  });

  it("links nothing when any site belongs to another company", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clients/${clientId}/sites`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { siteIds: [unlinkedSiteId, otherCompanySiteId] },
    });
    expect(res.statusCode).toBe(400);
    const site = await prisma.site.findUnique({ where: { id: unlinkedSiteId } });
    expect(site?.clientId).toBeNull();
  });

  it("unlinks a site by nulling clientId", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/clients/${clientId}/sites/${siteBId}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const site = await prisma.site.findUnique({ where: { id: siteBId } });
    expect(site?.clientId).toBeNull();
  });

  it("refuses to unlink a site that is not linked to this client", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/clients/${clientId}/sites/${unlinkedSiteId}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(404);
  });

  // ——— Month-end summary ———

  it("summarises every linked site for the month", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/month-end/summary?month=2026-07`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toMatchObject({
      month: "2026-07",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({ siteId: siteAId, timesheetStatus: "draft" });
    expect(body.warnings.join(" ")).toContain("not approved");
  });

  it("rejects a malformed month rather than reporting on the wrong window", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/month-end/summary?month=2026-13`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts an explicit period for companies on a payroll cycle", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/month-end/summary?periodStart=2026-06-26&periodEnd=2026-07-25`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().period).toMatchObject({
      month: null,
      periodStart: "2026-06-26",
      periodEnd: "2026-07-25",
    });
  });

  // ——— Access control ———

  it("keeps working for a user who only has the legacy /sites grant", async () => {
    const list = await app.inject({ method: "GET", url: "/clients", headers: authHeader(legacySitesToken) });
    expect(list.statusCode).toBe(200);

    const patch = await app.inject({
      method: "PATCH",
      url: `/clients/${clientId}`,
      headers: { ...authHeader(legacySitesToken), "content-type": "application/json" },
      payload: { contactPersonRole: "Operations Lead" },
    });
    expect(patch.statusCode).toBe(200);

    const summary = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/month-end/summary?month=2026-07`,
      headers: authHeader(legacySitesToken),
    });
    expect(summary.statusCode).toBe(200);
  });

  it("denies a user with no clients, sites or settings grant", async () => {
    for (const url of ["/clients", `/clients/${clientId}/month-end/summary?month=2026-07`]) {
      const res = await app.inject({ method: "GET", url, headers: authHeader(outsiderToken) });
      expect(res.statusCode).toBe(403);
    }
  });

  it("does not leak another company's client or site", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/clients/${clientId}`,
      headers: authHeader(otherToken),
    });
    expect(detail.statusCode).toBe(404);

    const summary = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/month-end/summary?month=2026-07`,
      headers: authHeader(otherToken),
    });
    expect(summary.statusCode).toBe(404);

    // A site in the caller's own company but not owned by this client must 404 too.
    const foreignSiteReport = await app.inject({
      method: "GET",
      url: `/clients/${clientId}/sites/${unlinkedSiteId}/report.pdf?month=2026-07`,
      headers: authHeader(token),
    });
    expect(foreignSiteReport.statusCode).toBe(404);
  });
});
