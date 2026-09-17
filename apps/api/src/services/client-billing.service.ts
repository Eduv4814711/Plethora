import { Prisma } from "@prisma/client";
import type { ClientInvoiceStatus, ClientQuoteStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { startOfUtcDay } from "./academy-finance.service.js";

export { startOfUtcDay };

const DEFAULT_PREFIXES = { quote: "QT", invoice: "INV", receipt: "RCT" } as const;

export type DocumentKind = keyof typeof DEFAULT_PREFIXES;

function toDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Reads a company's configured document prefix, falling back to the built-in default. */
async function resolvePrefix(companyId: string, kind: DocumentKind): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = company?.settings as { billing?: { numberPrefixes?: Record<string, unknown> } } | null;
  const configured = settings?.billing?.numberPrefixes?.[kind];
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return DEFAULT_PREFIXES[kind];
}

/** Highest numeric suffix already used for `prefix`, ignoring rows in any other format. */
export function highestNumberForPrefix(existing: readonly string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const value of existing) {
    const match = value.match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

export function formatDocumentNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

export async function generateNextQuoteNumber(companyId: string): Promise<string> {
  const prefix = await resolvePrefix(companyId, "quote");
  const rows = await prisma.clientQuote.findMany({ where: { companyId }, select: { quoteNumber: true } });
  return formatDocumentNumber(prefix, highestNumberForPrefix(rows.map((r) => r.quoteNumber), prefix) + 1);
}

export async function generateNextInvoiceNumber(companyId: string): Promise<string> {
  const prefix = await resolvePrefix(companyId, "invoice");
  const rows = await prisma.clientInvoice.findMany({ where: { companyId }, select: { invoiceNumber: true } });
  return formatDocumentNumber(prefix, highestNumberForPrefix(rows.map((r) => r.invoiceNumber), prefix) + 1);
}

export async function generateNextReceiptNumber(
  companyId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<string> {
  const prefix = await resolvePrefix(companyId, "receipt");
  const rows = await tx.clientReceipt.findMany({ where: { companyId }, select: { receiptNumber: true } });
  return formatDocumentNumber(prefix, highestNumberForPrefix(rows.map((r) => r.receiptNumber), prefix) + 1);
}

/** Rounded at the line so printed lines sum exactly to the printed subtotal. */
export function computeLineTotal(
  quantity: Prisma.Decimal | string | number,
  unitAmount: Prisma.Decimal | string | number
): Prisma.Decimal {
  return round2(toDecimal(unitAmount).mul(toDecimal(quantity)));
}

export interface DocumentTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

/**
 * Totals for a quote or invoice.
 *
 * Amounts are treated as VAT-EXCLUSIVE and VAT is applied AFTER the discount:
 *   taxable = subtotal - discount;  vat = taxable * rate / 100;  total = taxable + vat
 * A company that prices VAT-inclusive would need different handling.
 */
export function computeDocumentTotals(
  lines: readonly { lineTotal: Prisma.Decimal | string | number }[],
  discountAmount: Prisma.Decimal | string | number,
  vatRate: Prisma.Decimal | string | number
): DocumentTotals {
  let subtotal = new Prisma.Decimal(0);
  for (const line of lines) subtotal = subtotal.add(toDecimal(line.lineTotal));
  subtotal = round2(subtotal);

  const discount = round2(toDecimal(discountAmount));
  const taxable = subtotal.sub(discount);
  const vatAmount = round2(taxable.mul(toDecimal(vatRate)).div(100));

  return { subtotal, discountAmount: discount, vatAmount, totalAmount: round2(taxable.add(vatAmount)) };
}

export interface SitePresetLine {
  siteId: string;
  siteName: string;
  description: string;
  quantity: string;
  unitAmount: string;
  /** True when the site has no configured billing rate — surfaced rather than silently dropped. */
  needsPrice: boolean;
}

/** Statuses that constitute an active billable guard. */
export const ACTIVE_BILLABLE_GUARD_STATUSES = [
  "active",
  "training",
  "hired",
  "reliever",
] as const;

export interface ActiveBillableGuard {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  status: string;
  assignedAt: Date;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export interface SiteBillingCalculation {
  siteId: string;
  siteName: string;
  clientId: string;
  clientName?: string;
  billingConfigured: boolean;
  billingMethod: "PER_GUARD";
  ratePerGuard: Prisma.Decimal | null;
  billableGuardCount: number;
  siteMonthlyTotal: Prisma.Decimal;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  rateId: string | null;
  notes: string | null;
  rateUpdatedAt: Date | null;
}

export interface ClientBillingCalculation {
  clientId: string;
  clientName: string;
  asOfDate: string;
  sites: SiteBillingCalculation[];
  totalMonthlyAmount: Prisma.Decimal;
  totalBillableGuards: number;
  sitesConfiguredCount: number;
  sitesUnconfiguredCount: number;
}

export interface ConfigureSiteBillingRateInput {
  ratePerGuard: Prisma.Decimal | string | number;
  billingMethod?: "PER_GUARD";
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  notes?: string | null;
}

/**
 * Returns active billable guards assigned to a site as of a given date.
 * Excludes offboarded, suspended, applicants, non-security officers,
 * and guards with inactive or historical assignments.
 */
export async function getActiveBillableGuards(
  companyId: string,
  siteId: string,
  asOfDate: Date = new Date()
): Promise<ActiveBillableGuard[]> {
  const targetDate = startOfUtcDay(asOfDate);

  const assignments = await prisma.siteAssignment.findMany({
    where: {
      siteId,
      isActive: true,
      AND: [
        {
          OR: [
            { effectiveFrom: null },
            { effectiveFrom: { lte: targetDate } },
          ],
        },
        {
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: targetDate } },
          ],
        },
      ],
      employee: {
        companyId,
        employeeType: "security_officer",
        status: { in: [...ACTIVE_BILLABLE_GUARD_STATUSES] },
      },
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });

  return assignments.map((a) => ({
    id: a.employee.id,
    employeeNumber: a.employee.employeeNumber,
    firstName: a.employee.firstName,
    lastName: a.employee.lastName,
    status: a.employee.status,
    assignedAt: a.assignedAt,
    effectiveFrom: a.effectiveFrom,
    effectiveTo: a.effectiveTo,
  }));
}

/** Returns the active billable guard count for a site as of a given date. */
export async function getActiveBillableGuardCount(
  companyId: string,
  siteId: string,
  asOfDate: Date = new Date()
): Promise<number> {
  const guards = await getActiveBillableGuards(companyId, siteId, asOfDate);
  return guards.length;
}

/**
 * Returns the effective SiteBillingRate for a site as of a given date.
 */
export async function getEffectiveSiteBillingRate(
  companyId: string,
  siteId: string,
  asOfDate: Date = new Date()
) {
  const targetDate = startOfUtcDay(asOfDate);

  return prisma.siteBillingRate.findFirst({
    where: {
      companyId,
      siteId,
      isActive: true,
      effectiveFrom: { lte: targetDate },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: targetDate } },
      ],
    },
    orderBy: [
      { effectiveFrom: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Calculates billing for a site:
 * Price Per Guard × Billable Guard Count = Site Monthly Total.
 */
export async function calculateSiteBilling(
  companyId: string,
  siteId: string,
  asOfDate: Date = new Date()
): Promise<SiteBillingCalculation> {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    select: { id: true, name: true, clientId: true, client: { select: { name: true } } },
  });

  if (!site) {
    throw new Error("Site not found");
  }

  const [billableGuards, rate] = await Promise.all([
    getActiveBillableGuards(companyId, siteId, asOfDate),
    getEffectiveSiteBillingRate(companyId, siteId, asOfDate),
  ]);

  const guardCount = billableGuards.length;

  if (!rate) {
    return {
      siteId: site.id,
      siteName: site.name,
      clientId: site.clientId ?? "",
      clientName: site.client?.name,
      billingConfigured: false,
      billingMethod: "PER_GUARD",
      ratePerGuard: null,
      billableGuardCount: guardCount,
      siteMonthlyTotal: new Prisma.Decimal(0),
      effectiveFrom: null,
      effectiveTo: null,
      rateId: null,
      notes: null,
      rateUpdatedAt: null,
    };
  }

  const ratePerGuard = round2(toDecimal(rate.ratePerGuard));
  const siteMonthlyTotal = round2(ratePerGuard.mul(guardCount));

  return {
    siteId: site.id,
    siteName: site.name,
    clientId: site.clientId ?? "",
    clientName: site.client?.name,
    billingConfigured: true,
    billingMethod: "PER_GUARD",
    ratePerGuard,
    billableGuardCount: guardCount,
    siteMonthlyTotal,
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: rate.effectiveTo,
    rateId: rate.id,
    notes: rate.notes,
    rateUpdatedAt: rate.updatedAt,
  };
}

/**
 * Aggregates client-level monthly billing across all client sites.
 */
export async function calculateClientBilling(
  companyId: string,
  clientId: string,
  asOfDate: Date = new Date()
): Promise<ClientBillingCalculation> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { id: true, name: true },
  });

  if (!client) {
    throw new Error("Client not found");
  }

  const sites = await prisma.site.findMany({
    where: { companyId, clientId, siteStatus: "ACTIVE" },
    select: { id: true },
    orderBy: { name: "asc" },
  });

  const siteCalculations = await Promise.all(
    sites.map((s) => calculateSiteBilling(companyId, s.id, asOfDate))
  );

  let totalMonthlyAmount = new Prisma.Decimal(0);
  let totalBillableGuards = 0;
  let sitesConfiguredCount = 0;

  for (const sc of siteCalculations) {
    totalMonthlyAmount = totalMonthlyAmount.add(sc.siteMonthlyTotal);
    totalBillableGuards += sc.billableGuardCount;
    if (sc.billingConfigured) sitesConfiguredCount++;
  }

  return {
    clientId: client.id,
    clientName: client.name,
    asOfDate: startOfUtcDay(asOfDate).toISOString().slice(0, 10),
    sites: siteCalculations,
    totalMonthlyAmount: round2(totalMonthlyAmount),
    totalBillableGuards,
    sitesConfiguredCount,
    sitesUnconfiguredCount: siteCalculations.length - sitesConfiguredCount,
  };
}

