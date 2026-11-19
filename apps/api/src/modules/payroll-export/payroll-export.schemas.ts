import { z } from "zod";

export const payrollExportProviderSchema = z.enum([
  "SAGE_BUSINESS_CLOUD_ZA",
  "SAGE_VIP",
  "SAGE_300_PEOPLE",
  "GENERIC_CSV",
  "JSON_WEBHOOK",
]);

export const customColumnSchema = z.object({
  header: z.string().trim().min(1).max(60),
  fixedValue: z.string().max(120).optional(),
  field: z
    .enum([
      "periodKey",
      "companyName",
      "employeeNumber",
      "externalPayrollCode",
      "siteName",
      "costCenterCode",
    ])
    .optional(),
});

export const codeMappingSchema = z
  .object({
    regularHours: z.string().trim().min(1).max(40).optional(),
    overtimeHours: z.string().trim().min(1).max(40).optional(),
    sundayHours: z.string().trim().min(1).max(40).optional(),
    publicHolidayHours: z.string().trim().min(1).max(40).optional(),
    nightShiftHours: z.string().trim().min(1).max(40).optional(),
    annualLeaveHours: z.string().trim().min(1).max(40).optional(),
    sickLeaveHours: z.string().trim().min(1).max(40).optional(),
    familyLeaveHours: z.string().trim().min(1).max(40).optional(),
    studyLeaveHours: z.string().trim().min(1).max(40).optional(),
    unpaidLeaveHours: z.string().trim().min(1).max(40).optional(),
  })
  .optional();

export const createProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: payrollExportProviderSchema,
  isDefault: z.boolean().optional(),
  splitBySite: z.boolean().optional(),
  delimiter: z.enum([",", ";", "|", "\t"]).optional(),
  dateFormat: z.enum(["yyyy-MM-dd", "dd/MM/yyyy", "dd-MM-yyyy", "yyyyMMdd"]).optional(),
  codeMappingJson: codeMappingSchema,
  customColumnsJson: z.array(customColumnSchema).max(10).nullable().optional(),
});

export const updateProfileSchema = createProfileSchema.partial();

export const previewExportSchema = z.object({
  periodKey: z.string().trim().min(1).max(40).optional(),
  profileId: z.string().trim().min(1).optional(),
  splitBySite: z.boolean().optional(),
});

export const createBatchSchema = z.object({
  periodKey: z.string().trim().min(1).max(40).optional(),
  profileId: z.string().trim().min(1).optional(),
  splitBySite: z.boolean().optional(),
  overrideReason: z.string().trim().min(5).max(500).optional(),
});

export const lockBatchSchema = z.object({
  overrideReason: z.string().trim().min(5).max(500).optional(),
});

export const voidBatchSchema = z.object({
  reason: z.string().trim().min(5, "Void reason must be at least 5 characters").max(500),
});
