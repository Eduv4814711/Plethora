"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getEmployeeCompliance,
  getEmployeeDocuments,
  uploadDocument,
  verifyDocument,
  rejectDocument,
  updateDocumentMetadata,
  type ManagedDocument,
  type EmployeeComplianceDetail,
  type DocumentTypeDefinition,
} from "@/lib/msr-api";
import { authFetch, downloadPrivateFile } from "@/lib/api";
import { hasCapability, canAccessSensitiveData } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";
import { clsx } from "clsx";

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp";
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All Categories" },
  { value: "PERSONAL", label: "Personal Documents" },
  { value: "EMPLOYMENT", label: "Employment Documents" },
  { value: "PAYROLL_STATUTORY", label: "Payroll & Statutory" },
  { value: "LEAVE_MEDICAL", label: "Leave & Medical", isSensitive: true },
  { value: "DISCIPLINARY", label: "Disciplinary & HR", isSensitive: true },
  { value: "EXIT", label: "Exit Documents" },
  { value: "PSIRA", label: "PSiRA Documents" },
  { value: "SPECIALIST_SECURITY", label: "Specialist Security" },
  { value: "FIREARM", label: "Firearm Documents", isSensitive: true },
  { value: "QUALIFICATIONS", label: "Other Qualifications" },
];

