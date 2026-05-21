import { z } from "zod";

export const customBlockSchema = z.object({
  type: z.enum(["day", "night", "off"]),
  count: z.number().min(1).max(14),
});

export const createShiftSchema = z.object({
  employeeId: z.string().min(1),
  postId: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.enum(["created", "assigned"]).default("assigned"),
});

export const updateShiftSchema = z.object({
  employeeId: z.string().min(1).optional(),
  postId: z.string().min(1).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export const transitionSchema = z.object({
  status: z.enum(["created", "assigned", "active", "completed", "verified"]),
});

export const bulkCreateSchema = z
  .object({
    employeeId: z.string().min(1),
    postId: z.string().min(1).optional(),
    siteId: z.string().min(1).optional(),
    startDate: z.string(),
    endDate: z.string(),
    pattern: z.enum([
      "all_days",
      "weekdays",
      "2_on_2_off",
      "4_on_4_off",
      "5_on_2_off",
      "6_on_3_off",
      "3_on_3_off",
      "custom",
      "custom_builder",
    ]),
    customDays: z.array(z.number().min(0).max(6)).optional(),
    customBlocks: z.array(customBlockSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const hasPost = !!data.postId;
    const hasSite = !!data.siteId;
    if (hasPost === hasSite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of postId or siteId is required",
        path: ["postId"],
      });
      return;
    }
    if (hasSite && data.pattern !== "3_on_3_off" && data.pattern !== "custom_builder") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "siteId requires pattern 3_on_3_off or custom_builder",
        path: ["siteId"],
      });
    }
    if (data.pattern === "custom_builder" && hasSite && (!data.customBlocks || data.customBlocks.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customBlocks required when pattern is custom_builder",
        path: ["customBlocks"],
      });
    }
  });

export const resetSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  employeeId: z.string().optional(),
  siteId: z.string().optional(),
});

export const rosterPreviewSchema = z.object({
  siteId: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  pattern: z.enum(["3_on_3_off", "custom_builder"]),
  customBlocks: z.array(customBlockSchema).optional(),
  options: z
    .object({
      staggerGuards: z.boolean().optional(),
    })
    .optional(),
});

export const rosterPlanEntrySchema = z.object({
  employeeId: z.string().min(1),
  postId: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  shiftType: z.enum(["day", "night"]),
});

export const rosterPlanSchema = z.object({
  siteId: z.string().min(1),
  pattern: z.enum(["3_on_3_off", "custom_builder"]),
  startDate: z.string(),
  endDate: z.string(),
  entries: z.array(rosterPlanEntrySchema),
  summary: z
    .object({
      guardsConsidered: z.number(),
      shiftsPlanned: z.number(),
      postsUsed: z.number(),
      skippedGuardDays: z.number(),
      uncoveredDays: z.number().optional(),
      fairnessSpread: z
        .object({
          maxDayMinusMinDay: z.number(),
          maxNightMinusMinNight: z.number(),
          maxSundayMinusMinSunday: z.number(),
        })
        .optional(),
    })
    .optional(),
  guardStats: z
    .array(
      z.object({
        employeeId: z.string(),
        dayCount: z.number(),
        nightCount: z.number(),
        offCount: z.number(),
        sundayCount: z.number(),
        weekendCount: z.number(),
      })
    )
    .optional(),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        employeeId: z.string().optional(),
        postId: z.string().optional(),
        date: z.string().optional(),
      })
    )
    .optional(),
  conflicts: z
    .array(
      z.object({
        employeeId: z.string(),
        date: z.string(),
        reason: z.string(),
      })
    )
    .default([]),
  guardCycleOffsets: z
    .array(
      z.object({
        employeeId: z.string(),
        offsetDays: z.number(),
      })
    )
    .optional(),
});

export const rosterApplySchema = z.object({
  plan: rosterPlanSchema,
  options: z
    .object({
      replaceExisting: z.boolean().optional(),
      force: z.boolean().optional(),
    })
    .optional(),
});

export const bulkVerifySchema = z.object({
  shiftIds: z.array(z.string().min(1)).min(1).max(100),
});

export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
export type RosterPreviewInput = z.infer<typeof rosterPreviewSchema>;
export type RosterApplyInput = z.infer<typeof rosterApplySchema>;
export type CustomBlock = z.infer<typeof customBlockSchema>;
