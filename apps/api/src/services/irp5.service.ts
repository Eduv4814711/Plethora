import { prisma } from "../lib/prisma.js";
import { format } from "date-fns";

export interface Irp5EmployeeData {
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  idNumber: string | null;
  taxNumber: string | null;
  dateOfBirth: Date | null;
  email: string | null;
  physicalAddress: string | null;
  postalAddress: string | null;
  postalCode: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  commencementDate: Date | null;
  grossIncome: number;
  taxWithheld: number;
  uifEmployee: number;
  sdl: number;
  payPeriods: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Build IRP5/IT3(a) certificate data per employee for a tax year.
 * Tax year: 1 March (year-1) to 28 February (year).
 * e.g. taxYear 2025 = 1 March 2024 - 28 February 2025
 */
export async function buildIrp5DataForTaxYear(
  companyId: string,
  taxYear: number
): Promise<Irp5EmployeeData[]> {
  const periodStart = new Date(taxYear - 1, 2, 1); // 1 March
  const periodEnd = new Date(taxYear, 1, 28, 23, 59, 59, 999); // 28 Feb

  const runs = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "paid",
      periodEnd: { gte: periodStart, lte: periodEnd },
    },
    include: {
      items: {
        include: {
          employee: true,
          payslip: true,
        },
      },
    },
    orderBy: { periodStart: "asc" },
  });

  const byEmployee = new Map<string, Irp5EmployeeData>();

  for (const run of runs) {
    for (const item of run.items) {
      const emp = item.employee;
      const payslip = item.payslip;
      const grossPay = Number(item.grossPay);
      const tax = payslip?.tax != null ? Number(payslip.tax) : 0;
      const uif = payslip?.uifEmployee != null ? Number(payslip.uifEmployee) : 0;
      const sdl = payslip?.sdl != null ? Number(payslip.sdl) : 0;

      const existing = byEmployee.get(emp.id);
      if (existing) {
        existing.grossIncome += grossPay;
        existing.taxWithheld += tax;
        existing.uifEmployee += uif;
        existing.sdl += sdl;
        existing.payPeriods += 1;
        if (run.periodStart < existing.periodStart) existing.periodStart = run.periodStart;
        if (run.periodEnd > existing.periodEnd) existing.periodEnd = run.periodEnd;
      } else {
        byEmployee.set(emp.id, {
          employeeId: emp.id,
          employeeNumber: emp.employeeNumber ?? "",
          firstName: emp.firstName,
          lastName: emp.lastName,
          idNumber: emp.idNumber,
          taxNumber: emp.taxNumber,
          dateOfBirth: emp.dateOfBirth,
          email: emp.email,
          physicalAddress: emp.physicalAddress,
          postalAddress: emp.postalAddress,
          postalCode: emp.postalCode,
          bankName: emp.bankName,
          bankAccountNumber: emp.bankAccountNumber,
          bankBranchCode: emp.bankBranchCode,
          commencementDate: emp.commencementDate,
          grossIncome: grossPay,
          taxWithheld: tax,
          uifEmployee: uif,
          sdl,
          payPeriods: 1,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
        });
      }
    }
  }

  return Array.from(byEmployee.values()).map((e) => ({
    ...e,
    grossIncome: Math.round(e.grossIncome * 100) / 100,
    taxWithheld: Math.round(e.taxWithheld * 100) / 100,
    uifEmployee: Math.round(e.uifEmployee * 100) / 100,
    sdl: Math.round(e.sdl * 100) / 100,
  }));
}

/**
 * Generate IRP5 export as CSV for SARS eFiling / e@syFile import.
 */
export function irp5ToCsv(
  data: Irp5EmployeeData[],
  companyPayeRef: string | null,
  companySdlRef: string | null,
  companyUifRef: string | null
): string {
  const headers = [
    "Employee Number",
    "Surname",
    "First Name",
    "ID Number",
    "Tax Number",
    "Date of Birth",
    "Email",
    "Physical Address",
    "Postal Address",
    "Postal Code",
    "Bank Name",
    "Account Number",
    "Branch Code",
    "Commencement Date",
    "Gross Income",
    "Tax Withheld",
    "UIF",
    "SDL",
    "Pay Periods",
    "Period Start",
    "Period End",
    "PAYE Ref",
    "SDL Ref",
    "UIF Ref",
  ];

  const rows = data.map((e) => [
    e.employeeNumber,
    e.lastName,
    e.firstName,
    e.idNumber ?? "",
    e.taxNumber ?? "",
    e.dateOfBirth ? format(new Date(e.dateOfBirth), "yyyyMMdd") : "",
    e.email ?? "",
    e.physicalAddress ?? "",
    e.postalAddress ?? "",
    e.postalCode ?? "",
    e.bankName ?? "",
    e.bankAccountNumber ?? "",
    e.bankBranchCode ?? "",
    e.commencementDate ? format(new Date(e.commencementDate), "yyyy-MM-dd") : "",
    e.grossIncome.toFixed(2),
    e.taxWithheld.toFixed(2),
    e.uifEmployee.toFixed(2),
    e.sdl.toFixed(2),
    String(e.payPeriods),
    format(e.periodStart, "yyyy-MM-dd"),
    format(e.periodEnd, "yyyy-MM-dd"),
    companyPayeRef ?? "",
    companySdlRef ?? "",
    companyUifRef ?? "",
  ]);

  const allRows = [headers, ...rows];
  return allRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
