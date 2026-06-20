/**
 * Payroll finalisation validations: bank export readiness, IRP5 fields, EMP201 reconciliation.
 */

import { prisma } from "../lib/prisma.js";
import type { PayrollCalculationSnapshot } from "./payroll-calculation.types.js";
import { buildEmp201Data } from "./emp201.service.js";

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
    includedCount: items.filter((i) => Number(i.netPay) > 0).length - excludedEmployees.length,
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

  const issues: PayrollValidationIssue[] = [
    ...validateIrp5Fields(
      run.items.map((item) => ({
        employeeId: item.employeeId,
        netPay: Number(item.netPay),
        employee: item.employee,
      }))
    ),
    ...validateBankExportIssues(bankExport),
    ...validateStatutoryReconciliationIssues(statutoryReconciliation),
  ];

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    canApprove: criticalCount === 0 && run.status === "calculated",
    canExportBank: bankExport.valid && run.items.length > 0,
    criticalCount,
    warningCount,
    issues,
    bankExport,
    statutoryReconciliation,
  };
}
