import {
  formatExportDate,
  formatHours,
  resolveCustomColumnValue,
  toDelimitedTable,
  type AdapterRenderResult,
  type ExportBatchContext,
  type NormalizedExportLine,
} from "./adapter.types.js";

/**
 * Sage VIP / Classic & Premier wide batch-hours CSV adapter.
 * Outputs one tabular row per employee (or employee + cost centre when split by site)
 * mapped cleanly to Sage VIP fixed-field batch templates.
 */
export function renderSageVip(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  const customCols = context.customColumns ?? [];
  const headers = [
    "Company",
    "PayPeriodEnd",
    "EmployeeCode",
    "EmployeeName",
    "CostCenter",
    "BasicHours",
    "OvertimeHours",
    "SundayHours",
    "PublicHolidayHours",
    "NightHours",
    "AnnualLeaveHours",
    "SickLeaveHours",
    "FamilyLeaveHours",
    "StudyLeaveHours",
    "UnpaidLeaveHours",
    "WorkedShifts",
    ...customCols.map((c) => c.header),
  ];

  const periodEndFormatted = formatExportDate(context.periodEnd, context.dateFormat);

  const rows: unknown[][] = lines.map((line) => [
    context.companyName,
    periodEndFormatted,
    line.externalPayrollCode,
    line.employeeFullName,
    line.costCenterCode ?? "",
    formatHours(line.basicHours),
    formatHours(line.overtimeHours),
    formatHours(line.sundayHours),
    formatHours(line.publicHolidayHours),
    formatHours(line.nightShiftHours),
    formatHours(line.annualLeaveHours),
    formatHours(line.sickLeaveHours),
    formatHours(line.familyLeaveHours),
    formatHours(line.studyLeaveHours),
    formatHours(line.unpaidLeaveHours),
    String(line.workedShiftsCount),
    ...customCols.map((c) => resolveCustomColumnValue(c, context, line)),
  ]);

  return {
    content: toDelimitedTable(headers, rows, context.delimiter || ","),
    mimeType: "text/csv; charset=utf-8",
    fileExtension: "csv",
    filename: `sage-vip-hours-${context.periodKey}.csv`,
  };
}
