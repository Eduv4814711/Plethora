import { z } from "zod";

export const CLIENT_ENTITY_TYPES = [
  "PRIVATE_COMPANY",
  "CLOSE_CORPORATION",
  "TRUST",
  "PARTNERSHIP",
  "SOLE_PROPRIETOR",
  "NATURAL_PERSON",
  "GOVERNMENT",
  "MUNICIPALITY",
  "BODY_CORPORATE_HOA",
  "NPO",
  "OTHER",
] as const;

export const CLIENT_ONBOARDING_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "READY",
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
] as const;

export const CLIENT_CONTACT_TYPES = [
  "PRIMARY",
  "OPERATIONS",
  "BILLING",
  "EMERGENCY",
  "PROCUREMENT",
  "LEGAL",
  "INFORMATION_OFFICER",
  "AUTHORISED_SIGNATORY",
  "REPORT_RECIPIENT",
  "OTHER",
] as const;

export const CLIENT_RELATIONSHIP_TYPES = [
  "DIRECTOR",
  "MEMBER",
  "TRUSTEE",
  "PARTNER",
  "BENEFICIAL_OWNER",
  "AUTHORISED_SIGNATORY",
  "OTHER",
] as const;

export const CLIENT_CONTRACT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PENDING_RENEWAL",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
] as const;

export const CONTRACT_RENEWAL_TYPES = [
  "FIXED_TERM",
  "AUTO_RENEW_MONTHLY",
  "AUTO_RENEW_ANNUAL",
  "MONTH_TO_MONTH",
  "EVERGREEN",
] as const;

export const OPERATOR_AGREEMENT_STATUSES = [
  "NOT_APPLICABLE",
  "REQUIRED",
  "SENT",
  "SIGNED",
  "EXPIRED",
] as const;

// Shared billing fields
export const billingFieldsSchema = {
  billingEmail: z.string().email().optional().nullable(),
  billingAddress: z.string().max(1000).optional().nullable(),
  vatNumber: z.string().max(50).optional().nullable(),
  registrationNumber: z.string().max(50).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
};

// Shared contact & reporting fields
export const contactFieldsSchema = {
  contactPersonName: z.string().max(150).optional().nullable(),
  contactPersonRole: z.string().max(150).optional().nullable(),
  contactPersonMobile: z.string().max(40).optional().nullable(),
  physicalAddress: z.string().max(1000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  reportRecipients: z.array(z.string().email()).max(20).optional(),
};

// Client Identity fields
export const clientIdentityFieldsSchema = {
  legalName: z.string().max(255).optional().nullable(),
  tradingName: z.string().max(255).optional().nullable(),
  entityType: z.enum(CLIENT_ENTITY_TYPES).optional().nullable(),
  taxNumber: z.string().max(50).optional().nullable(),
  registeredAddress: z.string().max(1000).optional().nullable(),
  onboardingStatus: z.enum(CLIENT_ONBOARDING_STATUSES).optional(),
  onboardingCompletedAt: z.string().datetime().optional().nullable(),
};

export const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  userId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  ...clientIdentityFieldsSchema,
  ...billingFieldsSchema,
  ...contactFieldsSchema,
});

export const updateClientSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  userId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  ...clientIdentityFieldsSchema,
  ...billingFieldsSchema,
  ...contactFieldsSchema,
});

export const createContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional().nullable(),
  jobTitle: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().max(40).optional().nullable(),
  contactType: z.enum(CLIENT_CONTACT_TYPES).default("OTHER"),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});

export const updateContactSchema = createContactSchema.partial();

export const createRelatedPartySchema = z.object({
  fullName: z.string().min(1).max(200),
  relationshipType: z.enum(CLIENT_RELATIONSHIP_TYPES),
  ownershipPercent: z.number().min(0).max(100).optional().nullable(),
  isAuthorisedSignatory: z.boolean().default(false),
  authorityReference: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateRelatedPartySchema = createRelatedPartySchema.partial();

export const createContractSchema = z.object({
  contractNumber: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  status: z.enum(CLIENT_CONTRACT_STATUSES).default("ACTIVE"),
  signedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  noticePeriodDays: z.number().int().min(0).max(365).default(30),
  renewalType: z.enum(CONTRACT_RENEWAL_TYPES).default("FIXED_TERM"),
  autoRenew: z.boolean().default(false),
  scopeSummary: z.string().max(5000).optional().nullable(),
  serviceTypes: z.array(z.string().max(100)).default([]),
  notes: z.string().max(5000).optional().nullable(),
  siteIds: z.array(z.string().min(1)).optional(),
});

export const updateContractSchema = z.object({
  contractNumber: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(255).optional(),
  status: z.enum(CLIENT_CONTRACT_STATUSES).optional(),
  signedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  noticePeriodDays: z.number().int().min(0).max(365).optional(),
  renewalType: z.enum(CONTRACT_RENEWAL_TYPES).optional(),
  autoRenew: z.boolean().optional(),
  scopeSummary: z.string().max(5000).optional().nullable(),
  serviceTypes: z.array(z.string().max(100)).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

export const linkContractSitesSchema = z.object({
  siteIds: z.array(z.string().min(1)).min(1).max(100),
});

export const updateDataProcessingProfileSchema = z.object({
  responsiblePartyName: z.string().max(200).optional().nullable(),
  informationOfficerName: z.string().max(200).optional().nullable(),
  informationOfficerEmail: z.string().email().optional().nullable(),
  informationOfficerPhone: z.string().max(40).optional().nullable(),
  processingPurposes: z.array(z.string().max(100)).optional(),
  dataCategories: z.array(z.string().max(100)).optional(),
  hasCrossBorderTransfer: z.boolean().optional(),
  crossBorderDetails: z.string().max(2000).optional().nullable(),
  operatorAgreementStatus: z.enum(OPERATOR_AGREEMENT_STATUSES).optional(),
  operatorAgreementSignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  operatorAgreementDocumentId: z.string().optional().nullable(),
  privacyNoticeProvided: z.boolean().optional(),
  privacyNoticeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  retentionPolicyNotes: z.string().max(2000).optional().nullable(),
  securityMeasuresNotes: z.string().max(2000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});