/**
 * Configures or updates the billing rate for a site.
 * Ensures effective dating without overwriting historical billing records.
 */
export async function configureSiteBillingRate(
  companyId: string,
  clientId: string,
  siteId: string,
  input: ConfigureSiteBillingRateInput,
  userId?: string | null
) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    select: { id: true, clientId: true },
  });

  if (!site) throw new Error("Site not found");
  if (site.clientId !== clientId) {
    throw new Error("Site does not belong to the specified client");
  }

  const ratePerGuard = round2(toDecimal(input.ratePerGuard));
  if (ratePerGuard.lte(0)) {
    throw new Error("Rate per guard must be greater than zero");
  }

  const effectiveFrom = startOfUtcDay(
    input.effectiveFrom instanceof Date ? input.effectiveFrom : new Date(input.effectiveFrom)
  );
  const effectiveTo = input.effectiveTo
    ? startOfUtcDay(input.effectiveTo instanceof Date ? input.effectiveTo : new Date(input.effectiveTo))
    : null;

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom");
  }

  return prisma.$transaction(async (tx) => {
    // Check if there are overlapping active rates starting before or on effectiveFrom
    const overlappingRates = await tx.siteBillingRate.findMany({
      where: {
        siteId,
        companyId,
        isActive: true,
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    for (const oldRate of overlappingRates) {
      if (oldRate.effectiveFrom.getTime() === effectiveFrom.getTime()) {
        // Same effective date: supersede old rate
        await tx.siteBillingRate.update({
          where: { id: oldRate.id },
          data: { isActive: false },
        });
      } else {
        // Prior rate: cap its effectiveTo to the day prior to the new effective date
        const dayBefore = new Date(effectiveFrom.getTime() - 86400000);
        await tx.siteBillingRate.update({
          where: { id: oldRate.id },
          data: { effectiveTo: dayBefore },
        });
      }
    }

    return tx.siteBillingRate.create({
      data: {
        companyId,
        clientId,
        siteId,
        billingMethod: "PER_GUARD",
        ratePerGuard,
        effectiveFrom,
        effectiveTo,
        isActive: true,
        notes: input.notes?.trim() || null,
        createdByUserId: userId ?? null,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  });
}

/** Line-item presets from a client's active sites, priced via the billing engine. */
export async function buildSitePresetLines(
  companyId: string,
  clientId: string,
  asOfDate: Date = new Date()
): Promise<SitePresetLine[]> {
  const clientBilling = await calculateClientBilling(companyId, clientId, asOfDate);

  return clientBilling.sites.map((site) => {
    const guards = site.billableGuardCount;
    const rate = site.ratePerGuard;
    const desc = site.billingConfigured
      ? `Security services — ${site.siteName} (${guards} guard${guards === 1 ? "" : "s"} @ R${rate?.toString() ?? "0"})`
      : `Security services — ${site.siteName}`;

    return {
      siteId: site.siteId,
      siteName: site.siteName,
      description: desc,
      quantity: site.billingConfigured ? String(guards) : "1",
      unitAmount: (rate ?? new Prisma.Decimal(0)).toString(),
      needsPrice: !site.billingConfigured,
    };
  });
}

// ---------------------------------------------------------------------------
// Status state machines
// ---------------------------------------------------------------------------

export const QUOTE_TRANSITIONS: Record<ClientQuoteStatus, readonly ClientQuoteStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["accepted", "declined", "expired", "cancelled"],
  accepted: [],
  declined: [],
  expired: [],
  cancelled: [],
};

export const INVOICE_TRANSITIONS: Record<ClientInvoiceStatus, readonly ClientInvoiceStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["partially_paid", "paid", "overdue", "cancelled"],
  partially_paid: ["paid", "overdue", "cancelled"],
  overdue: ["partially_paid", "paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export function canTransitionQuote(from: ClientQuoteStatus, to: ClientQuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function canTransitionInvoice(from: ClientInvoiceStatus, to: ClientInvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

/** Only draft documents may have their lines or amounts edited. */
export function isQuoteEditable(status: ClientQuoteStatus): boolean {
  return status === "draft";
}

export function isInvoiceEditable(status: ClientInvoiceStatus): boolean {
  return status === "draft";
}

/**
 * Recompute an invoice's status from its recorded payments.
 * Draft and cancelled invoices are left alone. Call inside a transaction after payment changes.
 */
export async function syncInvoicePaymentStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string
): Promise<ClientInvoiceStatus> {
  const invoice = await tx.clientInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (!invoice) return "draft";
  if (invoice.status === "draft" || invoice.status === "cancelled") return invoice.status;

  let paid = new Prisma.Decimal(0);
  for (const payment of invoice.payments) paid = paid.add(payment.amount);

  let next: ClientInvoiceStatus;
  if (paid.gte(invoice.totalAmount)) {
    next = "paid";
  } else if (paid.gt(0)) {
    next = "partially_paid";
  } else {
    const due = startOfUtcDay(new Date(invoice.dueDate));
    next = due < startOfUtcDay(new Date()) ? "overdue" : "issued";
  }

  if (next !== invoice.status) {
    await tx.clientInvoice.update({ where: { id: invoiceId }, data: { status: next } });
  }
  return next;
}

/** Total already paid against an invoice. */
export async function getInvoicePaidAmount(
  tx: Prisma.TransactionClient,
  invoiceId: string
): Promise<Prisma.Decimal> {
  const result = await tx.clientPayment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  return toDecimal(result._sum.amount);
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

/** Bucket an outstanding invoice by how many days past its due date it is at `asOf`. */
export function classifyAgingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const days = Math.floor(
    (startOfUtcDay(asOf).getTime() - startOfUtcDay(dueDate).getTime()) / 86_400_000
  );
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingTotals = Record<AgingBucket, Prisma.Decimal>;

function emptyAging(): AgingTotals {
  return {
    current: new Prisma.Decimal(0),
    d1_30: new Prisma.Decimal(0),
    d31_60: new Prisma.Decimal(0),
    d61_90: new Prisma.Decimal(0),
    d90_plus: new Prisma.Decimal(0),
  };
}

/** Outstanding balances bucketed by age, for the whole company or one client. */
export async function getAgingTotals(
  companyId: string,
  clientId?: string,
  asOf: Date = new Date()
): Promise<AgingTotals> {
  const invoices = await prisma.clientInvoice.findMany({
    where: {
      companyId,
      ...(clientId ? { clientId } : {}),
      status: { notIn: ["draft", "cancelled"] },
    },
    select: { dueDate: true, totalAmount: true, payments: { select: { amount: true } } },
  });

  const totals = emptyAging();
  for (const invoice of invoices) {
    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);
    const remaining = invoice.totalAmount.sub(paid);
    if (remaining.lte(0)) continue;
    const bucket = classifyAgingBucket(invoice.dueDate, asOf);
    totals[bucket] = totals[bucket].add(remaining);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Summary + statement
// ---------------------------------------------------------------------------

export interface BillingSummary {
  totalBilled: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  overdueInvoiceCount: number;
  activeInvoiceCount: number;
}

/** Billed / collected / outstanding across active invoices. Mirrors the academy receivables summary. */
export async function getClientBillingSummary(
  companyId: string,
  clientId?: string
): Promise<BillingSummary> {
  const today = startOfUtcDay(new Date());

  const [summary] = await prisma.$queryRaw<
    {
      totalBilled: Prisma.Decimal | string | null;
      totalCollected: Prisma.Decimal | string | null;
      outstanding: Prisma.Decimal | string | null;
      overdueInvoiceCount: bigint;
      activeInvoiceCount: bigint;
    }[]
  >(Prisma.sql`
    WITH active_invoices AS (
      SELECT id, "totalAmount", "dueDate"
      FROM "ClientInvoice"
      WHERE "companyId" = ${companyId}
        AND "status" NOT IN ('draft', 'cancelled')
        ${clientId ? Prisma.sql`AND "clientId" = ${clientId}` : Prisma.empty}
    ),
    invoice_payments AS (
      SELECT "invoiceId", COALESCE(SUM(amount), 0) AS paid
      FROM "ClientPayment"
      WHERE "companyId" = ${companyId}
      GROUP BY "invoiceId"
    ),
    invoice_balances AS (
      SELECT
        ai.id,
        ai."totalAmount",
        ai."dueDate",
        COALESCE(ip.paid, 0) AS paid,
        ai."totalAmount" - COALESCE(ip.paid, 0) AS remaining
      FROM active_invoices ai
      LEFT JOIN invoice_payments ip ON ip."invoiceId" = ai.id
    )
    SELECT
      COALESCE(SUM("totalAmount"), 0) AS "totalBilled",
      COALESCE(SUM(paid), 0) AS "totalCollected",
      COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining ELSE 0 END), 0) AS "outstanding",
      COUNT(*) FILTER (WHERE remaining > 0 AND "dueDate" < ${today}::date)::bigint AS "overdueInvoiceCount",
      COUNT(*)::bigint AS "activeInvoiceCount"
    FROM invoice_balances
  `);

  return {
    totalBilled: toDecimal(summary?.totalBilled),
    totalCollected: toDecimal(summary?.totalCollected),
    outstanding: toDecimal(summary?.outstanding),
    overdueInvoiceCount: Number(summary?.overdueInvoiceCount ?? 0),
    activeInvoiceCount: Number(summary?.activeInvoiceCount ?? 0),
  };
}

export interface StatementTransaction {
  date: Date;
  kind: "invoice" | "payment";
  documentId: string;
  reference: string | null;
  description: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  balance: Prisma.Decimal;
}

export interface ClientStatement {
  openingBalance: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
  transactions: StatementTransaction[];
  aging: AgingTotals;
}

/**
 * Client statement for a period: opening balance, dated transactions with a running
 * balance, and the closing balance. The running balance is computed in SQL so the
 * screen and the printed PDF can never disagree.
 */
export async function getClientStatement(
  companyId: string,
  clientId: string,
  fromDate: Date,
  toDate: Date
): Promise<ClientStatement> {
  const from = startOfUtcDay(fromDate);
  const to = startOfUtcDay(toDate);

  const transactionsSql = Prisma.sql`
    WITH tx AS (
      SELECT
        i."invoiceDate" AS d,
        'invoice' AS kind,
        i.id AS document_id,
        i."invoiceNumber" AS reference,
        i."totalAmount" AS debit,
        0::numeric AS credit
      FROM "ClientInvoice" i
      WHERE i."companyId" = ${companyId}
        AND i."clientId" = ${clientId}
        AND i."status" NOT IN ('draft', 'cancelled')
      UNION ALL
      SELECT
        p."paymentDate" AS d,
        'payment' AS kind,
        p.id AS document_id,
        COALESCE(r."receiptNumber", p."referenceNumber") AS reference,
        0::numeric AS debit,
        p.amount AS credit
      FROM "ClientPayment" p
      LEFT JOIN "ClientReceipt" r ON r."paymentId" = p.id
      WHERE p."companyId" = ${companyId}
        AND p."clientId" = ${clientId}
    )
  `;

  const [openingRow] = await prisma.$queryRaw<{ opening: Prisma.Decimal | string | null }[]>(Prisma.sql`
    ${transactionsSql}
    SELECT COALESCE(SUM(debit - credit), 0) AS opening FROM tx WHERE d < ${from}::date
  `);
  const openingBalance = toDecimal(openingRow?.opening);

  const rows = await prisma.$queryRaw<
    {
      d: Date;
      kind: "invoice" | "payment";
      document_id: string;
      reference: string | null;
      debit: Prisma.Decimal | string;
      credit: Prisma.Decimal | string;
      running: Prisma.Decimal | string;
    }[]
  >(Prisma.sql`
    ${transactionsSql}
    SELECT
      d, kind, document_id, reference, debit, credit,
      SUM(debit - credit) OVER (ORDER BY d, kind DESC, document_id ROWS UNBOUNDED PRECEDING) AS running
    FROM tx
    WHERE d >= ${from}::date AND d <= ${to}::date
    ORDER BY d, kind DESC, document_id
  `);

  const transactions: StatementTransaction[] = rows.map((row) => ({
    date: row.d,
    kind: row.kind,
    documentId: row.document_id,
    reference: row.reference,
    description: row.kind === "invoice" ? "Invoice" : "Payment received",
    debit: toDecimal(row.debit),
    credit: toDecimal(row.credit),
    balance: openingBalance.add(toDecimal(row.running)),
  }));

  const closingBalance = transactions.length
    ? transactions[transactions.length - 1].balance
    : openingBalance;

  return {
    openingBalance,
    closingBalance,
    transactions,
    aging: await getAgingTotals(companyId, clientId, toDate),
  };
}

/** Quotes, invoices and receipts for one client — the purchase history view. */
export async function getClientPurchaseHistory(
  companyId: string,
  clientId: string,
  options: { limit?: number; offset?: number } = {}
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const [quotes, invoices, receipts] = await Promise.all([
    prisma.clientQuote.findMany({
      where: { companyId, clientId },
      orderBy: { quoteDate: "desc" },
      take: limit,
      skip: offset,
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.clientInvoice.findMany({
      where: { companyId, clientId },
      orderBy: { invoiceDate: "desc" },
      take: limit,
      skip: offset,
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        payments: { orderBy: { paymentDate: "desc" }, include: { receipt: true } },
      },
    }),
    prisma.clientReceipt.findMany({
      where: { companyId, payment: { clientId } },
      orderBy: { receiptDate: "desc" },
      take: limit,
      skip: offset,
      include: { payment: { select: { invoiceId: true, paymentMethod: true } } },
    }),
  ]);

  return { quotes, invoices, receipts };
}
