import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "@prisma/client";

export interface DocumentTypeDefinition {
  type: string;
  label: string;
  category: string;
  categoryLabel: string;
  isSensitive?: boolean;
  requiresExpiry?: boolean;
  defaultAuthority?: string;
  description?: string;
}

export const DOCUMENT_CATEGORIES: Record<string, { label: string; description: string; isSensitive?: boolean }> = {
  PERSONAL: { label: "Personal Documents", description: "Identity, proof of address, CV and personal records" },
  EMPLOYMENT: { label: "Employment Documents", description: "Contracts, offers, job descriptions, and HR agreements" },
  PAYROLL_STATUTORY: { label: "Payroll & Statutory Documents", description: "Banking details, SARS tax, UIF, and fund documents" },
  LEAVE_MEDICAL: { label: "Leave & Medical Documents", description: "Sick notes, medical certificates, and injury-on-duty files", isSensitive: true },
  DISCIPLINARY: { label: "Disciplinary & HR Documents", description: "Warnings, hearing notices, outcomes, and performance reviews", isSensitive: true },
  EXIT: { label: "Exit Documents", description: "Resignations, dismissals, certificates of service, and clearance forms" },
  PSIRA: { label: "PSiRA Documents", description: "PSiRA registration certificates, grade cards, and accredited training" },
  SPECIALIST_SECURITY: { label: "Specialist Security Certificates", description: "Armed response, CCTV, Access Control, and CIT qualifications" },
  FIREARM: { label: "Firearm Documents", description: "Firearm competency, authorizations, and SAPS/business training", isSensitive: true },
  QUALIFICATIONS: { label: "Other Qualifications", description: "First Aid, Firefighting, OHS, Driver's licenses and PrDP" },
};

