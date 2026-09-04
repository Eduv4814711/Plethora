import { format } from "date-fns";
import type { PayrollItem, Employee, Payslip, Company } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { PayslipTemplateData } from "./payslip-pdf.service.js";
import { employeeTypeConfig } from "../lib/leave-rules.config.js";
import { toLeaveConfigEmployeeType } from "./leave-v3.service.js";

interface PayrollItemWithRelations extends PayrollItem {
  employee: Employee;
  payslip: Payslip | null;
}

interface PayslipDataInput {
  payrollItem: PayrollItemWithRelations;
  company: Company;
  periodStart: Date;
  periodEnd: Date;
  payslipDate?: Date | string | null;
  siteName?: string | null;
  siteGradeName?: string | null;
  siteHourlyRate?: number | null;
  timesheet?: {
    basicHours: number;
    overtimeHours: number;
    sundayHours: number;
    publicHolidayHours: number;
    leaveDays: number;
  } | null;
  leaveBreakdown?: {
    annualHours: number;
    sickHours: number;
  };
}


/**
 * Build template data for the professional SA security payslip from DB models.
 */
export function buildPayslipTemplateData(input: PayslipDataInput): PayslipTemplateData {
  const { payrollItem, company, periodStart, periodEnd, siteName, timesheet, leaveBreakdown, siteGradeName, siteHourlyRate } = input;
  const emp = payrollItem.employee;
  const payslip = payrollItem.payslip;

  const earnings = (payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];
  const deductions = (payslip?.deductions as Array<{ name: string; amount: number }>) ?? [];
  const grossPay = payslip ? Number(payslip.grossPay) : Number(payrollItem.grossPay);
  const totalDeductions = payslip ? Number(payslip.totalDeductions) : Number(payrollItem.deductions);
  const netPay = payslip ? Number(payslip.netPay) : Number(payrollItem.netPay);

  const basicHours = timesheet?.basicHours ?? Number(payrollItem.hoursWorked);
  const overtimeHours = timesheet?.overtimeHours ?? Number(payrollItem.overtimeHours);
  const sundayHours = timesheet?.sundayHours ?? 0;
  const publicHolidayHours = timesheet?.publicHolidayHours ?? 0;
  const totalHours = basicHours + overtimeHours + sundayHours + publicHolidayHours;
  const leaveDays = timesheet?.leaveDays ?? 0;
  const annualLeaveHours = leaveBreakdown?.annualHours ?? 0;
  const sickLeaveHours = leaveBreakdown?.sickHours ?? 0;

  const dateEngaged = emp.commencementDate
    ? format(new Date(emp.commencementDate), "d MMM yyyy")
    : undefined;
  const payPeriod = `${format(periodStart, "d MMM yyyy")} – ${format(periodEnd, "d MMM yyyy")}`;
  const payDate = format(periodEnd, "d MMM yyyy");
  const payslipDate = input.payslipDate
    ? format(new Date(input.payslipDate), "d MMM yyyy")
    : payrollItem?.createdAt
      ? format(new Date(payrollItem.createdAt), "d MMM yyyy")
      : format(periodEnd, "d MMM yyyy");
  const dateOfBirth = emp.dateOfBirth
    ? format(new Date(emp.dateOfBirth), "d MMM yyyy")
    : undefined;

  const jobTitle = emp.jobRole ?? emp.occupation ?? undefined;
  const grade = (emp as Employee & { grade?: { name: string; hourlyRate: unknown } | null }).grade;
  const jobGrade = grade?.name ?? siteGradeName ?? undefined;
  const hourlyRate = grade?.hourlyRate != null
    ? Number(grade.hourlyRate)
    : siteHourlyRate != null
      ? siteHourlyRate
      : emp.hourlyRate != null
        ? Number(emp.hourlyRate)
        : undefined;
  const jobGradeRate = hourlyRate != null ? `R ${hourlyRate.toFixed(2)}/hr` : undefined;

  return {
    employerName: company.name,
    employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
    dateEngaged,
    employeeNumber: emp.employeeNumber ?? undefined,
    jobTitle,
    payPeriod,
    payDate,
    payslipDate,
    siteName: siteName ?? undefined,
    companyName: company.legalName ?? company.name,
    companyAddress: company.address ?? undefined,
    psiraRegistration: company.psiraRegistration ?? undefined,
    companyRegistration: company.registrationNumber ?? undefined,
    taxNumber: company.taxNumber ?? undefined,
    uifReference: company.uifReference ?? undefined,
    telephone: company.phone ?? undefined,
    fax: company.fax ?? undefined,
    email: company.email ?? undefined,
    psiraRegistrationNumber: emp.psiraRegistrationNumber ?? undefined,
    identityNumber: emp.idNumber ?? undefined,
    dateOfBirth,
    maritalStatus: emp.maritalStatus ?? undefined,
    gender: emp.gender ?? undefined,
    jobGrade,
    jobGradeRate,
    earnings,
    deductions,
    grossPay,
    totalDeductions,
    netPay,
    totalLeaveDays: leaveDays,
    totalHoursWorked: totalHours,
    normalHoursWorked: basicHours,
    overtimeHours,
    sundayHours,
    publicHolidayHours,
    annualLeaveHours,
    sickLeaveHours,
    totalEmployeeContribution: totalDeductions, // Map deductions as employee contribution
    totalCompanyContribution:
      (payslip?.uifEmployer != null ? Number(payslip.uifEmployer) : 0) +
      (payslip?.sdl != null ? Number(payslip.sdl) : 0),
    taxableEarnings:
      payslip?.taxableEarnings != null ? Number(payslip.taxableEarnings) : grossPay,
    tax: payslip?.tax != null ? Number(payslip.tax) : 0,
    additionalTax: 0,
    totalPerks: 0,
    accountHolder: `${emp.firstName} ${emp.lastName}`.trim(),
    bankName: emp.bankName ?? undefined,
    accountNumber: emp.bankAccountNumber ?? undefined,
    branchCode: emp.bankBranchCode ?? undefined,
  };
}

