import { z } from "zod";

export const alertPrioritySchema = z.enum(["CRITICAL", "MEDIUM", "LOW"]);
export const alertStatusSchema = z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]);
export const alertSourceModuleSchema = z.enum([
  "DASHBOARD",
  "ATTENDANCE",
  "ROSTERING",
  "PAYROLL",
  "TASKS",
  "SITES",
  "DOCUMENTS",
  "INCIDENTS",
  "REPORTS",
  "WHATSAPP",
  "APPROVALS",
  "COMPLIANCE",
]);

export const listAlertsQuerySchema = z.object({
  priority: alertPrioritySchema.optional(),
  status: alertStatusSchema.optional(),
  sourceModule: alertSourceModuleSchema.optional(),
  siteId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const resolveAlertBodySchema = z.object({
  note: z.string().max(2000).optional(),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