export const DOCUMENT_TAXONOMY: DocumentTypeDefinition[] = [
  // 1. Personal Documents
  { type: "sa_id", label: "South African ID / Passport", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },
  { type: "cv", label: "CV / Resume", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },
  { type: "proof_of_address", label: "Proof of Residential Address", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: true },
  { type: "profile_photo", label: "Profile Photo", category: "PERSONAL", categoryLabel: "Personal Documents", requiresExpiry: false },

  // 2. Employment Documents
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

  // 3. Payroll and Statutory Documents
  { type: "bank_details_proof", label: "Proof of Banking Details", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "sars_tax", label: "SARS / Tax Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "uif_doc", label: "UIF Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "provident_fund", label: "Provident Fund Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "pension_fund", label: "Pension Fund Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "nbcpss_doc", label: "NBCPSS Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },
  { type: "other_payroll", label: "Other Payroll Documents", category: "PAYROLL_STATUTORY", categoryLabel: "Payroll & Statutory Documents", requiresExpiry: false },

  // 4. Leave and Medical Documents (Sensitive)
  { type: "medical_certificate", label: "Medical Certificate / Sick Note", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "leave_supporting_doc", label: "Leave Supporting Documents", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "injury_on_duty", label: "Injury on Duty Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "coida_doc", label: "COIDA Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },
  { type: "return_to_work", label: "Return-to-Work Documentation", category: "LEAVE_MEDICAL", categoryLabel: "Leave & Medical Documents", isSensitive: true, requiresExpiry: false },

  // 5. Disciplinary and HR Documents (Sensitive)
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

  // 6. Exit Documents
  { type: "resignation_letter", label: "Resignation Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "termination_letter", label: "Termination Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "dismissal_letter", label: "Dismissal Letter", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "exit_documentation", label: "Exit Documentation", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "certificate_of_service", label: "Certificate of Service", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },
  { type: "other_exit_doc", label: "Other Exit Documents", category: "EXIT", categoryLabel: "Exit Documents", requiresExpiry: false },

  // 7. PSiRA Documents
  { type: "psira_registration_certificate", label: "PSiRA Registration Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_card", label: "PSiRA Card", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: true },
  { type: "psira_grade_e", label: "PSiRA Grade E Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_d", label: "PSiRA Grade D Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_c", label: "PSiRA Grade C Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_b", label: "PSiRA Grade B Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "psira_grade_a", label: "PSiRA Grade A Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", defaultAuthority: "PSiRA", requiresExpiry: false },
  { type: "security_training_certificate", label: "Security Training Certificate", category: "PSIRA", categoryLabel: "PSiRA Documents", requiresExpiry: false },

  // 8. Specialist Security Certificates
  { type: "armed_response_certificate", label: "Armed Response Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "reaction_officer_certificate", label: "Reaction Officer Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "cctv_operator_certificate", label: "CCTV Operator Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "access_control_certificate", label: "Access Control Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "cash_in_transit_certificate", label: "Cash-in-Transit (CIT) Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "special_events_certificate", label: "Special Events Security Certificate", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },
  { type: "other_security_qualification", label: "Other Security Qualification", category: "SPECIALIST_SECURITY", categoryLabel: "Specialist Security Certificates", requiresExpiry: false },

  // 9. Firearm Documents (Sensitive)
  { type: "firearm_competency_certificate", label: "Firearm Competency Certificate", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SAPS", requiresExpiry: true },
  { type: "firearm_training_certificate", label: "Firearm Training Certificate", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SASSETA / PFTC", requiresExpiry: false },
  { type: "business_purpose_firearm_competency", label: "Business-Purpose Firearm Competency", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, defaultAuthority: "SAPS", requiresExpiry: true },
  { type: "firearm_authorisation", label: "Firearm Authorisation Document", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, requiresExpiry: true },
  { type: "other_firearm_doc", label: "Other Firearm Documentation", category: "FIREARM", categoryLabel: "Firearm Documents", isSensitive: true, requiresExpiry: false },

  // 10. Other Qualifications
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

export const TAXONOMY_BY_TYPE = new Map(DOCUMENT_TAXONOMY.map((item) => [item.type, item]));

export function getDocumentDefinition(type: string): DocumentTypeDefinition {
  return (
    TAXONOMY_BY_TYPE.get(type) ?? {
      type,
      label: type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      category: "PERSONAL",
      categoryLabel: "Personal Documents",
    }
  );
}

export type ExpiryState = "VALID" | "EXPIRING_SOON_7D" | "EXPIRING_SOON_30D" | "EXPIRING_SOON_60D" | "EXPIRING_SOON_90D" | "EXPIRED" | "NO_EXPIRY";

export function evaluateExpiryState(expiryDate?: Date | string | null, doesNotExpire = false): {
  state: ExpiryState;
  daysUntilExpiry: number | null;
  hasExpired: boolean;
  isExpiringSoon: boolean;
  label: string;
} {
  if (doesNotExpire || !expiryDate) {
    return {
      state: "NO_EXPIRY",
      daysUntilExpiry: null,
      hasExpired: false,
      isExpiringSoon: false,
      label: "Does not expire",
    };
  }

  const date = typeof expiryDate === "string" ? new Date(expiryDate) : expiryDate;
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (24 * 3600 * 1000));
  const hasExpired = diffMs <= 0;

  if (hasExpired) {
    const overdueDays = Math.abs(daysUntilExpiry);
    return {
      state: "EXPIRED",
      daysUntilExpiry,
      hasExpired: true,
      isExpiringSoon: false,
      label: overdueDays === 0 ? "Expired today" : `Expired ${overdueDays} day(s) ago`,
    };
  }

  if (daysUntilExpiry <= 7) {
    return {
      state: "EXPIRING_SOON_7D",
      daysUntilExpiry,
      hasExpired: false,
      isExpiringSoon: true,
      label: `Expires in ${daysUntilExpiry} day(s)`,
    };
  }

  if (daysUntilExpiry <= 30) {
    return {
      state: "EXPIRING_SOON_30D",
      daysUntilExpiry,
      hasExpired: false,
      isExpiringSoon: true,
      label: `Expires in ${daysUntilExpiry} day(s)`,
    };
  }

  if (daysUntilExpiry <= 60) {
    return {
      state: "EXPIRING_SOON_60D",
      daysUntilExpiry,
      hasExpired: false,
      isExpiringSoon: true,
      label: `Expires in ${daysUntilExpiry} day(s)`,
    };
  }

  if (daysUntilExpiry <= 90) {
    return {
      state: "EXPIRING_SOON_90D",
      daysUntilExpiry,
      hasExpired: false,
      isExpiringSoon: true,
      label: `Expires in ${daysUntilExpiry} day(s)`,
    };
  }

  return {
    state: "VALID",
    daysUntilExpiry,
    hasExpired: false,
    isExpiringSoon: false,
    label: `Expires in ${daysUntilExpiry} days`,
  };
}

export interface RequiredDocumentRule {
  type: string;
  label: string;
  category: string;
  reason: string;
  isRequired: boolean;
}

export function getRequiredRulesForEmployee(employee: {
  employeeType?: string | null;
  status?: string | null;
  psiraGrade?: string | null;
  securityServiceType?: string | null;
  jobRole?: string | null;
}): RequiredDocumentRule[] {
  const status = employee.status ?? "active";
  const rules: RequiredDocumentRule[] = [
    {
      type: "sa_id",
      label: "South African ID / Passport",
      category: "PERSONAL",
      reason: "Statutory identification",
      isRequired: true,
    },
    {
      type: "employment_contract",
      label: "Employment Contract",
      category: "EMPLOYMENT",
      reason: "Basic Conditions of Employment Act (BCEA)",
      isRequired: true,
    },
    {
      type: "bank_details_proof",
      label: "Proof of Banking Details",
      category: "PAYROLL_STATUTORY",
      reason: "Required for payroll disbursement",
      isRequired: status !== "applicant",
    },
  ];

  const isGuard = (employee.employeeType ?? "security_officer") === "security_officer";

  if (isGuard) {
    rules.push({
      type: "psira_registration_certificate",
      label: "PSiRA Registration Certificate",
      category: "PSIRA",
      reason: "Private Security Industry Regulation Act",
      isRequired: true,
    });
    rules.push({
      type: "psira_card",
      label: "PSiRA Card",
      category: "PSIRA",
      reason: "Active PSiRA Identification Card",
      isRequired: true,
    });

    if (employee.psiraGrade) {
      const gradeType = `psira_grade_${employee.psiraGrade.toLowerCase()}`;
      rules.push({
        type: gradeType,
        label: `PSiRA Grade ${employee.psiraGrade.toUpperCase()} Certificate`,
        category: "PSIRA",
        reason: `Verification for registered Grade ${employee.psiraGrade.toUpperCase()}`,
        isRequired: true,
      });
    }
  }

  const roleText = `${employee.jobRole ?? ""} ${employee.securityServiceType ?? ""}`.toLowerCase();
  const isArmed = roleText.includes("armed") || roleText.includes("reaction") || roleText.includes("cit") || roleText.includes("cash in transit");
  if (isArmed) {
    rules.push({
      type: "firearm_competency_certificate",
      label: "Firearm Competency Certificate",
      category: "FIREARM",
      reason: "Mandatory for armed security personnel",
      isRequired: true,
    });
  }

  const isDriver = roleText.includes("driver") || roleText.includes("cit") || roleText.includes("patrol driver");
  if (isDriver) {
    rules.push({
      type: "drivers_licence",
      label: "Driver's Licence",
      category: "QUALIFICATIONS",
      reason: "Required for vehicle operators",
      isRequired: true,
    });
    rules.push({
      type: "prdp",
      label: "Professional Driving Permit (PrDP)",
      category: "QUALIFICATIONS",
      reason: "Required for professional transport / response drivers",
      isRequired: true,
    });
  }

  return rules;
}

export type OverallComplianceStatus = "COMPLIANT" | "ATTENTION_REQUIRED" | "NON_COMPLIANT";

export interface RequirementEvaluation {
  rule: RequiredDocumentRule;
  status: "VERIFIED" | "VALID" | "EXPIRING_SOON" | "EXPIRED" | "PENDING_VERIFICATION" | "REJECTED" | "MISSING";
  documentId?: string;
  documentName?: string;
  fileName?: string;
  verificationStatus?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  daysUntilExpiry?: number | null;
  expiryLabel?: string;
}

export interface EmployeeComplianceResult {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  employeeType: string;
  status: string;
  jobRole?: string | null;
  psiraGrade?: string | null;
  psiraRegistrationNumber?: string | null;
  overallStatus: OverallComplianceStatus;
  summary: {
    totalRequired: number;
    verifiedCount: number;
    pendingCount: number;
    expiringCount: number;
    expiredCount: number;
    missingCount: number;
  };
  requirements: RequirementEvaluation[];
  activeCertificates: Array<{
    id: string;
    type: string;
    label: string;
    category: string;
    documentNumber?: string | null;
    issuingAuthority?: string | null;
    verificationStatus: string;
    expiryDate?: string | null;
    expiryLabel?: string;
    hasExpired: boolean;
    isExpiringSoon: boolean;
  }>;
  totalDocumentsCount: number;
}

export async function calculateEmployeeCompliance(
  companyId: string,
  employeeId: string
): Promise<EmployeeComplianceResult | null> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      employeeType: true,
      status: true,
      jobRole: true,
      psiraGrade: true,
      psiraRegistrationNumber: true,
      securityServiceType: true,
    },
  });

  if (!employee) return null;

  const documents = await prisma.managedDocument.findMany({
    where: {
      companyId,
      employeeId,
      status: { not: "ARCHIVED" },
    },
    orderBy: { createdAt: "desc" },
  });

  const rules = getRequiredRulesForEmployee(employee);
  const requirements: RequirementEvaluation[] = [];

  let verifiedCount = 0;
  let pendingCount = 0;
  let expiringCount = 0;
  let expiredCount = 0;
  let missingCount = 0;

  for (const rule of rules) {
    // Find candidate documents matching documentType or category fallback
    const matchingDocs = documents.filter(
      (d) =>
        d.documentType === rule.type ||
        (rule.type === "psira_registration_certificate" && (d.documentType === "psira_card" || d.documentCategory === "PSIRA"))
    );

    const doc = matchingDocs[0];

    if (!doc) {
      missingCount += 1;
      requirements.push({
        rule,
        status: "MISSING",
      });
      continue;
    }

    const expiryEval = evaluateExpiryState(doc.expiryDate, doc.doesNotExpire);
    let itemStatus: RequirementEvaluation["status"] = "VALID";

    if (doc.verificationStatus === "REJECTED") {
      itemStatus = "REJECTED";
      expiredCount += 1;
    } else if (expiryEval.hasExpired) {
      itemStatus = "EXPIRED";
      expiredCount += 1;
    } else if (doc.verificationStatus === "PENDING_VERIFICATION") {
      itemStatus = "PENDING_VERIFICATION";
      pendingCount += 1;
    } else if (expiryEval.isExpiringSoon) {
      itemStatus = "EXPIRING_SOON";
      expiringCount += 1;
    } else if (doc.verificationStatus === "VERIFIED") {
      itemStatus = "VERIFIED";
      verifiedCount += 1;
    } else {
      itemStatus = "VALID";
      verifiedCount += 1;
    }

    requirements.push({
      rule,
      status: itemStatus,
      documentId: doc.id,
      documentName: doc.title,
      fileName: doc.fileName,
      verificationStatus: doc.verificationStatus,
      issueDate: doc.issueDate?.toISOString(),
      expiryDate: doc.expiryDate?.toISOString(),
      daysUntilExpiry: expiryEval.daysUntilExpiry,
      expiryLabel: expiryEval.label,
    });
  }

  // Active certificates list (PSIRA, Specialist, Firearm, Qualifications)
  const certCategories = new Set(["PSIRA", "SPECIALIST_SECURITY", "FIREARM", "QUALIFICATIONS"]);
  const activeCertificates = documents
    .filter((d) => certCategories.has(d.documentCategory ?? "") || d.documentType.startsWith("psira_") || d.documentType.includes("certificate"))
    .map((d) => {
      const def = getDocumentDefinition(d.documentType);
      const exp = evaluateExpiryState(d.expiryDate, d.doesNotExpire);
      return {
        id: d.id,
        type: d.documentType,
        label: def.label,
        category: d.documentCategory ?? def.category,
        documentNumber: d.documentNumber,
        issuingAuthority: d.issuingAuthority,
        verificationStatus: d.verificationStatus,
        expiryDate: d.expiryDate?.toISOString(),
        expiryLabel: exp.label,
        hasExpired: exp.hasExpired,
        isExpiringSoon: exp.isExpiringSoon,
      };
    });

  // Overall status calculation
  let overallStatus: OverallComplianceStatus = "COMPLIANT";
  if (missingCount > 0 || expiredCount > 0) {
    overallStatus = "NON_COMPLIANT";
  } else if (expiringCount > 0 || pendingCount > 0) {
    overallStatus = "ATTENTION_REQUIRED";
  }

  return {
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeType: employee.employeeType,
    status: employee.status,
    jobRole: employee.jobRole,
    psiraGrade: employee.psiraGrade,
    psiraRegistrationNumber: employee.psiraRegistrationNumber,
    overallStatus,
    summary: {
      totalRequired: rules.length,
      verifiedCount,
      pendingCount,
      expiringCount,
      expiredCount,
      missingCount,
    },
    requirements,
    activeCertificates,
    totalDocumentsCount: documents.length,
  };
}

export interface CompanyComplianceSummary {
  totalEmployees: number;
  fullyCompliantCount: number;
  attentionRequiredCount: number;
  nonCompliantCount: number;
  complianceRatePercent: number;
  documentsExpiringSoonCount: number;
  employeesMissingDocumentsCount: number;
  employeesWithExpiredDocumentsCount: number;
  psiraVerificationPendingCount: number;
}

export async function getCompanyComplianceSummary(companyId: string): Promise<CompanyComplianceSummary> {
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      status: { in: ["active", "training", "hired", "reliever"] },
    },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      employeeType: true,
      status: true,
      jobRole: true,
      psiraGrade: true,
      securityServiceType: true,
    },
  });

  const allDocuments = await prisma.managedDocument.findMany({
    where: {
      companyId,
      employeeId: { not: null },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      employeeId: true,
      documentType: true,
      documentCategory: true,
      verificationStatus: true,
      expiryDate: true,
      doesNotExpire: true,
    },
  });

  const docsByEmployee = new Map<string, typeof allDocuments>();
  for (const doc of allDocuments) {
    if (!doc.employeeId) continue;
    if (!docsByEmployee.has(doc.employeeId)) docsByEmployee.set(doc.employeeId, []);
    docsByEmployee.get(doc.employeeId)!.push(doc);
  }

  let fullyCompliantCount = 0;
  let attentionRequiredCount = 0;
  let nonCompliantCount = 0;
  let documentsExpiringSoonCount = 0;
  let employeesMissingDocumentsCount = 0;
  let employeesWithExpiredDocumentsCount = 0;
  let psiraVerificationPendingCount = 0;

  for (const emp of employees) {
    const empDocs = docsByEmployee.get(emp.id) ?? [];
    const rules = getRequiredRulesForEmployee(emp);

    let hasMissing = false;
    let hasExpired = false;
    let hasExpiringSoon = false;
    let hasPending = false;

    for (const rule of rules) {
      const match = empDocs.find(
        (d) =>
          d.documentType === rule.type ||
          (rule.type === "psira_registration_certificate" && (d.documentType === "psira_card" || d.documentCategory === "PSIRA"))
      );

      if (!match) {
        hasMissing = true;
        continue;
      }

      if (match.documentCategory === "PSIRA" && match.verificationStatus === "PENDING_VERIFICATION") {
        psiraVerificationPendingCount += 1;
      }

      const exp = evaluateExpiryState(match.expiryDate, match.doesNotExpire);
      if (exp.hasExpired || match.verificationStatus === "REJECTED") {
        hasExpired = true;
      } else if (exp.isExpiringSoon) {
        hasExpiringSoon = true;
        documentsExpiringSoonCount += 1;
      } else if (match.verificationStatus === "PENDING_VERIFICATION") {
        hasPending = true;
      }
    }

    if (hasMissing) employeesMissingDocumentsCount += 1;
    if (hasExpired) employeesWithExpiredDocumentsCount += 1;

    if (hasMissing || hasExpired) {
      nonCompliantCount += 1;
    } else if (hasExpiringSoon || hasPending) {
      attentionRequiredCount += 1;
    } else {
      fullyCompliantCount += 1;
    }
  }

  const total = employees.length;
  const complianceRatePercent = total > 0 ? Math.round((fullyCompliantCount / total) * 100) : 100;

  return {
    totalEmployees: total,
    fullyCompliantCount,
    attentionRequiredCount,
    nonCompliantCount,
    complianceRatePercent,
    documentsExpiringSoonCount,
    employeesMissingDocumentsCount,
    employeesWithExpiredDocumentsCount,
    psiraVerificationPendingCount,
  };
}

