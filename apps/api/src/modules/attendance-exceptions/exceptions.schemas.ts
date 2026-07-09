import { z } from "zod";

export const listExceptionsQuerySchema = z.object({
  status: z
    .enum(["OPEN", "UNDER_REVIEW", "APPROVED", "REJECTED", "RESOLVED"])
    .optional(),
  severity: z.enum(["CRITICAL", "MEDIUM", "LOW"]).optional(),
  exceptionType: z.string().optional(),
  siteId: z.string().optional(),
  employeeId: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const reviewExceptionBodySchema = z.object({
  action: z.enum(["approve", "reject", "resolve", "under_review", "mark_absent"]),
  reviewNote: z.string().max(2000).optional(),
});

export const detectExceptionsBodySchema = z.object({
  siteId: z.string().optional(),
  lookbackHours: z.number().int().min(1).max(168).optional().default(48),
  graceMinutes: z.number().int().min(0).max(120).optional().default(15),
});
