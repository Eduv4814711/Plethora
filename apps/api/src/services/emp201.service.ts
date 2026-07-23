import { prisma } from "../lib/prisma.js";
import { format } from "date-fns";

export interface Emp201Data {
  companyId: string;
  period: string; // YYYY-MM
  payeLiability: number;
  sdlLiability: number;
  uifLiability: number;
  totalPayable: number;
  employerDetails: {
    payeReference: string | null;
    sdlReference: string | null;
    uifReference: string | null;
    tradingName: string | null;
  };
  contactDetails: {
    firstName: string;
    surname: string;
    position: string;
    phone: string;
    email: string | null;
  };
}

/**
 * Build EMP201 monthly declaration data for a company and period.
 * Aggregates from all paid payroll runs in the given month.
 */
export async function buildEmp201Data(
  companyId: string,
  year: number,
  month: number
): Promise<Emp201Data | null> {
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const [company, runs] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        legalName: true,
        payeReference: true,
        sdlReference: true,
        uifReference: true,
        phone: true,
        email: true,
        owner: { select: { name: true, email: true } },
      },
    }),
    prisma.payrollRun.findMany({
      where: {
        companyId,
        status: "paid",
        periodEnd: { gte: periodStart, lte: periodEnd },
      },
      include: {
        items: { include: { payslip: true } },
      },
    }),
  ]);

  if (!company) return null;

  let payeLiability = 0;
  let sdlLiability = 0;
  let uifEmployeeTotal = 0;
  let uifEmployerTotal = 0;

  for (const run of runs) {
    for (const item of run.items) {
      const payslip = item.payslip;
      if (payslip) {
        payeLiability += Number(payslip.tax ?? 0);
        sdlLiability += Number(payslip.sdl ?? 0);
        uifEmployeeTotal += Number(payslip.uifEmployee ?? 0);
        uifEmployerTotal += Number(payslip.uifEmployer ?? 0);
      }
    }
  }

  const uifLiability = uifEmployeeTotal + uifEmployerTotal;
  const totalPayable = payeLiability + sdlLiability + uifLiability;

  const nameParts = (company.owner?.name ?? "Contact").trim().split(/\s+/);
  const firstName = nameParts[0] ?? "Contact";
  const surname = nameParts.slice(1).join(" ") || (nameParts[0] ?? "User");

  return {
    companyId,
    period: `${year}-${String(month).padStart(2, "0")}`,
    payeLiability: Math.round(payeLiability * 100) / 100,
    sdlLiability: Math.round(sdlLiability * 100) / 100,
    uifLiability: Math.round(uifLiability * 100) / 100,
    totalPayable: Math.round(totalPayable * 100) / 100,
    employerDetails: {
      payeReference: company.payeReference,
      sdlReference: company.sdlReference,
      uifReference: company.uifReference,
      tradingName: company.legalName ?? company.name,
    },
    contactDetails: {
      firstName,
      surname,
      position: "Authorised Representative",
      phone: company.phone ?? "",
      email: company.email ?? company.owner?.email ?? null,
    },
  };
}

/**
 * Generate EMP201 export as CSV for manual entry or eFiling import.
 */
export function emp201ToCsv(data: Emp201Data): string {
  const rows: string[][] = [
    ["EMP201 Monthly Declaration", data.period],
    [],
    ["Employer Details", ""],
    ["PAYE Reference", data.employerDetails.payeReference ?? ""],
    ["SDL Reference", data.employerDetails.sdlReference ?? ""],
    ["UIF Reference", data.employerDetails.uifReference ?? ""],
    ["Trading Name", data.employerDetails.tradingName ?? ""],
    [],
    ["Contact Details", ""],
    ["First Name", data.contactDetails.firstName],
    ["Surname", data.contactDetails.surname],
    ["Position", data.contactDetails.position],
    ["Phone", data.contactDetails.phone],
    ["Email", data.contactDetails.email ?? ""],
    [],
    ["Payment Details", ""],
    ["PAYE Liability", data.payeLiability.toFixed(2)],
    ["SDL Liability", data.sdlLiability.toFixed(2)],
    ["UIF Liability", data.uifLiability.toFixed(2)],
    ["Total Payable", data.totalPayable.toFixed(2)],
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
