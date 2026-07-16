import { z } from "zod";

const shiftCodeSchema = z.enum(["D", "N", "O", "L", "SL", "TR", "SB", "AWOL", "R", "blank"]);

export const patternCellSchema = z.object({
  guardId: z.string().min(1),
  patternDayIndex: z.number().int().min(0),
  shiftCode: shiftCodeSchema,
  isLocked: z.boolean().optional(),
});

export const createPatternSchema = z.object({
  siteId: z.string().min(1),
  name: z.string().min(1),
  anchorDate: z.string().min(1),
  cycleLengthDays: z.number().int().min(1).max(62),
  effectiveFrom: z.string().min(1),
  cells: z.array(patternCellSchema).optional(),
});

export const updatePatternSchema = z.object({
  name: z.string().min(1).optional(),
  anchorDate: z.string().min(1).optional(),
  cycleLengthDays: z.number().int().min(1).max(62).optional(),
  effectiveFrom: z.string().min(1).optional(),
  cells: z.array(patternCellSchema).optional(),
});

export const activatePatternSchema = z.object({
  effectiveFrom: z.string().min(1).optional(),
  changeReason: z.string().optional(),
});

export const patternGridQuerySchema = z.object({
  siteId: z.string().min(1),
  patternId: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  cycleLengthDays: z.coerce.number().int().min(1).max(62).optional(),
  anchorDate: z.string().optional(),
});

export const liveRosterQuerySchema = z.object({
  siteId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  fillFromPattern: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const generateRosterSchema = z.object({
  siteId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  persist: z.boolean().optional(),
});

export const publishRosterSchema = z.object({
  siteId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  replaceExisting: z.boolean().optional(),
  reason: z.string().min(5).max(2000),
});

export const manualOverrideSchema = z.object({
  siteId: z.string().min(1),
  guardId: z.string().min(1),
  rosterDate: z.string().min(1),
  overrideShiftCode: shiftCodeSchema,
  reason: z.string().optional(),
  doesChangeBasePattern: z.boolean().optional(),
});

export const bulkManualOverridesSchema = z.object({
  siteId: z.string().min(1),
  changes: z.array(
    z.object({
      guardId: z.string().min(1),
      rosterDate: z.string().min(1),
      overrideShiftCode: shiftCodeSchema,
      reason: z.string().optional(),
      doesChangeBasePattern: z.boolean().optional(),
    })
  ).min(1),
});

export const siteTimesheetQuerySchema = z.object({
  siteId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  shiftType: z.enum(["day", "night", "all"]).optional().default("all"),
});

export const siteTimesheetCaptureOverviewQuerySchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  shiftType: z.enum(["day", "night", "all"]).default("all"),
});

export const siteTimesheetRowUpdateSchema = z.object({
  actualGuardId: z.string().min(1).nullable().optional(),
  actualShiftCode: z.string().nullable().optional(),
  actualShiftType: z.string().nullable().optional(),
  clockIn: z.string().nullable().optional(),
  clockOut: z.string().nullable().optional(),
  hoursWorked: z.number().nullable().optional(),
  overtimeHours: z.number().nullable().optional(),
  attendanceStatus: z.enum([
    "pending",
    "present",
    "absent",
    "late",
    "left_early",
    "reliever",
    "shift_swapped",
    "leave",
    "sick_leave",
    "training",
    "off",
  ]).optional(),
  approvalStatus: z.enum(["pending", "partially_reviewed", "reviewed", "approved"]).optional(),
  dutyOnObNumber: z.string().max(80).nullable().optional(),
  dutyOffObNumber: z.string().max(80).nullable().optional(),
  /** @deprecated Use dutyOnObNumber */
  occurrenceBookNumber: z.string().max(80).nullable().optional(),
  comments: z.string().nullable().optional(),
});

export const siteTimesheetRowCreateSchema = z.object({
  workDate: z.string().min(1),
  actualGuardId: z.string().min(1),
  actualShiftCode: z.string().min(1),
  actualShiftType: z.string().min(1),
  attendanceStatus: z.enum([
    "pending",
    "present",
    "absent",
    "late",
    "left_early",
    "reliever",
    "shift_swapped",
    "leave",
    "sick_leave",
    "training",
    "off",
  ]),
  dutyOnObNumber: z.string().trim().min(1, "Duty ON OB number is required").max(80).optional(),
  dutyOffObNumber: z.string().trim().max(80).nullable().optional(),
  /** @deprecated Use dutyOnObNumber */
  occurrenceBookNumber: z.string().trim().min(1).max(80).optional(),
  comments: z.string().nullable().optional(),
  hoursWorked: z.number().nullable().optional(),
  overtimeHours: z.number().nullable().optional(),
}).refine((data) => Boolean(data.dutyOnObNumber?.trim() || data.occurrenceBookNumber?.trim()), {
  message: "Duty ON OB number is required",
  path: ["dutyOnObNumber"],
});

export const approveSiteTimesheetSchema = z.object({
  notes: z.string().optional(),
  reason: z.string().min(5).max(2000),
  /** When day|night, only those rows are approved; sheet locks only when no pending rows remain. */
  shiftType: z.enum(["day", "night", "all"]).optional().default("all"),
});

export const unlockSiteTimesheetSchema = z.object({
  reason: z.string().optional(),
});

export const addPlaceholderGuardSchema = z.object({
  type: z.enum(["unknown", "reliever"]),
});
