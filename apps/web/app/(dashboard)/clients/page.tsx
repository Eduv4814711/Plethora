"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner, PageHeader } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import { createClient, listClients, type ClientRecord } from "@/lib/msr-api";

export default function ClientsPage() {
  const { token, user } = useAuth();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactPersonMobile, setContactPersonMobile] = useState("");

  const canCreate = Boolean(
    user && (hasCapability(user, "/clients", "create") || hasCapability(user, "/sites", "create"))
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      setClients(await listClients(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createClient(token, {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        contactPersonName: contactPersonName.trim() || null,
        contactPersonMobile: contactPersonMobile.trim() || null,
      });
      setName("");
      setEmail("");
      setPhone("");
      setContactPersonName("");
      setContactPersonMobile("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSaving(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.email ?? "").toLowerCase().includes(needle) ||
          (c.contactPersonName ?? "").toLowerCase().includes(needle)
      )
    : clients;

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <PageHeader
        title="Clients"
        description="Capture client details, link their sites, and pull the month-end site report and timesheets."
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="input-modern w-full max-w-sm"
          aria-label="Search clients"
        />
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Add client"}
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <form onSubmit={handleCreate} className="card-dashboard grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="label-text mb-1 block">Client name</label>
            <input
              className="input-modern w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label-text mb-1 block">Email</label>
            <input
              type="email"
              className="input-modern w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label-text mb-1 block">Phone</label>
            <input
              className="input-modern w-full"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="label-text mb-1 block">Contact person</label>
            <input
              className="input-modern w-full"
              value={contactPersonName}
              onChange={(e) => setContactPersonName(e.target.value)}
            />
          </div>
          <div>
            <label className="label-text mb-1 block">Contact mobile</label>
            <input
              className="input-modern w-full"
              value={contactPersonMobile}
              onChange={(e) => setContactPersonMobile(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Add client"}
            </button>
            <span className="ml-3 text-sm text-neutral-500">
              Billing details, sites and report recipients are set on the client page.
            </span>
          </div>
        </form>
      )}

      {loading ? (
        <div
          className="h-40 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700"
          aria-label="Loading clients"
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900">
          {clients.length === 0 ? "No clients yet. Add your first one above." : "No clients match that search."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
          <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-700">
            <thead className="bg-neutral-50 dark:bg-neutral-900">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Contact person</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2 text-right">Sites</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filtered.map((client) => (
                <tr key={client.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <td className="px-3 py-2">
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {client.contactPersonName || "—"}
                    {client.contactPersonMobile ? ` · ${client.contactPersonMobile}` : ""}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {client.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{client._count?.sites ?? 0}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        client.isActive
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                          : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
                      }
                    >
                      {client.isActive ? "Active" : "Inactive"}
                    </span>
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
