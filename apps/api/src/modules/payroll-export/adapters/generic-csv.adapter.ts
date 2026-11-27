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
 * Generic wide CSV compatible with Excel review, SimplePay, PaySpace, or custom payroll imports.
 */
export function renderGenericCsv(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  const customCols = context.customColumns ?? [];
  const headers = [
    "Period Key",
    "Period Start",
    "Period End",
    "Employee Number",
    "External Payroll Code",
    "Employee Name",
    "Site Name",
    "Cost Center Code",
    "Basic Hours",
    "Overtime Hours",
    "Sunday Hours",
    "Public Holiday Hours",
    "Night Shift Hours",
    "Annual Leave Hours",
    "Sick Leave Hours",
    "Family Leave Hours",
    "Study Leave Hours",
    "Unpaid Leave Hours",
    "Worked Shifts",
    "Total Paid Hours",
    ...customCols.map((c) => c.header),
  ];

  const periodStartFormatted = formatExportDate(context.periodStart, context.dateFormat);
  const periodEndFormatted = formatExportDate(context.periodEnd, context.dateFormat);

  const rows: unknown[][] = lines.map((line) => {
    const sundayAll = line.sundayHours + (line.sundayDoubleHours ?? 0);
    const totalPaidHours =
      line.basicHours +
      line.overtimeHours +
      sundayAll +
      line.publicHolidayHours +
      line.annualLeaveHours +
      line.sickLeaveHours +
      line.familyLeaveHours +
      line.studyLeaveHours;

    return [
      context.periodKey,
      periodStartFormatted,
      periodEndFormatted,
      line.employeeNumber,
      line.externalPayrollCode,
      line.employeeFullName,
      line.siteName ?? "Consolidated",
      line.costCenterCode ?? "",
      formatHours(line.basicHours),
      formatHours(line.overtimeHours),
      formatHours(sundayAll),
      formatHours(line.publicHolidayHours),
      formatHours(line.nightShiftHours),
      formatHours(line.annualLeaveHours),
      formatHours(line.sickLeaveHours),
      formatHours(line.familyLeaveHours),
      formatHours(line.studyLeaveHours),
      formatHours(line.unpaidLeaveHours),
      String(line.workedShiftsCount),
      formatHours(totalPaidHours),
      ...customCols.map((c) => resolveCustomColumnValue(c, context, line)),
    ];
  });

  return {
    content: toDelimitedTable(headers, rows, context.delimiter || ","),
    mimeType: "text/csv; charset=utf-8",
    fileExtension: "csv",
    filename: `payroll-export-${context.periodKey}.csv`,
  };
}
