"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import {
  getClient,
  getClientContacts,
  getClientRelatedParties,
  getClientContracts,
  getClientCompliance,
  listSitesForLinking,
  linkClientSites,
  unlinkClientSite,
  updateClient,
  type ClientContact,
  type ClientContract,
  type ClientDetail,
  type ClientRelatedParty,
  type ClientComplianceEvaluation,
  type LinkableSite,
} from "@/lib/msr-api";
import { ClientOverviewTab } from "./client-overview-tab";
import { ClientLegalTab } from "./client-legal-tab";
import { ClientContactsTab } from "./client-contacts-tab";
import { ClientContractsTab } from "./client-contracts-tab";
import { ClientDocumentsTab } from "./client-documents-tab";
import { ClientPrivacyTab } from "./client-privacy-tab";
import { ClientMonthEndTab } from "./month-end-tab";

type ClientTab =
  | "overview"
  | "legal"
  | "contacts"
  | "contracts"
  | "sites"
  | "documents"
  | "privacy"
  | "month-end";

const TABS: { id: ClientTab; label: string; badge?: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "legal", label: "Legal & Identity" },
  { id: "contacts", label: "Contacts" },
  { id: "contracts", label: "Contracts" },
  { id: "sites", label: "Sites" },
  { id: "documents", label: "Documents & Compliance" },
  { id: "privacy", label: "Privacy & Data (POPIA)" },
  { id: "month-end", label: "Month-end Reports" },
];

