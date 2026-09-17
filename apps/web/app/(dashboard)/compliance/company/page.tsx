"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  fetchObligations,
  createObligation,
  markObligationCompliant,
  managementOverrideObligation,
  deleteObligation,
  type ComplianceObligation,
  type ComplianceObligationType,
  type ComplianceRiskLevel,
} from "@/lib/compliance-api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonBlock,
} from "@/components/ui";

const OBLIGATION_TYPES = [
  { value: "PSIRA_COMPANY", label: "PSiRA Company Registration" },
  { value: "DIRECTOR_VETTING", label: "Director & Management Vetting" },
  { value: "EMPLOYEE_PSIRA", label: "Guard PSiRA Batch Verification" },
  { value: "NBCPSS", label: "NBCPSS Main Collective Agreement" },
  { value: "SARS_TAX_CLEARANCE", label: "SARS Tax Clearance (TCS / PIN)" },
  { value: "COIDA", label: "COIDA Letter of Good Standing" },
  { value: "UIF", label: "UIF Compliance / Declaration (uFiling)" },
  { value: "PSSPF", label: "PSSPF Clearance / Good Standing" },
  { value: "PUBLIC_LIABILITY", label: "Public Liability Insurance" },
  { value: "POPIA", label: "POPIA Operator & Manual Compliance" },
  { value: "OTHER", label: "Other Obligation" },
];

