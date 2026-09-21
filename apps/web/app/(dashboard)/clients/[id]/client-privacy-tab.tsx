"use client";

import { useEffect, useState } from "react";
import {
  getClientDataProcessing,
  updateClientDataProcessing,
  type ClientContact,
  type ClientDataProcessingProfile,
  type ClientDetail,
  type OperatorAgreementStatus,
} from "@/lib/msr-api";

const ALL_PROCESSING_PURPOSES = [
  "Physical Access Control & Gatehouse Verification",
  "CCTV Video Surveillance & Perimeter Monitoring",
  "Biometric Guard & Visitor Verification",
  "Visitor Register & Vehicle Movement Logging",
  "Security Incident & Crime Investigation",
  "Patrol Verification & Time Attendance",
  "Automatic Number Plate Recognition (ANPR)",
];

const ALL_DATA_CATEGORIES = [
  "National ID / Passport / Work Permit Numbers",
  "Biometric Templates (Fingerprint / Facial geometry)",
  "CCTV Recorded Video Footage",
  "Vehicle Registration & Driver License Data",
  "Personal Contact Numbers & Residential Addresses",
  "Incident Witness Statements & Polygraph Records",
];

const OPERATOR_AGREEMENT_LABELS: Record<OperatorAgreementStatus, string> = {
  NOT_REQUIRED: "Not Required (Plethora acts as Sole Responsible Party)",
  PENDING: "Pending Signature (Section 21 Agreement Drafted)",
  SIGNED: "Signed & Executed (Operator Mandate in Force)",
  ATTACHED: "Attached under Documents Repository",
  EXEMPT: "Exempt under Statutory Mandate",
};

interface ClientPrivacyTabProps {
  client: ClientDetail;
  contacts: ClientContact[];
  canEdit: boolean;
  token: string;
  onError: (err: string) => void;
  onSuccess: (msg: string) => void;
}

