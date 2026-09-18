import { authFetch } from "./api";
import { downloadAttachment, previewAttachment } from "./download";

const BASE = "/payroll/billing";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string; error?: string }).message ||
        (err as { error?: string }).error ||
        fallback
    );
  }
  return res.json();
}

// ——— Types (money always crosses the wire as a decimal string) ———

export type QuoteStatus = "draft" | "issued" | "accepted" | "declined" | "expired" | "cancelled";
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export interface DocumentLine {
  id?: string;
  siteId?: string | null;
  description: string;
  quantity: string;
  unitAmount: string;
  lineTotal: string;
  sortOrder?: number;
}

export interface LineInput {
  siteId?: string | null;
  description: string;
  quantity: string | number;
  unitAmount: string | number;
}

interface DocumentTotals {
  subtotal: string;
  discountAmount: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
}

export interface ClientSummaryRef {
  id: string;
  name: string;
}

export interface Quote extends DocumentTotals {
  id: string;
  quoteNumber: string;
  quoteDate: string;
  validUntil: string;
  reference?: string | null;
  notes?: string | null;
  status: QuoteStatus;
  clientId: string;
  client?: ClientSummaryRef;
  items: DocumentLine[];
  invoices?: Array<{ id: string; invoiceNumber: string; status: InvoiceStatus }>;
}

export interface Payment {
  id: string;
  paymentDate: string;
  amount: string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  receipt?: Receipt | null;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  amount: string;
}

export interface Invoice extends DocumentTotals {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  reference?: string | null;
  notes?: string | null;
  status: InvoiceStatus;
  clientId: string;
  quoteId?: string | null;
  quote?: { id: string; quoteNumber: string } | null;
  client?: ClientSummaryRef;
  items: DocumentLine[];
  payments?: Payment[];
  amountPaid?: string;
  amountDue?: string;
}

export interface AgingTotals {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
}

export interface BillingSummary {
  totalBilled: string;
  totalCollected: string;
  outstanding: string;
  overdueInvoiceCount: number;
  activeInvoiceCount: number;
  aging: AgingTotals;
}

export interface BillableClient {
  id: string;
  name: string;
  email?: string | null;
  billingEmail?: string | null;
  phone?: string | null;
  isActive: boolean;
  paymentTermsDays: number;
  vatNumber?: string | null;
  siteCount: number;
  invoiceCount: number;
  quoteCount: number;
  outstanding: string;
  billableGuardCount?: number;
  monthlyBillingTotal?: string;
  sitesConfiguredCount?: number;
  sitesUnconfiguredCount?: number;
  sites?: Array<{
    siteId: string;
    siteName: string;
    ratePerGuard: string | null;
    billableGuardCount: number;
    siteMonthlyTotal: string;
    billingConfigured: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>;
}

export interface SitePresetLine {
  siteId: string;
  siteName: string;
  description: string;
  quantity: string;
  unitAmount: string;
  needsPrice: boolean;
}

export interface StatementTransaction {
  date: string;
  kind: "invoice" | "payment";
  documentId: string;
  reference: string | null;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface ClientStatement {
  client: { id: string; name: string; billingEmail?: string | null };
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  transactions: StatementTransaction[];
  aging: AgingTotals;
}

export interface DocumentPayload {
  clientId: string;
  reference?: string | null;
  notes?: string | null;
  discountAmount?: string | number;
  vatRate?: string | number;
  items: LineInput[];
}

export interface CreateQuotePayload extends DocumentPayload {
  quoteDate: string;
  validUntil: string;
  quoteNumber?: string;
}

export interface CreateInvoicePayload extends DocumentPayload {
  invoiceDate: string;
  dueDate?: string;
  invoiceNumber?: string;
}

export interface RecordPaymentPayload {
  paymentDate: string;
  amount: string | number;
  paymentMethod?: string;
  referenceNumber?: string | null;
  notes?: string | null;
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) {
    return { method };
  }
  return {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

// ——— Summary, clients, statements ———

export async function getBillingSummary(token: string, clientId?: string): Promise<BillingSummary> {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return parseJson(await authFetch(`${BASE}/summary${q}`, token), "Failed to load billing summary");
}

export async function listBillableClients(token: string): Promise<{ clients: BillableClient[] }> {
  return parseJson(await authFetch(`${BASE}/clients`, token), "Failed to load clients");
}

export async function getClientSitePreset(
  token: string,
  clientId: string
): Promise<{ lines: SitePresetLine[] }> {
  return parseJson(
    await authFetch(`${BASE}/clients/${clientId}/site-preset`, token),
    "Failed to load site presets"
  );
}

export async function getClientHistory(
  token: string,
  clientId: string
): Promise<{ quotes: Quote[]; invoices: Invoice[]; receipts: Receipt[] }> {
  return parseJson(
    await authFetch(`${BASE}/clients/${clientId}/history`, token),
    "Failed to load client history"
  );
}

export async function getClientStatement(
  token: string,
  clientId: string,
  from: string,
  to: string
): Promise<ClientStatement> {
  const q = new URLSearchParams({ from, to });
  return parseJson(
    await authFetch(`${BASE}/clients/${clientId}/statement?${q}`, token),
    "Failed to load statement"
  );
}

// ——— Quotes ———

export interface ListQuotesParams {
  clientId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listQuotes(
  token: string,
  params: ListQuotesParams = {}
): Promise<{ quotes: Quote[]; total: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params.clientId) q.set("clientId", params.clientId);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const suffix = q.toString() ? `?${q}` : "";
  return parseJson(await authFetch(`${BASE}/quotes${suffix}`, token), "Failed to load quotes");
}

export async function duplicateQuote(token: string, id: string): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}/duplicate`, token, jsonInit("POST")),
    "Failed to duplicate quote"
  );
}

export async function getQuote(token: string, id: string): Promise<Quote> {
  return parseJson(await authFetch(`${BASE}/quotes/${id}`, token), "Failed to load quote");
}

export async function createQuote(token: string, payload: CreateQuotePayload): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes`, token, jsonInit("POST", payload)),
    "Failed to create quote"
  );
}

