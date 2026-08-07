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

const timesheetTimestampSchema = z.string().datetime({ offset: true });
const timesheetHoursSchema = z.number().finite().min(0).max(24);

const siteTimesheetRowEditableShape = {
  actualGuardId: z.string().min(1).nullable().optional(),
  actualShiftCode: z.string().nullable().optional(),
  actualShiftType: z.string().nullable().optional(),
  clockIn: timesheetTimestampSchema.nullable().optional(),
  clockOut: timesheetTimestampSchema.nullable().optional(),
  hoursWorked: timesheetHoursSchema.nullable().optional(),
  overtimeHours: timesheetHoursSchema.nullable().optional(),
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
  dutyOnObNumber: z.string().max(80).nullable().optional(),
  dutyOffObNumber: z.string().max(80).nullable().optional(),
  /** @deprecated Use dutyOnObNumber */
  occurrenceBookNumber: z.string().max(80).nullable().optional(),
  comments: z.string().nullable().optional(),
};

function validateTimesheetClockPatch(
  data: {
    clockIn?: string | null;
    clockOut?: string | null;
    hoursWorked?: number | null;
    overtimeHours?: number | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.clockIn && data.clockOut) {
    const clockIn = new Date(data.clockIn);
    const clockOut = new Date(data.clockOut);
    if (clockOut <= clockIn) {
      ctx.addIssue({
        code: "custom",
        message: "Clock out must be after clock in",
        path: ["clockOut"],
      });
    } else if (clockOut.getTime() - clockIn.getTime() > 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: "custom",
        message: "A worked shift cannot exceed 24 hours",
        path: ["clockOut"],
      });
    }
  }
  if (
    data.hoursWorked != null &&
    data.overtimeHours != null &&
    data.overtimeHours > data.hoursWorked
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Overtime hours cannot exceed total hours worked",
      path: ["overtimeHours"],
    });
  }
}

/**
 * Generic edits deliberately exclude approvalStatus. Row confirmation and
 * timesheet approval use their dedicated, capability-gated endpoints.
 */
export const siteTimesheetRowUpdateSchema = z
  .object(siteTimesheetRowEditableShape)
  .strict()
  .superRefine(validateTimesheetClockPatch);

export const approveSiteTimesheetRowSchema = z
  .object(siteTimesheetRowEditableShape)
  .strict()
  .superRefine(validateTimesheetClockPatch);

/**
 * Confirm many rows as worked-as-scheduled in one request. Capped so a runaway client
 * cannot ask for an unbounded transaction.
 */
export const bulkConfirmSiteTimesheetRowsSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            rowId: z.string().min(1),
            dutyOnObNumber: z.string().trim().max(80).optional(),
            dutyOffObNumber: z.string().trim().max(80).optional(),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

export const siteTimesheetRowCreateSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Work date must use YYYY-MM-DD"),
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
  hoursWorked: timesheetHoursSchema.nullable().optional(),
  overtimeHours: timesheetHoursSchema.nullable().optional(),
}).superRefine((data, ctx) => {
  if (!data.dutyOnObNumber?.trim() && !data.occurrenceBookNumber?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Duty ON OB number is required",
      path: ["dutyOnObNumber"],
    });
  }
  if (
    data.hoursWorked != null &&
    data.overtimeHours != null &&
    data.overtimeHours > data.hoursWorked
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Overtime hours cannot exceed total hours worked",
      path: ["overtimeHours"],
    });
  }
});

export const approveSiteTimesheetSchema = z.object({
  notes: z.string().optional(),
  /** When day|night, only those rows are approved; sheet locks only when no pending rows remain. */
  shiftType: z.enum(["day", "night", "all"]).optional().default("all"),
});

export const unlockSiteTimesheetSchema = z.object({
  reason: z.string().optional(),
});

export const addPlaceholderGuardSchema = z.object({
  type: z.enum(["unknown", "reliever"]),
});

export const activateContinuitySchema = z.object({
  calendarId: z.string().min(1).optional(),
  effectiveFrom: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  anchorDate: z.string().min(1).optional(),
  cycleLengthDays: z.number().int().min(2).max(14).optional(),
  cells: z.array(patternCellSchema).min(1).optional(),
});

export const continuityPauseSchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const confirmReplacementSchema = z.object({
  employeeId: z.string().min(1),
});
