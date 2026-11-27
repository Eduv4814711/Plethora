import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAY_CODE_MAPPING,
  renderPayrollExport,
  type ExportBatchContext,
  type NormalizedExportLine,
} from "../adapters/index.js";

const baseContext = (
  overrides: Partial<ExportBatchContext> = {}
): ExportBatchContext => ({
  batchId: "batch_abc123",
  periodKey: "2026-09",
  periodStart: "2026-08-26",
  periodEnd: "2026-09-25",
  companyName: "Vanguard Security (Pty) Ltd",
  companyPayeReference: "7123456789",
  profileName: "Sage Profile",
  provider: "SAGE_BUSINESS_CLOUD_ZA",
  delimiter: ",",
  dateFormat: "yyyy-MM-dd",
  codeMapping: { ...DEFAULT_PAY_CODE_MAPPING },
  customColumns: [],
  generatedAt: "2026-09-26T08:00:00.000Z",
  ...overrides,
});

const sampleLine: NormalizedExportLine = {
  employeeId: "emp-1",
  employeeNumber: "EMP001",
  externalPayrollCode: "SAGE-001",
  employeeFullName: 'Dlamini, "Sipho"',
  siteId: "site-1",
  siteName: "Sandton, Main Gate",
  costCenterCode: "CC-100",
  basicHours: 160,
  overtimeHours: 12.5,
  sundayHours: 8,
  publicHolidayHours: 0,
  nightShiftHours: 24,
  annualLeaveHours: 8,
  sickLeaveHours: 0,
  familyLeaveHours: 0,
  studyLeaveHours: 0,
  unpaidLeaveHours: 0,
  workedShiftsCount: 16,
};

