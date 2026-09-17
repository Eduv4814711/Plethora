import { z } from "zod";

export const complianceObligationTypeSchema = z.enum([
  "PSIRA_COMPANY",
  "DIRECTOR_VETTING",
  "EMPLOYEE_PSIRA",
  "NBCPSS",
  "SARS_TAX_CLEARANCE",
  "COIDA",
  "UIF",
  "PSSPF",
  "PUBLIC_LIABILITY",
  "POPIA",
  "OTHER",
]);

export const complianceObligationStatusSchema = z.enum([
  "COMPLIANT",
  "ATTENTION_REQUIRED",
  "NON_COMPLIANT",
  "PENDING_VERIFICATION",
  "NOT_APPLICABLE",
]);

export const complianceRiskLevelSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const statutorySchemeSchema = z.enum([
  "PAYE",
  "UIF",
  "SDL",
  "PSSPF",
  "NBCPSS",
  "COIDA",
  "OTHER",
]);

export const statutoryPeriodStatusSchema = z.enum([
  "CALCULATED",
  "DECLARED",
  "PARTIALLY_PAID",
  "PAID",
  "FAILED",
  "OVERDUE",
  "DISPUTED",
]);

export const statutoryPaymentStatusSchema = z.enum([
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REVERSED",
]);

export const legalCaseTypeSchema = z.enum([
  "CCMA",
  "LABOUR_COURT",
  "REGULATORY",
  "EMPLOYEE_DISPUTE",
  "OTHER",
]);

export const legalCaseStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_OUTCOME",
  "SETTLED",
  "CLOSED",
  "WITHDRAWN",
]);

export const cashCommitmentCategorySchema = z.enum([
  "PAYROLL",
  "STATUTORY",
  "CRITICAL_SUPPLIER",
  "OPERATING_EXPENSE",
  "REMEDIATION_PAYMENT",
  "CAPEX",
  "RELATED_PARTY_OR_INVESTMENT",
  "OTHER",
]);

export const cashCommitmentFrequencySchema = z.enum([
  "ONCE",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
]);

export const remediationPlanStatusSchema = z.enum([
  "ACTIVE",
  "COMPLETED",
  "DEFAULTED",
  "SUSPENDED",
]);

export const remediationFrequencySchema = z.enum([
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
]);