export default function ClientWorkspacePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const clientId = params.id;
  const { token, user } = useAuth();

  const [tab, setTab] = useState<ClientTab>(() => {
    const requested = searchParams.get("tab") as ClientTab | null;
    return requested && TABS.some((t) => t.id === requested) ? requested : "overview";
  });

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [relatedParties, setRelatedParties] = useState<ClientRelatedParty[]>([]);
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [compliance, setCompliance] = useState<ClientComplianceEvaluation | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedContractFilterId, setSelectedContractFilterId] = useState<string | undefined>();

  const canEdit = Boolean(
    user && (user.isOwner || hasCapability(user, "/clients", "edit") || hasCapability(user, "/sites", "edit"))
  );

  const canVerifyDocuments = Boolean(
    user && (user.isOwner || hasCapability(user, "/documents", "edit") || hasCapability(user, "/compliance", "edit"))
  );

  const canAccessBilling = Boolean(
    user && (user.isOwner || hasCapability(user, "/payroll/billing", "view"))
  );

  const loadAll = useCallback(async () => {
    if (!token || !clientId) return;
    setError("");
    try {
      const [clientData, contactsData, partiesData, contractsData, complianceData] =
        await Promise.all([
          getClient(token, clientId),
          getClientContacts(token, clientId).catch(() => [] as ClientContact[]),
          getClientRelatedParties(token, clientId).catch(() => [] as ClientRelatedParty[]),
          getClientContracts(token, clientId).catch(() => [] as ClientContract[]),
          getClientCompliance(token, clientId).catch(() => null),
        ]);

      setClient(clientData);
      setContacts(contactsData);
      setRelatedParties(partiesData);
      setContracts(contractsData);
      setCompliance(complianceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client workspace");
    }
  }, [token, clientId]);

  useEffect(() => {
    setLoading(true);
    void loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const handleSaveClientMaster = async (payload: any) => {
    if (!token || !clientId) return;
    await updateClient(token, clientId, payload);
    await loadAll();
  };

  const handleNavigateToDocuments = (contractId?: string) => {
    setSelectedContractFilterId(contractId);
    setTab("documents");
  };

  if (loading) {
    return (
      <main className="animate-fade-in space-y-4 pb-16">
        <div className="h-44 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-800" />
      </main>
    );
  }

  if (!client) {
    return (
      <main className="animate-fade-in space-y-4 pb-16">
        <Link href="/clients" className="text-sm text-security-navy-700 hover:underline">
          ← Back to clients
        </Link>
        <AlertBanner variant="error">{error || "Client record not found"}</AlertBanner>
      </main>
    );
  }

  const attentionCount = compliance?.summary.attention || 0;
  const missingCount = compliance?.summary.missing || 0;

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Breadcrumb & Master Header */}
      <header className="space-y-2">
        <Link
          href="/clients"
          className="text-xs font-medium text-security-navy-600 hover:underline dark:text-security-navy-400"
        >
          ← Back to Clients Directory
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-security-navy-900 dark:text-security-navy-100">
                {client.name}
              </h1>
              {client.tradingName && client.tradingName !== client.name && (
                <span className="text-sm text-security-navy-500">t/a {client.tradingName}</span>
              )}
              <span className="rounded-full bg-security-navy-100 px-2.5 py-0.5 text-xs font-semibold text-security-navy-800 dark:bg-security-navy-800 dark:text-security-navy-200">
                {client.entityType ? client.entityType.replace(/_/g, " ") : "Entity"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  client.isActive
                    ? "bg-security-emerald-100 text-security-emerald-800 dark:bg-security-emerald-950/60 dark:text-security-emerald-300"
                    : "bg-security-navy-100 text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-400"
                }`}
              >
                {client.isActive ? "Active" : "Inactive"}
              </span>
            </div>

            <p className="mt-1 text-xs text-security-navy-500">
              Registration: {client.registrationNumber || "Unregistered"} · {client.sites.length} operational site(s) · {contracts.length} contract agreement(s)
            </p>
          </div>

          {/* Finance-controlled Client Billing Link */}
          {canAccessBilling && (
            <Link
              href={`/payroll/billing/clients/${client.id}`}
              className="btn-secondary flex items-center gap-1.5 text-xs text-security-emerald-800 dark:text-security-emerald-300"
            >
              <span>💳</span> Client Billing & Rates
            </Link>
          )}
        </div>
      </header>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {notice && <AlertBanner variant="success">{notice}</AlertBanner>}

      {/* 8-Tab Navigation Bar */}
      <nav
        className="flex overflow-x-auto border-b border-security-navy-200 dark:border-security-navy-700"
        aria-label="Client Workspace Sections"
      >
        <div className="flex gap-1 min-w-max">
          {TABS.map((item) => {
            const isActiveTab = tab === item.id;
            const hasAttention =
              item.id === "documents" && (attentionCount > 0 || missingCount > 0);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setError("");
                  setNotice("");
                }}
                className={`relative flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  isActiveTab
                    ? "border-security-navy-900 text-security-navy-900 dark:border-security-amber-400 dark:text-security-amber-400"
                    : "border-transparent text-security-navy-500 hover:border-security-navy-300 hover:text-security-navy-800 dark:hover:text-security-navy-200"
                }`}
                aria-current={isActiveTab ? "page" : undefined}
              >
                {item.label}
                {hasAttention && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-security-amber-500 px-1 text-[10px] font-bold text-white">
                    {attentionCount + missingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Tab Panels */}
      {tab === "overview" && (
        <ClientOverviewTab
          client={client}
          compliance={compliance}
          contacts={contacts}
          contracts={contracts}
          user={user}
          onTabChange={(t) => setTab(t)}
        />
      )}

      {tab === "legal" && (
        <ClientLegalTab
          client={client}
          canEdit={canEdit}
          token={token ?? ""}
          onSaveClient={handleSaveClientMaster}
          relatedParties={relatedParties}
          onRefreshRelatedParties={async () => {
            if (!token) return;
            const res = await getClientRelatedParties(token, client.id);
            setRelatedParties(res);
          }}
          onError={setError}
          onSuccess={setNotice}
        />
      )}

      {tab === "contacts" && (
        <ClientContactsTab
          client={client}
          contacts={contacts}
          canEdit={canEdit}
          token={token ?? ""}
          onRefreshContacts={async () => {
            if (!token) return;
            const res = await getClientContacts(token, client.id);
            setContacts(res);
          }}
          onError={setError}
          onSuccess={setNotice}
        />
      )}

      {tab === "contracts" && (
        <ClientContractsTab
          client={client}
          contracts={contracts}
          canEdit={canEdit}
          token={token ?? ""}
          onRefreshContracts={async () => {
            if (!token) return;
            const res = await getClientContracts(token, client.id);
            setContracts(res);
          }}
          onNavigateToDocuments={handleNavigateToDocuments}
          onError={setError}
          onSuccess={setNotice}
        />
      )}

      {tab === "sites" && (
        <SitesTab
          client={client}
          canEdit={canEdit}
          token={token ?? ""}
          onChanged={loadAll}
          onError={setError}
        />
      )}

      {tab === "documents" && (
        <ClientDocumentsTab
          client={client}
          compliance={compliance}
          contracts={contracts}
          initialContractFilterId={selectedContractFilterId}
          canEdit={canEdit}
          canVerify={canVerifyDocuments}
          token={token ?? ""}
          onRefreshCompliance={async () => {
            if (!token) return;
            const res = await getClientCompliance(token, client.id);
            setCompliance(res);
          }}
          onError={setError}
          onSuccess={setNotice}
        />
      )}

      {tab === "privacy" && (
        <ClientPrivacyTab
          client={client}
          contacts={contacts}
          canEdit={canEdit}
          token={token ?? ""}
          onError={setError}
          onSuccess={setNotice}
        />
      )}

      {tab === "month-end" && (
        <ClientMonthEndTab clientId={client.id} token={token ?? ""} />
      )}
    </main>
  );
}

/** Operational Sites Tab: manages linking/detaching sites to this client */
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
      <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
        <table className="min-w-full divide-y divide-security-navy-100 text-xs dark:divide-security-navy-700">
          <thead className="bg-security-navy-50 dark:bg-security-navy-900">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-security-navy-500">
              <th className="px-4 py-2.5">Site Name</th>
              <th className="px-4 py-2.5">Deployment Address</th>
              <th className="px-4 py-2.5">Operational Service</th>
              <th className="px-4 py-2.5">Legacy Contract Period</th>
              <th className="px-4 py-2.5">Status</th>
              {canEdit && <th className="px-4 py-2.5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
            {client.sites.map((site) => (
              <tr key={site.id} className="hover:bg-security-navy-50/50 dark:hover:bg-security-navy-800/40">
                <td className="px-4 py-3">
                  <Link
                    href={`/sites/${site.id}`}
                    className="font-medium text-security-navy-900 hover:text-security-amber-600 hover:underline dark:text-security-navy-100"
                  >
                    {site.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-security-navy-600 dark:text-security-navy-400">
                  {site.physicalAddress || "—"}
                </td>
                <td className="px-4 py-3 text-security-navy-600 dark:text-security-navy-400">
                  {site.serviceType || "—"}
                </td>
                <td className="px-4 py-3 font-mono text-security-navy-600 dark:text-security-navy-400">
                  {site.contractStartDate ? String(site.contractStartDate).slice(0, 10) : "—"}
                  {site.contractEndDate ? ` → ${String(site.contractEndDate).slice(0, 10)}` : ""}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-security-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-security-emerald-800 dark:bg-security-emerald-950/60 dark:text-security-emerald-300">
                    {site.siteStatus}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="btn-secondary py-1 text-xs"
                      onClick={() => unlink(site.id)}
                      disabled={busy}
                    >
                      Detach
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {client.sites.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-xs text-security-navy-500">
                  No operational sites linked yet. Attach sites below to include their posts and attendance in month-end packs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="card-dashboard space-y-3 p-4 text-xs">
          <h2 className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">
            Attach Operational Sites
          </h2>
          {unlinked.length === 0 ? (
            <p className="text-security-navy-500">
              All company sites are currently attached to clients.
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {unlinked.map((site) => (
                  <label key={site.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(site.id)}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked ? [...current, site.id] : current.filter((id) => id !== site.id)
                        )
                      }
                    />
                    <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                      {site.name}
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={link}
                disabled={busy || selected.length === 0}
              >
                {busy ? "Linking..." : `Attach ${selected.length || ""} Site(s)`.trim()}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
