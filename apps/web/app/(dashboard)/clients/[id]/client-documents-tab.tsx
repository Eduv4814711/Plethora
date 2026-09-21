"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listDocuments,
  uploadDocument,
  verifyDocument,
  rejectDocument,
  type ClientContract,
  type ClientComplianceEvaluation,
  type ClientDetail,
  type ManagedDocument,
} from "@/lib/msr-api";

const CLIENT_DOCUMENT_CATEGORIES: { id: string; label: string }[] = [
  { id: "ALL", label: "All Documents" },
  { id: "CLIENT_LEGAL", label: "Legal & Formation" },
  { id: "CLIENT_IDENTITY", label: "Identity & Proof of Address" },
  { id: "CLIENT_AUTHORITY", label: "Authority & Resolutions" },
  { id: "CLIENT_CONTRACT", label: "Commercial Contracts" },
  { id: "CLIENT_PRIVACY", label: "POPIA & Privacy" },
  { id: "CLIENT_PROCUREMENT", label: "Tax & Procurement" },
  { id: "CLIENT_OTHER", label: "Other Records" },
];

const DOCUMENT_TYPE_OPTIONS: { category: string; type: string; label: string }[] = [
  { category: "CLIENT_LEGAL", type: "CIPC_REGISTRATION", label: "CIPC Certificate / COR14.3" },
  { category: "CLIENT_LEGAL", type: "FOUNDING_STATEMENT", label: "Founding Statement (CK1/CK2)" },
  { category: "CLIENT_LEGAL", type: "TRUST_DEED", label: "Trust Deed / Letters of Authority" },
  { category: "CLIENT_IDENTITY", type: "PROOF_OF_BUSINESS_ADDRESS", label: "Proof of Business Address" },
  { category: "CLIENT_IDENTITY", type: "BENEFICIAL_OWNERSHIP_REGISTER", label: "Beneficial Ownership Register" },
  { category: "CLIENT_IDENTITY", type: "DIRECTOR_IDENTITY_DOCUMENT", label: "Director / Member ID Copy" },
  { category: "CLIENT_AUTHORITY", type: "AUTHORISED_SIGNATORY_RESOLUTION", label: "Board Resolution / Signatory Mandate" },
  { category: "CLIENT_AUTHORITY", type: "POWER_OF_ATTORNEY", label: "Power of Attorney" },
  { category: "CLIENT_CONTRACT", type: "SERVICE_CONTRACT", label: "Master Service Agreement" },
  { category: "CLIENT_CONTRACT", type: "SERVICE_LEVEL_AGREEMENT", label: "Service Level Agreement (SLA)" },
  { category: "CLIENT_CONTRACT", type: "CONTRACT_AMENDMENT", label: "Contract Addendum / Scope Amendment" },
  { category: "CLIENT_PRIVACY", type: "POPIA_OPERATOR_AGREEMENT", label: "POPIA Section 21 Operator Agreement" },
  { category: "CLIENT_PRIVACY", type: "DATA_PROCESSING_AGREEMENT", label: "Data Processing Agreement" },
  { category: "CLIENT_PRIVACY", type: "PRIVACY_NOTICE_ACKNOWLEDGEMENT", label: "Privacy Notice Acknowledgment" },
  { category: "CLIENT_PROCUREMENT", type: "TAX_CLEARANCE_PIN", label: "SARS Tax Compliance Status PIN" },
  { category: "CLIENT_PROCUREMENT", type: "BBBEE_CERTIFICATE", label: "B-BBEE Certificate / Affidavit" },
  { category: "CLIENT_OTHER", type: "CLIENT_CORRESPONDENCE", label: "Official Client Correspondence" },
];

interface ClientDocumentsTabProps {
  client: ClientDetail;
  compliance: ClientComplianceEvaluation | null;
  contracts: ClientContract[];
  initialContractFilterId?: string;
  canEdit: boolean;
  canVerify: boolean;
  token: string;
  onRefreshCompliance: () => Promise<void>;
  onError: (err: string) => void;
  onSuccess: (msg: string) => void;
}