export interface ComplianceReportFilters {
  status?: string;
  complianceStatus?: OverallComplianceStatus;
  employeeType?: string;
  psiraGrade?: string;
  groupId?: string;
  search?: string;
  expiryFilter?: "expired" | "expiring_30d" | "expiring_60d" | "missing_required";
  limit?: number;
  offset?: number;
}

export async function getCompanyComplianceReport(
  companyId: string,
  filters: ComplianceReportFilters = {}
) {
  const where: Prisma.EmployeeWhereInput = {
    companyId,
    ...(filters.status && filters.status !== "all" ? { status: filters.status as never } : {}),
    ...(filters.employeeType ? { employeeType: filters.employeeType } : {}),
    ...(filters.psiraGrade ? { psiraGrade: filters.psiraGrade } : {}),
    ...(filters.groupId ? { groupId: filters.groupId } : {}),
    ...(filters.search
      ? {
          OR: [
            { firstName: { contains: filters.search, mode: "insensitive" } },
            { lastName: { contains: filters.search, mode: "insensitive" } },
            { employeeNumber: { contains: filters.search, mode: "insensitive" } },
            { idNumber: { contains: filters.search, mode: "insensitive" } },
            { psiraRegistrationNumber: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      group: { select: { id: true, name: true } },
      grade: { select: { id: true, name: true } },
    },
  });

  const results: EmployeeComplianceResult[] = [];
  for (const emp of employees) {
    const comp = await calculateEmployeeCompliance(companyId, emp.id);
    if (!comp) continue;

    if (filters.complianceStatus && comp.overallStatus !== filters.complianceStatus) {
      continue;
    }

    if (filters.expiryFilter === "expired" && comp.summary.expiredCount === 0) {
      continue;
    }
    if (filters.expiryFilter === "expiring_30d" && comp.summary.expiringCount === 0) {
      continue;
    }
    if (filters.expiryFilter === "missing_required" && comp.summary.missingCount === 0) {
      continue;
    }

    results.push(comp);
  }

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  const paginated = results.slice(offset, offset + limit);

  return {
    items: paginated,
    total: results.length,
  };
}