export async function updateQuote(
  token: string,
  id: string,
  payload: Partial<CreateQuotePayload>
): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}`, token, jsonInit("PATCH", payload)),
    "Failed to update quote"
  );
}

export async function deleteQuote(token: string, id: string): Promise<{ success: boolean }> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}`, token, jsonInit("DELETE")),
    "Failed to delete quote"
  );
}

export async function issueQuote(token: string, id: string): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}/issue`, token, jsonInit("POST")),
    "Failed to issue quote"
  );
}

export async function acceptQuote(token: string, id: string): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}/accept`, token, jsonInit("POST")),
    "Failed to accept quote"
  );
}

export async function declineQuote(token: string, id: string, reason?: string): Promise<Quote> {
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}/decline`, token, jsonInit("POST", { reason })),
    "Failed to decline quote"
  );
}

export async function convertQuoteToInvoice(
  token: string,
  id: string,
  force = false
): Promise<Invoice> {
  const q = force ? "?force=true" : "";
  return parseJson(
    await authFetch(`${BASE}/quotes/${id}/convert-to-invoice${q}`, token, jsonInit("POST")),
    "Failed to convert quote"
  );
}

// ——— Invoices ———

export interface ListInvoicesParams {
  clientId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listInvoices(
  token: string,
  params: ListInvoicesParams = {}
): Promise<{ invoices: Invoice[]; total: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params.clientId) q.set("clientId", params.clientId);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const suffix = q.toString() ? `?${q}` : "";
  return parseJson(await authFetch(`${BASE}/invoices${suffix}`, token), "Failed to load invoices");
}

export async function duplicateInvoice(token: string, id: string): Promise<Invoice> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${id}/duplicate`, token, jsonInit("POST")),
    "Failed to duplicate invoice"
  );
}

export async function getInvoice(token: string, id: string): Promise<Invoice> {
  return parseJson(await authFetch(`${BASE}/invoices/${id}`, token), "Failed to load invoice");
}

export async function createInvoice(token: string, payload: CreateInvoicePayload): Promise<Invoice> {
  return parseJson(
    await authFetch(`${BASE}/invoices`, token, jsonInit("POST", payload)),
    "Failed to create invoice"
  );
}

export async function updateInvoice(
  token: string,
  id: string,
  payload: Partial<CreateInvoicePayload>
): Promise<Invoice> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${id}`, token, jsonInit("PATCH", payload)),
    "Failed to update invoice"
  );
}

export async function deleteInvoice(token: string, id: string): Promise<{ success: boolean }> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${id}`, token, jsonInit("DELETE")),
    "Failed to delete invoice"
  );
}

