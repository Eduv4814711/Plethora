/**
 * Payroll finalisation validations: bank export readiness, IRP5 fields, EMP201 reconciliation.
 */

import { prisma } from "../lib/prisma.js";
import type { PayrollCalculationSnapshot } from "./payroll-calculation.types.js";
import { buildEmp201Data } from "./emp201.service.js";
import { runPayrollComplianceChecks } from "./payroll-compliance/payroll-compliance.service.js";

export type ValidationSeverity = "critical" | "warning";

export interface PayrollValidationIssue {
  ruleId: string;
  ruleName: string;
  severity: ValidationSeverity;
  message: string;
  entityType: "employee" | "payroll_run";
  entityId: string;
  employeeId?: string;
  employeeName?: string;
  suggestedAction: string;
}

export interface BankExportValidation {
  valid: boolean;
  totalNetPay: number;
  exportTotal: number;
  includedCount: number;
  excludedEmployees: Array<{
    employeeId: string;
    employeeName: string;
    employeeNumber: string | null;
    netPay: number;
    missingFields: string[];
  }>;
}

export interface StatutoryReconciliation {
  matched: boolean;
  paye: { snapshot: number; items: number; matched: boolean };
  uifEmployee: { snapshot: number; items: number; matched: boolean };
  uifEmployer: { snapshot: number; items: number; matched: boolean };
  sdl: { snapshot: number; items: number; matched: boolean };
  netPay: { snapshot: number; items: number; matched: boolean };
  mismatches: string[];
  emp201Preview?: {
    period: string;
    payeLiability: number;
    uifLiability: number;
    sdlLiability: number;
    matchesRun: boolean;
  };
}

