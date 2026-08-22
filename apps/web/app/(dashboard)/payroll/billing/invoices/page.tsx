"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  createInvoice,
  listBillableClients,
  listInvoices,
  type BillableClient,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../_components/status-badge";
import { computeTotalsPreview, DocumentTotals } from "../_components/document-totals";
import { emptyLine, LineItemsEditor, type EditableLine } from "../_components/line-items-editor";

const STATUSES: Array<InvoiceStatus | "all"> = [
  "all",
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InvoicesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<BillableClient[]>([]);
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0.00");
  const [vatRate, setVatRate] = useState("15");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [invoiceRes, clientRes] = await Promise.all([
        listInvoices(token, status === "all" ? {} : { status }),
        listBillableClients(token),
      ]);
      setInvoices(invoiceRes.invoices);
      setClients(clientRes.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [token, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => computeTotalsPreview(lines, discount, vatRate),
    [lines, discount, vatRate]
  );

  const selectedClient = clients.find((c) => c.id === clientId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const usable = lines.filter((l) => l.description.trim() !== "");
    if (!clientId) {
      setError("Select a client for this invoice.");
      return;
    }
    if (usable.length === 0) {
      setError("Add at least one line item.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createInvoice(token, {
        clientId,
        invoiceDate,
        ...(dueDate ? { dueDate } : {}),
        reference: reference || null,
        notes: notes || null,
        discountAmount: discount,
        vatRate,
        items: usable,
      });
      setClientId("");
      setInvoiceDate(today());
      setDueDate("");
      setReference("");
      setNotes("");
      setDiscount("0.00");
      setVatRate("15");
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/payroll/billing"
            className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
          >
            ← Back to billing
          </Link>
          <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">Invoices</h1>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setShowForm((o) => !o)} className="btn-primary min-h-11">
            {showForm ? "Close" : "New invoice"}
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {showForm && canCreate && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-security-lg border border-security-navy-100 bg-white p-4 dark:border-security-navy-700 dark:bg-security-navy-900"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Client</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="input-modern mt-1 w-full"
                required
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Invoice date</span>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="input-modern mt-1 w-full"
                required
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-modern mt-1 w-full"
              />
              <span className="mt-0.5 block text-[11px] text-security-navy-500">
                {selectedClient
                  ? `Blank = ${selectedClient.paymentTermsDays} days from invoice date`
                  : "Blank uses the client's payment terms"}
              </span>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Reference</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional"
                className="input-modern mt-1 w-full"
              />
            </label>
          </div>

          <LineItemsEditor
            token={token ?? ""}
            clientId={clientId}
            lines={lines}
            onChange={setLines}
            currency={currency}
            disabled={saving}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Discount</span>
                  <input
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    inputMode="decimal"
                    className="input-modern mt-1 w-full text-right"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">VAT rate %</span>
                  <input
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    inputMode="decimal"
                    className="input-modern mt-1 w-full text-right"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="input-modern mt-1 w-full"
                  placeholder="Banking details, terms, anything to print on the invoice"
                />
              </label>
            </div>
            <DocumentTotals totals={totals} currency={currency} vatRate={vatRate} />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary min-h-11">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary min-h-11 disabled:opacity-50">
              {saving ? "Saving…" : "Create invoice"}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={
              status === s
                ? "min-h-11 rounded-lg bg-security-navy-800 px-3 text-sm font-medium text-white"
                : "min-h-11 rounded-lg px-3 text-sm font-medium text-security-navy-700 hover:bg-security-navy-50 dark:text-security-navy-300 dark:hover:bg-security-navy-800"
            }
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" aria-label="Loading invoices" />
      ) : invoices.length === 0 ? (
        <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-4 py-10 text-center text-sm text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900">
          No invoices yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
            <thead className="bg-security-navy-50 dark:bg-security-navy-900">
              <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Due amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-security-navy-50 dark:hover:bg-security-navy-900">
                  <td className="px-3 py-2">
                    <Link
                      href={`/payroll/billing/invoices/${invoice.id}`}
                      className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{invoice.client?.name ?? "—"}</td>
                  <td className="px-3 py-2">{invoice.invoiceDate?.slice(0, 10)}</td>
                  <td className="px-3 py-2">{invoice.dueDate?.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(invoice.totalAmount, { currency })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(invoice.amountDue ?? invoice.totalAmount, { currency })}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
