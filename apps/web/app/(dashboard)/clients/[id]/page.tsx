"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import {
  getClient,
  listClientAccountCandidates,
  listSitesForLinking,
  linkClientSites,
  unlinkClientSite,
  updateClient,
  type ClientAccountCandidate,
  type ClientDetail,
  type ClientWritableFields,
  type LinkableSite,
} from "@/lib/msr-api";
import { ClientMonthEndTab } from "./month-end-tab";

type Tab = "details" | "sites" | "month-end";

const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "sites", label: "Sites" },
  { id: "month-end", label: "Month-end reports" },
];

type FormState = {
  name: string;
  email: string;
  phone: string;
  contactPersonName: string;
  contactPersonRole: string;
  contactPersonMobile: string;
  physicalAddress: string;
  notes: string;
  billingEmail: string;
  billingAddress: string;
  vatNumber: string;
  registrationNumber: string;
  paymentTermsDays: string;
  userId: string;
  isActive: boolean;
  reportRecipients: string[];
};

function formFrom(client: ClientDetail): FormState {
  return {
    name: client.name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    contactPersonName: client.contactPersonName ?? "",
    contactPersonRole: client.contactPersonRole ?? "",
    contactPersonMobile: client.contactPersonMobile ?? "",
    physicalAddress: client.physicalAddress ?? "",
    notes: client.notes ?? "",
    billingEmail: client.billingEmail ?? "",
    billingAddress: client.billingAddress ?? "",
    vatNumber: client.vatNumber ?? "",
    registrationNumber: client.registrationNumber ?? "",
    paymentTermsDays: String(client.paymentTermsDays ?? 30),
    userId: client.userId ?? "",
    isActive: client.isActive,
    reportRecipients: client.reportRecipients ?? [],
  };
}

