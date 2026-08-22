"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { listBillableClients, type BillableClient } from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";

export default function BillingClientsPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);

  const [clients, setClients] = useState<BillableClient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listBillableClients(token);
      setClients(res.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header>
        <Link
          href="/payroll/billing"
          className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
        >
          ← Back to billing
        </Link>
        <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">Clients & statements</h1>
        <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">
          Open a client to see their purchase history and print an account statement.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clients…"
        className="input-modern w-full max-w-sm"
        aria-label="Search clients"
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" aria-label="Loading clients" />
      ) : filtered.length === 0 ? (
        <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-4 py-10 text-center text-sm text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900">
          {clients.length === 0
            ? "No clients yet. Add them under Settings, then link their sites."
            : "No clients match that search."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
            <thead className="bg-security-navy-50 dark:bg-security-navy-900">
              <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2 text-right">Sites</th>
                <th className="px-3 py-2 text-right">Quotes</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
              {filtered.map((client) => (
                <tr key={client.id} className="hover:bg-security-navy-50 dark:hover:bg-security-navy-900">
                  <td className="px-3 py-2">
                    <Link
                      href={`/payroll/billing/clients/${client.id}`}
                      className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                    >
                      {client.name}
                    </Link>
                    {!client.isActive && <span className="ml-2 text-xs text-security-navy-500">(inactive)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{client.siteCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{client.quoteCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{client.invoiceCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(client.outstanding, { currency })}
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
