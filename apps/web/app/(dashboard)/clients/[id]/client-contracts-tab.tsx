"use client";

import { useState } from "react";
import {
  createClientContract,
  updateClientContract,
  linkContractSites,
  unlinkContractSite,
  type ClientContract,
  type ClientContractStatus,
  type ClientDetail,
  type ContractRenewalType,
} from "@/lib/msr-api";

const CONTRACT_STATUS_CONFIG: Record<
  ClientContractStatus,
  { label: string; badgeClass: string }
> = {
  DRAFT: {
    label: "Draft",
    badgeClass: "bg-security-navy-100 text-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-300",
  },
  PENDING_SIGNATURE: {
    label: "Pending Signature",
    badgeClass: "bg-security-amber-100 text-security-amber-800 dark:bg-security-amber-900/40 dark:text-security-amber-300",
  },
  ACTIVE: {
    label: "Active",
    badgeClass: "bg-security-emerald-100 text-security-emerald-800 dark:bg-security-emerald-900/40 dark:text-security-emerald-300",
  },
  UNDER_REVIEW: {
    label: "Under Review",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  EXPIRED: {
    label: "Expired",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  TERMINATED: {
    label: "Terminated",
    badgeClass: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  },
  DISPUTED: {
    label: "Disputed",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  },
};

const RENEWAL_TYPE_LABELS: Record<ContractRenewalType, string> = {
  MANUAL: "Manual Extension",
  EVERGREEN: "Evergreen (Indefinite)",
  FIXED_TERM: "Fixed Term",
  MONTH_TO_MONTH: "Month-to-Month",
};

interface ClientContractsTabProps {
  client: ClientDetail;
  contracts: ClientContract[];
  canEdit: boolean;
  token: string;
  onRefreshContracts: () => Promise<void>;
  onNavigateToDocuments: (contractId?: string) => void;
  onError: (err: string) => void;
  onSuccess: (msg: string) => void;
}

export function ClientContractsTab({
  client,
  contracts,
  canEdit,
  token,
  onRefreshContracts,
  onNavigateToDocuments,
  onError,
  onSuccess,
}: ClientContractsTabProps) {
  // Add / Edit Contract modal
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [contractNumber, setContractNumber] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ClientContractStatus>("ACTIVE");
  const [signedDate, setSignedDate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [noticePeriodDays, setNoticePeriodDays] = useState("30");
  const [renewalType, setRenewalType] = useState<ContractRenewalType>("FIXED_TERM");
  const [autoRenew, setAutoRenew] = useState(false);
  const [scopeSummary, setScopeSummary] = useState("");
  const [serviceTypesInput, setServiceTypesInput] = useState("Physical Guarding, Access Control");
  const [notes, setNotes] = useState("");
  const [savingContract, setSavingContract] = useState(false);

  // Manage Covered Sites modal
  const [activeSiteContract, setActiveSiteContract] = useState<ClientContract | null>(null);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [savingSites, setSavingSites] = useState(false);

  const openAddContract = () => {
    setEditingContractId(null);
    setContractNumber(`CON-${new Date().getFullYear()}-${String(contracts.length + 1).padStart(3, "0")}`);
    setTitle("Master Security Services Agreement");
    setStatus("ACTIVE");
    setSignedDate(new Date().toISOString().slice(0, 10));
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setEffectiveTo("");
    setNoticePeriodDays("30");
    setRenewalType("FIXED_TERM");
    setAutoRenew(false);
    setScopeSummary("");
    setServiceTypesInput("Physical Guarding, Access Control");
    setNotes("");
    setShowContractModal(true);
  };

  const openEditContract = (c: ClientContract) => {
    setEditingContractId(c.id);
    setContractNumber(c.contractNumber);
    setTitle(c.title);
    setStatus(c.status);
    setSignedDate(c.signedDate ? String(c.signedDate).slice(0, 10) : "");
    setEffectiveFrom(c.effectiveFrom ? String(c.effectiveFrom).slice(0, 10) : "");
    setEffectiveTo(c.effectiveTo ? String(c.effectiveTo).slice(0, 10) : "");
    setNoticePeriodDays(c.noticePeriodDays !== null && c.noticePeriodDays !== undefined ? String(c.noticePeriodDays) : "30");
    setRenewalType(c.renewalType);
    setAutoRenew(c.autoRenew);
    setScopeSummary(c.scopeSummary || "");
    setServiceTypesInput(c.serviceTypes.join(", "));
    setNotes(c.notes || "");
    setShowContractModal(true);
  };

  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !contractNumber.trim() || !title.trim()) return;
    setSavingContract(true);
    try {
      const serviceTypes = serviceTypesInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        contractNumber: contractNumber.trim(),
        title: title.trim(),
        status,
        signedDate: signedDate || null,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        noticePeriodDays: noticePeriodDays.trim() ? Number(noticePeriodDays) : null,
        renewalType,
        autoRenew,
        scopeSummary: scopeSummary.trim() || null,
        serviceTypes,
        notes: notes.trim() || null,
      };

      if (editingContractId) {
        await updateClientContract(token, client.id, editingContractId, payload);
        onSuccess("Contract updated.");
      } else {
        await createClientContract(token, client.id, payload);
        onSuccess("Contract established.");
      }

      setShowContractModal(false);
      await onRefreshContracts();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save contract");
    } finally {
      setSavingContract(false);
    }
  };

  const openManageSites = (contract: ClientContract) => {
    setActiveSiteContract(contract);
    const coveredIds = (contract.contractSites || []).map((cs) => cs.siteId);
    setSelectedSiteIds(coveredIds);
  };

  const handleSaveCoveredSites = async () => {
    if (!token || !activeSiteContract) return;
    setSavingSites(true);
    try {
      const currentCoveredIds = (activeSiteContract.contractSites || []).map((cs) => cs.siteId);
      const toLink = selectedSiteIds.filter((id) => !currentCoveredIds.includes(id));
      const toUnlink = currentCoveredIds.filter((id) => !selectedSiteIds.includes(id));

      if (toLink.length > 0) {
        await linkContractSites(token, client.id, activeSiteContract.id, toLink);
      }
      for (const unlinkId of toUnlink) {
        await unlinkContractSite(token, client.id, activeSiteContract.id, unlinkId);
      }

      onSuccess("Covered sites updated for agreement.");
      setActiveSiteContract(null);
      await onRefreshContracts();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update covered sites");
    } finally {
      setSavingSites(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
            Commercial & Service Contracts
          </h2>
          <p className="text-xs text-security-navy-500">
            Authoritative agreements governing scope, term, and operational coverage for this client.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={openAddContract} className="btn-primary text-xs">
            + Register Agreement
          </button>
        )}
      </div>

      {contracts.length === 0 ? (
        <div className="card-dashboard p-8 text-center text-xs text-security-navy-500">
          No commercial agreements registered for this client.
          {canEdit && (
            <div className="mt-3">
              <button type="button" onClick={openAddContract} className="btn-secondary text-xs">
                Register master service agreement
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {contracts.map((contract) => {
            const statusCfg = CONTRACT_STATUS_CONFIG[contract.status] || CONTRACT_STATUS_CONFIG.DRAFT;
            const coveredSites = contract.contractSites || [];
            const isExpiringSoon = (() => {
              if (!contract.effectiveTo || contract.status !== "ACTIVE") return false;
              const diffDays = (new Date(contract.effectiveTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
              return diffDays >= 0 && diffDays <= 60;
            })();

            return (
              <div
                key={contract.id}
                className="card-dashboard space-y-4 p-5 transition-shadow hover:shadow-security-elevated"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-security-navy-500">
                        {contract.contractNumber}
                      </span>
                      <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                        {contract.title}
                      </h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusCfg.badgeClass}`}>
                        {statusCfg.label}
                      </span>
                      {isExpiringSoon && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 animate-pulse">
                          Expiring Soon
                        </span>
                      )}
                    </div>
                    {contract.scopeSummary && (
                      <p className="mt-1 text-xs text-security-navy-600 dark:text-security-navy-400">
                        {contract.scopeSummary}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openManageSites(contract)}
                      className="btn-secondary py-1 text-xs"
                    >
                      Covered Sites ({coveredSites.length})
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEditContract(contract)}
                        className="btn-secondary py-1 text-xs"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onNavigateToDocuments(contract.id)}
                      className="text-xs text-security-amber-600 hover:underline"
                    >
                      Attached Documents →
                    </button>
                  </div>
                </div>

                {/* Contract Meta Grid */}
                <div className="grid gap-3 sm:grid-cols-4 text-xs">
                  <div>
                    <span className="text-security-navy-500 block">Effective Term</span>
                    <span className="font-mono font-medium text-security-navy-800 dark:text-security-navy-200">
                      {contract.effectiveFrom ? new Date(contract.effectiveFrom).toLocaleDateString() : "—"}
                      {" → "}
                      {contract.effectiveTo ? new Date(contract.effectiveTo).toLocaleDateString() : "Indefinite"}
                    </span>
                  </div>

                  <div>
                    <span className="text-security-navy-500 block">Renewal Framework</span>
                    <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                      {RENEWAL_TYPE_LABELS[contract.renewalType]}
                      {contract.autoRenew ? " (Auto-renews)" : ""}
                    </span>
                  </div>

                  <div>
                    <span className="text-security-navy-500 block">Termination Notice</span>
                    <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                      {contract.noticePeriodDays ?? 30} Days Written Notice
                    </span>
                  </div>

                  <div>
                    <span className="text-security-navy-500 block">Signed Date</span>
                    <span className="font-mono text-security-navy-800 dark:text-security-navy-200">
                      {contract.signedDate ? new Date(contract.signedDate).toLocaleDateString() : "Pending Execution"}
                    </span>
                  </div>
                </div>

                {/* Service Types Tags */}
                {contract.serviceTypes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] font-medium text-security-navy-500 mr-1">Services:</span>
                    {contract.serviceTypes.map((svc) => (
                      <span
                        key={svc}
                        className="rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-medium text-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-300"
                      >
                        {svc}
                      </span>
                    ))}
                  </div>
                )}

                {/* Covered Sites Pills */}
                <div className="border-t border-security-navy-100 pt-3 text-xs dark:border-security-navy-800">
                  <span className="text-security-navy-500 font-medium mr-2">Operational Sites Covered:</span>
                  {coveredSites.length === 0 ? (
                    <span className="italic text-security-navy-400">
                      No sites explicitly linked to this agreement.
                    </span>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {coveredSites.map((cs) => (
                        <span
                          key={cs.id}
                          className="rounded-security bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                        >
                          📍 {cs.site.name} ({cs.site.siteStatus})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Contract Modal */}
      {showContractModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                {editingContractId ? "Edit Commercial Contract" : "Register Service Agreement"}
              </h3>
              <button
                type="button"
                onClick={() => setShowContractModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 dark:hover:text-security-navy-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveContract} className="mt-4 space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">Contract Number / Reference *</label>
                  <input
                    className="input-modern w-full font-mono"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Contract Title *</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Master Security & Guarding Agreement"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label-text mb-1 block">Status</label>
                  <select
                    className="input-modern w-full"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ClientContractStatus)}
                  >
                    {Object.entries(CONTRACT_STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Effective From</label>
                  <input
                    type="date"
                    className="input-modern w-full"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Effective To (blank = indefinite)</label>
                  <input
                    type="date"
                    className="input-modern w-full"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label-text mb-1 block">Signed Date</label>
                  <input
                    type="date"
                    className="input-modern w-full"
                    value={signedDate}
                    onChange={(e) => setSignedDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Notice Period (Days)</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    className="input-modern w-full"
                    value={noticePeriodDays}
                    onChange={(e) => setNoticePeriodDays(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Renewal Framework</label>
                  <select
                    className="input-modern w-full"
                    value={renewalType}
                    onChange={(e) => setRenewalType(e.target.value as ContractRenewalType)}
                  >
                    {Object.entries(RENEWAL_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-security-navy-800 dark:text-security-navy-200">
                  <input
                    type="checkbox"
                    checked={autoRenew}
                    onChange={(e) => setAutoRenew(e.target.checked)}
                  />
                  Agreement auto-renews automatically unless terminated in writing
                </label>
              </div>

              <div>
                <label className="label-text mb-1 block">Service Types (comma-separated)</label>
                <input
                  className="input-modern w-full"
                  placeholder="Physical Guarding, Armed Response, CCTV Monitoring, Access Control"
                  value={serviceTypesInput}
                  onChange={(e) => setServiceTypesInput(e.target.value)}
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Scope Summary</label>
                <textarea
                  rows={2}
                  className="input-modern w-full"
                  placeholder="Summary of agreed operational duties, guard grades, SLAs..."
                  value={scopeSummary}
                  onChange={(e) => setScopeSummary(e.target.value)}
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Confidential Governance Notes</label>
                <textarea
                  rows={2}
                  className="input-modern w-full"
                  placeholder="Escalation mechanisms, special covenants..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowContractModal(false)}
                  disabled={savingContract}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingContract || !contractNumber.trim() || !title.trim()}
                >
                  {savingContract ? "Saving..." : "Save Agreement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Covered Sites Modal */}
      {activeSiteContract && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <div>
                <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                  Manage Covered Sites
                </h3>
                <p className="text-xs text-security-navy-500">
                  Agreement: {activeSiteContract.contractNumber} ({activeSiteContract.title})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSiteContract(null)}
                className="text-security-navy-400 hover:text-security-navy-600 dark:hover:text-security-navy-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <p className="text-security-navy-600 dark:text-security-navy-300">
                Select which of this client&apos;s operational sites are governed under this agreement:
              </p>

              {client.sites.length === 0 ? (
                <p className="rounded-security border border-dashed border-security-navy-200 p-4 text-center text-security-navy-500">
                  No sites currently linked to this client. Attach sites on the Sites tab first.
                </p>
              ) : (
                <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-security border border-security-navy-100 p-2 dark:border-security-navy-800">
                  {client.sites.map((site) => (
                    <label
                      key={site.id}
                      className="flex items-center gap-2 rounded p-1.5 hover:bg-security-navy-50 dark:hover:bg-security-navy-800/60"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSiteIds.includes(site.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSiteIds([...selectedSiteIds, site.id]);
                          } else {
                            setSelectedSiteIds(selectedSiteIds.filter((id) => id !== site.id));
                          }
                        }}
                      />
                      <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                        {site.name}
                      </span>
                      <span className="text-[11px] text-security-navy-500">({site.siteStatus})</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActiveSiteContract(null)}
                  disabled={savingSites}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCoveredSites}
                  disabled={savingSites || client.sites.length === 0}
                >
                  {savingSites ? "Saving..." : `Update Covered Sites (${selectedSiteIds.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
