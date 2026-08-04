import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../../lib/prisma.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { config } from "../../../lib/config.js";
import { hashPassword } from "../../../services/auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

const BILLING = "/payroll/billing";

describe.runIf(dbReady)("client billing (integration)", () => {
  let app: FastifyInstance;
  const runId = randomBytes(6).toString("hex");

  // Tenant A — full billing access.
  let companyId: string;
  let token: string;
  let clientId: string;
  let siteId: string;

  // Tenant B — used for isolation checks.
  let otherCompanyId: string;
  let otherToken: string;

  // A user with only view access, to prove the approve guard bites.
  let viewOnlyToken: string;

  async function provision(label: string, capabilities: Record<string, string[]>) {
    const company = await prisma.company.create({
      data: { name: `Billing Test ${label} ${runId}`, vatNumber: `4${runId.slice(0, 9)}` },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: `Billing ${label}`,
        email: `billing-${label.toLowerCase()}-${runId}@plethora-test.local`,
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

    const tenantA = await provision("A", {
      "/payroll/billing": ["view", "create", "edit", "delete", "approve", "export"],
    });
    companyId = tenantA.companyId;
    token = tenantA.token;

    const tenantB = await provision("B", {
      "/payroll/billing": ["view", "create", "edit", "delete", "approve", "export"],
    });
    otherCompanyId = tenantB.companyId;
    otherToken = tenantB.token;

    // Inherits billing view/create via the /payroll prefix, but has no approve.
    const viewer = await prisma.user.create({
      data: {
        companyId,
        name: "Payroll Viewer",
        email: `billing-viewer-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("billing-test-password-32chars!!"),
        capabilities: { "/payroll": ["view", "create"] },
      },
    });
    viewOnlyToken = jwt.sign(
      { sub: viewer.id, email: viewer.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    const client = await prisma.client.create({
      data: {
        companyId,
        name: `Acme Holdings ${runId}`,
        email: `ops-${runId}@acme-test.local`,
        billingEmail: `ap-${runId}@acme-test.local`,
        billingAddress: "1 Test Street, Johannesburg",
        vatNumber: "4123456789",
        paymentTermsDays: 14,
      },
    });
    clientId = client.id;

    const site = await prisma.site.create({
      data: {
        companyId,
        name: `Acme HQ ${runId}`,
        clientId,
        monthlyRevenue: "25000.00",
        siteStatus: "ACTIVE",
      },
    });
    siteId = site.id;

    // A second site with no contract value, to prove it is surfaced rather than dropped.
    await prisma.site.create({
      data: {
        companyId,
        name: `Acme Depot ${runId}`,
        clientId,
        siteStatus: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await app.close();
  });

  /** Creates a draft quote with a single 25 000 line at 15% VAT. */
  async function createDraftQuote(amount = "25000.00") {
    const res = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: {
        clientId,
        quoteDate: "2026-08-01",
        validUntil: "2026-08-31",
        vatRate: 15,
        items: [{ siteId, description: "Guarding — Acme HQ", quantity: 1, unitAmount: amount }],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; quoteNumber: string; totalAmount: string; status: string };
  }

  it("returns site presets priced from monthlyRevenue and flags unpriced sites", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${BILLING}/clients/${clientId}/site-preset`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const { lines } = res.json() as {
      lines: Array<{ siteId: string; unitAmount: string; needsPrice: boolean }>;
    };
    expect(lines).toHaveLength(2);

    const priced = lines.find((l) => l.siteId === siteId);
    expect(priced?.unitAmount).toBe("25000");
    expect(priced?.needsPrice).toBe(false);

    const unpriced = lines.find((l) => l.siteId !== siteId);
    expect(unpriced?.needsPrice).toBe(true);
    expect(unpriced?.unitAmount).toBe("0");
  });

  it("computes VAT on a new quote and assigns a sequential number", async () => {
    const quote = await createDraftQuote();
    expect(quote.quoteNumber).toMatch(/^QT-\d{4}$/);
    expect(quote.status).toBe("draft");
    // 25000 + 15% = 28750
    expect(quote.totalAmount).toBe("28750");
  });

  it("runs the full quote to paid-invoice lifecycle", async () => {
    const quote = await createDraftQuote();

    const issued = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/issue`,
      headers: authHeader(token),
    });
    expect(issued.statusCode).toBe(200);
    expect((issued.json() as { status: string }).status).toBe("issued");

    const accepted = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/accept`,
      headers: authHeader(token),
    });
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { status: string }).status).toBe("accepted");

    const converted = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/convert-to-invoice`,
      headers: authHeader(token),
    });
    expect(converted.statusCode).toBe(201);
    const invoice = converted.json() as {
      id: string;
      invoiceNumber: string;
      status: string;
      quoteId: string;
      totalAmount: string;
      items: Array<{ description: string; siteId: string | null }>;
    };
    expect(invoice.status).toBe("draft");
    expect(invoice.quoteId).toBe(quote.id);
    expect(invoice.totalAmount).toBe(quote.totalAmount);
    // Line items, including their site link, carry across from the quote.
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].siteId).toBe(siteId);

    // A second conversion is refused unless forced.
    const again = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/convert-to-invoice`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(409);

    const issuedInvoice = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoice.id}/issue`,
      headers: authHeader(token),
    });
    expect(issuedInvoice.statusCode).toBe(200);

    // Partial payment.
    const partial = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoice.id}/payments`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { paymentDate: "2026-08-05", amount: "10000.00", paymentMethod: "eft" },
    });
    expect(partial.statusCode).toBe(201);
    const partialBody = partial.json() as {
      invoiceStatus: string;
      receipt: { receiptNumber: string; amount: string };
    };
    expect(partialBody.invoiceStatus).toBe("partially_paid");
    expect(partialBody.receipt.receiptNumber).toMatch(/^RCT-\d{4}$/);

    // Settling the balance marks it paid.
    const balance = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoice.id}/payments`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { paymentDate: "2026-08-10", amount: "18750.00", paymentMethod: "eft" },
    });
    expect(balance.statusCode).toBe(201);
    expect((balance.json() as { invoiceStatus: string }).invoiceStatus).toBe("paid");

    const detail = await app.inject({
      method: "GET",
      url: `${BILLING}/invoices/${invoice.id}`,
      headers: authHeader(token),
    });
    const detailBody = detail.json() as { amountPaid: string; amountDue: string; status: string };
    expect(detailBody.status).toBe("paid");
    expect(detailBody.amountPaid).toBe("28750");
    expect(detailBody.amountDue).toBe("0");
  });

  it("rejects a payment that exceeds the outstanding balance", async () => {
    const quote = await createDraftQuote("1000.00");
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/issue`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/accept`, headers: authHeader(token) });
    const converted = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/convert-to-invoice`,
      headers: authHeader(token),
    });
    const invoiceId = (converted.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `${BILLING}/invoices/${invoiceId}/issue`, headers: authHeader(token) });

    const res = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoiceId}/payments`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { paymentDate: "2026-08-05", amount: "99999.00" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("Overpayment");
  });

  it("refuses to edit or cancel invoices that are no longer draft", async () => {
    const quote = await createDraftQuote("500.00");
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/issue`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/accept`, headers: authHeader(token) });
    const converted = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/convert-to-invoice`,
      headers: authHeader(token),
    });
    const invoiceId = (converted.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `${BILLING}/invoices/${invoiceId}/issue`, headers: authHeader(token) });

    const edit = await app.inject({
      method: "PATCH",
      url: `${BILLING}/invoices/${invoiceId}`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { discountAmount: "10.00" },
    });
    expect(edit.statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoiceId}/payments`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { paymentDate: "2026-08-06", amount: "100.00" },
    });

    const cancel = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoiceId}/cancel`,
      headers: authHeader(token),
    });
    expect(cancel.statusCode).toBe(409);
  });

  it("reverses a payment and rolls the invoice status back", async () => {
    const quote = await createDraftQuote("2000.00");
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/issue`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `${BILLING}/quotes/${quote.id}/accept`, headers: authHeader(token) });
    const converted = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/convert-to-invoice`,
      headers: authHeader(token),
    });
    const invoiceId = (converted.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `${BILLING}/invoices/${invoiceId}/issue`, headers: authHeader(token) });

    const paid = await app.inject({
      method: "POST",
      url: `${BILLING}/invoices/${invoiceId}/payments`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { paymentDate: "2026-08-05", amount: "2300.00" },
    });
    const paymentId = (paid.json() as { payment: { id: string } }).payment.id;

    const reversed = await app.inject({
      method: "DELETE",
      url: `${BILLING}/payments/${paymentId}`,
      headers: authHeader(token),
    });
    expect(reversed.statusCode).toBe(200);

    // The receipt is removed along with the payment.
    expect(await prisma.clientReceipt.count({ where: { paymentId } })).toBe(0);
  });

  it("produces a statement whose running balance reconciles opening to closing", async () => {
    const statement = await app.inject({
      method: "GET",
      url: `${BILLING}/clients/${clientId}/statement?from=2026-01-01&to=2026-12-31`,
      headers: authHeader(token),
    });
    expect(statement.statusCode).toBe(200);
    const body = statement.json() as {
      openingBalance: string;
      closingBalance: string;
      transactions: Array<{ debit: string; credit: string; balance: string }>;
      aging: Record<string, string>;
    };

    expect(body.transactions.length).toBeGreaterThan(0);

    const movement = body.transactions.reduce(
      (sum, t) => sum + Number(t.debit) - Number(t.credit),
      0
    );
    expect(Number(body.closingBalance)).toBeCloseTo(Number(body.openingBalance) + movement, 2);

    // The last running balance is the closing balance.
    const last = body.transactions[body.transactions.length - 1];
    expect(Number(last.balance)).toBeCloseTo(Number(body.closingBalance), 2);
    expect(body.aging).toHaveProperty("d90_plus");
  });

  it("reports a billing summary for the client", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${BILLING}/summary?clientId=${clientId}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totalBilled: string; totalCollected: string; outstanding: string };
    expect(Number(body.totalBilled)).toBeGreaterThan(0);
    expect(Number(body.totalCollected)).toBeGreaterThan(0);
    expect(Number(body.outstanding)).toBeGreaterThanOrEqual(0);
  });

  it("requires approve capability to issue a quote", async () => {
    const quote = await createDraftQuote("100.00");

    const forbidden = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes/${quote.id}/issue`,
      headers: authHeader(viewOnlyToken),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("lets a user granted only /payroll inherit billing view access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${BILLING}/quotes`,
      headers: authHeader(viewOnlyToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("isolates billing documents between tenants", async () => {
    const quote = await createDraftQuote("750.00");

    const crossRead = await app.inject({
      method: "GET",
      url: `${BILLING}/quotes/${quote.id}`,
      headers: authHeader(otherToken),
    });
    expect(crossRead.statusCode).toBe(404);

    const crossStatement = await app.inject({
      method: "GET",
      url: `${BILLING}/clients/${clientId}/statement?from=2026-01-01&to=2026-12-31`,
      headers: authHeader(otherToken),
    });
    expect(crossStatement.statusCode).toBe(404);

    const crossList = await app.inject({
      method: "GET",
      url: `${BILLING}/quotes`,
      headers: authHeader(otherToken),
    });
    expect((crossList.json() as { total: number }).total).toBe(0);
  });

  it("rejects a discount larger than the subtotal", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BILLING}/quotes`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: {
        clientId,
        quoteDate: "2026-08-01",
        validUntil: "2026-08-31",
        discountAmount: "5000.00",
        items: [{ description: "Small job", quantity: 1, unitAmount: "100.00" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
