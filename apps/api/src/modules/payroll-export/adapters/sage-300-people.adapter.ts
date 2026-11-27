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

const COMPONENT_FIELDS: Array<{
  key: keyof PayCodeMapping;
  codeName: string;
  getValue: (line: NormalizedExportLine) => number;
}> = [
  { key: "regularHours", codeName: "REG_HRS", getValue: (l) => l.basicHours },
  { key: "overtimeHours", codeName: "OT_15_HRS", getValue: (l) => l.overtimeHours },
  { key: "sundayHours", codeName: "SUN_HRS", getValue: (l) => l.sundayHours },
  { key: "sundayDoubleHours", codeName: "SUN_2X_HRS", getValue: (l) => l.sundayDoubleHours ?? 0 },
  { key: "publicHolidayHours", codeName: "PH_HRS", getValue: (l) => l.publicHolidayHours },
  { key: "nightShiftHours", codeName: "NIGHT_ALLOW_HRS", getValue: (l) => l.nightShiftHours },
  { key: "annualLeaveHours", codeName: "LEAVE_ANNUAL_HRS", getValue: (l) => l.annualLeaveHours },
  { key: "sickLeaveHours", codeName: "LEAVE_SICK_HRS", getValue: (l) => l.sickLeaveHours },
  { key: "familyLeaveHours", codeName: "LEAVE_FAMILY_HRS", getValue: (l) => l.familyLeaveHours },
  { key: "studyLeaveHours", codeName: "LEAVE_STUDY_HRS", getValue: (l) => l.studyLeaveHours },
  { key: "unpaidLeaveHours", codeName: "LEAVE_UNPAID_HRS", getValue: (l) => l.unpaidLeaveHours },
];

/**
 * Sage 300 People transaction batch CSV/delimited adapter.
 */
export function renderSage300People(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  const customCols = context.customColumns ?? [];
  const headers = [
    "CompanyCode",
    "BatchReference",
    "EmployeeCode",
    "EmployeeName",
    "CostCentreCode",
    "EarningCode",
    "TransactionType",
    "PeriodStart",
    "PeriodEnd",
    "Units",
    ...customCols.map((c) => c.header),
  ];

  const batchRef = context.batchId
    ? `PL-${context.periodKey}-${context.batchId.slice(-6).toUpperCase()}`
    : `PL-${context.periodKey}`;
  const periodStartFormatted = formatExportDate(context.periodStart, context.dateFormat);
  const periodEndFormatted = formatExportDate(context.periodEnd, context.dateFormat);
  const companyCode = context.companyPayeReference?.trim() || context.companyName;

  const rows: unknown[][] = [];
  for (const line of lines) {
    for (const comp of COMPONENT_FIELDS) {
      const value = Math.round(comp.getValue(line) * 100) / 100;
      if (value <= 0) continue;
      rows.push([
        companyCode,
        batchRef,
        line.externalPayrollCode,
        line.employeeFullName,
        line.costCenterCode ?? "",
        context.codeMapping[comp.key] ?? (comp.key === "sundayDoubleHours" ? "1025" : ""),
        comp.codeName,
        periodStartFormatted,
        periodEndFormatted,
        formatHours(value),
        ...customCols.map((c) => resolveCustomColumnValue(c, context, line)),
      ]);
    }
  }

  return {
    content: toDelimitedTable(headers, rows, context.delimiter || ","),
    mimeType: "text/csv; charset=utf-8",
    fileExtension: "csv",
    filename: `sage-300-people-${context.periodKey}.csv`,
  };
}