export async function issueInvoice(token: string, id: string): Promise<Invoice> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${id}/issue`, token, jsonInit("POST")),
    "Failed to issue invoice"
  );
}

export async function cancelInvoice(token: string, id: string): Promise<Invoice> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${id}/cancel`, token, jsonInit("POST")),
    "Failed to cancel invoice"
  );
}

// ——— Payments & receipts ———

export async function recordPayment(
  token: string,
  invoiceId: string,
  payload: RecordPaymentPayload
): Promise<{ payment: Payment; receipt: Receipt; invoiceStatus: InvoiceStatus }> {
  return parseJson(
    await authFetch(`${BASE}/invoices/${invoiceId}/payments`, token, jsonInit("POST", payload)),
    "Failed to record payment"
  );
}

export async function reversePayment(
  token: string,
  paymentId: string
): Promise<{ success: boolean; invoiceStatus: InvoiceStatus }> {
  return parseJson(
    await authFetch(`${BASE}/payments/${paymentId}`, token, jsonInit("DELETE")),
    "Failed to reverse payment"
  );
}

export async function listReceipts(
  token: string,
  params: { clientId?: string; limit?: number; offset?: number } = {}
): Promise<{ receipts: Receipt[]; total: number }> {
  const q = new URLSearchParams();
  if (params.clientId) q.set("clientId", params.clientId);
  if (params.limit) q.set("limit", String(params.limit));
  const suffix = q.toString() ? `?${q}` : "";
  return parseJson(await authFetch(`${BASE}/receipts${suffix}`, token), "Failed to load receipts");
}

// ——— PDF downloads ———

const downloadPdf = downloadAttachment;

export function downloadQuotePdf(token: string, id: string, name = "quote.pdf") {
  return downloadPdf(token, `${BASE}/quotes/${id}/pdf`, name);
}

export function downloadInvoicePdf(token: string, id: string, name = "invoice.pdf") {
  return downloadPdf(token, `${BASE}/invoices/${id}/pdf`, name);
}

export function downloadReceiptPdf(token: string, id: string, name = "receipt.pdf") {
  return downloadPdf(token, `${BASE}/receipts/${id}/pdf`, name);
}

export function downloadStatementPdf(
  token: string,
  clientId: string,
  from: string,
  to: string,
  name = "statement.pdf"
) {
  const q = new URLSearchParams({ from, to });
  return downloadPdf(token, `${BASE}/clients/${clientId}/statement/pdf?${q}`, name);
}

// ——— PDF previews (opens in new tab) ———

export function previewQuotePdf(token: string, id: string) {
  return previewAttachment(token, `${BASE}/quotes/${id}/pdf`);
}

export function previewInvoicePdf(token: string, id: string) {
  return previewAttachment(token, `${BASE}/invoices/${id}/pdf`);
}

export function previewReceiptPdf(token: string, id: string) {
  return previewAttachment(token, `${BASE}/receipts/${id}/pdf`);
}

export function previewStatementPdf(
  token: string,
  clientId: string,
  from: string,
  to: string
) {
  const q = new URLSearchParams({ from, to });
  return previewAttachment(token, `${BASE}/clients/${clientId}/statement/pdf?${q}`);
}

// ——— CSV data exports ———

