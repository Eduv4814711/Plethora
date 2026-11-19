import {
  formatExportDate,
  formatHours,
  resolveCustomColumnValue,
  toDelimitedTable,
  type AdapterRenderResult,
  type ExportBatchContext,
  type NormalizedExportLine,
  type PayCodeMapping,
} from "./adapter.types.js";

interface ComponentDef {
  key: keyof PayCodeMapping;
  label: string;
  getValue: (line: NormalizedExportLine) => number;
}

const COMPONENTS: ComponentDef[] = [
  { key: "regularHours", label: "Ordinary Hours", getValue: (l) => l.basicHours },
  { key: "overtimeHours", label: "Overtime 1.5x Hours", getValue: (l) => l.overtimeHours },
  { key: "sundayHours", label: "Sunday Hours", getValue: (l) => l.sundayHours },
  { key: "publicHolidayHours", label: "Public Holiday Hours", getValue: (l) => l.publicHolidayHours },
  { key: "nightShiftHours", label: "Night Shift Allowance Hours", getValue: (l) => l.nightShiftHours },
  { key: "annualLeaveHours", label: "Annual Leave Hours", getValue: (l) => l.annualLeaveHours },
  { key: "sickLeaveHours", label: "Sick Leave Hours", getValue: (l) => l.sickLeaveHours },
  { key: "familyLeaveHours", label: "Family Responsibility Leave Hours", getValue: (l) => l.familyLeaveHours },
  { key: "studyLeaveHours", label: "Study Leave Hours", getValue: (l) => l.studyLeaveHours },
  { key: "unpaidLeaveHours", label: "Unpaid Leave Hours", getValue: (l) => l.unpaidLeaveHours },
];

/**
 * Sage Business Cloud Payroll ZA batch transactions CSV adapter.
 * Emits one normalized transaction line per non-zero earnings/leave code
 * per employee (optionally split by site cost centre).
 */
export function renderSageBusinessCloudZa(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  const customCols = context.customColumns ?? [];
  const headers = [
    "Employee Code",
    "Employee Number",
    "Employee Name",
    "Period Start",
    "Period End",
    "Cost Centre",
    "Site",
    "Payroll Code",
    "Component",
    "Hours",
    ...customCols.map((c) => c.header),
  ];

  const periodStartFormatted = formatExportDate(context.periodStart, context.dateFormat);
  const periodEndFormatted = formatExportDate(context.periodEnd, context.dateFormat);

  const rows: unknown[][] = [];
  for (const line of lines) {
    for (const comp of COMPONENTS) {
      const hours = Math.round(comp.getValue(line) * 100) / 100;
      if (hours <= 0) continue;
      rows.push([
        line.externalPayrollCode,
        line.employeeNumber,
        line.employeeFullName,
        periodStartFormatted,
        periodEndFormatted,
        line.costCenterCode ?? "",
        line.siteName ?? "Consolidated",
        context.codeMapping[comp.key],
        comp.label,
        formatHours(hours),
        ...customCols.map((c) => resolveCustomColumnValue(c, context, line)),
      ]);
    }
  }

  return {
    content: toDelimitedTable(headers, rows, context.delimiter || ","),
    mimeType: "text/csv; charset=utf-8",
    fileExtension: "csv",
    filename: `sage-bc-za-timesheets-${context.periodKey}.csv`,
  };
}