function payloadFrom(form: FormState): Partial<ClientWritableFields> {
  const orNull = (value: string) => (value.trim() ? value.trim() : null);
  return {
    name: form.name.trim(),
    email: orNull(form.email),
    phone: orNull(form.phone),
    contactPersonName: orNull(form.contactPersonName),
    contactPersonRole: orNull(form.contactPersonRole),
    contactPersonMobile: orNull(form.contactPersonMobile),
    physicalAddress: orNull(form.physicalAddress),
    notes: orNull(form.notes),
    billingEmail: orNull(form.billingEmail),
    billingAddress: orNull(form.billingAddress),
    vatNumber: orNull(form.vatNumber),
    registrationNumber: orNull(form.registrationNumber),
    paymentTermsDays: Number(form.paymentTermsDays) || 30,
    userId: form.userId || null,
    isActive: form.isActive,
    reportRecipients: form.reportRecipients,
  };
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const { token, user } = useAuth();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [candidates, setCandidates] = useState<ClientAccountCandidate[]>([]);
  const [tab, setTab] = useState<Tab>("details");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canEdit = Boolean(
    user && (hasCapability(user, "/clients", "edit") || hasCapability(user, "/sites", "edit"))
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [detail, users] = await Promise.all([
        getClient(token, clientId),
        listClientAccountCandidates(token).catch(() => [] as ClientAccountCandidate[]),
      ]);
      setClient(detail);
      setForm(formFrom(detail));
      setCandidates(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client");
    }
  }, [token, clientId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !form) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateClient(token, clientId, payloadFrom(form));
      setNotice("Client saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save client");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="animate-fade-in space-y-4 pb-16">
        <div className="h-40 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700" aria-label="Loading client" />
      </main>
    );
  }

  if (!client || !form) {
    return (
      <main className="animate-fade-in space-y-4 pb-16">
        <Link href="/clients" className="text-sm text-security-navy-700 hover:underline">
          ← Back to clients
        </Link>
        <AlertBanner variant="error">{error || "Client not found"}</AlertBanner>
      </main>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header className="space-y-1">
        <Link href="/clients" className="text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300">
          ← Back to clients
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{client.name}</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {client.sites.length} linked site(s) · {client.isActive ? "Active" : "Inactive"}
            </p>
          </div>
          <Link
            href={`/payroll/billing/clients/${client.id}`}
            className="btn-secondary text-sm"
          >
            Billing & statements
          </Link>
        </div>
      </header>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {notice && <AlertBanner variant="success">{notice}</AlertBanner>}

      <nav className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700" aria-label="Client sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-11 px-4 text-sm font-medium ${
              tab === item.id
                ? "border-b-2 border-security-navy-700 text-security-navy-800 dark:text-security-navy-300"
                : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <form onSubmit={save} className="card-dashboard grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="label-text mb-1 block">Client name</label>
            <input className="input-modern w-full" value={form.name} onChange={(e) => set("name", e.target.value)} required disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Email</label>
            <input type="email" className="input-modern w-full" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Phone</label>
            <input className="input-modern w-full" value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Portal user (client account)</label>
            <select className="input-modern w-full" value={form.userId} onChange={(e) => set("userId", e.target.value)} disabled={!canEdit}>
              <option value="">None</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.email})
                </option>
              ))}
            </select>
          </div>

          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 sm:col-span-2">
            Contact person
          </p>
          <div>
            <label className="label-text mb-1 block">Name</label>
            <input className="input-modern w-full" value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Role / title</label>
            <input className="input-modern w-full" value={form.contactPersonRole} onChange={(e) => set("contactPersonRole", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Mobile</label>
            <input className="input-modern w-full" value={form.contactPersonMobile} onChange={(e) => set("contactPersonMobile", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="sm:col-span-2">
            <label className="label-text mb-1 block">Physical address</label>
            <textarea rows={2} className="input-modern w-full" value={form.physicalAddress} onChange={(e) => set("physicalAddress", e.target.value)} disabled={!canEdit} />
          </div>

          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 sm:col-span-2">
            Billing details — printed on quotes, invoices and statements
          </p>
          <div>
            <label className="label-text mb-1 block">Billing email</label>
            <input type="email" className="input-modern w-full" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">VAT number</label>
            <input className="input-modern w-full" value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Company registration number</label>
            <input className="input-modern w-full" value={form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="label-text mb-1 block">Payment terms (days)</label>
            <input type="number" min={0} max={365} className="input-modern w-full" value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="sm:col-span-2">
            <label className="label-text mb-1 block">Billing address</label>
            <textarea rows={2} className="input-modern w-full" value={form.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} disabled={!canEdit} />
          </div>

          <div className="sm:col-span-2">
            <RecipientsEditor
              value={form.reportRecipients}
              onChange={(next) => set("reportRecipients", next)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label-text mb-1 block">Internal notes</label>
            <textarea rows={3} className="input-modern w-full" value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={!canEdit} />
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} disabled={!canEdit} />
            Active
          </label>

          {canEdit && (
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </form>
      )}

      {tab === "sites" && (
        <SitesTab
          client={client}
          canEdit={canEdit}
          token={token ?? ""}
          onChanged={load}
          onError={setError}
        />
      )}

      {tab === "month-end" && <ClientMonthEndTab clientId={client.id} token={token ?? ""} />}
    </main>
  );
}

function RecipientsEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const email = draft.trim();
    if (!email || value.includes(email)) return;
    onChange([...value, email]);
    setDraft("");
  };

  return (
    <div>
      <label className="label-text mb-1 block">Email the month-end pack to (sent manually)</label>
      <p className="mb-2 text-xs text-neutral-500">
        Nothing is emailed automatically — these are the addresses to send the downloaded pack to.
        Leave empty to fall back to the billing email.
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-sm dark:bg-neutral-800"
          >
            {email}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== email))}
                className="text-neutral-500 hover:text-red-600"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {value.length === 0 && <span className="text-sm text-neutral-500">No recipients captured.</span>}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <input
            type="email"
            className="input-modern w-full max-w-sm"
            value={draft}
            placeholder="name@client.co.za"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn-secondary" onClick={add}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function SitesTab({
  client,
  canEdit,
  token,
  onChanged,
  onError,
}: {
  client: ClientDetail;
  canEdit: boolean;
  token: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [available, setAvailable] = useState<LinkableSite[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !canEdit) return;
    void listSitesForLinking(token)
      .then(setAvailable)
      .catch((err) => onError(err instanceof Error ? err.message : "Failed to load sites"));
  }, [token, canEdit, onError, client.sites.length]);

  const unlinked = useMemo(() => available.filter((site) => !site.clientId), [available]);

  const link = async () => {
    if (!token || selected.length === 0) return;
    setBusy(true);
    try {
      await linkClientSites(token, client.id, selected);
      setSelected([]);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to link sites");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (siteId: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await unlinkClientSite(token, client.id, siteId);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to unlink site");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-700">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Contract</th>
              <th className="px-3 py-2">Status</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {client.sites.map((site) => (
              <tr key={site.id}>
                <td className="px-3 py-2">
                  <Link href={`/sites/${site.id}`} className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300">
                    {site.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{site.physicalAddress || "—"}</td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{site.serviceType || "—"}</td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                  {site.contractStartDate ? String(site.contractStartDate).slice(0, 10) : "—"}
                  {site.contractEndDate ? ` → ${String(site.contractEndDate).slice(0, 10)}` : ""}
                </td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{site.siteStatus}</td>
                {canEdit && (
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="btn-secondary py-1 text-sm" onClick={() => unlink(site.id)} disabled={busy}>
                      Detach
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {client.sites.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-3 py-8 text-center text-sm text-neutral-600">
                  No sites linked yet. Attach them below so their timesheets appear in the month-end pack.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="card-dashboard space-y-3 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Attach sites</h2>
          {unlinked.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Every site is already linked to a client. Detach it from its current client first, or set the
              client on the <Link href="/sites" className="text-security-navy-700 hover:underline">site itself</Link>.
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {unlinked.map((site) => (
                  <label key={site.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(site.id)}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked ? [...current, site.id] : current.filter((id) => id !== site.id)
                        )
                      }
                    />
                    {site.name}
                  </label>
                ))}
              </div>
              <button type="button" className="btn-primary" onClick={link} disabled={busy || selected.length === 0}>
                {busy ? "Linking…" : `Attach ${selected.length || ""} site(s)`.trim()}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
