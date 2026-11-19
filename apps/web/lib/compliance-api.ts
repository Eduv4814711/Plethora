import { authFetch } from "./api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceObligationType =
  | "PSIRA_COMPANY"
  | "DIRECTOR_VETTING"
  | "EMPLOYEE_PSIRA"
  | "NBCPSS"
  | "SARS_TAX_CLEARANCE"
  | "COIDA"
  | "UIF"
  | "PSSPF"
  | "PUBLIC_LIABILITY"
  | "POPIA"
  | "OTHER";

export type ComplianceObligationStatus =
  | "COMPLIANT"
  | "ATTENTION_REQUIRED"
  | "NON_COMPLIANT"
  | "PENDING_VERIFICATION"
  | "NOT_APPLICABLE";

export type ComplianceRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ComplianceSummary {
  overallHealthScore: number;
  obligations: {
    total: number;
    compliant: number;
    attentionRequired: number;
    nonCompliant: number;
    pendingVerification: number;
    notApplicable: number;
  };
  remediations: {
    activeCount: number;
    totalDebt: number;
  };
  legalCases: {
    openCount: number;
    highRiskCount: number;
  };
}

export interface ComplianceObligation {
  id: string;
  companyId: string;
  type: ComplianceObligationType;
  title: string;
  authority?: string | null;
  referenceNumber?: string | null;
  status: ComplianceObligationStatus;
  riskLevel: ComplianceRiskLevel;
  ownerUserId?: string | null;
  effectiveDate?: string | null;
  dueDate?: string | null;
  expiryDate?: string | null;
  expectedAmount?: number | null;
  paidAmount?: number | null;
  notes?: string | null;
  primaryEvidenceDocumentId?: string | null;
  lastVerifiedAt?: string | null;
  owner?: { id: string; name: string; email: string } | null;
  verifiedBy?: { id: string; name: string; email: string } | null;
  managementOverride?: { id: string; name: string; email: string } | null;
  managementOverrideReason?: string | null;
}

export interface LegalCase {
  id: string;
  caseNumber: string;
  caseType: string;
  title: string;
  description?: string | null;
  riskLevel: ComplianceRiskLevel;
  status: string;
  dateReceived: string;
  nextEventDate?: string | null;
  nextAction?: string | null;
  outcome?: string | null;
  assignedTo?: { id: string; name: string } | null;
  employee?: { id: string; firstName: string; lastName: string } | null;
}

export interface RemediationPlan {
  id: string;
  title: string;
  originalBalance: number;
  currentBalance: number;
  installmentAmount: number;
  frequency: string;
  startDate: string;
  endDate?: string | null;
  nextPaymentDate?: string | null;
  status: string;
  externalAgreementReference?: string | null;
  obligation?: { id: string; title: string; type: string } | null;
}

// ---------------------------------------------------------------------------
// API Methods
// ---------------------------------------------------------------------------

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.error || `Request failed with ${res.status}`);
  }
  return res.json();
}

export async function fetchComplianceSummary(token: string): Promise<ComplianceSummary> {
  const res = await authFetch("/compliance/summary", token);
  return handleResponse<ComplianceSummary>(res);
}

export async function syncComplianceAlerts(token: string): Promise<{ createdCount: number; scannedCount: number }> {
  const res = await authFetch("/compliance/sync-alerts", token, { method: "POST" });
  return handleResponse(res);
}

export async function fetchObligations(
  token: string,
  params?: { type?: string; status?: string; riskLevel?: string; search?: string }
): Promise<{ items: ComplianceObligation[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.status) query.set("status", params.status);
  if (params?.riskLevel) query.set("riskLevel", params.riskLevel);
  if (params?.search) query.set("search", params.search);

  const res = await authFetch(`/compliance/obligations?${query.toString()}`, token);
  return handleResponse(res);
}

export async function createObligation(token: string, data: Partial<ComplianceObligation>): Promise<ComplianceObligation> {
  const res = await authFetch("/compliance/obligations", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse<ComplianceObligation>(res);
}

export async function updateObligation(token: string, id: string, data: Partial<ComplianceObligation>): Promise<ComplianceObligation> {
  const res = await authFetch(`/compliance/obligations/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return handleResponse<ComplianceObligation>(res);
}

export async function markObligationCompliant(
  token: string,
  id: string,
  data: { primaryEvidenceDocumentId?: string; notes?: string }
): Promise<ComplianceObligation> {
  const res = await authFetch(`/compliance/obligations/${id}/mark-compliant`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse<ComplianceObligation>(res);
}

export async function managementOverrideObligation(
  token: string,
  id: string,
  targetStatus: string,
  reason: string
): Promise<ComplianceObligation> {
  const res = await authFetch(`/compliance/obligations/${id}/management-override`, token, {
    method: "POST",
    body: JSON.stringify({ targetStatus, reason }),
  });
  return handleResponse<ComplianceObligation>(res);
}

export async function deleteObligation(token: string, id: string): Promise<void> {
  const res = await authFetch(`/compliance/obligations/${id}`, token, { method: "DELETE" });
  return handleResponse(res);
}

// Legal Cases & Remediation
export async function fetchLegalCases(token: string, params?: any): Promise<{ items: LegalCase[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.caseType) query.set("caseType", params.caseType);
  if (params?.status) query.set("status", params.status);
  const res = await authFetch(`/compliance/legal-cases?${query.toString()}`, token);
  return handleResponse(res);
}

export async function createLegalCase(token: string, data: any): Promise<LegalCase> {
  const res = await authFetch("/compliance/legal-cases", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse<LegalCase>(res);
}

export async function fetchRemediationPlans(token: string, params?: any): Promise<{ items: RemediationPlan[]; total: number }> {
  const res = await authFetch("/compliance/remediation-plans", token);
  return handleResponse(res);
}

export async function createRemediationPlan(token: string, data: any): Promise<RemediationPlan> {
  const res = await authFetch("/compliance/remediation-plans", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse<RemediationPlan>(res);
}

// Reports
export async function fetchTenderPack(token: string): Promise<any> {
  const res = await authFetch("/compliance/reports/tender-pack", token);
  return handleResponse(res);
}

export async function fetchExecutiveRiskReport(token: string): Promise<any> {
  const res = await authFetch("/compliance/reports/executive-risk", token);
  return handleResponse(res);
}