export function ClientDocumentsTab({
  client,
  compliance,
  contracts,
  initialContractFilterId,
  canEdit,
  canVerify,
  token,
  onRefreshCompliance,
  onError,
  onSuccess,
}: ClientDocumentsTabProps) {
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedContractId, setSelectedContractId] = useState<string>(initialContractFilterId || "ALL");

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docCategory, setDocCategory] = useState("CLIENT_LEGAL");
  const [docType, setDocType] = useState("CIPC_REGISTRATION");
  const [linkedContractId, setLinkedContractId] = useState("");
  const [isSensitive, setIsSensitive] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);

  // Reject modal
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params: Record<string, string | undefined> = { clientId: client.id };
      if (selectedCategory !== "ALL") params.category = selectedCategory;
      if (selectedContractId !== "ALL") params.clientContractId = selectedContractId;
      const res = await listDocuments(token, params);
      setDocuments(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load client documents");
    } finally {
      setLoading(false);
    }
  }, [token, client.id, selectedCategory, selectedContractId, onError]);

  useEffect(() => {
    void fetchDocs();
  }, [fetchDocs]);

  const handleCategoryChange = (cat: string) => {
    setDocCategory(cat);
    const valid = DOCUMENT_TYPE_OPTIONS.filter((o) => o.category === cat);
    if (valid.length > 0) {
      setDocType(valid[0].type);
    }
    // Auto-suggest sensitivity for beneficial ownership or director ID
    if (cat === "CLIENT_IDENTITY") {
      setIsSensitive(true);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !file || !docTitle.trim()) return;
    setUploading(true);
    try {
      await uploadDocument(token, file, {
        title: docTitle.trim(),
        category: docCategory,
        documentType: docType,
        clientId: client.id,
        ...(linkedContractId ? { clientContractId: linkedContractId } : {}),
        isSensitive,
        ...(expiryDate ? { expiryDate } : {}),
      });

      setShowUploadModal(false);
      setFile(null);
      setDocTitle("");
      setExpiryDate("");
      setLinkedContractId("");
      setIsSensitive(false);
      onSuccess("Document uploaded successfully.");

      await Promise.all([fetchDocs(), onRefreshCompliance()]);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Document upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleVerify = async (docId: string) => {
    if (!token) return;
    try {
      await verifyDocument(token, docId);
      onSuccess("Document verified.");
      await Promise.all([fetchDocs(), onRefreshCompliance()]);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to verify document");
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !rejectingDocId || !rejectionReason.trim()) return;
    setRejecting(true);
    try {
      await rejectDocument(token, rejectingDocId, rejectionReason.trim());
      onSuccess("Document rejected.");
      setRejectingDocId(null);
      setRejectionReason("");
      await Promise.all([fetchDocs(), onRefreshCompliance()]);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to reject document");
    } finally {
      setRejecting(false);
    }
  };

  const filteredTypeOptions = DOCUMENT_TYPE_OPTIONS.filter((o) => o.category === docCategory);

  return (
    <div className="space-y-8">
      {/* Real-time Compliance Evaluation Engine Card */}
      {compliance && (
        <div className="card-dashboard space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                  Compliance & Governance Readiness Evaluation
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    compliance.overallStatus === "COMPLETE"
                      ? "bg-security-emerald-100 text-security-emerald-800 dark:bg-security-emerald-950/60 dark:text-security-emerald-300"
                      : compliance.overallStatus === "ATTENTION"
                      ? "bg-security-amber-100 text-security-amber-800 dark:bg-security-amber-900/40 dark:text-security-amber-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  }`}
                >
                  {compliance.overallStatus}
                </span>
              </div>
              <p className="text-xs text-security-navy-500">
                Automated evaluation across statutory company law, commercial contracts, representation mandates, and POPIA privacy regulations.
              </p>
            </div>

            <div className="text-right text-xs">
              <span className="font-semibold text-security-navy-800 dark:text-security-navy-200">
                {compliance.summary.complete} of {compliance.summary.total - compliance.summary.notApplicable} checks passed
              </span>
              <div className="text-[11px] text-security-navy-500">
                {compliance.summary.attention} attention · {compliance.summary.missing} missing
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {compliance.checks.map((chk) => {
              const statusColors = {
                COMPLETE: "border-security-emerald-200 bg-security-emerald-50/50 text-security-emerald-900 dark:border-security-emerald-900/50 dark:bg-security-emerald-950/30 dark:text-security-emerald-300",
                ATTENTION: "border-security-amber-200 bg-security-amber-50/50 text-security-amber-900 dark:border-security-amber-900/50 dark:bg-security-amber-950/30 dark:text-security-amber-300",
                MISSING: "border-red-200 bg-red-50/50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
                NOT_APPLICABLE: "border-security-navy-100 bg-security-navy-50/50 text-security-navy-600 dark:border-security-navy-800 dark:bg-security-navy-900/30 dark:text-security-navy-400",
              }[chk.status];

              const reqColors = {
                STATUTORY: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
                CONTRACTUAL: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
                RECOMMENDED: "bg-security-navy-100 text-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-300",
                OPTIONAL: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
              }[chk.requirementLevel];

              return (
                <div
                  key={chk.key}
                  className={`rounded-security border p-3 text-xs ${statusColors}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{chk.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${reqColors}`}>
                      {chk.requirementLevel}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-90">{chk.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Managed Documents Repository */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
              Supporting Legal & Compliance Documents
            </h2>
            <p className="text-xs text-security-navy-500">
              Auditable records stored in Plethora&apos;s tenant-isolated managed storage system.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="btn-primary text-xs"
            >
              + Upload Document
            </button>
          )}
        </div>

        {/* Category & Contract Filter Strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
          <div className="flex flex-wrap gap-1.5 flex-1">
            {CLIENT_DOCUMENT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-security-navy-900 text-white dark:bg-security-navy-100 dark:text-security-navy-900"
                    : "bg-security-navy-100 text-security-navy-700 hover:bg-security-navy-200 dark:bg-security-navy-800 dark:text-security-navy-300"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {contracts.length > 0 && (
            <select
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              className="input-modern text-xs"
              aria-label="Filter by associated contract"
            >
              <option value="ALL">All Contracts</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} ({c.title})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Documents Table */}
        {loading ? (
          <div className="h-40 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-800" />
        ) : documents.length === 0 ? (
          <div className="card-dashboard p-8 text-center text-xs text-security-navy-500">
            No documents found for this category.
            {canEdit && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  className="font-medium text-security-amber-600 hover:underline"
                >
                  Upload required compliance evidence
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-security-navy-100 text-xs dark:divide-security-navy-800">
                <thead className="bg-security-navy-50 dark:bg-security-navy-900/80">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-security-navy-500">
                    <th className="px-4 py-3">Document Title</th>
                    <th className="px-4 py-3">Category & Type</th>
                    <th className="px-4 py-3">Contract Ref</th>
                    <th className="px-4 py-3">Verification</th>
                    <th className="px-4 py-3">Expiry</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                  {documents.map((doc) => {
                    const isVerified = doc.verificationStatus === "VERIFIED";
                    const isRejected = doc.verificationStatus === "REJECTED";

                    return (
                      <tr
                        key={doc.id}
                        className="hover:bg-security-navy-50/50 dark:hover:bg-security-navy-800/40"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 font-medium text-security-navy-900 dark:text-security-navy-100">
                            {doc.isSensitive && (
                              <span title="Confidential / Sensitive Record" className="text-security-amber-600">
                                🔒
                              </span>
                            )}
                            {doc.title}
                          </div>
                          <div className="text-[11px] text-security-navy-500">{doc.fileName}</div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="font-medium text-security-navy-700 dark:text-security-navy-300">
                            {doc.category}
                          </div>
                          <div className="text-[11px] font-mono text-security-navy-500">
                            {doc.documentType}
                          </div>
                        </td>

                        <td className="px-4 py-3 font-mono text-security-navy-600 dark:text-security-navy-400">
                          {doc.clientContract ? doc.clientContract.contractNumber : "—"}
                        </td>

                        <td className="px-4 py-3">
                          {isVerified ? (
                            <span className="rounded-full bg-security-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-security-emerald-800 dark:bg-security-emerald-950/60 dark:text-security-emerald-300">
                              ✓ Verified
                            </span>
                          ) : isRejected ? (
                            <span
                              title={doc.rejectionReason || "Rejected"}
                              className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300"
                            >
                              ✕ Rejected
                            </span>
                          ) : (
                            <span className="rounded-full bg-security-amber-100 px-2 py-0.5 text-[10px] font-semibold text-security-amber-800 dark:bg-security-amber-900/40 dark:text-security-amber-300">
                              Pending Verification
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 font-mono text-security-navy-600 dark:text-security-navy-400">
                          {doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString() : "No Expiry"}
                        </td>

                        <td className="px-4 py-3 text-right space-x-2">
                          {doc.downloadUrl && (
                            <a
                              href={doc.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-blue-600 hover:underline"
                            >
                              View
                            </a>
                          )}
                          {canVerify && !isVerified && (
                            <button
                              type="button"
                              onClick={() => handleVerify(doc.id)}
                              className="font-medium text-security-emerald-700 hover:underline dark:text-security-emerald-400"
                            >
                              Verify
                            </button>
                          )}
                          {canVerify && !isRejected && (
                            <button
                              type="button"
                              onClick={() => setRejectingDocId(doc.id)}
                              className="font-medium text-red-600 hover:underline"
                            >
                              Reject
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                Upload Client Document
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 dark:hover:text-security-navy-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="label-text mb-1 block">File *</label>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="input-modern w-full"
                  required
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Document Title *</label>
                <input
                  className="input-modern w-full"
                  placeholder="e.g. CIPC Certificate 2026"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">Taxonomy Category</label>
                  <select
                    className="input-modern w-full"
                    value={docCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                  >
                    {CLIENT_DOCUMENT_CATEGORIES.filter((c) => c.id !== "ALL").map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-text mb-1 block">Document Type</label>
                  <select
                    className="input-modern w-full"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  >
                    {filteredTypeOptions.map((o) => (
                      <option key={o.type} value={o.type}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {contracts.length > 0 && (
                <div>
                  <label className="label-text mb-1 block">Associated Commercial Contract</label>
                  <select
                    className="input-modern w-full"
                    value={linkedContractId}
                    onChange={(e) => setLinkedContractId(e.target.value)}
                  >
                    <option value="">None (Client-level document)</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contractNumber} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label-text mb-1 block">Expiry Date (if applicable)</label>
                <input
                  type="date"
                  className="input-modern w-full"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-security-navy-800 dark:text-security-navy-200">
                  <input
                    type="checkbox"
                    checked={isSensitive}
                    onChange={(e) => setIsSensitive(e.target.checked)}
                  />
                  Mark as Sensitive (Restricted to authorised compliance/client-sensitive roles)
                </label>
              </div>

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={uploading || !file || !docTitle.trim()}
                >
                  {uploading ? "Uploading..." : "Upload Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectingDocId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
              Reject Compliance Document
            </h3>
            <p className="mt-1 text-xs text-security-navy-500">
              Provide a clear reason for the audit log so the client/operations team can remediate.
            </p>

            <form onSubmit={handleReject} className="mt-4 space-y-3 text-xs">
              <textarea
                rows={3}
                className="input-modern w-full"
                placeholder="e.g. Illegible signature, expired CIPC filing..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
              />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRejectingDocId(null)}
                  disabled={rejecting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary bg-red-600 hover:bg-red-700"
                  disabled={rejecting || !rejectionReason.trim()}
                >
                  {rejecting ? "Rejecting..." : "Confirm Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