export default function ObligationsRegisterPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/compliance/company", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/compliance/company", "edit"));
  const canApprove = Boolean(user && hasCapability(user, "/compliance/company", "approve"));

  const [items, setItems] = useState<ComplianceObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [overrideModalId, setOverrideModalId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideStatus, setOverrideStatus] = useState("COMPLIANT");

  // Form state
  const [formData, setFormData] = useState({
    type: "PSIRA_COMPANY" as ComplianceObligationType,
    title: "",
    authority: "",
    referenceNumber: "",
    riskLevel: "MEDIUM" as ComplianceRiskLevel,
    expiryDate: "",
    expectedAmount: "",
    notes: "",
  });

  const loadItems = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const res = await fetchObligations(token, {
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        search: search || undefined,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load obligations");
    } finally {
      setLoading(false);
    }
  }, [token, typeFilter, statusFilter, search]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createObligation(token, {
        type: formData.type,
        title: formData.title || OBLIGATION_TYPES.find((t) => t.value === formData.type)?.label || "Obligation",
        authority: formData.authority || undefined,
        referenceNumber: formData.referenceNumber || undefined,
        riskLevel: formData.riskLevel,
        expiryDate: formData.expiryDate ? new Date(formData.expiryDate).toISOString() : undefined,
        expectedAmount: formData.expectedAmount ? parseFloat(formData.expectedAmount) : undefined,
        notes: formData.notes || undefined,
      });
      setShowCreateModal(false);
      setFormData({
        type: "PSIRA_COMPANY",
        title: "",
        authority: "",
        referenceNumber: "",
        riskLevel: "MEDIUM",
        expiryDate: "",
        expectedAmount: "",
        notes: "",
      });
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create obligation");
    }
  };

  const handleMarkCompliant = async (id: string) => {
    if (!token) return;
    try {
      await markObligationCompliant(token, id, {});
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify obligation");
    }
  };

  const handleOverride = async () => {
    if (!token || !overrideModalId || !overrideReason) return;
    try {
      await managementOverrideObligation(token, overrideModalId, overrideStatus, overrideReason);
      setOverrideModalId(null);
      setOverrideReason("");
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Management override failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!token || !confirm("Are you sure you want to delete this compliance obligation?")) return;
    try {
      await deleteObligation(token, id);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete obligation");
    }
  };

  const getStatusBadgeVariant = (status: string): "neutral" | "success" | "warning" | "error" => {
    switch (status) {
      case "COMPLIANT":
        return "success";
      case "ATTENTION_REQUIRED":
        return "warning";
      case "NON_COMPLIANT":
        return "error";
      default:
        return "neutral";
    }
  };

  const getRiskBadgeVariant = (risk: string): "neutral" | "success" | "warning" | "error" => {
    switch (risk) {
      case "CRITICAL":
        return "error";
      case "HIGH":
        return "warning";
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Compliance & Obligation Register"
        description="Central record of PSiRA licensing, SARS Tax Clearance, COIDA good standing, NBCPSS levy compliance, and insurance."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              + Add Obligation
            </Button>
          ) : undefined
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <input
              type="text"
              placeholder="Search title, authority, ref #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-modern w-full"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-modern w-full"
          >
            <option value="">All Obligation Types</option>
            {OBLIGATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-modern w-full"
          >
            <option value="">All Statuses</option>
            <option value="COMPLIANT">Compliant</option>
            <option value="ATTENTION_REQUIRED">Attention Required</option>
            <option value="NON_COMPLIANT">Non-Compliant</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
          </select>
        </div>
      </Card>

      {/* Obligations Table */}
      {loading ? (
        <SkeletonBlock className="h-64" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No compliance obligations found"
          description="Capture PSiRA licenses, SARS certificates, and insurance policies to begin monitoring compliance health."
          action={
            canCreate ? (
              <Button size="sm" onClick={() => setShowCreateModal(true)}>
                Add First Obligation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden border border-security-navy-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                <tr>
                  <th className="px-4 py-3">Obligation</th>
                  <th className="px-4 py-3">Authority / Ref</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk Level</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {items.map((ob) => (
                  <tr key={ob.id} className="hover:bg-security-navy-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-security-navy-900">{ob.title}</div>
                      <div className="text-xs text-security-navy-500">{ob.type}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{ob.authority || "—"}</div>
                      {ob.referenceNumber && (
                        <div className="text-[11px] font-mono text-security-navy-500">
                          {ob.referenceNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusBadgeVariant(ob.status)}>
                        {ob.status.replace("_", " ")}
                      </Badge>
                      {ob.managementOverrideReason && (
                        <div className="text-[10px] text-amber-600 mt-1 italic">
                          Override applied
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getRiskBadgeVariant(ob.riskLevel)}>
                        {ob.riskLevel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {ob.expiryDate ? (
                        <span
                          className={
                            new Date(ob.expiryDate) < new Date()
                              ? "text-red-600 font-semibold"
                              : ""
                          }
                        >
                          {ob.expiryDate.slice(0, 10)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {canApprove && ob.status !== "COMPLIANT" && (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-emerald-700 hover:text-emerald-800"
                          onClick={() => handleMarkCompliant(ob.id)}
                        >
                          Verify
                        </button>
                      )}
                      {canApprove && (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-amber-700 hover:text-amber-800"
                          onClick={() => setOverrideModalId(ob.id)}
                        >
                          Override
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          className="btn-ghost text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleDelete(ob.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Add Compliance Obligation</h2>
            <form onSubmit={handleCreate} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Obligation Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const type = e.target.value as ComplianceObligationType;
                    const defaultTitle = OBLIGATION_TYPES.find((t) => t.value === type)?.label || "";
                    setFormData({ ...formData, type, title: defaultTitle });
                  }}
                  className="input-modern w-full"
                >
                  {OBLIGATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label-text mb-1 block">Title *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input-modern w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Issuing Authority</label>
                  <input
                    type="text"
                    placeholder="e.g. PSiRA / SARS / NBCPSS"
                    value={formData.authority}
                    onChange={(e) => setFormData({ ...formData, authority: e.target.value })}
                    className="input-modern w-full"
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Reference / License #</label>
                  <input
                    type="text"
                    value={formData.referenceNumber}
                    onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
                    className="input-modern w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Risk Level</label>
                  <select
                    value={formData.riskLevel}
                    onChange={(e) => setFormData({ ...formData, riskLevel: e.target.value as ComplianceRiskLevel })}
                    className="input-modern w-full"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="input-modern w-full"
                  />
                </div>
              </div>

              <div>
                <label className="label-text mb-1 block">Notes</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <Button variant="secondary" size="sm" type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Save Obligation
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Override Modal */}
      {overrideModalId && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Management Compliance Override</h2>
            <p className="text-xs text-security-navy-500">
              Manually setting an obligation status requires an audited management explanation.
            </p>
            <div className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Target Status</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="input-modern w-full"
                >
                  <option value="COMPLIANT">Compliant</option>
                  <option value="ATTENTION_REQUIRED">Attention Required</option>
                  <option value="NON_COMPLIANT">Non-Compliant</option>
                  <option value="NOT_APPLICABLE">Not Applicable</option>
                </select>
              </div>

              <div>
                <label className="label-text mb-1 block">Audited Reason *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="State the formal governance reason and authority reference..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setOverrideModalId(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={overrideReason.trim().length < 5}
                  onClick={handleOverride}
                >
                  Apply Override
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