// Obligation schemas
export const listObligationsQuerySchema = z.object({
  type: complianceObligationTypeSchema.optional(),
  status: complianceObligationStatusSchema.optional(),
  riskLevel: complianceRiskLevelSchema.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createObligationSchema = z.object({
  type: complianceObligationTypeSchema,
  title: z.string().min(1).max(200),
  authority: z.string().max(200).optional(),
  referenceNumber: z.string().max(100).optional(),
  status: complianceObligationStatusSchema.optional().default("PENDING_VERIFICATION"),
  riskLevel: complianceRiskLevelSchema.optional().default("MEDIUM"),
  ownerUserId: z.string().optional(),
  effectiveDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  expectedAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  primaryEvidenceDocumentId: z.string().optional(),
});

export const updateObligationSchema = createObligationSchema.partial();

export const markCompliantSchema = z.object({
  primaryEvidenceDocumentId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export const managementOverrideSchema = z.object({
  targetStatus: complianceObligationStatusSchema,
  reason: z.string().min(5, "Management override reason is required").max(2000),
});

// Statutory Period schemas
export const listStatutoryPeriodsQuerySchema = z.object({
  scheme: statutorySchemeSchema.optional(),
  status: statutoryPeriodStatusSchema.optional(),
  year: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createStatutoryPeriodSchema = z.object({
  scheme: statutorySchemeSchema,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  dueDate: z.coerce.date(),
  expectedEmployeeAmount: z.coerce.number().min(0).default(0),
  expectedEmployerAmount: z.coerce.number().min(0).default(0),
  expectedOtherAmount: z.coerce.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
  sourcePayrollRunIds: z.array(z.string()).optional(),
});

export const updateStatutoryPeriodSchema = z.object({
  declaredTotal: z.coerce.number().min(0).optional(),
  externalReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  status: statutoryPeriodStatusSchema.optional(),
});

export const advancePeriodStatusSchema = z.object({
  targetStatus: statutoryPeriodStatusSchema,
  declaredTotal: z.coerce.number().min(0).optional(),
  externalReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const recordStatutoryPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentDate: z.coerce.date(),
  status: statutoryPaymentStatusSchema.default("SUCCESS"),
  paymentReference: z.string().max(100).optional(),
  externalReference: z.string().max(100).optional(),
  failureReason: z.string().max(2000).optional(),
  proofDocumentId: z.string().optional(),
});

export const listContributionsFilterSchema = z.object({
  scheme: statutorySchemeSchema.optional(),
  employeeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// Remediation schemas
export const listRemediationPlansQuerySchema = z.object({
  status: remediationPlanStatusSchema.optional(),
  scheme: statutorySchemeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createRemediationPlanSchema = z.object({
  obligationId: z.string().optional(),
  scheme: statutorySchemeSchema.optional(),
  title: z.string().min(1).max(200),
  originalBalance: z.coerce.number().min(0),
  currentBalance: z.coerce.number().min(0),
  installmentAmount: z.coerce.number().min(0),
  frequency: remediationFrequencySchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  nextPaymentDate: z.coerce.date().optional(),
  externalAgreementReference: z.string().max(100).optional(),
  primaryEvidenceDocumentId: z.string().optional(),
  ownerUserId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateRemediationPlanSchema = createRemediationPlanSchema.partial().extend({
  status: remediationPlanStatusSchema.optional(),
});

// Legal Case schemas
export const listLegalCasesQuerySchema = z.object({
  caseType: legalCaseTypeSchema.optional(),
  status: legalCaseStatusSchema.optional(),
  riskLevel: complianceRiskLevelSchema.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createLegalCaseSchema = z.object({
  caseNumber: z.string().min(1).max(100),
  caseType: legalCaseTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  riskLevel: complianceRiskLevelSchema.optional().default("MEDIUM"),
  status: legalCaseStatusSchema.optional().default("OPEN"),
  dateReceived: z.coerce.date(),
  nextEventDate: z.coerce.date().optional(),
  assignedToId: z.string().optional(),
  employeeId: z.string().optional(),
  nextAction: z.string().max(2000).optional(),
  primaryDocumentId: z.string().optional(),
});

export const updateLegalCaseSchema = createLegalCaseSchema.partial().extend({
  outcome: z.string().max(5000).optional(),
  closedAt: z.coerce.date().optional(),
});

// Cash Commitment schemas
export const createCashCommitmentSchema = z.object({
  name: z.string().min(1).max(200),
  category: cashCommitmentCategorySchema,
  amount: z.coerce.number().positive(),
  frequency: cashCommitmentFrequencySchema.optional().default("MONTHLY"),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  protected: z.boolean().optional().default(false),
  priority: z.coerce.number().int().min(0).max(100).optional().default(0),
  active: z.boolean().optional().default(true),
  supplierOrPayee: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateCashCommitmentSchema = createCashCommitmentSchema.partial();

export const createCashSnapshotSchema = z.object({
  availableCash: z.coerce.number(),
  notes: z.string().max(2000).optional(),
});

// Statutory Rate Config schemas
export const createStatutoryRateConfigSchema = z.object({
  scheme: statutorySchemeSchema,
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional(),
  employeeRate: z.coerce.number().min(0).max(1).optional(),
  employerRate: z.coerce.number().min(0).max(1).optional(),
  earningsCeiling: z.coerce.number().min(0).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  sourceReference: z.string().max(200).optional(),
  isProvisional: z.boolean().optional().default(false),
});

// Employment Exit schemas
export const listEmploymentExitsQuerySchema = z.object({
  terminationStatus: z.string().optional(),
  employeeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createEmploymentExitSchema = z.object({
  employeeId: z.string(),
  lastWorkingDate: z.coerce.date(),
  reason: z.string().max(500).optional(),
  siteId: z.string().optional(),
  redeployed: z.boolean().optional().default(false),
  newSiteId: z.string().optional(),
  terminationStatus: z.string().optional().default("pending"),
  uifDeclarationCompleted: z.boolean().optional().default(false),
  certificateOfServiceCompleted: z.boolean().optional().default(false),
  finalPayrollCompleted: z.boolean().optional().default(false),
  notes: z.string().max(5000).optional(),
});

export const updateEmploymentExitSchema = createEmploymentExitSchema.partial();
