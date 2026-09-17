import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import type { ClientInvoiceStatus, ClientQuoteStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import {
  buildSitePresetLines,
  calculateClientBilling,
  calculateSiteBilling,
  canTransitionInvoice,
  canTransitionQuote,
  computeDocumentTotals,
  computeLineTotal,
  configureSiteBillingRate,
  generateNextInvoiceNumber,
  generateNextQuoteNumber,
  generateNextReceiptNumber,
  getActiveBillableGuards,
  getAgingTotals,
  getClientBillingSummary,
  getClientPurchaseHistory,
  getClientStatement,
  getInvoicePaidAmount,
  isInvoiceEditable,
  isQuoteEditable,
  startOfUtcDay,
  syncInvoicePaymentStatus,
} from "../../services/client-billing.service.js";
import {
  configureSiteBillingRateSchema,
  createInvoiceSchema,
  createQuoteSchema,
  declineQuoteSchema,
  decimalJson,
  type LineInput,
  parseDate,
  recordPaymentSchema,
  serializeDocument,
  statementQuerySchema,
  toDec,
  updateInvoiceSchema,
  updateQuoteSchema,
} from "./billing.schemas.js";
import { registerBillingPdfRoutes } from "./billing-pdf.routes.js";

const MODULE = "/payroll/billing";

/** Maps validated line input onto persistable rows with computed totals. */
function buildLineRows(items: readonly LineInput[]) {
  return items.map((item, index) => {
    const quantity = toDec(item.quantity);
    const unitAmount = toDec(item.unitAmount);
    return {
      siteId: item.siteId ?? null,
      description: item.description,
      quantity,
      unitAmount,
      lineTotal: computeLineTotal(quantity, unitAmount),
      sortOrder: index,
    };
  });
}

function serializeAging(aging: Awaited<ReturnType<typeof getAgingTotals>>) {
  return {
    current: decimalJson(aging.current),
    d1_30: decimalJson(aging.d1_30),
    d31_60: decimalJson(aging.d31_60),
    d61_90: decimalJson(aging.d61_90),
    d90_plus: decimalJson(aging.d90_plus),
  };
}

export async function billingRoutes(app: FastifyInstance) {
  const crudProtect = [authMiddleware, requireCrudCapability({ module: MODULE })];
  const approveProtect = [authMiddleware, requireCapability(MODULE, "approve")];
  const exportProtect = [authMiddleware, requireCapability(MODULE, "export")];

  /** Loads a company-scoped client, or null. */
  async function findClient(companyId: string, clientId: string) {
    return prisma.client.findFirst({ where: { id: clientId, companyId } });
  }

  // -------------------------------------------------------------------------
  // Summary & client views
  // -------------------------------------------------------------------------

  app.get("/summary", { preHandler: crudProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.query as { clientId?: string };
    const [summary, aging] = await Promise.all([
      getClientBillingSummary(companyId, clientId),
      getAgingTotals(companyId, clientId),
    ]);
    return {
      totalBilled: decimalJson(summary.totalBilled),
      totalCollected: decimalJson(summary.totalCollected),
      outstanding: decimalJson(summary.outstanding),
      overdueInvoiceCount: summary.overdueInvoiceCount,
      activeInvoiceCount: summary.activeInvoiceCount,
      aging: serializeAging(aging),
    };
  });

  app.get("/clients", { preHandler: crudProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const clients = await prisma.client.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { _count: { select: { sites: true, invoices: true, quotes: true } } },
    });

    const clientData = await Promise.all(
      clients.map(async (client) => {
        const [summary, clientBilling] = await Promise.all([
          getClientBillingSummary(companyId, client.id),
          calculateClientBilling(companyId, client.id),
        ]);
        return {
          clientId: client.id,
          outstanding: decimalJson(summary.outstanding),
          billableGuardCount: clientBilling.totalBillableGuards,
          monthlyBillingTotal: decimalJson(clientBilling.totalMonthlyAmount),
          sitesConfiguredCount: clientBilling.sitesConfiguredCount,
          sitesUnconfiguredCount: clientBilling.sitesUnconfiguredCount,
          sites: clientBilling.sites.map((s) => ({
            siteId: s.siteId,
            siteName: s.siteName,
            ratePerGuard: s.ratePerGuard ? decimalJson(s.ratePerGuard) : null,
            billableGuardCount: s.billableGuardCount,
            siteMonthlyTotal: decimalJson(s.siteMonthlyTotal),
            billingConfigured: s.billingConfigured,
            effectiveFrom: s.effectiveFrom ? s.effectiveFrom.toISOString().slice(0, 10) : null,
            effectiveTo: s.effectiveTo ? s.effectiveTo.toISOString().slice(0, 10) : null,
          })),
        };
      })
    );
    const byClient = new Map(clientData.map((b) => [b.clientId, b]));

    return {
      clients: clients.map((client) => {
        const data = byClient.get(client.id);
        return {
          id: client.id,
          name: client.name,
          email: client.email,
          billingEmail: client.billingEmail,
          phone: client.phone,
          isActive: client.isActive,
          paymentTermsDays: client.paymentTermsDays,
          vatNumber: client.vatNumber,
          siteCount: client._count.sites,
          invoiceCount: client._count.invoices,
          quoteCount: client._count.quotes,
          outstanding: data?.outstanding ?? "0",
          billableGuardCount: data?.billableGuardCount ?? 0,
          monthlyBillingTotal: data?.monthlyBillingTotal ?? "0",
          sitesConfiguredCount: data?.sitesConfiguredCount ?? 0,
          sitesUnconfiguredCount: data?.sitesUnconfiguredCount ?? 0,
          sites: data?.sites ?? [],
        };
      }),
    };
  });

  app.get("/clients/:clientId/site-preset", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.params as { clientId: string };
    if (!(await findClient(companyId, clientId))) {
      return reply.code(404).send({ error: "Client not found" });
    }
    return { lines: await buildSitePresetLines(companyId, clientId) };
  });

  app.get("/clients/:clientId/sites", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.params as { clientId: string };
    const { asOf } = request.query as { asOf?: string };
    const client = await findClient(companyId, clientId);
    if (!client) {
      return reply.code(404).send({ error: "Client not found" });
    }
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const billing = await calculateClientBilling(companyId, clientId, asOfDate);

    return {
      clientId: billing.clientId,
      clientName: billing.clientName,
      asOfDate: billing.asOfDate,
      totalMonthlyAmount: decimalJson(billing.totalMonthlyAmount),
      totalBillableGuards: billing.totalBillableGuards,
      sitesConfiguredCount: billing.sitesConfiguredCount,
      sitesUnconfiguredCount: billing.sitesUnconfiguredCount,
      sites: billing.sites.map((s) => ({
        siteId: s.siteId,
        siteName: s.siteName,
        billingMethod: s.billingMethod,
        ratePerGuard: s.ratePerGuard ? decimalJson(s.ratePerGuard) : null,
        billableGuardCount: s.billableGuardCount,
        siteMonthlyTotal: decimalJson(s.siteMonthlyTotal),
        billingConfigured: s.billingConfigured,
        effectiveFrom: s.effectiveFrom ? s.effectiveFrom.toISOString().slice(0, 10) : null,
        effectiveTo: s.effectiveTo ? s.effectiveTo.toISOString().slice(0, 10) : null,
        notes: s.notes,
        rateId: s.rateId,
        rateUpdatedAt: s.rateUpdatedAt,
      })),
    };
  });

  app.get("/clients/:clientId/sites/:siteId", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId, siteId } = request.params as { clientId: string; siteId: string };
    const { asOf } = request.query as { asOf?: string };
    const client = await findClient(companyId, clientId);
    if (!client) {
      return reply.code(404).send({ error: "Client not found" });
    }
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId, clientId },
      select: { id: true, name: true, physicalAddress: true, siteStatus: true },
    });
    if (!site) {
      return reply.code(404).send({ error: "Site not found for this client" });
    }

    const asOfDate = asOf ? new Date(asOf) : new Date();
    const [siteBilling, activeGuards, history] = await Promise.all([
      calculateSiteBilling(companyId, siteId, asOfDate),
      getActiveBillableGuards(companyId, siteId, asOfDate),
      prisma.siteBillingRate.findMany({
        where: { siteId, companyId },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    return {
      site: {
        id: site.id,
        name: site.name,
        physicalAddress: site.physicalAddress,
        siteStatus: site.siteStatus,
      },
      billing: {
        siteId: siteBilling.siteId,
        siteName: siteBilling.siteName,
        billingMethod: siteBilling.billingMethod,
        ratePerGuard: siteBilling.ratePerGuard ? decimalJson(siteBilling.ratePerGuard) : null,
        billableGuardCount: siteBilling.billableGuardCount,
        siteMonthlyTotal: decimalJson(siteBilling.siteMonthlyTotal),
        billingConfigured: siteBilling.billingConfigured,
        effectiveFrom: siteBilling.effectiveFrom ? siteBilling.effectiveFrom.toISOString().slice(0, 10) : null,
        effectiveTo: siteBilling.effectiveTo ? siteBilling.effectiveTo.toISOString().slice(0, 10) : null,
        notes: siteBilling.notes,
        rateId: siteBilling.rateId,
        rateUpdatedAt: siteBilling.rateUpdatedAt,
      },
      activeGuards: activeGuards.map((g) => ({
        id: g.id,
        employeeNumber: g.employeeNumber,
        firstName: g.firstName,
        lastName: g.lastName,
        status: g.status,
        assignedAt: g.assignedAt.toISOString().slice(0, 10),
      })),
      history: history.map((h) => ({
        id: h.id,
        billingMethod: h.billingMethod,
        ratePerGuard: decimalJson(h.ratePerGuard),
        effectiveFrom: h.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: h.effectiveTo ? h.effectiveTo.toISOString().slice(0, 10) : null,
        isActive: h.isActive,
        notes: h.notes,
        createdBy: h.createdBy ? { id: h.createdBy.id, name: h.createdBy.name, email: h.createdBy.email } : null,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      })),
    };
  });

  app.post("/clients/:clientId/sites/:siteId/rate", { preHandler: crudProtect }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;
    const { clientId, siteId } = request.params as { clientId: string; siteId: string };

    const parsed = configureSiteBillingRateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const client = await findClient(companyId, clientId);
    if (!client) {
      return reply.code(404).send({ error: "Client not found" });
    }

    try {
      const newRate = await configureSiteBillingRate(
        companyId,
        clientId,
        siteId,
        parsed.data,
        user.sub
      );

      await createAuditLog({
        userId: user.sub,
        companyId,
        action: "site_billing_rate.configure",
        entityType: "site_billing_rate",
        entityId: newRate.id,
        metadata: {
          siteId,
          clientId,
          ratePerGuard: newRate.ratePerGuard.toString(),
          effectiveFrom: newRate.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: newRate.effectiveTo ? newRate.effectiveTo.toISOString().slice(0, 10) : null,
        },
      });

      const updatedCalculation = await calculateSiteBilling(companyId, siteId, newRate.effectiveFrom);

      return reply.code(200).send({
        rate: {
          id: newRate.id,
          billingMethod: newRate.billingMethod,
          ratePerGuard: decimalJson(newRate.ratePerGuard),
          effectiveFrom: newRate.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: newRate.effectiveTo ? newRate.effectiveTo.toISOString().slice(0, 10) : null,
          isActive: newRate.isActive,
          notes: newRate.notes,
          createdAt: newRate.createdAt,
        },
        siteBilling: {
          siteId: updatedCalculation.siteId,
          siteName: updatedCalculation.siteName,
          ratePerGuard: updatedCalculation.ratePerGuard ? decimalJson(updatedCalculation.ratePerGuard) : null,
          billableGuardCount: updatedCalculation.billableGuardCount,
          siteMonthlyTotal: decimalJson(updatedCalculation.siteMonthlyTotal),
          billingConfigured: updatedCalculation.billingConfigured,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to configure site rate";
      if (message.includes("not found")) {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: "Configuration error", message });
    }
  });

  app.get("/clients/:clientId/history", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.params as { clientId: string };
    const q = request.query as { limit?: string; offset?: string };
    if (!(await findClient(companyId, clientId))) {
      return reply.code(404).send({ error: "Client not found" });
    }
    const history = await getClientPurchaseHistory(companyId, clientId, {
      limit: Number(q.limit) || undefined,
      offset: Number(q.offset) || undefined,
    });
    return {
      quotes: history.quotes.map((row) => serializeDocument(row as unknown as Record<string, unknown>)),
      invoices: history.invoices.map((row) => serializeDocument(row as unknown as Record<string, unknown>)),
      receipts: history.receipts.map((row) => serializeDocument(row as unknown as Record<string, unknown>)),
    };
  });

  app.get("/clients/:clientId/statement", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.params as { clientId: string };
    const parsed = statementQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: "from and to dates are required" });
    }
    const from = parseDate(parsed.data.from);
    const to = parseDate(parsed.data.to);
    if (!from || !to) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid from or to date" });
    }
    if (from > to) {
      return reply.code(400).send({ error: "Validation error", message: "from must be on or before to" });
    }

    const client = await findClient(companyId, clientId);
    if (!client) return reply.code(404).send({ error: "Client not found" });

    const statement = await getClientStatement(companyId, clientId, from, to);
    return {
      client: { id: client.id, name: client.name, billingEmail: client.billingEmail ?? client.email },
      periodStart: startOfUtcDay(from).toISOString().slice(0, 10),
      periodEnd: startOfUtcDay(to).toISOString().slice(0, 10),
      openingBalance: decimalJson(statement.openingBalance),
      closingBalance: decimalJson(statement.closingBalance),
      transactions: statement.transactions.map((t) => ({
        date: t.date instanceof Date ? t.date.toISOString().slice(0, 10) : String(t.date),
        kind: t.kind,
        documentId: t.documentId,
        reference: t.reference,
        description: t.description,
        debit: decimalJson(t.debit),
        credit: decimalJson(t.credit),
        balance: decimalJson(t.balance),
      })),
      aging: serializeAging(statement.aging),
    };
  });

  // -------------------------------------------------------------------------
  // Quotes
  // -------------------------------------------------------------------------

  app.get("/quotes", { preHandler: crudProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;

    const search = q.search?.trim();
    const fromDate = q.from ? parseDate(q.from) : undefined;
    const toDate = q.to ? parseDate(q.to) : undefined;

    const andConditions: Prisma.ClientQuoteWhereInput[] = [
      { companyId },
      ...(q.clientId ? [{ clientId: q.clientId }] : []),
      ...(q.status ? [{ status: q.status as ClientQuoteStatus }] : []),
    ];

    if (fromDate || toDate) {
      andConditions.push({
        quoteDate: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { quoteNumber: { contains: search, mode: "insensitive" } },
          { reference: { contains: search, mode: "insensitive" } },
          { client: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    const where: Prisma.ClientQuoteWhereInput = { AND: andConditions };

    const [quotes, total] = await Promise.all([
      prisma.clientQuote.findMany({
        where,
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: offset,
        include: {
          client: { select: { id: true, name: true } },
          items: { orderBy: { sortOrder: "asc" } },
        },
      }),
      prisma.clientQuote.count({ where }),
    ]);

    return {
      quotes: quotes.map((row) => serializeDocument(row as unknown as Record<string, unknown>)),
      total,
      limit,
      offset,
    };
  });

  app.post("/quotes", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const parsed = createQuoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const quoteDate = parseDate(data.quoteDate);
    const validUntil = parseDate(data.validUntil);
    if (!quoteDate || !validUntil) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid quoteDate or validUntil" });
    }
    if (validUntil < quoteDate) {
      return reply.code(400).send({ error: "Validation error", message: "validUntil must be on or after quoteDate" });
    }
    if (!(await findClient(companyId, data.clientId))) {
      return reply.code(400).send({ error: "Validation error", message: "clientId not found" });
    }

    const lines = buildLineRows(data.items);
    const totals = computeDocumentTotals(lines, toDec(data.discountAmount), toDec(data.vatRate));
    if (totals.subtotal.sub(totals.discountAmount).lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Discount cannot exceed the subtotal" });
    }

    const quoteNumber = data.quoteNumber?.trim() || (await generateNextQuoteNumber(companyId));

    try {
      const quote = await prisma.clientQuote.create({
        data: {
          companyId,
          clientId: data.clientId,
          quoteNumber,
          quoteDate,
          validUntil,
          reference: data.reference ?? null,
          notes: data.notes ?? null,
          vatRate: toDec(data.vatRate),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          vatAmount: totals.vatAmount,
          totalAmount: totals.totalAmount,
          items: { create: lines },
        },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "billing.quote.create",
        entityType: "client_quote",
        entityId: quote.id,
        metadata: { quoteNumber, clientId: data.clientId, totalAmount: decimalJson(totals.totalAmount) },
      });

      return reply.code(201).send(serializeDocument(quote as unknown as Record<string, unknown>));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: `Quote number ${quoteNumber} already exists` });
      }
      throw err;
    }
  });

  app.get("/quotes/:id", { preHandler: crudProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = await prisma.clientQuote.findFirst({
      where: { id, companyId: request.user!.companyId },
      include: {
        client: true,
        items: { orderBy: { sortOrder: "asc" } },
        invoices: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!quote) return reply.code(404).send({ error: "Quote not found" });
    return serializeDocument(quote as unknown as Record<string, unknown>);
  });

  app.patch("/quotes/:id", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const parsed = updateQuoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.clientQuote.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!existing) return reply.code(404).send({ error: "Quote not found" });
    if (!isQuoteEditable(existing.status)) {
      return reply.code(409).send({ error: "Cannot edit", message: `A ${existing.status} quote cannot be edited` });
    }

    if (data.clientId && !(await findClient(companyId, data.clientId))) {
      return reply.code(400).send({ error: "Validation error", message: "clientId not found" });
    }

    const quoteDate = data.quoteDate ? parseDate(data.quoteDate) : existing.quoteDate;
    const validUntil = data.validUntil ? parseDate(data.validUntil) : existing.validUntil;
    if (!quoteDate || !validUntil) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid quoteDate or validUntil" });
    }

    const lines = data.items
      ? buildLineRows(data.items)
      : existing.items.map((item) => ({
          siteId: item.siteId,
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          lineTotal: item.lineTotal,
          sortOrder: item.sortOrder,
        }));
    const vatRate = data.vatRate === undefined ? existing.vatRate : toDec(data.vatRate);
    const discount = data.discountAmount === undefined ? existing.discountAmount : toDec(data.discountAmount);
    const totals = computeDocumentTotals(lines, discount, vatRate);
    if (totals.subtotal.sub(totals.discountAmount).lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Discount cannot exceed the subtotal" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.items) {
        await tx.clientQuoteLine.deleteMany({ where: { quoteId: id } });
      }
      return tx.clientQuote.update({
        where: { id },
        data: {
          ...(data.clientId ? { clientId: data.clientId } : {}),
          quoteDate,
          validUntil,
          ...(data.reference !== undefined ? { reference: data.reference } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          vatRate,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          vatAmount: totals.vatAmount,
          totalAmount: totals.totalAmount,
          ...(data.items ? { items: { create: lines } } : {}),
        },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.quote.update",
      entityType: "client_quote",
      entityId: id,
      metadata: { totalAmount: decimalJson(totals.totalAmount) },
    });

    return serializeDocument(updated as unknown as Record<string, unknown>);
  });

  app.delete("/quotes/:id", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientQuote.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Quote not found" });
    if (existing.status !== "draft") {
      return reply.code(409).send({ error: "Cannot delete", message: "Only draft quotes can be deleted" });
    }

    await prisma.clientQuote.delete({ where: { id } });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.quote.delete",
      entityType: "client_quote",
      entityId: id,
      metadata: { quoteNumber: existing.quoteNumber },
    });
    return { success: true };
  });

  /** Shared handler for the quote status transitions. */
  async function transitionQuote(
    request: FastifyRequest,
    reply: FastifyReply,
    to: ClientQuoteStatus,
    action: string,
    extra: Record<string, unknown> = {}
  ) {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientQuote.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Quote not found" });
    if (!canTransitionQuote(existing.status, to)) {
      return reply
        .code(409)
        .send({ error: "Invalid transition", message: `Cannot move a ${existing.status} quote to ${to}` });
    }

    const decided = to === "accepted" || to === "declined" || to === "expired";
    const updated = await prisma.clientQuote.update({
      where: { id },
      data: {
        status: to,
        ...(to === "issued" ? { issuedAt: new Date() } : {}),
        ...(decided ? { decidedAt: new Date(), decidedByUserId: request.user!.sub } : {}),
      },
      include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action,
      entityType: "client_quote",
      entityId: id,
      metadata: { from: existing.status, to, ...extra },
    });

    return serializeDocument(updated as unknown as Record<string, unknown>);
  }

  app.post("/quotes/:id/issue", { preHandler: approveProtect }, (request, reply) =>
    transitionQuote(request, reply, "issued", "billing.quote.issue")
  );

  app.post("/quotes/:id/accept", { preHandler: approveProtect }, (request, reply) =>
    transitionQuote(request, reply, "accepted", "billing.quote.accept")
  );

  app.post("/quotes/:id/decline", { preHandler: approveProtect }, (request, reply) => {
    const parsed = declineQuoteSchema.safeParse(request.body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;
    return transitionQuote(request, reply, "declined", "billing.quote.decline", { reason });
  });

  app.post("/quotes/:id/convert-to-invoice", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const { force } = request.query as { force?: string };

    const quote = await prisma.clientQuote.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { sortOrder: "asc" } }, client: true, invoices: { select: { id: true } } },
    });
    if (!quote) return reply.code(404).send({ error: "Quote not found" });
    if (quote.status !== "accepted") {
      return reply
        .code(409)
        .send({ error: "Cannot convert", message: "Only an accepted quote can be converted to an invoice" });
    }
    if (quote.invoices.length > 0 && force !== "true") {
      return reply.code(409).send({
        error: "Already converted",
        message: "This quote has already been converted. Pass ?force=true to create another invoice from it.",
        invoiceIds: quote.invoices.map((i) => i.id),
      });
    }

    const invoiceDate = startOfUtcDay(new Date());
    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + (quote.client.paymentTermsDays ?? 30));

    const invoiceNumber = await generateNextInvoiceNumber(companyId);

    try {
      const invoice = await prisma.clientInvoice.create({
        data: {
          companyId,
          clientId: quote.clientId,
          quoteId: quote.id,
          invoiceNumber,
          invoiceDate,
          dueDate,
          reference: quote.reference,
          notes: quote.notes,
          vatRate: quote.vatRate,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          vatAmount: quote.vatAmount,
          totalAmount: quote.totalAmount,
          items: {
            create: quote.items.map((item) => ({
              siteId: item.siteId,
              description: item.description,
              quantity: item.quantity,
              unitAmount: item.unitAmount,
              lineTotal: item.lineTotal,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "billing.quote.convert",
        entityType: "client_invoice",
        entityId: invoice.id,
        metadata: { quoteId: quote.id, quoteNumber: quote.quoteNumber, invoiceNumber },
      });

      return reply.code(201).send(serializeDocument(invoice as unknown as Record<string, unknown>));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: `Invoice number ${invoiceNumber} already exists` });
      }
      throw err;
    }
  });

  app.post("/quotes/:id/duplicate", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientQuote.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { sortOrder: "asc" } }, client: true },
    });
    if (!existing) return reply.code(404).send({ error: "Quote not found" });

    const quoteDate = startOfUtcDay(new Date());
    const validUntil = new Date(quoteDate);
    validUntil.setUTCDate(validUntil.getUTCDate() + 30);

    const quoteNumber = await generateNextQuoteNumber(companyId);
    const lines = existing.items.map((item) => ({
      siteId: item.siteId,
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
      sortOrder: item.sortOrder,
    }));

    const duplicate = await prisma.clientQuote.create({
      data: {
        companyId,
        clientId: existing.clientId,
        quoteNumber,
        quoteDate,
        validUntil,
        reference: existing.reference ? `Copy of ${existing.reference}` : `Copy of ${existing.quoteNumber}`,
        notes: existing.notes,
        vatRate: existing.vatRate,
        subtotal: existing.subtotal,
        discountAmount: existing.discountAmount,
        vatAmount: existing.vatAmount,
        totalAmount: existing.totalAmount,
        status: "draft",
        items: { create: lines },
      },
      include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.quote.duplicate",
      entityType: "client_quote",
      entityId: duplicate.id,
      metadata: { originalQuoteId: existing.id, quoteNumber: duplicate.quoteNumber },
    });

    return reply.code(201).send(serializeDocument(duplicate as unknown as Record<string, unknown>));
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  app.get("/invoices", { preHandler: crudProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;

    const search = q.search?.trim();
    const fromDate = q.from ? parseDate(q.from) : undefined;
    const toDate = q.to ? parseDate(q.to) : undefined;

    const andConditions: Prisma.ClientInvoiceWhereInput[] = [
      { companyId },
      ...(q.clientId ? [{ clientId: q.clientId }] : []),
      ...(q.status ? [{ status: q.status as ClientInvoiceStatus }] : []),
    ];

    if (fromDate || toDate) {
      andConditions.push({
        invoiceDate: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { invoiceNumber: { contains: search, mode: "insensitive" } },
          { reference: { contains: search, mode: "insensitive" } },
          { client: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    const where: Prisma.ClientInvoiceWhereInput = { AND: andConditions };

    const [invoices, total] = await Promise.all([
      prisma.clientInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: offset,
        include: {
          client: { select: { id: true, name: true } },
          items: { orderBy: { sortOrder: "asc" } },
          payments: { select: { amount: true } },
        },
      }),
      prisma.clientInvoice.count({ where }),
    ]);

    return {
      invoices: invoices.map((invoice) => {
        let paid = new Prisma.Decimal(0);
        for (const payment of invoice.payments) paid = paid.add(payment.amount);
        return {
          ...serializeDocument(invoice as unknown as Record<string, unknown>),
          amountPaid: decimalJson(paid),
          amountDue: decimalJson(invoice.totalAmount.sub(paid)),
        };
      }),
      total,
      limit,
      offset,
    };
  });

  app.post("/invoices", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const parsed = createInvoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const invoiceDate = parseDate(data.invoiceDate);
    if (!invoiceDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid invoiceDate" });
    }

    const client = await findClient(companyId, data.clientId);
    if (!client) {
      return reply.code(400).send({ error: "Validation error", message: "clientId not found" });
    }

    let dueDate: Date;
    if (data.dueDate) {
      const parsedDue = parseDate(data.dueDate);
      if (!parsedDue) return reply.code(400).send({ error: "Validation error", message: "Invalid dueDate" });
      dueDate = parsedDue;
    } else {
      dueDate = new Date(invoiceDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + (client.paymentTermsDays ?? 30));
    }
    if (dueDate < invoiceDate) {
      return reply.code(400).send({ error: "Validation error", message: "dueDate must be on or after invoiceDate" });
    }

    const lines = buildLineRows(data.items);
    const totals = computeDocumentTotals(lines, toDec(data.discountAmount), toDec(data.vatRate));
    if (totals.subtotal.sub(totals.discountAmount).lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Discount cannot exceed the subtotal" });
    }

    const invoiceNumber = data.invoiceNumber?.trim() || (await generateNextInvoiceNumber(companyId));

    try {
      const invoice = await prisma.clientInvoice.create({
        data: {
          companyId,
          clientId: data.clientId,
          invoiceNumber,
          invoiceDate,
          dueDate,
          reference: data.reference ?? null,
          notes: data.notes ?? null,
          vatRate: toDec(data.vatRate),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          vatAmount: totals.vatAmount,
          totalAmount: totals.totalAmount,
          items: { create: lines },
        },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "billing.invoice.create",
        entityType: "client_invoice",
        entityId: invoice.id,
        metadata: { invoiceNumber, clientId: data.clientId, totalAmount: decimalJson(totals.totalAmount) },
      });

      return reply.code(201).send(serializeDocument(invoice as unknown as Record<string, unknown>));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: `Invoice number ${invoiceNumber} already exists` });
      }
      throw err;
    }
  });

  app.get("/invoices/:id", { preHandler: crudProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.clientInvoice.findFirst({
      where: { id, companyId: request.user!.companyId },
      include: {
        client: true,
        items: { orderBy: { sortOrder: "asc" } },
        payments: { orderBy: { paymentDate: "desc" }, include: { receipt: true } },
        quote: { select: { id: true, quoteNumber: true } },
      },
    });
    if (!invoice) return reply.code(404).send({ error: "Invoice not found" });

    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);

    return {
      ...serializeDocument(invoice as unknown as Record<string, unknown>),
      amountPaid: decimalJson(paid),
      amountDue: decimalJson(invoice.totalAmount.sub(paid)),
    };
  });

  app.patch("/invoices/:id", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const parsed = updateInvoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.clientInvoice.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!existing) return reply.code(404).send({ error: "Invoice not found" });
    if (!isInvoiceEditable(existing.status)) {
      return reply
        .code(409)
        .send({ error: "Cannot edit", message: `A ${existing.status} invoice cannot be edited` });
    }

    if (data.clientId && !(await findClient(companyId, data.clientId))) {
      return reply.code(400).send({ error: "Validation error", message: "clientId not found" });
    }

    const invoiceDate = data.invoiceDate ? parseDate(data.invoiceDate) : existing.invoiceDate;
    const dueDate = data.dueDate ? parseDate(data.dueDate) : existing.dueDate;
    if (!invoiceDate || !dueDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid invoiceDate or dueDate" });
    }
    if (dueDate < invoiceDate) {
      return reply.code(400).send({ error: "Validation error", message: "dueDate must be on or after invoiceDate" });
    }

    const lines = data.items
      ? buildLineRows(data.items)
      : existing.items.map((item) => ({
          siteId: item.siteId,
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          lineTotal: item.lineTotal,
          sortOrder: item.sortOrder,
        }));
    const vatRate = data.vatRate === undefined ? existing.vatRate : toDec(data.vatRate);
    const discount = data.discountAmount === undefined ? existing.discountAmount : toDec(data.discountAmount);
    const totals = computeDocumentTotals(lines, discount, vatRate);
    if (totals.subtotal.sub(totals.discountAmount).lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Discount cannot exceed the subtotal" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.items) {
        await tx.clientInvoiceLine.deleteMany({ where: { invoiceId: id } });
      }
      return tx.clientInvoice.update({
        where: { id },
        data: {
          ...(data.clientId ? { clientId: data.clientId } : {}),
          invoiceDate,
          dueDate,
          ...(data.reference !== undefined ? { reference: data.reference } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          vatRate,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          vatAmount: totals.vatAmount,
          totalAmount: totals.totalAmount,
          ...(data.items ? { items: { create: lines } } : {}),
        },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.invoice.update",
      entityType: "client_invoice",
      entityId: id,
      metadata: { totalAmount: decimalJson(totals.totalAmount) },
    });

    return serializeDocument(updated as unknown as Record<string, unknown>);
  });

  app.delete("/invoices/:id", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientInvoice.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Invoice not found" });
    if (existing.status !== "draft") {
      return reply.code(409).send({ error: "Cannot delete", message: "Only draft invoices can be deleted" });
    }

    await prisma.clientInvoice.delete({ where: { id } });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.invoice.delete",
      entityType: "client_invoice",
      entityId: id,
      metadata: { invoiceNumber: existing.invoiceNumber },
    });
    return { success: true };
  });

  app.post("/invoices/:id/issue", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientInvoice.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Invoice not found" });
    if (!canTransitionInvoice(existing.status, "issued")) {
      return reply
        .code(409)
        .send({ error: "Invalid transition", message: `Cannot issue a ${existing.status} invoice` });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.clientInvoice.update({
        where: { id },
        data: { status: "issued", issuedAt: new Date() },
      });
      // Immediately reconcile against any recorded payments / an already-past due date.
      await syncInvoicePaymentStatus(tx, id);
      return tx.clientInvoice.findUniqueOrThrow({
        where: { id },
        include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.invoice.issue",
      entityType: "client_invoice",
      entityId: id,
      metadata: { invoiceNumber: existing.invoiceNumber, status: invoice.status },
    });

    return serializeDocument(invoice as unknown as Record<string, unknown>);
  });

  app.post("/invoices/:id/cancel", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientInvoice.findFirst({
      where: { id, companyId },
      include: { _count: { select: { payments: true } } },
    });
    if (!existing) return reply.code(404).send({ error: "Invoice not found" });
    if (existing._count.payments > 0) {
      return reply.code(409).send({
        error: "Cannot cancel",
        message: "Reverse the recorded payments before cancelling this invoice",
      });
    }
    if (!canTransitionInvoice(existing.status, "cancelled")) {
      return reply
        .code(409)
        .send({ error: "Invalid transition", message: `Cannot cancel a ${existing.status} invoice` });
    }

    const invoice = await prisma.clientInvoice.update({
      where: { id },
      data: { status: "cancelled" },
      include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.invoice.cancel",
      entityType: "client_invoice",
      entityId: id,
      metadata: { invoiceNumber: existing.invoiceNumber, from: existing.status },
    });

    return serializeDocument(invoice as unknown as Record<string, unknown>);
  });

  app.post("/invoices/:id/duplicate", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const existing = await prisma.clientInvoice.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { sortOrder: "asc" } }, client: true },
    });
    if (!existing) return reply.code(404).send({ error: "Invoice not found" });

    const invoiceDate = startOfUtcDay(new Date());
    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + (existing.client.paymentTermsDays ?? 30));

    const invoiceNumber = await generateNextInvoiceNumber(companyId);
    const lines = existing.items.map((item) => ({
      siteId: item.siteId,
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
      sortOrder: item.sortOrder,
    }));

    const duplicate = await prisma.clientInvoice.create({
      data: {
        companyId,
        clientId: existing.clientId,
        invoiceNumber,
        invoiceDate,
        dueDate,
        reference: existing.reference ? `Copy of ${existing.reference}` : `Copy of ${existing.invoiceNumber}`,
        notes: existing.notes,
        vatRate: existing.vatRate,
        subtotal: existing.subtotal,
        discountAmount: existing.discountAmount,
        vatAmount: existing.vatAmount,
        totalAmount: existing.totalAmount,
        status: "draft",
        items: { create: lines },
      },
      include: { client: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.invoice.duplicate",
      entityType: "client_invoice",
      entityId: duplicate.id,
      metadata: { originalInvoiceId: existing.id, invoiceNumber: duplicate.invoiceNumber },
    });

    return reply.code(201).send(serializeDocument(duplicate as unknown as Record<string, unknown>));
  });

  // -------------------------------------------------------------------------
  // Payments & receipts
  // -------------------------------------------------------------------------

  app.post("/invoices/:id/payments", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = recordPaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const paymentDate = parseDate(data.paymentDate);
    if (!paymentDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid paymentDate" });
    }
    const amount = toDec(data.amount);
    if (amount.lte(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Payment amount must be greater than zero" });
    }

    const invoice = await prisma.clientInvoice.findFirst({ where: { id, companyId } });
    if (!invoice) return reply.code(404).send({ error: "Invoice not found" });
    if (invoice.status === "draft" || invoice.status === "cancelled") {
      return reply.code(409).send({
        error: "Cannot record payment",
        message: `Payments cannot be recorded against a ${invoice.status} invoice`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const alreadyPaid = await getInvoicePaidAmount(tx, id);
      if (alreadyPaid.add(amount).gt(invoice.totalAmount)) {
        return { overpaid: true, remaining: invoice.totalAmount.sub(alreadyPaid) } as const;
      }

      const payment = await tx.clientPayment.create({
        data: {
          companyId,
          invoiceId: id,
          clientId: invoice.clientId,
          paymentDate,
          amount,
          paymentMethod: data.paymentMethod ?? null,
          referenceNumber: data.referenceNumber ?? null,
          notes: data.notes ?? null,
          recordedByUserId: userId,
        },
      });

      const receipt = await tx.clientReceipt.create({
        data: {
          companyId,
          paymentId: payment.id,
          receiptNumber: await generateNextReceiptNumber(companyId, tx),
          receiptDate: paymentDate,
          amount,
          issuedByUserId: userId,
        },
      });

      const status = await syncInvoicePaymentStatus(tx, id);
      return { overpaid: false, payment, receipt, status } as const;
    });

    if (result.overpaid) {
      return reply.code(400).send({
        error: "Overpayment",
        message: `Payment exceeds the outstanding balance of ${decimalJson(result.remaining)}`,
      });
    }

    await createAuditLog({
      userId,
      companyId,
      action: "billing.payment.record",
      entityType: "client_payment",
      entityId: result.payment.id,
      metadata: {
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        amount: decimalJson(amount),
        receiptNumber: result.receipt.receiptNumber,
        invoiceStatus: result.status,
      },
    });

    return reply.code(201).send({
      payment: serializeDocument(result.payment as unknown as Record<string, unknown>),
      receipt: serializeDocument(result.receipt as unknown as Record<string, unknown>),
      invoiceStatus: result.status,
    });
  });

  app.delete("/payments/:id", { preHandler: crudProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const payment = await prisma.clientPayment.findFirst({
      where: { id, companyId },
      include: { receipt: true, invoice: { select: { id: true, invoiceNumber: true } } },
    });
    if (!payment) return reply.code(404).send({ error: "Payment not found" });

    const status = await prisma.$transaction(async (tx) => {
      // The receipt cascades with the payment.
      await tx.clientPayment.delete({ where: { id } });
      return syncInvoicePaymentStatus(tx, payment.invoiceId);
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "billing.payment.reverse",
      entityType: "client_payment",
      entityId: id,
      metadata: {
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        amount: decimalJson(payment.amount),
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        invoiceStatus: status,
      },
    });

    return { success: true, invoiceStatus: status };
  });

  app.get("/receipts", { preHandler: crudProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const where: Prisma.ClientReceiptWhereInput = {
      companyId,
      ...(q.clientId ? { payment: { clientId: q.clientId } } : {}),
    };

    const [receipts, total] = await Promise.all([
      prisma.clientReceipt.findMany({
        where,
        orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: offset,
        include: {
          payment: {
            include: {
              invoice: { select: { id: true, invoiceNumber: true } },
              client: { select: { id: true, name: true } },
            },
          },
          issuedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.clientReceipt.count({ where }),
    ]);

    return {
      receipts: receipts.map((row) => serializeDocument(row as unknown as Record<string, unknown>)),
      total,
      limit,
      offset,
    };
  });

  app.get("/receipts/:id", { preHandler: crudProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await prisma.clientReceipt.findFirst({
      where: { id, companyId: request.user!.companyId },
      include: {
        payment: { include: { invoice: true, client: true } },
        issuedBy: { select: { id: true, name: true } },
      },
    });
    if (!receipt) return reply.code(404).send({ error: "Receipt not found" });
    return serializeDocument(receipt as unknown as Record<string, unknown>);
  });

  await registerBillingPdfRoutes(app, exportProtect);
}