export const ALL_DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  // Personal
  { type: "sa_id", label: "South African ID / Passport", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },
  { type: "cv", label: "CV / Resume", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },
  { type: "proof_of_address", label: "Proof of Residential Address", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: true },
  { type: "profile_photo", label: "Profile Photo", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },
  // Employment
  { type: "employment_contract", label: "Employment Contract", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "offer_of_employment", label: "Offer of Employment", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "job_description", label: "Job Description", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "confidentiality_agreement", label: "Confidentiality Agreement", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "popia_consent", label: "POPIA Consent / Privacy Acknowledgement", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "company_policy", label: "Company Policy Acknowledgement", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "code_of_conduct", label: "Code of Conduct Acknowledgement", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "site_deployment_letter", label: "Site Deployment Letter", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "site_transfer_letter", label: "Site Transfer Letter", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "site_induction", label: "Site Induction Document", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  { type: "uniform_equipment_form", label: "Uniform / Equipment Issue Form", category: "EMPLOYMENT", categoryLabel: "Employment Documents", requiresExpiry: false },
  // Payroll
  { type: "bank_details_proof", label: "Proof of Banking Details", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "sars_tax", label: "SARS / Tax Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "uif_doc", label: "UIF Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "provident_fund", label: "Provident Fund Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "pension_fund", label: "Pension Fund Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "nbcpss_doc", label: "NBCPSS Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "other_payroll", label: "Other Payroll Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  // Leave & Medical (Sensitive)
  { type: "medical_certificate", label: "Medical Certificate / Sick Note", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "leave_supporting_doc", label: "Leave Supporting Documents", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "injury_on_duty", label: "Injury on Duty Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "coida_doc", label: "COIDA Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "return_to_work", label: "Return-to-Work Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  // Disciplinary (Sensitive)
  { type: "written_warning", label: "Written Warning", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: true },
  { type: "final_written_warning", label: "Final Written Warning", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: true },
  { type: "notice_disciplinary_hearing", label: "Notice to Attend Disciplinary Hearing", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "charge_sheet", label: "Charge Sheet", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "disciplinary_evidence", label: "Disciplinary Evidence", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "disciplinary_outcome", label: "Disciplinary Hearing Outcome", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "suspension_letter", label: "Suspension Letter", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "grievance_document", label: "Grievance Document", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "performance_review", label: "Performance Review", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: false },
  { type: "performance_improvement_plan", label: "Performance Improvement Plan", category: "DISCIPLINARY", categoryLabel: "Disciplinary & HR Documents", isSensitive: true, requiresExpiry: true },
  // Exit
  { type: "resignation_letter", label: "Resignation Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "termination_letter", label: "Termination Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "dismissal_letter", label: "Dismissal Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "exit_documentation", label: "Exit Documentation", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "certificate_of_service", label: "Certificate of Service", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "other_exit_doc", label: "Other Exit Documents", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  // PSiRA
  { type: "psira_registration_certificate", label: "PSiRA Registration Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_card", label: "PSiRA Card", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: true },
  { type: "psira_grade_e", label: "PSiRA Grade E Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_d", label: "PSiRA Grade D Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_c", label: "PSiRA Grade C Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_b", label: "PSiRA Grade B Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_a", label: "PSiRA Grade A Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "security_training_certificate", label: "Security Training Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", requiresExpiry: false },
  // Specialist
  { type: "armed_response_certificate", label: "Armed Response Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "reaction_officer_certificate", label: "Reaction Officer Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "cctv_operator_certificate", label: "CCTV Operator Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "access_control_certificate", label: "Access Control Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "cash_in_transit_certificate", label: "Cash-in-Transit (CIT) Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "special_events_certificate", label: "Special Events Security Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "other_security_qualification", label: "Other Security Qualification", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  // Firearm (Sensitive)
  { type: "firearm_competency_certificate", label: "Firearm Competency Certificate", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SAPS", requiresExpiry: true },
  { type: "firearm_training_certificate", label: "Firearm Training Certificate", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SASSETA / PFTC", requiresExpiry: false },
  { type: "business_purpose_firearm_competency", label: "Business-Purpose Firearm Competency", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SAPS", requiresExpiry: true },
  { type: "firearm_authorisation", label: "Firearm Authorisation Document", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, requiresExpiry: true },
  { type: "other_firearm_doc", label: "Other Firearm Documentation", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, requiresExpiry: false },
  // Qualifications
  { type: "first_aid_certificate", label: "First Aid Certificate", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", defaultAuthority: "St John / Red Cross / Dept of Labour", requiresExpiry: true },
  { type: "firefighting_certificate", label: "Firefighting Certificate", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: true },
  { type: "health_safety_certificate", label: "Health and Safety Certificate", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: true },
  { type: "drivers_licence", label: "Driver's Licence", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", defaultAuthority: "DLTC", requiresExpiry: true },
  { type: "prdp", label: "Professional Driving Permit (PrDP)", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", defaultAuthority: "DLTC", requiresExpiry: true },
  { type: "defensive_driving_certificate", label: "Defensive Driving Certificate", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: false },
  { type: "ohs_training", label: "Occupational Health & Safety Training", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: false },
  { type: "academic_qualification", label: "Academic Qualification", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: false },
  { type: "other_professional_qualification", label: "Other Professional Qualification", category: "QUALIFICATIONS", categoryLabel: "Other Qualifications", requiresExpiry: false },
];

export function EmployeeDocumentsSection({
  employeeId,
  token,
  onProfileUpdated,
}: {
  employeeId: string;
  token: string;
  onProfileUpdated?: () => void;
}) {
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();

  const canEdit = user ? hasCapability(user, "/employees", "edit") || hasCapability(user, "/documents", "edit") : false;
  const canUpload = user ? hasCapability(user, "/employees", "create") || hasCapability(user, "/documents", "create") : false;
  const canExport = user ? hasCapability(user, "/employees", "export") || hasCapability(user, "/documents", "export") : false;
  const canViewSensitive = user
    ? user.isOwner ||
      canAccessSensitiveData(user, "/employees") ||
      canAccessSensitiveData(user, "/payroll") ||
      hasCapability(user, "/documents", "view_sensitive")
    : false;

  const [compliance, setCompliance] = useState<EmployeeComplianceDetail | null>(null);
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<ManagedDocument | null>(null);
  const [rejectingDoc, setRejectingDoc] = useState<ManagedDocument | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  // Upload Form State
  const [uploadCategory, setUploadCategory] = useState<string>("PERSONAL");
  const [uploadType, setUploadType] = useState<string>("sa_id");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadNumber, setUploadNumber] = useState("");
  const [uploadAuthority, setUploadAuthority] = useState("");
  const [uploadIssueDate, setUploadIssueDate] = useState("");
  const [uploadExpiryDate, setUploadExpiryDate] = useState("");
  const [uploadDoesNotExpire, setUploadDoesNotExpire] = useState(false);
  const [uploadIsSensitive, setUploadIsSensitive] = useState(false);
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");

  const fetchData = useCallback(async () => {
    if (!token || !employeeId) return;
    setLoading(true);
    setError(null);
    try {
      const [compData, docsData] = await Promise.all([
        getEmployeeCompliance(token, employeeId),
        getEmployeeDocuments(token, employeeId, { limit: 100 }),
      ]);
      setCompliance(compData);
      setDocuments(docsData.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents & compliance records");
    } finally {
      setLoading(false);
    }
  }, [token, employeeId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Update form defaults when type changes
  const handleTypeChange = (newType: string) => {
    setUploadType(newType);
    const def = ALL_DOCUMENT_TYPES.find((d) => d.type === newType);
    if (def) {
      setUploadTitle(def.label);
      setUploadCategory(def.category);
      setUploadAuthority(def.defaultAuthority ?? "");
      setUploadDoesNotExpire(!def.requiresExpiry);
      setUploadIsSensitive(Boolean(def.isSensitive));
    }
  };

  const handleCategoryChangeInUpload = (newCategory: string) => {
    setUploadCategory(newCategory);
    const availableTypes = ALL_DOCUMENT_TYPES.filter((d) => d.category === newCategory);
    if (availableTypes.length > 0) {
      handleTypeChange(availableTypes[0].type);
    }
  };

  const handleUploadForRequirement = (type: string) => {
    handleTypeChange(type);
    setUploadFile(null);
    setUploadNumber("");
    setUploadIssueDate("");
    setUploadExpiryDate("");
    setUploadNotes("");
    setUploadError("");
    setShowUploadModal(true);
  };

  // Filtered Documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Sensitive category restriction
      if (
        (doc.isSensitive || doc.documentCategory === "LEAVE_MEDICAL" || doc.documentCategory === "DISCIPLINARY" || doc.documentCategory === "FIREARM") &&
        !canViewSensitive
      ) {
        return false;
      }

      if (selectedCategory !== "ALL") {
        const docCat = doc.documentCategory || doc.typeDefinition?.category || "";
        if (docCat !== selectedCategory) return false;
      }

      if (selectedStatus !== "ALL") {
        if (selectedStatus === "VERIFIED" && doc.verificationStatus !== "VERIFIED") return false;
        if (selectedStatus === "PENDING_VERIFICATION" && doc.verificationStatus !== "PENDING_VERIFICATION") return false;
        if (selectedStatus === "REJECTED" && doc.verificationStatus !== "REJECTED") return false;
        if (selectedStatus === "EXPIRED" && doc.expiryState?.state !== "EXPIRED") return false;
        if (selectedStatus === "EXPIRING_SOON" && !doc.expiryState?.isExpiringSoon) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (doc.title || "").toLowerCase().includes(q);
        const matchesType = (doc.typeDefinition?.label || doc.documentType || "").toLowerCase().includes(q);
        const matchesNumber = (doc.documentNumber || "").toLowerCase().includes(q);
        const matchesFile = (doc.fileName || "").toLowerCase().includes(q);
        const matchesAuthority = (doc.issuingAuthority || "").toLowerCase().includes(q);
        if (!matchesName && !matchesType && !matchesNumber && !matchesFile && !matchesAuthority) return false;
      }

      return true;
    });
  }, [documents, selectedCategory, selectedStatus, searchQuery, canViewSensitive]);

  // Actions
  const handleVerify = async (docId: string) => {
    if (!token || !canEdit) return;
    setActionInProgress(true);
    try {
      await verifyDocument(token, docId);
      await fetchData();
      onProfileUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to verify document");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleReject = async () => {
    if (!token || !canEdit || !rejectingDoc) return;
    setActionInProgress(true);
    try {
      await rejectDocument(token, rejectingDoc.id, rejectionReason.trim());
      setRejectingDoc(null);
      setRejectionReason("");
      await fetchData();
      onProfileUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject document");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleArchive = async (docId: string) => {
    if (!token || !canEdit) return;
    const confirmed = await confirm({
      title: "Archive document?",
      message: "This will remove the document from active compliance calculation and store it in archive history.",
      confirmLabel: "Archive document",
    });
    if (!confirmed) return;

    setActionInProgress(true);
    try {
      await authFetch(`/documents/${docId}/archive`, token, { method: "PATCH" });
      await fetchData();
      onProfileUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive document");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !uploadFile) {
      setUploadError("Please select a file to upload");
      return;
    }

    if (uploadFile.size > DOCUMENT_MAX_BYTES) {
      setUploadError("File size exceeds 10MB limit");
      return;
    }

    setUploadError("");
    setActionInProgress(true);
    try {
      await uploadDocument(token, uploadFile, {
        title: uploadTitle.trim() || uploadFile.name,
        documentType: uploadType,
        documentCategory: uploadCategory,
        documentNumber: uploadNumber.trim() || undefined,
        issuingAuthority: uploadAuthority.trim() || undefined,
        issueDate: uploadIssueDate || undefined,
        expiryDate: uploadDoesNotExpire ? undefined : uploadExpiryDate || undefined,
        doesNotExpire: uploadDoesNotExpire,
        isSensitive: uploadIsSensitive,
        employeeId,
        category: "EMPLOYEE",
        notes: uploadNotes.trim() || undefined,
      });

      setShowUploadModal(false);
      setUploadFile(null);
      setUploadNumber("");
      setUploadAuthority("");
      setUploadIssueDate("");
      setUploadExpiryDate("");
      setUploadNotes("");
      await fetchData();
      onProfileUpdated?.();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !showEditModal) return;

    setActionInProgress(true);
    try {
      await updateDocumentMetadata(token, showEditModal.id, {
        title: showEditModal.title,
        documentNumber: showEditModal.documentNumber || null,
        issuingAuthority: showEditModal.issuingAuthority || null,
        issueDate: showEditModal.issueDate || null,
        expiryDate: showEditModal.doesNotExpire ? null : showEditModal.expiryDate || null,
        doesNotExpire: showEditModal.doesNotExpire,
        isSensitive: showEditModal.isSensitive,
        notes: showEditModal.notes || null,
      });

      setShowEditModal(null);
      await fetchData();
      onProfileUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update document");
    } finally {
      setActionInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse p-4">
        <div className="h-28 bg-security-navy-100 rounded-security-lg" />
        <div className="h-64 bg-security-navy-100 rounded-security-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-security-navy-900">
      {confirmDialog}

      {error && (
        <div className="p-4 rounded-security border border-red-200 bg-red-50 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* 1. EMPLOYEE COMPLIANCE SUMMARY BANNER */}
      {compliance && (
        <div
          className={clsx(
            "rounded-security-lg border-2 p-5 shadow-security-card",
            compliance.overallStatus === "COMPLIANT" && "border-security-emerald-300 bg-security-emerald-50/70",
            compliance.overallStatus === "ATTENTION_REQUIRED" && "border-security-amber-300 bg-security-amber-50/70",
            compliance.overallStatus === "NON_COMPLIANT" && "border-red-300 bg-red-50/70"
          )}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest text-security-navy-600">
                  Compliance Status
                </span>
                <span
                  className={clsx(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                    compliance.overallStatus === "COMPLIANT" && "bg-security-emerald-600 text-white",
                    compliance.overallStatus === "ATTENTION_REQUIRED" && "bg-security-amber-600 text-white",
                    compliance.overallStatus === "NON_COMPLIANT" && "bg-red-600 text-white"
                  )}
                >
                  {compliance.overallStatus === "COMPLIANT" && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {compliance.overallStatus === "ATTENTION_REQUIRED" && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                  {compliance.overallStatus === "NON_COMPLIANT" && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {compliance.overallStatus.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-sm font-semibold text-security-navy-900 mt-1">
                {compliance.employeeName} ({compliance.employeeNumber}) · {compliance.employeeType === "general" ? "Office Staff" : "Security Officer"}
                {compliance.psiraGrade && ` · PSiRA Grade ${compliance.psiraGrade}`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
              <span className="px-2.5 py-1 rounded-security bg-white/90 border border-security-navy-200">
                ✓ {compliance.summary.verifiedCount} Verified
              </span>
              {compliance.summary.pendingCount > 0 && (
                <span className="px-2.5 py-1 rounded-security bg-security-amber-100 text-security-amber-900 border border-security-amber-300">
                  ⏳ {compliance.summary.pendingCount} Pending
                </span>
              )}
              {compliance.summary.expiringCount > 0 && (
                <span className="px-2.5 py-1 rounded-security bg-security-amber-100 text-security-amber-900 border border-security-amber-300">
                  ⚠ {compliance.summary.expiringCount} Expiring Soon
                </span>
              )}
              {compliance.summary.expiredCount > 0 && (
                <span className="px-2.5 py-1 rounded-security bg-red-100 text-red-900 border border-red-300">
                  ✕ {compliance.summary.expiredCount} Expired
                </span>
              )}
              {compliance.summary.missingCount > 0 && (
                <span className="px-2.5 py-1 rounded-security bg-red-100 text-red-900 border border-red-300">
                  ✕ {compliance.summary.missingCount} Missing Required
                </span>
              )}
            </div>
          </div>

          {/* Requirements Checklist Matrix */}
          <div className="mt-4 pt-4 border-t border-security-navy-200/50">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-security-navy-700">
                Mandatory Statutory & Role Requirements:
              </p>
              <span className="text-[11px] text-security-navy-600 font-medium">
                {compliance.summary.verifiedCount} of {compliance.requirements.length} satisfied
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {compliance.requirements.map((req) => {
                const isGood = req.status === "VERIFIED" || req.status === "VALID";
                const isWarn = req.status === "EXPIRING_SOON" || req.status === "PENDING_VERIFICATION";
                const isBad = req.status === "MISSING" || req.status === "EXPIRED" || req.status === "REJECTED";

                return (
                  <div
                    key={req.rule.type}
                    className={clsx(
                      "flex flex-col justify-between p-3.5 rounded-security-lg border transition-shadow bg-white shadow-xs",
                      isGood && "border-security-emerald-200 hover:border-security-emerald-300",
                      isWarn && "border-security-amber-300 bg-security-amber-50/30 hover:border-security-amber-400",
                      isBad && "border-red-300 bg-red-50/30 hover:border-red-400"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span
                          className={clsx(
                            "mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 text-xs font-bold",
                            isGood && "bg-security-emerald-100 text-security-emerald-700",
                            isWarn && "bg-security-amber-100 text-security-amber-800",
                            isBad && "bg-red-100 text-red-700"
                          )}
                        >
                          {isGood && "✓"}
                          {isWarn && "⏳"}
                          {isBad && "✕"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-security-navy-900 text-xs leading-snug break-words">
                            {req.rule.label}
                          </p>
                          {req.rule.reason && (
                            <p className="text-[11px] text-security-navy-500 mt-0.5 leading-tight">
                              {req.rule.reason}
                            </p>
                          )}
                          {req.documentName && (
                            <p className="text-[11px] font-medium text-security-navy-700 mt-1 truncate">
                              📄 {req.documentName}
                            </p>
                          )}
                          {req.expiryLabel && (
                            <p
                              className={clsx(
                                "text-[10px] font-medium mt-0.5",
                                req.status === "EXPIRED" ? "text-red-700 font-semibold" : "text-security-navy-600"
                              )}
                            >
                              {req.expiryLabel}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span
                          className={clsx(
                            "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            req.status === "VERIFIED" && "bg-security-emerald-100 text-security-emerald-800 border border-security-emerald-200",
                            req.status === "VALID" && "bg-security-emerald-50 text-security-emerald-700 border border-security-emerald-200",
                            req.status === "EXPIRING_SOON" && "bg-security-amber-100 text-security-amber-900 border border-security-amber-300",
                            req.status === "PENDING_VERIFICATION" && "bg-security-amber-100 text-security-amber-800 border border-security-amber-300",
                            req.status === "EXPIRED" && "bg-red-100 text-red-900 border border-red-300",
                            req.status === "MISSING" && "bg-red-100 text-red-800 border border-red-300",
                            req.status === "REJECTED" && "bg-red-200 text-red-900 border border-red-300"
                          )}
                        >
                          {req.status.replace(/_/g, " ")}
                        </span>

                        {isBad && canUpload && (
                          <button
                            type="button"
                            onClick={() => handleUploadForRequirement(req.rule.type)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-security-navy-700 hover:text-security-navy-950 bg-white hover:bg-security-navy-50 border border-security-navy-300 rounded px-2 py-0.5 shadow-2xs transition-colors"
                          >
                            + Upload
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2. TOOLBAR & FILTERS */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 rounded-security-lg bg-security-navy-50/80 border-2 border-security-navy-100">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <input
            type="search"
            placeholder="Search documents, PSiRA numbers, certificates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-compact min-w-[200px] flex-1 max-w-xs"
          />

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="input-compact min-w-[160px]"
            aria-label="Filter category"
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label} {cat.isSensitive ? "🔒" : ""}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="input-compact min-w-[140px]"
            aria-label="Filter status"
          >
            <option value="ALL">All Statuses</option>
            <option value="VERIFIED">Verified</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
            <option value="EXPIRING_SOON">Expiring Soon</option>
            <option value="EXPIRED">Expired</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        {canUpload && (
          <button
            type="button"
            onClick={() => {
              handleTypeChange("sa_id");
              setShowUploadModal(true);
            }}
            className="btn-primary shrink-0 flex items-center gap-2 text-xs py-2 px-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Upload Document
          </button>
        )}
      </div>

      {/* 3. DOCUMENTS LIST TABLE / CARDS */}
      <div className="rounded-security-lg border-2 border-security-navy-100 bg-white overflow-hidden shadow-security-card">
        {filteredDocuments.length === 0 ? (
          <div className="p-12 text-center text-security-navy-500">
            <svg className="w-12 h-12 mx-auto text-security-navy-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-semibold text-security-navy-800">No documents found</p>
            <p className="text-xs text-security-navy-500 mt-1 max-w-sm mx-auto">
              {searchQuery || selectedCategory !== "ALL" || selectedStatus !== "ALL"
                ? "Try clearing your filters or search query."
                : "Upload personnel documents, contracts, PSiRA credentials and certificates to build this digital file."}
            </p>
            {canUpload && (
              <button
                type="button"
                onClick={() => {
                  handleTypeChange("sa_id");
                  setShowUploadModal(true);
                }}
                className="btn-secondary text-xs mt-4"
              >
                Upload First Document
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-security-navy-50 border-b-2 border-security-navy-100 text-[11px] font-bold uppercase tracking-wider text-security-navy-600">
                  <th className="py-3 px-4">Document / Title</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Doc No. & Authority</th>
                  <th className="py-3 px-3">Dates & Expiry</th>
                  <th className="py-3 px-3">Verification</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {filteredDocuments.map((doc) => {
                  const exp = doc.expiryState;
                  const isExpiring = exp?.isExpiringSoon;
                  const isExpired = exp?.hasExpired;
                  const isVerified = doc.verificationStatus === "VERIFIED";
                  const isRejected = doc.verificationStatus === "REJECTED";

                  return (
                    <tr key={doc.id} className="hover:bg-security-navy-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5">
                          <span className="p-2 rounded-security bg-security-navy-50 text-security-navy-700 border border-security-navy-100 shrink-0 mt-0.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-bold text-security-navy-900 truncate">{doc.title}</p>
                              {doc.isSensitive && (
                                <span className="text-[10px] bg-security-amber-100 text-security-amber-900 px-1.5 py-0.2 rounded font-semibold" title="Restricted / Sensitive">
                                  🔒 Sensitive
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-security-navy-500 truncate mt-0.5">
                              {doc.typeDefinition?.label || doc.documentType} · {doc.fileName}
                            </p>
                            {doc.notes && (
                              <p className="text-[10px] text-security-navy-600 italic truncate mt-0.5">Note: {doc.notes}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <span className="font-medium text-security-navy-700">
                          {doc.typeDefinition?.categoryLabel || (doc.documentCategory ?? "General").replace(/_/g, " ")}
                        </span>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-security-navy-900">{doc.documentNumber || "—"}</p>
                          <p className="text-[10px] text-security-navy-500">{doc.issuingAuthority || "—"}</p>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="space-y-1">
                          {doc.doesNotExpire ? (
                            <span className="text-[11px] text-security-navy-600 font-medium">Does not expire</span>
                          ) : doc.expiryDate ? (
                            <div>
                              <p className="text-xs text-security-navy-800">{new Date(doc.expiryDate).toLocaleDateString()}</p>
                              <span
                                className={clsx(
                                  "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide",
                                  isExpired && "bg-red-100 text-red-800",
                                  isExpiring && "bg-security-amber-100 text-security-amber-800",
                                  !isExpired && !isExpiring && "bg-security-emerald-50 text-security-emerald-700"
                                )}
                              >
                                {exp?.label}
                              </span>
                            </div>
                          ) : (
                            <span className="text-security-navy-400">—</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="space-y-0.5">
                          <span
                            className={clsx(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              isVerified && "bg-security-emerald-100 text-security-emerald-800",
                              isRejected && "bg-red-100 text-red-800",
                              !isVerified && !isRejected && "bg-security-amber-100 text-security-amber-800"
                            )}
                          >
                            {isVerified && "✓ "}
                            {isRejected && "✕ "}
                            {(doc.verificationStatus || "PENDING").replace(/_/g, " ")}
                          </span>
                          {doc.verifiedBy && (
                            <p className="text-[10px] text-security-navy-500 truncate">
                              By {doc.verifiedBy.name}
                            </p>
                          )}
                          {isRejected && doc.rejectionReason && (
                            <p className="text-[10px] text-red-600 truncate" title={doc.rejectionReason}>
                              {doc.rejectionReason}
                            </p>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {canExport && doc.downloadUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                void downloadPrivateFile(token, doc.downloadUrl!, doc.fileName).catch((err) =>
                                  alert(err instanceof Error ? err.message : "Download failed")
                                );
                              }}
                              className="btn-secondary text-[11px] py-1 px-2.5 rounded"
                              title="Download document file"
                            >
                              Download
                            </button>
                          )}

                          {canEdit && (
                            <>
                              {!isVerified && (
                                <button
                                  type="button"
                                  disabled={actionInProgress}
                                  onClick={() => handleVerify(doc.id)}
                                  className="btn-primary text-[11px] py-1 px-2.5 rounded bg-security-emerald-700 hover:bg-security-emerald-800"
                                  title="Verify document authenticity"
                                >
                                  Verify
                                </button>
                              )}

                              {!isRejected && (
                                <button
                                  type="button"
                                  disabled={actionInProgress}
                                  onClick={() => {
                                    setRejectingDoc(doc);
                                    setRejectionReason("");
                                  }}
                                  className="btn-secondary text-[11px] py-1 px-2.5 rounded text-red-600 hover:bg-red-50 hover:border-red-200"
                                  title="Reject document"
                                >
                                  Reject
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={actionInProgress}
                                onClick={() => setShowEditModal(doc)}
                                className="btn-secondary text-[11px] py-1 px-2 rounded"
                                title="Edit metadata"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                disabled={actionInProgress}
                                onClick={() => handleArchive(doc.id)}
                                className="p-1 text-security-navy-400 hover:text-red-600 rounded hover:bg-red-50"
                                title="Archive"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. UPLOAD MODAL */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-security-lg border-2 border-security-navy-100 shadow-security-card overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-security-navy-100 flex items-center justify-between bg-security-navy-50">
              <div>
                <h3 className="text-base font-bold text-security-navy-900">Upload Personnel Document / Certificate</h3>
                <p className="text-xs text-security-navy-600">Attach and record credentials for employee digital personnel file</p>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="p-1 rounded text-security-navy-400 hover:text-security-navy-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {uploadError && (
                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-security">{uploadError}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Document Category *
                  </label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => handleCategoryChangeInUpload(e.target.value)}
                    className="input-compact w-full"
                    required
                  >
                    {CATEGORY_OPTIONS.filter((c) => c.value !== "ALL").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label} {c.isSensitive ? "🔒" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Document Type *
                  </label>
                  <select
                    value={uploadType}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    className="input-compact w-full"
                    required
                  >
                    {ALL_DOCUMENT_TYPES.filter((d) => d.category === uploadCategory).map((d) => (
                      <option key={d.type} value={d.type}>
                        {d.label} {d.isSensitive ? "🔒" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                  Document Title / Display Name *
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="input-compact w-full"
                  placeholder="e.g. PSiRA Grade C Certificate"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Document / Certificate Number
                  </label>
                  <input
                    type="text"
                    value={uploadNumber}
                    onChange={(e) => setUploadNumber(e.target.value)}
                    className="input-compact w-full"
                    placeholder="e.g. PSIRA Reg #, ID #, Cert #"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Issuing Authority
                  </label>
                  <input
                    type="text"
                    value={uploadAuthority}
                    onChange={(e) => setUploadAuthority(e.target.value)}
                    className="input-compact w-full"
                    placeholder="e.g. PSiRA, SAPS, SASSETA, St John"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Issue Date
                  </label>
                  <DateInput
                    value={uploadIssueDate}
                    onChange={setUploadIssueDate}
                    ariaLabel="Issue date"
                    pastOnly
                    showToday
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-security-navy-600">
                      Expiry Date
                    </label>
                    <label className="flex items-center gap-1 text-[11px] cursor-pointer text-security-navy-700">
                      <input
                        type="checkbox"
                        checked={uploadDoesNotExpire}
                        onChange={(e) => {
                          setUploadDoesNotExpire(e.target.checked);
                          if (e.target.checked) setUploadExpiryDate("");
                        }}
                        className="rounded border-security-navy-300"
                      />
                      Does not expire
                    </label>
                  </div>
                  <DateInput
                    value={uploadExpiryDate}
                    onChange={setUploadExpiryDate}
                    ariaLabel="Expiry date"
                    disabled={uploadDoesNotExpire}
                    futureOnly
                    showToday
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                  File Attachment (PDF, JPG, PNG, Word, Excel, max 10MB) *
                </label>
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full rounded-security border-2 border-security-navy-200 bg-white text-xs text-security-navy-700 file:mr-3 file:rounded-security file:border-0 file:bg-security-navy file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-security-navy-800 cursor-pointer"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                  Notes / Comments
                </label>
                <textarea
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  className="input-compact w-full h-16"
                  placeholder="Additional context, verification notes, or details..."
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-security-navy-100">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-security-navy-700">
                  <input
                    type="checkbox"
                    checked={uploadIsSensitive}
                    onChange={(e) => setUploadIsSensitive(e.target.checked)}
                    className="rounded border-security-navy-300"
                  />
                  Mark as Restricted / Sensitive
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="btn-secondary text-xs py-2 px-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionInProgress}
                    className="btn-primary text-xs py-2 px-4"
                  >
                    {actionInProgress ? "Uploading..." : "Save & Upload"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. EDIT METADATA MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-security-lg border-2 border-security-navy-100 shadow-security-card overflow-hidden">
            <div className="p-4 border-b border-security-navy-100 flex items-center justify-between bg-security-navy-50">
              <h3 className="text-sm font-bold text-security-navy-900">Edit Document Metadata</h3>
              <button
                type="button"
                onClick={() => setShowEditModal(null)}
                className="p-1 text-security-navy-400 hover:text-security-navy-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={showEditModal.title}
                  onChange={(e) => setShowEditModal({ ...showEditModal, title: e.target.value })}
                  className="input-compact w-full"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Document Number
                  </label>
                  <input
                    type="text"
                    value={showEditModal.documentNumber ?? ""}
                    onChange={(e) => setShowEditModal({ ...showEditModal, documentNumber: e.target.value })}
                    className="input-compact w-full"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Issuing Authority
                  </label>
                  <input
                    type="text"
                    value={showEditModal.issuingAuthority ?? ""}
                    onChange={(e) => setShowEditModal({ ...showEditModal, issuingAuthority: e.target.value })}
                    className="input-compact w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                    Issue Date
                  </label>
                  <DateInput
                    value={showEditModal.issueDate ? showEditModal.issueDate.slice(0, 10) : ""}
                    onChange={(v) => setShowEditModal({ ...showEditModal, issueDate: v })}
                    ariaLabel="Issue date"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-security-navy-600">
                      Expiry Date
                    </label>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showEditModal.doesNotExpire ?? false}
                        onChange={(e) =>
                          setShowEditModal({
                            ...showEditModal,
                            doesNotExpire: e.target.checked,
                            expiryDate: e.target.checked ? null : showEditModal.expiryDate,
                          })
                        }
                      />
                      No Expiry
                    </label>
                  </div>
                  <DateInput
                    value={showEditModal.expiryDate ? showEditModal.expiryDate.slice(0, 10) : ""}
                    onChange={(v) => setShowEditModal({ ...showEditModal, expiryDate: v })}
                    disabled={showEditModal.doesNotExpire}
                    ariaLabel="Expiry date"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-security-navy-600 mb-1">
                  Notes
                </label>
                <textarea
                  value={showEditModal.notes ?? ""}
                  onChange={(e) => setShowEditModal({ ...showEditModal, notes: e.target.value })}
                  className="input-compact w-full h-16"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-security-navy-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(null)}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionInProgress}
                  className="btn-primary text-xs py-1.5 px-4"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. REJECT DOCUMENT MODAL */}
      {rejectingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-security-lg border-2 border-red-200 shadow-security-card p-5">
            <h3 className="text-sm font-bold text-red-900 mb-1">Reject Document: {rejectingDoc.title}</h3>
            <p className="text-xs text-security-navy-600 mb-3">
              Provide a reason for rejecting this document so HR and auditing records capture why verification failed.
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Incomplete copy, illegible stamp, registration number mismatch..."
              className="input-compact w-full h-24 text-xs mb-4"
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectingDoc(null)}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionInProgress}
                onClick={handleReject}
                className="btn-primary text-xs py-1.5 px-4 bg-red-600 hover:bg-red-700"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