function triggerCsvDownload(content: string, filename: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

export function exportInvoicesToCsv(
  invoices: Invoice[],
  filename = `invoices_${new Date().toISOString().slice(0, 10)}.csv`
) {
  const headers = [
    "Invoice #",
    "Client",
    "Issue Date",
    "Due Date",
    "Subtotal",
    "VAT",
    "Total Amount",
    "Amount Paid",
    "Amount Due",
    "Status",
    "Reference",
  ];
  const rows = invoices.map((inv) => [
    escapeCsvCell(inv.invoiceNumber),
    escapeCsvCell(inv.client?.name ?? ""),
    escapeCsvCell(inv.invoiceDate?.slice(0, 10) ?? ""),
    escapeCsvCell(inv.dueDate?.slice(0, 10) ?? ""),
    escapeCsvCell(inv.subtotal),
    escapeCsvCell(inv.vatAmount),
    escapeCsvCell(inv.totalAmount),
    escapeCsvCell(inv.amountPaid ?? "0.00"),
    escapeCsvCell(inv.amountDue ?? inv.totalAmount),
    escapeCsvCell(inv.status),
    escapeCsvCell(inv.reference ?? ""),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  triggerCsvDownload(csv, filename);
}

export function exportQuotesToCsv(
  quotes: Quote[],
  filename = `quotes_${new Date().toISOString().slice(0, 10)}.csv`
) {
  const headers = [
    "Quote #",
    "Client",
    "Quote Date",
    "Valid Until",
    "Subtotal",
    "VAT",
    "Total Amount",
    "Status",
    "Reference",
  ];
  const rows = quotes.map((q) => [
    escapeCsvCell(q.quoteNumber),
    escapeCsvCell(q.client?.name ?? ""),
    escapeCsvCell(q.quoteDate?.slice(0, 10) ?? ""),
    escapeCsvCell(q.validUntil?.slice(0, 10) ?? ""),
    escapeCsvCell(q.subtotal),
    escapeCsvCell(q.vatAmount),
    escapeCsvCell(q.totalAmount),
    escapeCsvCell(q.status),
    escapeCsvCell(q.reference ?? ""),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  triggerCsvDownload(csv, filename);
}

export function exportClientsBalancesToCsv(
  clients: BillableClient[],
  filename = `client_balances_${new Date().toISOString().slice(0, 10)}.csv`
) {
  const headers = [
    "Client Name",
    "Email",
    "Phone",
    "VAT Number",
    "Active",
    "Sites",
    "Quotes",
    "Invoices",
    "Outstanding Balance",
  ];
  const rows = clients.map((c) => [
    escapeCsvCell(c.name),
    escapeCsvCell(c.billingEmail || c.email || ""),
    escapeCsvCell(c.phone ?? ""),
    escapeCsvCell(c.vatNumber ?? ""),
    escapeCsvCell(c.isActive ? "Yes" : "No"),
    escapeCsvCell(c.siteCount),
    escapeCsvCell(c.quoteCount),
    escapeCsvCell(c.invoiceCount),
    escapeCsvCell(c.outstanding),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  triggerCsvDownload(csv, filename);
}

// ——— Site Billing Configuration & Rates ———

export interface SiteBillingSummary {
  siteId: string;
  siteName: string;
  billingMethod: "PER_GUARD";
  ratePerGuard: string | null;
  billableGuardCount: number;
  siteMonthlyTotal: string;
  billingConfigured: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes?: string | null;
  rateId?: string | null;
  rateUpdatedAt?: string | null;
}

export interface ClientSitesBillingResponse {
  clientId: string;
  clientName: string;
  asOfDate: string;
  totalMonthlyAmount: string;
  totalBillableGuards: number;
  sitesConfiguredCount: number;
  sitesUnconfiguredCount: number;
  sites: SiteBillingSummary[];
}

export interface ActiveBillableGuardInfo {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  status: string;
  assignedAt: string;
}

export interface SiteBillingRateHistoryEntry {
  id: string;
  billingMethod: string;
  ratePerGuard: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteBillingDetailResponse {
  site: {
    id: string;
    name: string;
    physicalAddress?: string | null;
    siteStatus: string;
  };
  billing: SiteBillingSummary;
  activeGuards: ActiveBillableGuardInfo[];
  history: SiteBillingRateHistoryEntry[];
}

export interface ConfigureSiteBillingRatePayload {
  ratePerGuard: number;
  billingMethod?: "PER_GUARD";
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export async function getClientSitesBilling(
  token: string,
  clientId: string,
  asOf?: string
): Promise<ClientSitesBillingResponse> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  const res = await authFetch(`${BASE}/clients/${clientId}/sites${query}`, token);
  return parseJson(res, "Failed to load client sites billing");
}

export async function getSiteBillingDetail(
  token: string,
  clientId: string,
  siteId: string,
  asOf?: string
): Promise<SiteBillingDetailResponse> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  const res = await authFetch(`${BASE}/clients/${clientId}/sites/${siteId}${query}`, token);
  return parseJson(res, "Failed to load site billing details");
}

export async function updateSiteBillingRate(
  token: string,
  clientId: string,
  siteId: string,
  data: ConfigureSiteBillingRatePayload
): Promise<{
  rate: SiteBillingRateHistoryEntry;
  siteBilling: {
    siteId: string;
    siteName: string;
    ratePerGuard: string | null;
    billableGuardCount: number;
    siteMonthlyTotal: string;
    billingConfigured: boolean;
  };
}> {
  const res = await authFetch(`${BASE}/clients/${clientId}/sites/${siteId}/rate`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to configure site billing rate");
}

