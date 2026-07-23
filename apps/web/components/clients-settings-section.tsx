"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  createClient,
  listClientAccountCandidates,
  listClients,
  updateClient,
  type ClientAccountCandidate,
  type ClientRecord,
} from "@/lib/msr-api";
import { AlertBanner, PageHeader } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";

export function ClientsSettingsSection({ token }: { token: string }) {
  const { user } = useAuth();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [users, setUsers] = useState<ClientAccountCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const canCreateClients = Boolean(user && hasCapability(user, "/sites", "create"));
  const canEditClients = Boolean(user && hasCapability(user, "/sites", "edit"));

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [c, u] = await Promise.all([
        listClients(token),
        listClientAccountCandidates(token),
      ]);
      setClients(c);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createClient(token, {
        name: name.trim(),
        email: email || undefined,
        phone: phone || undefined,
        userId: userId || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setUserId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (client: ClientRecord) => {
    setError("");
    try {
      await updateClient(token, client.id, { isActive: !client.isActive });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (loading) {
    return <div className="animate-pulse h-24 bg-neutral-200 rounded-lg" />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Clients"
        description="Manage client organisations for the client portal and site linking."
      />
      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {canCreateClients && <form onSubmit={handleCreate} className="card-dashboard p-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label-text block mb-1">Client name</label>
          <input className="input-modern w-full" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label-text block mb-1">Email</label>
          <input type="email" className="input-modern w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label-text block mb-1">Phone</label>
          <input className="input-modern w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="label-text block mb-1">Portal user (client account)</label>
          <select className="input-modern w-full" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">None</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Add client"}
          </button>
        </div>
      </form>}

      <ul className="space-y-2">
        {clients.map((c) => (
          <li key={c.id} className="card-dashboard p-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-neutral-900">{c.name}</p>
              <p className="text-sm text-neutral-600">
                {c.email || "No email"} · {c._count?.sites ?? 0} site(s)
              </p>
            </div>
            {canEditClients && (
              <button
                type="button"
                className="btn-secondary text-sm py-1.5"
                onClick={() => toggleActive(c)}
              >
                {c.isActive ? "Deactivate" : "Activate"}
              </button>
            )}
          </li>
        ))}
        {clients.length === 0 && (
          <p className="text-sm text-neutral-600">No clients yet. Add one above.</p>
        )}
      </ul>

      <p className="text-sm text-neutral-600">
        Link clients to sites under{" "}
        <Link href="/sites" className="text-security-navy-800 hover:underline">Sites</Link>
        . Preview the portal at{" "}
        <Link href="/client-portal" className="text-security-navy-800 hover:underline">Client portal</Link>.
      </p>
    </section>
  );
}
