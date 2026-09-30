import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { config } from "../../../lib/config.js";
import { hashPassword } from "../../../services/auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

const BILLING = "/payroll/billing";

describe.runIf(dbReady)("quote and invoice numbering (integration)", () => {
  let app: FastifyInstance;
  const runId = randomBytes(6).toString("hex");

  let companyId: string;
  let token: string;
  let clientId: string;
  let site1Id: string;
  let site2Id: string;

  let opsToken: string; // Operations user: view and create, but NOT edit

  async function provision(label: string, capabilities: Record<string, string[]>) {
    const company = await prisma.company.create({
      data: { name: `Numbering Test ${label} ${runId}`, vatNumber: `4${runId.slice(0, 9)}` },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: `Billing ${label}`,
        email: `billing-num-${label.toLowerCase()}-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("billing-test-password-32chars!!"),
        capabilities,
      },
    });
    await prisma.company.update({ where: { id: company.id }, data: { ownerUserId: user.id } });
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, companyId: company.id },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
    return { companyId: company.id, userId: user.id, token: accessToken };
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const tenantA = await provision("Finance", {
      "/payroll/billing": ["view", "create", "edit", "delete", "approve", "export"],
    });
    companyId = tenantA.companyId;
    token = tenantA.token;

    // Operations user who does not have 'edit' capability (cannot configure numbering)
    const opsUser = await prisma.user.create({
      data: {
        companyId,
        name: "Ops User",
        email: `billing-ops-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("billing-test-password-32chars!!"),
        capabilities: { "/payroll/billing": ["view", "create"] },
      },
    });
    opsToken = jwt.sign(
      { sub: opsUser.id, email: opsUser.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    const client = await prisma.client.create({
      data: {
        companyId,
        name: `Acme Industrial ${runId}`,
        email: `ops-${runId}@acme-test.local`,
        billingEmail: `ap-${runId}@acme-test.local`,
        billingAddress: "14 Mining Way, Wolmaransstad",
        vatNumber: "4123456789",
        paymentTermsDays: 30,
      },
    });
    clientId = client.id;

    const site1 = await prisma.site.create({
      data: {
        companyId,
        name: `Wolmaransstad Main Site ${runId}`,
        clientId,
        siteStatus: "ACTIVE",
      },
    });
    site1Id = site1.id;

    const site2 = await prisma.site.create({
      data: {
        companyId,
        name: `Klerksdorp Depot ${runId}`,
        clientId,
        siteStatus: "ACTIVE",
      },
    });
    site2Id = site2.id;
  });

  afterAll(async () => {
    if (!companyId) return;
    try {
      await prisma.clientInvoicePayment.deleteMany({
        where: { invoice: { companyId } },
      });
      await prisma.clientInvoiceLine.deleteMany({
        where: { invoice: { companyId } },
      });
      await prisma.clientInvoice.deleteMany({ where: { companyId } });
      await prisma.clientQuoteLine.deleteMany({
        where: { quote: { companyId } },
      });
      await prisma.clientQuote.deleteMany({ where: { companyId } });
      await prisma.siteBillingConfig.deleteMany({ where: { companyId } });
      await prisma.site.deleteMany({ where: { companyId } });
      await prisma.client.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    } catch {
      // Ignore teardown errors in tests
    }
  });

  // 1 & 4. Configure Prefix and Numbering
  it("configures quote and invoice prefix, starting number, and padding for a site", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: {
        quotePrefix: "QBS-WOL-",
        quoteStartingNumber: 1,
        quotePadding: 4,
        invoicePrefix: "INV-WOL-",
        invoiceStartingNumber: 1,
        invoicePadding: 4,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.quotePrefix).toBe("QBS-WOL-");
    expect(body.config.quoteNextNumber).toBe(1);
    expect(body.config.invoicePrefix).toBe("INV-WOL-");
    expect(body.config.invoiceNextNumber).toBe(1);
    expect(body.config.invoicePadding).toBe(4);
  });

  // Preview endpoint
  it("provides live previews of next numbers based on site configuration", async () => {
    const quotePreviewRes = await app.inject({
      method: "GET",
      url: `${BILLING}/numbering/preview?kind=quote&clientId=${clientId}&siteId=${site1Id}`,
      headers: authHeader(token),
    });
    expect(quotePreviewRes.statusCode).toBe(200);
    expect(quotePreviewRes.json().nextNumber).toBe("QBS-WOL-0001");

    const invoicePreviewRes = await app.inject({
      method: "GET",
      url: `${BILLING}/numbering/preview?kind=invoice&clientId=${clientId}&siteId=${site1Id}`,
      headers: authHeader(token),
    });
    expect(invoicePreviewRes.statusCode).toBe(200);
    expect(invoicePreviewRes.json().nextNumber).toBe("INV-WOL-0001");
  });

  // 1. Automatic Quote Numbering & 10. Sequence increments
  it("generates sequential quote numbers automatically using site configuration", async () => {
    const lineItem = { description: "Security Guard Day Shift", quantity: 2, unitAmount: "12000.00" };

    const q1 = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [lineItem],
      },
    });
    expect(q1.statusCode).toBe(201);
    expect(q1.json().quoteNumber).toBe("QBS-WOL-0001");
    expect(q1.json().siteId).toBe(site1Id);

    const q2 = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [lineItem],
      },
    });
    expect(q2.statusCode).toBe(201);
    expect(q2.json().quoteNumber).toBe("QBS-WOL-0002");
  });

  // 2 & 3. Automatic Invoice Numbering & Separate Sequences
  it("generates invoice numbers on a separate sequence from quotes", async () => {
    const lineItem = { description: "Monthly Guarding Fee", quantity: 1, unitAmount: "24000.00" };

    const inv1 = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        invoiceDate: "2026-10-01",
        items: [lineItem],
      },
    });
    expect(inv1.statusCode).toBe(201);
    // Sequence starts at 0001, completely unaffected by the 2 quotes previously created
    expect(inv1.json().invoiceNumber).toBe("INV-WOL-0001");
    expect(inv1.json().siteId).toBe(site1Id);

    const inv2 = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        invoiceDate: "2026-10-01",
        items: [lineItem],
      },
    });
    expect(inv2.statusCode).toBe(201);
    expect(inv2.json().invoiceNumber).toBe("INV-WOL-0002");
  });

  // 6. Manual Quote Numbers
  it("allows manual quote number entry and preserves custom format", async () => {
    const lineItem = { description: "Armed Response Add-on", quantity: 1, unitAmount: "4500.00" };

    const manualQuote = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        quoteNumber: "QBS-WOL-Q-2026-0045",
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [lineItem],
      },
    });
    expect(manualQuote.statusCode).toBe(201);
    expect(manualQuote.json().quoteNumber).toBe("QBS-WOL-Q-2026-0045");

    // The automatic sequence continues normally for the next auto quote
    const nextAuto = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [lineItem],
      },
    });
    expect(nextAuto.statusCode).toBe(201);
    expect(nextAuto.json().quoteNumber).toBe("QBS-WOL-0003");
  });

  // 7. Manual Invoice Numbers
  it("allows manual invoice number entry and validates format", async () => {
    const lineItem = { description: "CCTV Installation", quantity: 1, unitAmount: "18500.00" };

    const manualInv = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        invoiceNumber: "INV-LEGACY-0099",
        invoiceDate: "2026-10-01",
        items: [lineItem],
      },
    });
    expect(manualInv.statusCode).toBe(201);
    expect(manualInv.json().invoiceNumber).toBe("INV-LEGACY-0099");
  });

  // 8. Duplicate Number Prevention
  it("rejects duplicate manual document numbers with 409 conflict", async () => {
    const lineItem = { description: "Guard Service", quantity: 1, unitAmount: "1000.00" };

    // Duplicate manual quote number
    const dupQuote = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        quoteNumber: "QBS-WOL-Q-2026-0045", // Already used above
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [lineItem],
      },
    });
    expect(dupQuote.statusCode).toBe(409);
    expect(dupQuote.json().message).toMatch(/already exists/i);

    // Duplicate manual invoice number
    const dupInv = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices`,
      headers: authHeader(token),
      payload: {
        clientId,
        invoiceNumber: "INV-LEGACY-0099", // Already used above
        invoiceDate: "2026-10-01",
        items: [lineItem],
      },
    });
    expect(dupInv.statusCode).toBe(409);
    expect(dupInv.json().message).toMatch(/already exists/i);
  });

  // 5. Prefix Changes (historical numbers retained)
  it("changing a prefix affects only future documents, leaving historical numbers intact", async () => {
    // Change invoice prefix from INV-WOL- to QBS-INV-
    const updatePrefix = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: {
        invoicePrefix: "QBS-INV-",
      },
    });
    expect(updatePrefix.statusCode).toBe(200);

    // Create new invoice with updated prefix
    const newInv = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        invoiceDate: "2026-10-02",
        items: [{ description: "Guard Service", quantity: 1, unitAmount: "1000.00" }],
      },
    });
    expect(newInv.statusCode).toBe(201);
    expect(newInv.json().invoiceNumber).toBe("QBS-INV-0003");

    // Verify historical invoice INV-WOL-0001 still exists with its original number
    const oldInvCheck = await prisma.clientInvoice.findFirst({
      where: { companyId, invoiceNumber: "INV-WOL-0001" },
    });
    expect(oldInvCheck).not.toBeNull();
    expect(oldInvCheck?.invoiceNumber).toBe("INV-WOL-0001");
  });

  // 9. Concurrent Document Creation (Advisory Lock Safety)
  it("handles concurrent invoice creations without generating duplicate numbers", async () => {
    const lineItem = { description: "Concurrent Test", quantity: 1, unitAmount: "500.00" };

    // Trigger 5 concurrent requests simultaneously
    const requests = Array.from({ length: 5 }, () =>
      app.inject({
        method: "POST",
        url: `${BILLING}/invoices`,
        headers: authHeader(token),
        payload: {
          clientId,
          siteId: site1Id,
          invoiceDate: "2026-10-02",
          items: [lineItem],
        },
      })
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
    }

    const numbers = responses.map((r) => r.json().invoiceNumber);
    // Verify all 5 numbers are completely unique
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(5);
  });

  // 11. Leading-zero padding configuration
  it("supports custom padding length (e.g. 6 digits)", async () => {
    // Configure site2 with 6-digit padding and prefix KLERK-
    const cfg = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site2Id}/numbering`,
      headers: authHeader(token),
      payload: {
        quotePrefix: "KLERK-Q-",
        quoteStartingNumber: 1,
        quotePadding: 6,
        invoicePrefix: "KLERK-INV-",
        invoiceStartingNumber: 1,
        invoicePadding: 6,
      },
    });
    expect(cfg.statusCode).toBe(200);

    const quoteRes = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site2Id,
        quoteDate: "2026-10-02",
        validUntil: "2026-10-31",
        items: [{ description: "Klerksdorp Patrol", quantity: 1, unitAmount: "5000.00" }],
      },
    });
    expect(quoteRes.statusCode).toBe(201);
    expect(quoteRes.json().quoteNumber).toBe("KLERK-Q-000001");
  });

  // 13. Permissions: Operational user cannot configure numbering
  it("prevents users without billing:edit capability from modifying numbering configuration", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(opsToken),
      payload: {
        quotePrefix: "HACKED-",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // 15. API Validation: Prefix and numbers constraints
  it("validates prefix and numeric constraints on the numbering API", async () => {
    // Invalid characters in prefix
    const badChars = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: { quotePrefix: "BAD PREFIX WITH SPACES" },
    });
    expect(badChars.statusCode).toBe(400);

    // Prefix too long (> 20 chars)
    const tooLong = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: { quotePrefix: "VERY-LONG-PREFIX-EXCEEDING-TWENTY-CHARS" },
    });
    expect(tooLong.statusCode).toBe(400);

    // Negative starting number
    const negStart = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: { quoteStartingNumber: -5 },
    });
    expect(negStart.statusCode).toBe(400);

    // Padding < 1 or > 10
    const badPadding = await app.inject({
      method: "POST",
      url: `${BILLING}/clients/${clientId}/sites/${site1Id}/numbering`,
      headers: authHeader(token),
      payload: { quotePadding: 15 },
    });
    expect(badPadding.statusCode).toBe(400);
  });

  // Quote conversion with numbering options
  it("allows converting accepted quote to invoice with site-specific sequence or manual number", async () => {
    // 1. Create a quote for site1
    const createRes = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: authHeader(token),
      payload: {
        clientId,
        siteId: site1Id,
        quoteDate: "2026-10-01",
        validUntil: "2026-10-31",
        items: [{ description: "Full Guard Detail", quantity: 1, unitAmount: "10000.00" }],
      },
    });
    const quoteId = createRes.json().id;

    // Issue and Accept quote
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quoteId}/issue`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quoteId}/accept`, headers: authHeader(token) });

    // Convert with manual invoice number
    const convertRes = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quoteId}/convert-to-invoice`,
      headers: authHeader(token),
      payload: {
        siteId: site1Id,
        invoiceNumber: "INV-CONVERTED-001",
      },
    });
    expect(convertRes.statusCode).toBe(201);
    expect(convertRes.json().invoiceNumber).toBe("INV-CONVERTED-001");
    expect(convertRes.json().siteId).toBe(site1Id);
  });
});
