"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  AlertBanner,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  PageShell,
  SearchInput,
  Select,
  SkeletonBlock,
  StatCard,
  TableShell,
  Toolbar,
} from "@/components/ui";
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
    badgeClass: "bg-security-navy-100 text-security-navy-700",
  },
  IN_REVIEW: {
    label: "In Review",
    badgeClass: "bg-security-amber-100 text-security-amber-800",
  },
  READY: {
    label: "Ready",
    badgeClass: "bg-blue-100 text-blue-800",
  },
  ACTIVE: {
    label: "Active",
    badgeClass: "bg-security-emerald-100 text-security-emerald-800",
  },
  SUSPENDED: {
    label: "Suspended",
    badgeClass: "bg-red-100 text-red-800",
  },
  CLOSED: {
    label: "Closed",
    badgeClass: "bg-gray-100 text-gray-700",
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
    <PageShell>
      <PageHeader
        title="Clients & Legal Entities"
        description="Authoritative commercial, compliance and relationship directory for organisations purchasing security services."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setShowCreateModal(true)}>
              + Establish client
            </Button>
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
          tone="good"
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

      {/* Toolbar with Search and Filters */}
      <Toolbar className="justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-md">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search by legal name, reg number, contact..."
              ariaLabel="Search clients"
            />
          </div>

          <Select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-auto text-xs"
            aria-label="Filter by entity type"
          >
            <option value="ALL">All Entity Types</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>

          <Select
            value={onboardingFilter}
            onChange={(e) => setOnboardingFilter(e.target.value)}
            className="w-auto text-xs"
            aria-label="Filter by onboarding status"
          >
            <option value="ALL">All Onboarding Statuses</option>
            {Object.entries(ONBOARDING_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>

          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-auto text-xs"
            aria-label="Filter by operational status"
          >
            <option value="ALL">Status: All</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </Select>
        </div>

        <span className="text-xs text-security-navy-500">
          Showing {filtered.length} of {clients.length}
        </span>
      </Toolbar>

      {/* Clients Table */}
      {loading ? (
        <SkeletonBlock className="h-56" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={clients.length === 0 ? "No client records registered." : "No clients match your filter criteria."}
          description={
            clients.length === 0
              ? "Establish a new client record to begin tracking contracts, operational sites and compliance."
              : "Try adjusting your search query or reset your filters."
          }
          action={
            clients.length === 0 && canCreate ? (
              <Button type="button" onClick={() => setShowCreateModal(true)}>
                Establish first client
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>Client / Organisation</th>
              <th>Entity & Reg</th>
              <th>Primary Contact</th>
              <th className="text-center">Sites</th>
              <th>Onboarding</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
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
                <tr key={client.id} className="transition-colors hover:bg-security-navy-50/60">
                  {/* Name & Trading Name */}
                  <td>
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-semibold text-security-navy-900 hover:text-security-amber-600 hover:underline"
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
                  <td>
                    <div className="text-xs font-medium text-security-navy-700">
                      {client.entityType ? ENTITY_TYPE_LABELS[client.entityType] : "Unspecified"}
                    </div>
                    <div className="font-mono text-[11px] text-security-navy-500">
                      {client.registrationNumber || "No Reg #"}
                    </div>
                  </td>

                  {/* Contact */}
                  <td>
                    <div className="text-xs font-medium text-security-navy-800">
                      {primaryContact.firstName
                        ? `${primaryContact.firstName} ${primaryContact.lastName || ""}`.trim()
                        : "—"}
                    </div>
                    <div className="text-[11px] text-security-navy-500">
                      {primaryContact.mobile || primaryContact.email || "No contact info"}
                    </div>
                  </td>

                  {/* Linked Sites Count */}
                  <td className="text-center">
                    <span className="inline-flex items-center justify-center rounded-full bg-security-navy-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-security-navy-700">
                      {client._count?.sites ?? 0}
                    </span>
                  </td>

                  {/* Onboarding State */}
                  <td>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${obConfig.badgeClass}`}
                    >
                      {obConfig.label}
                    </span>
                  </td>

                  {/* Active Status */}
                  <td>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        client.isActive
                          ? "bg-security-emerald-50 text-security-emerald-700"
                          : "bg-security-navy-50 text-security-navy-600"
                      }`}
                    >
                      {client.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>

                  {/* Action Link */}
                  <td className="text-right">
                    <Link href={`/clients/${client.id}`} className="btn-secondary py-1 text-xs">
                      Workspace →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      {/* Quick-Create Client Modal */}
      <Modal
        open={Boolean(showCreateModal && canCreate)}
        onClose={() => !creating && setShowCreateModal(false)}
        title="Establish Client Record"
        description="Quick establishment captures core legal identity. Extended contracts, contacts and compliance are managed in the workspace."
        size="lg"
      >
        <form onSubmit={handleQuickCreate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Display / Organisation Name *">
                <Input
                  placeholder="e.g. Apex Logistics"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="Registered Legal Name">
              <Input
                placeholder="e.g. Apex Logistics (Pty) Ltd"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>

            <Field label="Entity Type">
              <Select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as ClientEntityType)}
              >
                {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Company Registration #">
              <Input
                placeholder="e.g. 2022/123456/07"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </Field>

            <Field label="Primary Contact Person">
              <Input
                placeholder="e.g. Sipho Ndlovu"
                value={contactPersonName}
                onChange={(e) => setContactPersonName(e.target.value)}
              />
            </Field>

            <Field label="Contact Email">
              <Input
                type="email"
                placeholder="sipho@apexlogistics.co.za"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Contact Mobile / Phone">
              <Input
                placeholder="082 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !name.trim()} loading={creating}>
              {creating ? "Establishing..." : "Establish & Open Workspace"}
            </Button>
          </div>
        </form>
      </Modal>
    </PageShell>
  );
}