describe("payroll export adapters", () => {
  it("renders SAGE_BUSINESS_CLOUD_ZA transaction rows with zero suppression, quoting, and pay code mapping", () => {
    const result = renderPayrollExport(
      baseContext({
        provider: "SAGE_BUSINESS_CLOUD_ZA",
        dateFormat: "dd/MM/yyyy",
        codeMapping: {
          ...DEFAULT_PAY_CODE_MAPPING,
          regularHours: "BASIC-ZA",
          nightShiftHours: "NIGHT-ZA",
        },
        customColumns: [
          { header: "Period", field: "periodKey" },
          { header: "FixedBranch", fixedValue: "JHB" },
        ],
      }),
      [sampleLine]
    );

    expect(result.fileExtension).toBe("csv");
    expect(result.mimeType).toContain("text/csv");
    expect(result.filename).toBe("sage-bc-za-timesheets-2026-09.csv");

    const rows = result.content.split("\r\n");
    // 5 non-zero components on sampleLine: basic, overtime, sunday, nightShift, annualLeave
    expect(rows.length).toBe(1 + 5);
    expect(rows[0]).toContain("Employee Code,Employee Number,Employee Name");
    expect(rows[0]).toContain(",Period,FixedBranch");
    // Escapes embedded comma and quotes per RFC 4180
    expect(rows[1]).toContain('"Dlamini, ""Sipho"""');
    expect(rows[1]).toContain('"Sandton, Main Gate"');
    expect(rows[1]).toContain("26/08/2026");
    expect(rows[1]).toContain("25/09/2026");
    expect(rows[1]).toContain("BASIC-ZA");
    expect(rows[1]).toContain("160.00");
    expect(rows[1]).toContain(",2026-09,JHB");
    // Suppresses zero components (e.g. Public Holiday code 1030, Sick Leave 2010)
    expect(result.content).not.toContain(",1030,");
    expect(result.content).not.toContain(",2010,");
  });

  it("renders SAGE_VIP wide batch table with custom semicolon delimiter and dd-MM-yyyy date", () => {
    const result = renderPayrollExport(
      baseContext({
        provider: "SAGE_VIP",
        delimiter: ";",
        dateFormat: "dd-MM-yyyy",
      }),
      [sampleLine]
    );

    expect(result.fileExtension).toBe("csv");
    const rows = result.content.split("\r\n");
    expect(rows.length).toBe(2);
    expect(rows[0].startsWith("Company;PayPeriodEnd;EmployeeCode;")).toBe(true);
    expect(rows[1]).toContain(";25-09-2026;SAGE-001;");
    expect(rows[1]).toContain(";CC-100;160.00;12.50;8.00;0.00;24.00;8.00;0.00;0.00;0.00;0.00;16");
  });

  it("renders SAGE_300_PEOPLE transactions respecting custom pay code mappings and yyyyMMdd dates", () => {
    const result = renderPayrollExport(
      baseContext({
        provider: "SAGE_300_PEOPLE",
        dateFormat: "yyyyMMdd",
        codeMapping: {
          ...DEFAULT_PAY_CODE_MAPPING,
          annualLeaveHours: "LVE-ANN",
        },
      }),
      [sampleLine]
    );

    expect(result.fileExtension).toBe("csv");
    const rows = result.content.split("\r\n");
    expect(rows.length).toBe(1 + 5);
    expect(rows[0].startsWith("CompanyCode,BatchReference,EmployeeCode,")).toBe(true);
    expect(result.content).toContain("7123456789,PL-2026-09-ABC123,SAGE-001");
    expect(result.content).toContain(",LVE-ANN,LEAVE_ANNUAL_HRS,20260826,20260925,8.00");
  });

  it("renders GENERIC_CSV with pipe delimiter, total paid hours excluding unpaid leave, and custom columns", () => {
    const lineWithUnpaid: NormalizedExportLine = {
      ...sampleLine,
      employeeFullName: "Thabo Mokoena",
      siteName: "Main Site",
      unpaidLeaveHours: 12,
    };
    const result = renderPayrollExport(
      baseContext({
        provider: "GENERIC_CSV",
        delimiter: "|",
        customColumns: [{ header: "PayrollRef", field: "externalPayrollCode" }],
      }),
      [lineWithUnpaid]
    );

    expect(result.fileExtension).toBe("csv");
    const rows = result.content.split("\r\n");
    expect(rows.length).toBe(2);
    // Total paid hours = 160 + 12.5 + 8 + 0 + 8 = 188.50 (unpaid leave & night allowance excluded)
    expect(rows[1]).toContain("|12.00|16|188.50|SAGE-001");
  });

  it("renders JSON_WEBHOOK structured payload with schemaVersion, totals, and lines", () => {
    const result = renderPayrollExport(
      baseContext({ provider: "JSON_WEBHOOK" }),
      [sampleLine]
    );

    expect(result.fileExtension).toBe("json");
    expect(result.mimeType).toContain("application/json");
    const parsed = JSON.parse(result.content);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.provider).toBe("JSON_WEBHOOK");
    expect(parsed.batch.periodKey).toBe("2026-09");
    expect(parsed.company.payeReference).toBe("7123456789");
    expect(parsed.totals.basicHours).toBe(160);
    expect(parsed.totals.overtimeHours).toBe(12.5);
    expect(parsed.totals.workedShiftsCount).toBe(16);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].externalPayrollCode).toBe("SAGE-001");
  });

  it("handles sundayDoubleHours (2.0x unscheduled Sunday) across all adapters and neutralizes CSV formula injection", () => {
    const doubleSundayAndFormulaLine: NormalizedExportLine = {
      ...sampleLine,
      employeeFullName: "=SUM(A1:A10)",
      siteName: "@DangerSite",
      sundayHours: 8,
      sundayDoubleHours: 6,
    };

    const bcZa = renderPayrollExport(
      baseContext({ provider: "SAGE_BUSINESS_CLOUD_ZA" }),
      [doubleSundayAndFormulaLine]
    );
    // Emits dedicated sundayDoubleHours code (1025) and prefixes formula cells with single quote
    expect(bcZa.content).toContain(",1025,Sunday Double-Time Hours,6.00");
    expect(bcZa.content).toContain("'=SUM(A1:A10)");
    expect(bcZa.content).toContain("'@DangerSite");

    const vip = renderPayrollExport(
      baseContext({ provider: "SAGE_VIP", delimiter: ";" }),
      [doubleSundayAndFormulaLine]
    );
    // Folds sundayHours (8) + sundayDoubleHours (6) = 14.00 in SundayHours column
    expect(vip.content).toContain(";160.00;12.50;14.00;0.00;");

    const generic = renderPayrollExport(
      baseContext({ provider: "GENERIC_CSV", delimiter: "|" }),
      [doubleSundayAndFormulaLine]
    );
    // Total paid hours = 160 + 12.5 + (8 + 6) + 0 + 8 = 194.50
    expect(generic.content).toContain("|16|194.50");

    const webhook = renderPayrollExport(
      baseContext({ provider: "JSON_WEBHOOK" }),
      [doubleSundayAndFormulaLine]
    );
    const parsed = JSON.parse(webhook.content);
    expect(parsed.totals.sundayDoubleHours).toBe(6);
  });
});
