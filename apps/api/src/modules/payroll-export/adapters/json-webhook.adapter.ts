import type {
  AdapterRenderResult,
  ExportBatchContext,
  NormalizedExportLine,
} from "./adapter.types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Structured JSON export payload suitable for middleware, ERP webhooks, or automated ingestion.
 */
export function renderJsonWebhook(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  const totals = lines.reduce(
    (acc, l) => ({
      basicHours: round2(acc.basicHours + l.basicHours),
      overtimeHours: round2(acc.overtimeHours + l.overtimeHours),
      sundayHours: round2(acc.sundayHours + l.sundayHours),
      sundayDoubleHours: round2(acc.sundayDoubleHours + (l.sundayDoubleHours ?? 0)),
      publicHolidayHours: round2(acc.publicHolidayHours + l.publicHolidayHours),
      nightShiftHours: round2(acc.nightShiftHours + l.nightShiftHours),
      annualLeaveHours: round2(acc.annualLeaveHours + l.annualLeaveHours),
      sickLeaveHours: round2(acc.sickLeaveHours + l.sickLeaveHours),
      familyLeaveHours: round2(acc.familyLeaveHours + l.familyLeaveHours),
      studyLeaveHours: round2(acc.studyLeaveHours + l.studyLeaveHours),
      unpaidLeaveHours: round2(acc.unpaidLeaveHours + l.unpaidLeaveHours),
      workedShiftsCount: acc.workedShiftsCount + l.workedShiftsCount,
    }),
    {
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      sundayDoubleHours: 0,
      publicHolidayHours: 0,
      nightShiftHours: 0,
      annualLeaveHours: 0,
      sickLeaveHours: 0,
      familyLeaveHours: 0,
      studyLeaveHours: 0,
      unpaidLeaveHours: 0,
      workedShiftsCount: 0,
    }
  );

  const payload = {
    schemaVersion: "1.0",
    provider: context.provider,
    generatedAt: context.generatedAt,
    batch: {
      id: context.batchId ?? null,
      periodKey: context.periodKey,
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      profileName: context.profileName,
    },
    company: {
      name: context.companyName,
      payeReference: context.companyPayeReference ?? null,
    },
    codeMapping: context.codeMapping,
    totals,
    lines,
  };

  return {
    content: JSON.stringify(payload, null, 2),
    mimeType: "application/json; charset=utf-8",
    fileExtension: "json",
    filename: `payroll-export-${context.periodKey}.json`,
  };
}