export function ClientPrivacyTab({
  client,
  contacts,
  canEdit,
  token,
  onError,
  onSuccess,
}: ClientPrivacyTabProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ClientDataProcessingProfile | null>(null);

  // Form state
  const [responsiblePartyLegalName, setResponsiblePartyLegalName] = useState("");
  const [responsiblePartyAddress, setResponsiblePartyAddress] = useState("");
  const [informationOfficerContactId, setInformationOfficerContactId] = useState("");
  const [processingPurposes, setProcessingPurposes] = useState<string[]>([]);
  const [dataCategories, setDataCategories] = useState<string[]>([]);
  const [retentionPolicyReference, setRetentionPolicyReference] = useState("");
  const [crossBorderTransfer, setCrossBorderTransfer] = useState(false);
  const [crossBorderDetails, setCrossBorderDetails] = useState("");
  const [operatorAgreementStatus, setOperatorAgreementStatus] = useState<OperatorAgreementStatus>("PENDING");
  const [operatorAgreementSignedDate, setOperatorAgreementSignedDate] = useState("");
  const [privacyNoticeDistributed, setPrivacyNoticeDistributed] = useState(false);
  const [privacyNoticeDate, setPrivacyNoticeDate] = useState("");
  const [securitySafeguardsSummary, setSecuritySafeguardsSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getClientDataProcessing(token, client.id)
      .then((res) => {
        if (res) {
          setProfile(res);
          setResponsiblePartyLegalName(res.responsiblePartyLegalName || client.legalName || client.name);
          setResponsiblePartyAddress(res.responsiblePartyAddress || client.registeredAddress || client.physicalAddress || "");
          setInformationOfficerContactId(res.informationOfficerContactId || "");
          setProcessingPurposes(res.processingPurposes.length > 0 ? res.processingPurposes : ALL_PROCESSING_PURPOSES.slice(0, 3));
          setDataCategories(res.dataCategories.length > 0 ? res.dataCategories : ALL_DATA_CATEGORIES.slice(0, 3));
          setRetentionPolicyReference(res.retentionPolicyReference || "Standard 3-Year Security Footage & Log Retention");
          setCrossBorderTransfer(res.crossBorderTransfer);
          setCrossBorderDetails(res.crossBorderDetails || "");
          setOperatorAgreementStatus(res.operatorAgreementStatus);
          setOperatorAgreementSignedDate(res.operatorAgreementSignedDate ? String(res.operatorAgreementSignedDate).slice(0, 10) : "");
          setPrivacyNoticeDistributed(res.privacyNoticeDistributed);
          setPrivacyNoticeDate(res.privacyNoticeDate ? String(res.privacyNoticeDate).slice(0, 10) : "");
          setSecuritySafeguardsSummary(res.securitySafeguardsSummary || "AES-256 cloud encryption, tenant-isolated access, audited physical key vaults.");
          setNotes(res.notes || "");
        } else {
          // Defaults for new profile
          setResponsiblePartyLegalName(client.legalName || client.name);
          setResponsiblePartyAddress(client.registeredAddress || client.physicalAddress || "");
          setProcessingPurposes(ALL_PROCESSING_PURPOSES.slice(0, 3));
          setDataCategories(ALL_DATA_CATEGORIES.slice(0, 3));
          setRetentionPolicyReference("Standard 3-Year Security Footage & Log Retention");
          setSecuritySafeguardsSummary("AES-256 cloud encryption, tenant-isolated access, audited physical key vaults.");
        }
      })
      .catch((err) => onError(err instanceof Error ? err.message : "Failed to load data processing profile"))
      .finally(() => setLoading(false));
  }, [token, client, onError]);

  const togglePurpose = (purpose: string) => {
    setProcessingPurposes((prev) =>
      prev.includes(purpose) ? prev.filter((p) => p !== purpose) : [...prev, purpose]
    );
  };

  const toggleCategory = (cat: string) => {
    setDataCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canEdit) return;
    setSaving(true);
    try {
      const updated = await updateClientDataProcessing(token, client.id, {
        responsiblePartyLegalName: responsiblePartyLegalName.trim() || null,
        responsiblePartyAddress: responsiblePartyAddress.trim() || null,
        informationOfficerContactId: informationOfficerContactId || null,
        processingPurposes,
        dataCategories,
        retentionPolicyReference: retentionPolicyReference.trim() || null,
        crossBorderTransfer,
        crossBorderDetails: crossBorderTransfer ? crossBorderDetails.trim() || null : null,
        operatorAgreementStatus,
        operatorAgreementSignedDate: operatorAgreementSignedDate || null,
        privacyNoticeDistributed,
        privacyNoticeDate: privacyNoticeDistributed ? privacyNoticeDate || null : null,
        securitySafeguardsSummary: securitySafeguardsSummary.trim() || null,
        notes: notes.trim() || null,
      });

      setProfile(updated);
      onSuccess("POPIA & Data Processing profile saved.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save privacy profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-800" />;
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="card-dashboard space-y-6 p-6">
        <div>
          <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
            POPIA Data Processing & Responsible Party Governance
          </h2>
          <p className="text-xs text-security-navy-500">
            South African Protection of Personal Information Act (POPIA No. 4 of 2013) governance profile. Captures Responsible Party details, Section 21 Operator Agreements, and processing purposes.
          </p>
        </div>

        {/* Responsible Party & Information Officer */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-text mb-1 block">Responsible Party (Legal Entity)</label>
            <input
              className="input-modern w-full text-xs"
              value={responsiblePartyLegalName}
              onChange={(e) => setResponsiblePartyLegalName(e.target.value)}
              placeholder="e.g. Apex Logistics (Pty) Ltd"
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Designated Information Officer</label>
            <select
              className="input-modern w-full text-xs"
              value={informationOfficerContactId}
              onChange={(e) => setInformationOfficerContactId(e.target.value)}
              disabled={!canEdit}
            >
              <option value="">Select from Client Contacts...</option>
              {contacts.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.firstName} {ct.lastName || ""} ({ct.jobTitle || ct.contactType})
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="label-text mb-1 block">Official Responsible Party Legal Notice Address</label>
            <textarea
              rows={2}
              className="input-modern w-full text-xs"
              value={responsiblePartyAddress}
              onChange={(e) => setResponsiblePartyAddress(e.target.value)}
              placeholder="Address for Section 14 / PAIA / POPIA compliance notices"
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* Section 21 Operator Agreement Status */}
        <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-4 dark:border-security-navy-800 dark:bg-security-navy-900/40">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-security-navy-700 dark:text-security-navy-300">
            POPIA Section 21 Mandate (Operator Agreement)
          </h3>
          <p className="mt-0.5 text-[11px] text-security-navy-500">
            Under POPIA Section 21, a written agreement is mandatory where Plethora processes personal data on behalf of a client.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-text mb-1 block text-xs">Agreement Status</label>
              <select
                className="input-modern w-full text-xs"
                value={operatorAgreementStatus}
                onChange={(e) => setOperatorAgreementStatus(e.target.value as OperatorAgreementStatus)}
                disabled={!canEdit}
              >
                {Object.entries(OPERATOR_AGREEMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-text mb-1 block text-xs">Execution / Signed Date</label>
              <input
                type="date"
                className="input-modern w-full text-xs"
                value={operatorAgreementSignedDate}
                onChange={(e) => setOperatorAgreementSignedDate(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>
        </div>

        {/* Processing Purposes Multi-Select */}
        <div>
          <label className="label-text mb-2 block font-semibold">
            Lawful Processing Purposes (Security Operations Scope)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALL_PROCESSING_PURPOSES.map((purpose) => {
              const checked = processingPurposes.includes(purpose);
              return (
                <label
                  key={purpose}
                  className={`flex items-center gap-2 rounded-security border p-2.5 text-xs transition-colors ${
                    checked
                      ? "border-security-amber-200 bg-security-amber-50/40 text-security-navy-900 dark:border-security-amber-800/40 dark:bg-security-amber-950/20 dark:text-security-navy-100"
                      : "border-security-navy-100 bg-white text-security-navy-600 dark:border-security-navy-800 dark:bg-security-navy-900 dark:text-security-navy-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePurpose(purpose)}
                    disabled={!canEdit}
                  />
                  <span>{purpose}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Personal Data Categories */}
        <div>
          <label className="label-text mb-2 block font-semibold">
            Categories of Personal Information Handled
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALL_DATA_CATEGORIES.map((cat) => {
              const checked = dataCategories.includes(cat);
              return (
                <label
                  key={cat}
                  className={`flex items-center gap-2 rounded-security border p-2.5 text-xs transition-colors ${
                    checked
                      ? "border-blue-200 bg-blue-50/40 text-security-navy-900 dark:border-blue-800/40 dark:bg-blue-950/20 dark:text-security-navy-100"
                      : "border-security-navy-100 bg-white text-security-navy-600 dark:border-security-navy-800 dark:bg-security-navy-900 dark:text-security-navy-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCategory(cat)}
                    disabled={!canEdit}
                  />
                  <span>{cat}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Safeguards & Cross-Border */}
        <div className="grid gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label className="label-text mb-1 block">Data Retention Policy Reference</label>
            <input
              className="input-modern w-full"
              placeholder="e.g. Incident records retained 5 years per BCEA/SAPS"
              value={retentionPolicyReference}
              onChange={(e) => setRetentionPolicyReference(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Security Safeguards Summary</label>
            <input
              className="input-modern w-full"
              placeholder="e.g. Encrypted digital logs, biometric vaulting"
              value={securitySafeguardsSummary}
              onChange={(e) => setSecuritySafeguardsSummary(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-2 space-y-2">
            <label className="flex items-center gap-2 font-medium text-security-navy-800 dark:text-security-navy-200">
              <input
                type="checkbox"
                checked={crossBorderTransfer}
                onChange={(e) => setCrossBorderTransfer(e.target.checked)}
                disabled={!canEdit}
              />
              Cross-border data processing applies (e.g. offshore cloud backup, multinational client access)
            </label>
            {crossBorderTransfer && (
              <textarea
                rows={2}
                className="input-modern w-full text-xs"
                placeholder="Specify target jurisdictions and Section 72 safeguard mechanisms..."
                value={crossBorderDetails}
                onChange={(e) => setCrossBorderDetails(e.target.value)}
                disabled={!canEdit}
              />
            )}
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 font-medium text-security-navy-800 dark:text-security-navy-200">
              <input
                type="checkbox"
                checked={privacyNoticeDistributed}
                onChange={(e) => setPrivacyNoticeDistributed(e.target.checked)}
                disabled={!canEdit}
              />
              Section 18 Privacy Notice has been distributed / displayed on site
            </label>
            {privacyNoticeDistributed && (
              <div className="flex items-center gap-2">
                <span className="text-security-navy-500">Notice Date:</span>
                <input
                  type="date"
                  className="input-modern text-xs py-1"
                  value={privacyNoticeDate}
                  onChange={(e) => setPrivacyNoticeDate(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
            <button type="submit" className="btn-primary text-xs" disabled={saving}>
              {saving ? "Saving Profile..." : "Save POPIA Profile"}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
