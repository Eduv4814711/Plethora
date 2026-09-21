"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner, PageHeader, StatCard, Toolbar } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import {
  createClient,
  listClients,
  type ClientEntityType,
  type ClientOnboardingStatus,
  type ClientRecord,
} from "@/lib/msr-api";

const ENTITY_TYPE_LABELS: Record<ClientEntityType, string> = {
  PRIVATE_COMPANY: "Private Company (Pty Ltd)",
  CLOSE_CORPORATION: "Close Corporation (CC)",
  TRUST: "Trust",
  PARTNERSHIP: "Partnership",
  SOLE_PROPRIETOR: "Sole Proprietor",
  NATURAL_PERSON: "Natural Person",
  GOVERNMENT: "Government Dept",
  MUNICIPALITY: "Municipality",
  BODY_CORPORATE_HOA: "Body Corporate / HOA",
  NPO: "Non-Profit Org (NPO)",
  OTHER: "Other Entity",
};

const ONBOARDING_STATUS_STYLES: Record<
  ClientOnboardingStatus,
  { label: string; badgeClass: string }
> = {
  DRAFT: {
    label: "Draft",
    badgeClass: "bg-security-navy-100 text-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-300",
  },
  IN_REVIEW: {
    label: "In Review",
    badgeClass: "bg-security-amber-100 text-security-amber-800 dark:bg-security-amber-900/40 dark:text-security-amber-300",
  },
  READY: {
    label: "Ready",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  ACTIVE: {
    label: "Active",
    badgeClass: "bg-security-emerald-100 text-security-emerald-800 dark:bg-security-emerald-900/40 dark:text-security-emerald-300",
  },
  SUSPENDED: {
    label: "Suspended",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  CLOSED: {
    label: "Closed",
    badgeClass: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  },
};

export default function ClientsPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [onboardingFilter, setOnboardingFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  // Quick-create fields
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [entityType, setEntityType] = useState<ClientEntityType>("PRIVATE_COMPANY");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

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

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const created = await createClient(token, {
        name: name.trim(),
        legalName: legalName.trim() || null,
        entityType,
        registrationNumber: registrationNumber.trim() || null,
        contactPersonName: contactPersonName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        isActive: true,
      });

      setShowCreateModal(false);
      setName("");
      setLegalName("");
      setRegistrationNumber("");
      setContactPersonName("");
      setEmail("");
      setPhone("");

      // Fast onboarding flow: redirect straight to client workspace
      router.push(`/clients/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
      setCreating(false);
    }
  };

  // Filter logic
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (entityFilter !== "ALL" && c.entityType !== entityFilter) return false;
      if (statusFilter === "ACTIVE" && !c.isActive) return false;
      if (statusFilter === "INACTIVE" && c.isActive) return false;
      if (onboardingFilter !== "ALL" && (c.onboardingStatus || "DRAFT") !== onboardingFilter) return false;

      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.legalName ?? "").toLowerCase().includes(q) ||
        (c.tradingName ?? "").toLowerCase().includes(q) ||
        (c.registrationNumber ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.contactPersonName ?? "").toLowerCase().includes(q) ||
        (c.contacts ?? []).some(
          (ct) =>
            ct.firstName.toLowerCase().includes(q) ||
            (ct.lastName ?? "").toLowerCase().includes(q) ||
            (ct.email ?? "").toLowerCase().includes(q)
        )
      );
    });
  }, [clients, query, entityFilter, statusFilter, onboardingFilter]);

  // Operational metrics
  const stats = useMemo(() => {
    const total = clients.length;
    const active = clients.filter((c) => c.isActive).length;
    const totalSites = clients.reduce((sum, c) => sum + (c._count?.sites ?? 0), 0);
    const attentionNeeded = clients.filter(
      (c) =>
        (c.onboardingStatus && ["DRAFT", "IN_REVIEW"].includes(c.onboardingStatus)) ||
        (c._count?.sites ?? 0) === 0
    ).length;

    return { total, active, totalSites, attentionNeeded };
  }, [clients]);

  return (
    <main className="animate-fade-in space-y-6 pb-16">
      <PageHeader
        title="Clients & Legal Entities"
        description="Authoritative commercial, compliance and relationship directory for organisations purchasing security services."
        actions={
          canCreate ? (
            <button
              type="button"
              className="btn-primary flex items-center gap-2 text-sm"
              onClick={() => setShowCreateModal(true)}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Establish client
            </button>
          ) : undefined
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Clients"
          value={stats.total}
          hint={`${stats.active} actively serviced`}
          tone="live"
        />
        <StatCard
          label="Operational Sites"
          value={stats.totalSites}
          hint="Across all client portfolios"
          tone="good"
        />
        <StatCard
          label="Onboarding / In Review"
          value={stats.attentionNeeded}
          hint="Require legal or operational setup"
          tone={stats.attentionNeeded > 0 ? "warn" : "idle"}
        />
        <StatCard
          label="Active Service Ratio"
          value={stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}%` : "0%"}
          hint="Current operational yield"
          tone="idle"
        />
      </div>

      {/* Toolbar with Search and Modern Filters */}
      <Toolbar className="justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1 max-w-md">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by legal name, reg number, contact..."
              className="input-modern w-full pl-9"
              aria-label="Search clients"
            />
            <svg
              className="absolute left-3 top-2.5 h-4 w-4 text-security-navy-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="input-modern text-xs"
            aria-label="Filter by entity type"
          >
            <option value="ALL">All Entity Types</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <select
            value={onboardingFilter}
            onChange={(e) => setOnboardingFilter(e.target.value)}
            className="input-modern text-xs"
            aria-label="Filter by onboarding status"
          >
            <option value="ALL">All Onboarding Statuses</option>
            {Object.entries(ONBOARDING_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-modern text-xs"
            aria-label="Filter by operational status"
          >
            <option value="ALL">Status: All</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </select>
        </div>

        <span className="text-xs text-security-navy-500">
          Showing {filtered.length} of {clients.length}
        </span>
      </Toolbar>

      {/* Clients Table */}
      {loading ? (
        <div className="h-56 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-800" />
      ) : filtered.length === 0 ? (
        <div className="rounded-security-lg border border-dashed border-security-navy-200 bg-white p-12 text-center dark:border-security-navy-700 dark:bg-security-navy-900">
          <p className="font-medium text-security-navy-800 dark:text-security-navy-200">
            {clients.length === 0 ? "No client records registered." : "No clients match your filter criteria."}
          </p>
          <p className="mt-1 text-xs text-security-navy-500">
            {clients.length === 0
              ? "Establish a new client record to begin tracking contracts, operational sites and compliance."
              : "Try adjusting your search query or reset your filters."}
          </p>
          {clients.length === 0 && canCreate && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="btn-primary mt-4 text-xs"
            >
              Establish first client
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card dark:border-security-navy-700 dark:bg-security-navy-900">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-800">
              <thead className="bg-security-navy-50 dark:bg-security-navy-900/80">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-security-navy-500">
                  <th className="px-4 py-3">Client / Organisation</th>
                  <th className="px-4 py-3">Entity & Reg</th>
                  <th className="px-4 py-3">Primary Contact</th>
                  <th className="px-4 py-3 text-center">Sites</th>
                  <th className="px-4 py-3">Onboarding</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                {filtered.map((client) => {
                  const obStatus = client.onboardingStatus || "DRAFT";
                  const obConfig = ONBOARDING_STATUS_STYLES[obStatus] || ONBOARDING_STATUS_STYLES.DRAFT;
                  const primaryContact = client.contacts?.find((ct) => ct.isPrimary) || {
                    firstName: client.contactPersonName || "",
                    lastName: "",
                    mobile: client.contactPersonMobile || client.phone || "",
                    email: client.email || "",
                  };

                  return (
                    <tr
                      key={client.id}
                      className="transition-colors hover:bg-security-navy-50/60 dark:hover:bg-security-navy-800/50"
                    >
                      {/* Name & Trading Name */}
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/clients/${client.id}`}
                          className="font-semibold text-security-navy-900 hover:text-security-amber-600 hover:underline dark:text-security-navy-100"
                        >
                          {client.name}
                        </Link>
                        {client.tradingName && client.tradingName !== client.name && (
                          <div className="text-xs text-security-navy-500">t/a {client.tradingName}</div>
                        )}
                        {client.legalName && client.legalName !== client.name && (
                          <div className="text-[11px] text-security-navy-400">Legal: {client.legalName}</div>
                        )}
                      </td>

                      {/* Entity & Reg */}
                      <td className="px-4 py-3.5">
                        <div className="text-xs font-medium text-security-navy-700 dark:text-security-navy-300">
                          {client.entityType ? ENTITY_TYPE_LABELS[client.entityType] : "Unspecified"}
                        </div>
                        <div className="text-[11px] font-mono text-security-navy-500">
                          {client.registrationNumber || "No Reg #"}
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-3.5">
                        <div className="text-xs font-medium text-security-navy-800 dark:text-security-navy-200">
                          {primaryContact.firstName
                            ? `${primaryContact.firstName} ${primaryContact.lastName || ""}`.trim()
                            : "—"}
                        </div>
                        <div className="text-[11px] text-security-navy-500">
                          {primaryContact.mobile || primaryContact.email || "No contact info"}
                        </div>
                      </td>

                      {/* Linked Sites Count */}
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center justify-center rounded-full bg-security-navy-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-300">
                          {client._count?.sites ?? 0}
                        </span>
                      </td>

                      {/* Onboarding State */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${obConfig.badgeClass}`}
                        >
                          {obConfig.label}
                        </span>
                      </td>

                      {/* Active Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            client.isActive
                              ? "bg-security-emerald-50 text-security-emerald-700 dark:bg-security-emerald-950/50 dark:text-security-emerald-400"
                              : "bg-security-navy-50 text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-400"
                          }`}
                        >
                          {client.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>

                      {/* Action Link */}
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/clients/${client.id}`}
                          className="btn-secondary py-1 text-xs"
                        >
                          Workspace →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick-Create Client Modal */}
      {showCreateModal && canCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <div>
                <h2 className="text-lg font-semibold text-security-navy-900 dark:text-security-navy-100">
                  Establish Client Record
                </h2>
                <p className="text-xs text-security-navy-500">
                  Quick establishment captures core legal identity. Extended contracts, contacts and compliance are managed in the workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 dark:hover:text-security-navy-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickCreate} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label-text mb-1 block">Display / Organisation Name *</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Apex Logistics"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="label-text mb-1 block">Registered Legal Name</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Apex Logistics (Pty) Ltd"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label-text mb-1 block">Entity Type</label>
                  <select
                    className="input-modern w-full"
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value as ClientEntityType)}
                  >
                    {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-text mb-1 block">Company Registration #</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. 2022/123456/07"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label-text mb-1 block">Primary Contact Person</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Sipho Ndlovu"
                    value={contactPersonName}
                    onChange={(e) => setContactPersonName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label-text mb-1 block">Contact Email</label>
                  <input
                    type="email"
                    className="input-modern w-full"
                    placeholder="sipho@apexlogistics.co.za"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label-text mb-1 block">Contact Mobile / Phone</label>
                  <input
                    className="input-modern w-full"
                    placeholder="082 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary text-sm"
                  disabled={creating || !name.trim()}
                >
                  {creating ? "Establishing..." : "Establish & Open Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
