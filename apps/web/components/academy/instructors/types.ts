"use client";

export type InstructorStatus = "active" | "inactive" | "suspended" | "contract_ended";
export type CertificateStatus = "valid" | "expiring_soon" | "expired" | "missing";
export type ContractHealth = "valid" | "expiring_soon" | "expired" | "missing";
export type ComplianceStatus =
  | "compliant"
  | "attention_needed"
  | "high_risk"
  | "pending_review"
  | "archived"
  | "missing_contract"
  | "missing_certificate"
  | "expired_contract"
  | "expired_certificate";
export type DocumentVerificationStatus = "verified" | "pending_review" | "missing" | "expired";

export interface InstructorBranchOption {
  id: string;
  name: string;
}

export interface InstructorCourseOption {
  id: string;
  code?: string | null;
  title: string;
}

export interface InstructorDocument {
  id: string;
  instructorId: string;
  documentType: string;
  downloadUrl?: string;
  fileName: string;
  issueDate: string | null;
  expiryDate: string | null;
  verificationStatus: DocumentVerificationStatus | string;
  uploadedBy?: { id: string; name?: string | null; email?: string | null } | null;
  uploadedAt?: string | null;
  verifiedBy?: { id: string; name?: string | null; email?: string | null } | null;
  verifiedAt?: string | null;
  notes?: string | null;
}

export interface InstructorAuditItem {
  id: string;
  at: string;
  action: string;
  userName: string | null;
  entityType: string;
}

export interface InstructorRecord {
  id: string;
  fullName: string;
  idNumber: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  residentialAddress: string | null;
  emergencyContact: string | null;
  psiraInstructorNumber: string | null;
  instructorGrade: string | null;
  qualification: string | null;
  accreditationScope: string | null;
  accreditationStatus: string | null;
  certificateNumber: string | null;
  certificateIssueDate: string | null;
  certificateExpiryDate: string | null;
  employmentType: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractStatus: string | null;
  assignedBranchId: string | null;
  assignedBranch?: { id: string; name: string } | null;
  assignedCourseIds: string[];
  assignedCourses: InstructorCourseOption[];
  complianceStatus: string | null;
  complianceStatusComputed: ComplianceStatus | string;
  certificateStatus: CertificateStatus | string;
  contractStatusComputed: ContractHealth | string;
  contractDaysRemaining: number | null;
  status: InstructorStatus;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  missingDocumentTypes: string[];
  missingDocumentsCount: number;
  documents?: Array<{
    id: string;
    documentType: string;
    verificationStatus: string;
    expiryDate: string | null;
  }>;
}

export interface InstructorSummary {
  totalInstructors: number;
  activeInstructors: number;
  expiringContracts: number;
  missingDocuments: number;
  suspendedInactive: number;
  psiraComplianceScore: number;
  highRisk: number;
  attentionNeeded: number;
}

export interface InstructorFilters {
  search: string;
  status: string;
  complianceStatus: string;
  contractExpiry: string;
  branchId: string;
  courseId: string;
  sort: string;
}

export interface InstructorFormState {
  fullName: string;
  status: InstructorStatus;
  idNumber: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  residentialAddress: string;
  emergencyContact: string;
  psiraInstructorNumber: string;
  instructorGrade: string;
  qualification: string;
  accreditationScope: string;
  accreditationStatus: string;
  certificateNumber: string;
  certificateIssueDate: string;
  certificateExpiryDate: string;
  employmentType: string;
  contractStartDate: string;
  contractEndDate: string;
  contractStatus: string;
  assignedBranchId: string;
  assignedCourseIds: string[];
  complianceStatus: string;
  notes: string;
}

export type InstructorFormErrors = Partial<Record<keyof InstructorFormState, string>>;

export const DEFAULT_INSTRUCTOR_FORM: InstructorFormState = {
  fullName: "",
  status: "active",
  idNumber: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  residentialAddress: "",
  emergencyContact: "",
  psiraInstructorNumber: "",
  instructorGrade: "",
  qualification: "",
  accreditationScope: "",
  accreditationStatus: "",
  certificateNumber: "",
  certificateIssueDate: "",
  certificateExpiryDate: "",
  employmentType: "",
  contractStartDate: "",
  contractEndDate: "",
  contractStatus: "",
  assignedBranchId: "",
  assignedCourseIds: [],
  complianceStatus: "",
  notes: "",
};