export interface PayrollFinalisationValidation {
  canApprove: boolean;
  canExportBank: boolean;
  criticalCount: number;
  warningCount: number;
  issues: PayrollValidationIssue[];
  bankExport: BankExportValidation;
  statutoryReconciliation: StatutoryReconciliation;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function employeeDisplayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function validateBankDetailsForItems(
  items: Array<{
    id: string;
    employeeId: string;
    netPay: number | string | { toString(): string };
    employee: {
      firstName: string;
      lastName: string;
      employeeNumber: string | null;
      bankAccountNumber: string | null;
      bankBranchCode: string | null;
    };
  }>
): BankExportValidation {
  const excludedEmployees: BankExportValidation["excludedEmployees"] = [];
  let exportTotal = 0;
  let totalNetPay = 0;

  for (const item of items) {
    const netPay = round2(Number(item.netPay));
    if (!Number.isFinite(netPay) || netPay < 0) {
      excludedEmployees.push({
        employeeId: item.employeeId,
        employeeName: employeeDisplayName(item.employee.firstName, item.employee.lastName),
        employeeNumber: item.employee.employeeNumber,
        netPay,
        missingFields: ["a valid non-negative net pay amount"],
      });
      continue;
    }
    totalNetPay += netPay;
    if (netPay <= 0) continue;

    const missingFields: string[] = [];
    const account = item.employee.bankAccountNumber?.trim();
    if (!account) missingFields.push("bank account number");
    if (!item.employee.bankBranchCode?.trim()) missingFields.push("branch code");

    if (missingFields.length > 0) {
      excludedEmployees.push({
        employeeId: item.employeeId,
        employeeName: employeeDisplayName(item.employee.firstName, item.employee.lastName),
        employeeNumber: item.employee.employeeNumber,
        netPay,
        missingFields,
      });
    } else {
      exportTotal += netPay;
    }
  }

  return {
    valid: excludedEmployees.length === 0,
    totalNetPay: round2(totalNetPay),
    exportTotal: round2(exportTotal),
    includedCount:
      items.filter((i) => Number.isFinite(Number(i.netPay)) && Number(i.netPay) > 0).length -
      excludedEmployees.filter((employee) => employee.netPay > 0).length,
    excludedEmployees,
  };
}

export function reconcileStatutoryTotals(params: {
  items: Array<{
    grossPay: number | string;
    netPay: number | string;
    payslip: {
      tax: number | string | null;
      uifEmployee: number | string | null;
      uifEmployer: number | string | null;
      sdl: number | string | null;
    } | null;
  }>;
  snapshot: PayrollCalculationSnapshot | null;
}): StatutoryReconciliation {
  const itemTotals = params.items.reduce(
    (acc, item) => {
      const payslip = item.payslip;
      return {
        grossPay: acc.grossPay + Number(item.grossPay),
        netPay: acc.netPay + Number(item.netPay),
        paye: acc.paye + Number(payslip?.tax ?? 0),
        uifEmployee: acc.uifEmployee + Number(payslip?.uifEmployee ?? 0),
        uifEmployer: acc.uifEmployer + Number(payslip?.uifEmployer ?? 0),
        sdl: acc.sdl + Number(payslip?.sdl ?? 0),
      };
    },
    { grossPay: 0, netPay: 0, paye: 0, uifEmployee: 0, uifEmployer: 0, sdl: 0 }
  );

  const snapshotTotals = params.snapshot?.totals ?? null;
  const mismatches: string[] = [];

  const compare = (label: string, snapshotVal: number | undefined, itemVal: number) => {
    const snap = round2(snapshotVal ?? itemVal);
    const items = round2(itemVal);
    const matched = Math.abs(snap - items) < 0.02;
    if (!matched) {
      mismatches.push(`${label}: snapshot ${snap.toFixed(2)} vs items ${items.toFixed(2)}`);
    }
    return { snapshot: snap, items, matched };
  };

  const paye = compare("PAYE", snapshotTotals?.tax, itemTotals.paye);
  const uifEmployee = compare("UIF (employee)", snapshotTotals?.uifEmployee, itemTotals.uifEmployee);
  const uifEmployer = compare("UIF (employer)", snapshotTotals?.uifEmployer, itemTotals.uifEmployer);
  const sdl = compare("SDL", snapshotTotals?.sdl, itemTotals.sdl);
  const netPay = compare("Net pay", snapshotTotals?.netPay, itemTotals.netPay);

  return {
    matched: mismatches.length === 0,
    paye,
    uifEmployee,
    uifEmployer,
    sdl,
    netPay,
    mismatches,
  };
}

function validateIrp5Fields(
  items: Array<{
    employeeId: string;
    netPay: number | string;
    employee: {
      id: string;
      firstName: string;
      lastName: string;
      idNumber: string | null;
      taxNumber: string | null;
      dateOfBirth: Date | null;
      physicalAddress: string | null;
      postalAddress: string | null;
    };
  }>
): PayrollValidationIssue[] {
  const issues: PayrollValidationIssue[] = [];

  for (const item of items) {
    if (Number(item.netPay) <= 0) continue;
    const emp = item.employee;
    const name = employeeDisplayName(emp.firstName, emp.lastName);
    const missing: string[] = [];

    if (!emp.idNumber?.trim()) missing.push("ID number");
    if (!emp.dateOfBirth) missing.push("date of birth");
    if (!emp.physicalAddress?.trim() && !emp.postalAddress?.trim()) {
      missing.push("physical or postal address");
    }

    if (missing.length > 0) {
      issues.push({
        ruleId: "irp5_required_fields",
        ruleName: "Missing IRP5 employee data",
        severity: "critical",
        message: `${name} is missing IRP5 fields: ${missing.join(", ")}.`,
        entityType: "employee",
        entityId: emp.id,
        employeeId: emp.id,
        employeeName: name,
        suggestedAction: "Update the employee record with the missing IRP5 fields before approving payroll.",
      });
    }
  }

  return issues;
}

function validateBankExportIssues(bankExport: BankExportValidation): PayrollValidationIssue[] {
  return bankExport.excludedEmployees.map((ex) => ({
    ruleId: "missing_bank_details",
    ruleName: "Missing bank details",
    severity: "critical",
    message: `${ex.employeeName} (${ex.employeeNumber ?? "no employee #"}) is missing ${ex.missingFields.join(" and ")} for a net pay of R${ex.netPay.toFixed(2)}.`,
    entityType: "employee",
    entityId: ex.employeeId,
    employeeId: ex.employeeId,
    employeeName: ex.employeeName,
    suggestedAction: "Add complete bank account details on the employee record before approving or exporting.",
  }));
}

function validateStatutoryReconciliationIssues(
  reconciliation: StatutoryReconciliation
): PayrollValidationIssue[] {
  if (reconciliation.matched) return [];

  return reconciliation.mismatches.map((msg) => ({
    ruleId: "statutory_reconciliation",
    ruleName: "Statutory totals mismatch",
    severity: "critical",
    message: msg,
    entityType: "payroll_run",
    entityId: "payroll_run",
    suggestedAction: "Recalculate the payroll run and verify payslip statutory deductions match the calculation snapshot.",
  }));
}

export function validatePayrollFinancialValues(
  items: Array<{
    id: string;
    employeeId: string;
    grossPay: number | string;
    deductions: number | string;
    netPay: number | string;
    employee: { firstName: string; lastName: string };
  }>
): PayrollValidationIssue[] {
  const issues: PayrollValidationIssue[] = [];
  for (const item of items) {
    const grossPay = Number(item.grossPay);
    const deductions = Number(item.deductions);
    const netPay = Number(item.netPay);
    const name = employeeDisplayName(item.employee.firstName, item.employee.lastName);
    const invalid =
      !Number.isFinite(grossPay) ||
      !Number.isFinite(deductions) ||
      !Number.isFinite(netPay) ||
      grossPay < 0 ||
      deductions < 0 ||
      netPay < 0 ||
      deductions > grossPay ||
      Math.abs(grossPay - deductions - netPay) >= 0.02;
    if (!invalid) continue;
    issues.push({
      ruleId: "invalid_payment_values",
      ruleName: "Invalid payroll payment values",
      severity: "critical",
      message: `${name} has invalid payroll values (gross=${grossPay}, deductions=${deductions}, net=${netPay}).`,
      entityType: "employee",
      entityId: item.employeeId,
      employeeId: item.employeeId,
      employeeName: name,
      suggestedAction: "Correct the employee's pay and deduction configuration, then recalculate payroll.",
    });
  }
  return issues;
}

/**
 * Warn when a run was taxed on carried-forward rates. PAYE still calculates, but the
 * figures have not been confirmed against a published SARS table for that year and
 * must not be filed without checking.
 */
export function validateTaxYearConfiguration(
  snapshot: PayrollCalculationSnapshot | null,
  payrollRunId: string
): PayrollValidationIssue[] {
  const taxYear = snapshot?.inputs?.taxYear;
  if (!taxYear?.provisional) return [];

  return [
    {
      ruleId: "provisional_tax_year",
      ruleName: "Provisional tax tables",
      severity: "warning",
      message: `PAYE for this run was calculated on provisional ${taxYear.label} tax tables carried forward from the previous year.`,
      entityType: "payroll_run",
      entityId: payrollRunId,
      suggestedAction: `Confirm the SARS ${taxYear.label} brackets and rebates in tax-brackets.ts, then recalculate this run before filing.`,
    },
  ];
}

/**
 * Warn when an employee carries both a monthly salary and an hourly rate. Payroll
 * treats a non-zero monthly salary as authoritative and absorbs worked hours into it,
 * so a stale salary on an hourly employee silently pays the wrong amount.
 */
export function validateConflictingPayConfiguration(
  snapshot: PayrollCalculationSnapshot | null
): PayrollValidationIssue[] {
  if (!snapshot?.employees) return [];

  const issues: PayrollValidationIssue[] = [];
  for (const employee of snapshot.employees) {
    const { context, output } = employee;
    if (output.skipped) continue;
    if (context.monthlySalary <= 0 || context.hourlyRate <= 0) continue;

    const name = employeeDisplayName(context.firstName, context.lastName);
    issues.push({
      ruleId: "conflicting_pay_configuration",
      ruleName: "Both monthly salary and hourly rate configured",
      severity: "warning",
      message: `${name} has a monthly salary of R${context.monthlySalary.toFixed(2)} and an hourly rate of R${context.hourlyRate.toFixed(2)}. Payroll paid the monthly salary and did not pay the worked hours at the hourly rate.`,
      entityType: "employee",
      entityId: context.employeeId,
      employeeId: context.employeeId,
      employeeName: name,
      suggestedAction: "Clear whichever rate does not apply on the employee record, then recalculate payroll.",
    });
  }
  return issues;
}

export async function validatePayrollFinalisation(
  payrollRunId: string,
  companyId: string
): Promise<PayrollFinalisationValidation> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    include: {
      items: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
              idNumber: true,
              taxNumber: true,
              dateOfBirth: true,
              physicalAddress: true,
              postalAddress: true,
              bankAccountNumber: true,
              bankBranchCode: true,
            },
          },
          payslip: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("Payroll run not found");
  }

  const snapshot = run.calculationSnapshot as PayrollCalculationSnapshot | null;
  const bankExport = validateBankDetailsForItems(
    run.items.map((item) => ({
      id: item.id,
      employeeId: item.employeeId,
      netPay: Number(item.netPay),
      employee: item.employee,
    }))
  );

  const statutoryReconciliation = reconcileStatutoryTotals({
    items: run.items.map((item) => ({
      grossPay: Number(item.grossPay),
      netPay: Number(item.netPay),
      payslip: item.payslip
        ? {
            tax: item.payslip.tax != null ? Number(item.payslip.tax) : null,
            uifEmployee: item.payslip.uifEmployee != null ? Number(item.payslip.uifEmployee) : null,
            uifEmployer: item.payslip.uifEmployer != null ? Number(item.payslip.uifEmployer) : null,
            sdl: item.payslip.sdl != null ? Number(item.payslip.sdl) : null,
          }
        : null,
    })),
    snapshot,
  });

  const periodEnd = new Date(run.periodEnd);
  if (run.status !== "draft" && run.items.length > 0) {
    statutoryReconciliation.emp201Preview = {
      period: `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}`,
      payeLiability: statutoryReconciliation.paye.items,
      uifLiability:
        statutoryReconciliation.uifEmployee.items + statutoryReconciliation.uifEmployer.items,
      sdlLiability: statutoryReconciliation.sdl.items,
      matchesRun: statutoryReconciliation.matched,
    };
  }

  if (run.status === "paid") {
    const emp201 = await buildEmp201Data(
      companyId,
      periodEnd.getFullYear(),
      periodEnd.getMonth() + 1
    );
    if (emp201 && statutoryReconciliation.emp201Preview) {
      const matchesRun =
        Math.abs(emp201.payeLiability - statutoryReconciliation.paye.items) < 0.02 &&
        Math.abs(emp201.uifLiability - (statutoryReconciliation.uifEmployee.items + statutoryReconciliation.uifEmployer.items)) < 0.02 &&
        Math.abs(emp201.sdlLiability - statutoryReconciliation.sdl.items) < 0.02;

      statutoryReconciliation.emp201Preview = {
        ...statutoryReconciliation.emp201Preview,
        payeLiability: emp201.payeLiability,
        uifLiability: emp201.uifLiability,
        sdlLiability: emp201.sdlLiability,
        matchesRun,
      };

      if (!matchesRun) {
        statutoryReconciliation.matched = false;
        statutoryReconciliation.mismatches.push(
          "EMP201 monthly totals do not reconcile with this paid payroll run."
        );
      }
    }
  }

  const complianceResults = await runPayrollComplianceChecks(payrollRunId, companyId);
  const complianceIssues: PayrollValidationIssue[] = complianceResults
    .filter((result) => result.severity === "critical" || result.severity === "warning")
    .map((result) => ({
      ruleId: `compliance:${result.ruleId}`,
      ruleName: result.ruleName,
      severity: result.severity === "critical" ? "critical" : "warning",
      message: result.message,
      entityType: result.employeeId ? "employee" : "payroll_run",
      entityId: result.employeeId ?? payrollRunId,
      employeeId: result.employeeId,
      suggestedAction: result.suggestedAction,
    }));

  const issues: PayrollValidationIssue[] = [
    ...(run.items.length === 0
      ? [{
          ruleId: "empty_payroll_run",
          ruleName: "Payroll run has no employees",
          severity: "critical" as const,
          message: "This payroll run contains no payment items.",
          entityType: "payroll_run" as const,
          entityId: payrollRunId,
          suggestedAction: "Check pay-frequency assignments and attendance, then recalculate payroll.",
        }]
      : []),
    ...validatePayrollFinancialValues(
      run.items.map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        grossPay: item.grossPay.toString(),
        deductions: item.deductions.toString(),
        netPay: item.netPay.toString(),
        employee: item.employee,
      }))
    ),
    ...validateIrp5Fields(
      run.items.map((item) => ({
        employeeId: item.employeeId,
        netPay: Number(item.netPay),
        employee: item.employee,
      }))
    ),
    ...validateBankExportIssues(bankExport),
    ...validateStatutoryReconciliationIssues(statutoryReconciliation),
    ...validateTaxYearConfiguration(snapshot, payrollRunId),
    ...validateConflictingPayConfiguration(snapshot),
    ...complianceIssues,
  ];

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    canApprove: criticalCount === 0 && run.status === "calculated",
    canExportBank:
      bankExport.valid &&
      issues.every((issue) => issue.severity !== "critical") &&
      run.items.length > 0 &&
      (run.status === "approved" || run.status === "paid"),
    criticalCount,
    warningCount,
    issues,
    bankExport,
    statutoryReconciliation,
  };
}