/**
 * Fetch all data needed to build payslip template for a payroll item.
 */
export async function fetchPayslipData(
  payrollRunId: string,
  itemId: string,
  companyId: string
): Promise<PayslipDataInput | null> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
  });
  if (!run) return null;

  const [item, company, timesheet, leaveRequests, shiftWithSite] = await Promise.all([
    prisma.payrollItem.findFirst({
      where: { id: itemId, payrollRunId },
      include: { employee: { include: { grade: true } }, payslip: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
    }),
    prisma.payrollItem.findUnique({ where: { id: itemId }, select: { employeeId: true } }).then((i) =>
      i
        ? prisma.timesheet.findFirst({
            where: { companyId, payrollRunId, employeeId: i.employeeId },
          })
        : null
    ),
    prisma.payrollItem.findUnique({ where: { id: itemId }, select: { employeeId: true } }).then((i) =>
      i
        ? prisma.leaveRequest.findMany({
            where: {
              companyId,
              employeeId: i.employeeId,
              status: "APPROVED",
              startDate: { lte: run.periodEnd },
              endDate: { gte: run.periodStart },
            },
            select: { leaveType: true, startDate: true, endDate: true, unitsRequested: true, employee: { select: { employeeType: true } } },
          })
        : []
    ),
    prisma.payrollItem.findUnique({ where: { id: itemId }, select: { employeeId: true } }).then(async (i) => {
      if (!i) return null;
      const shift = await prisma.shift.findFirst({
        where: {
          employeeId: i.employeeId,
          startTime: { lt: run.periodEnd },
          endTime: { gt: run.periodStart },
        },
        include: { site: { include: { payProfiles: { include: { area: true, grade: true }, orderBy: { effectiveFrom: "desc" } } } } },
      });
      if (shift?.site) return shift;
      const assignment = await prisma.siteAssignment.findFirst({
        where: { employeeId: i.employeeId },
        include: { site: { include: { payProfiles: { include: { area: true, grade: true }, orderBy: { effectiveFrom: "desc" } } } } },
      });
      if (assignment?.site) return { site: assignment.site };
      const home = await prisma.employeePayrollHomeSite.findFirst({
        where: { employeeId: i.employeeId, effectiveFrom: { lte: run.periodEnd } },
        orderBy: { effectiveFrom: "desc" },
        include: { site: { include: { payProfiles: { include: { area: true, grade: true }, orderBy: { effectiveFrom: "desc" } } } } },
      });
      if (home?.site) return { site: home.site };
      return null;
    }),
  ]);

  if (!item || !company) return null;

  const siteObj = (shiftWithSite?.site as { name?: string; payProfiles?: Array<{ areaId: string; gradeId: string; area: { name: string }; grade: { name: string } }> } | null);
  const siteName = siteObj?.name ?? null;
  const payProfile = siteObj?.payProfiles?.[0];
  const siteGradeName = payProfile?.grade?.name ?? null;
  let siteHourlyRate: number | null = null;
  if (payProfile) {
    const rateRecord = await prisma.payAreaGradeRate.findFirst({
      where: {
        companyId,
        areaId: payProfile.areaId,
        gradeId: payProfile.gradeId,
        effectiveFrom: { lte: run.periodEnd },
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (rateRecord) {
      siteHourlyRate = Number(rateRecord.hourlyRate);
    }
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  let annualLeaveHours = 0;
  let sickLeaveHours = 0;

  for (const req of leaveRequests ?? []) {
    const overlapStart = req.startDate > run.periodStart ? req.startDate : run.periodStart;
    const overlapEnd = req.endDate < run.periodEnd ? req.endDate : run.periodEnd;
    if (overlapEnd < overlapStart) continue;

    const totalDays = Math.round((req.endDate.getTime() - req.startDate.getTime()) / DAY_MS) + 1;
    const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1;
    const ratio = totalDays > 0 ? overlapDays / totalDays : 0;
    const hoursPerUnit = employeeTypeConfig(toLeaveConfigEmployeeType(req.employee.employeeType)).hoursPerUnit;
    const hours = Number(req.unitsRequested) * ratio * hoursPerUnit;

    if (req.leaveType === "ANNUAL") {
      annualLeaveHours += hours;
    } else if (req.leaveType === "SICK") {
      sickLeaveHours += hours;
    }
  }

  return {
    payrollItem: item,
    company,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    siteName,
    siteGradeName,
    siteHourlyRate,
    timesheet: timesheet
      ? {
          basicHours: Number(timesheet.basicHours),
          overtimeHours: Number(timesheet.overtimeHours),
          sundayHours: Number(timesheet.sundayHours),
          publicHolidayHours: Number(timesheet.publicHolidayHours),
          leaveDays: Number(timesheet.leaveDays),
        }
      : null,
    leaveBreakdown: { annualHours: annualLeaveHours, sickHours: sickLeaveHours },
  };
}
