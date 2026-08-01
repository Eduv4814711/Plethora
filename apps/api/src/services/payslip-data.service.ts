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
  siteName?: string | null;
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
  const { payrollItem, company, periodStart, periodEnd, siteName, timesheet, leaveBreakdown } = input;
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
  const payDate = format(periodEnd, "d MMM yyyy");
  const dateOfBirth = emp.dateOfBirth
    ? format(new Date(emp.dateOfBirth), "d MMM yyyy")
    : undefined;

  const jobTitle = emp.jobRole ?? emp.occupation ?? undefined;
  const grade = (emp as Employee & { grade?: { name: string; hourlyRate: unknown } | null }).grade;
  const jobGrade = grade?.name ?? undefined;
  const hourlyRate = grade?.hourlyRate != null ? Number(grade.hourlyRate) : emp.hourlyRate != null ? Number(emp.hourlyRate) : undefined;
  const jobGradeRate = hourlyRate != null ? `R ${hourlyRate.toFixed(2)}/hr` : undefined;

  return {
    employerName: company.name,
    employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
    dateEngaged,
    employeeNumber: emp.employeeNumber ?? undefined,
    jobTitle,
    payDate,
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
    prisma.payrollItem.findUnique({ where: { id: itemId }, select: { employeeId: true } }).then((i) =>
      i
        ? prisma.shift.findFirst({
            where: {
              employeeId: i.employeeId,
              startTime: { lt: run.periodEnd },
              endTime: { gt: run.periodStart },
            },
            include: { site: true },
          })
        : null
    ),
  ]);

  if (!item || !company) return null;

  const siteName = shiftWithSite?.site?.name ?? null;

  // Same proration approach as timesheet.service.ts's aggregateTimesheets:
  // a request spanning the period boundary only contributes the proportion
  // of its units that fall within this pay period.
  const DAY_MS = 24 * 60 * 60 * 1000;
  let annualLeaveHours = 0;
  let sickLeaveHours = 0;
  for (const request of leaveRequests) {
    const overlapStart = request.startDate > run.periodStart ? request.startDate : run.periodStart;
    const overlapEnd = request.endDate < run.periodEnd ? request.endDate : run.periodEnd;
    if (overlapEnd < overlapStart) continue;
    const totalDays = Math.round((request.endDate.getTime() - request.startDate.getTime()) / DAY_MS) + 1;
    const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1;
    const ratio = totalDays > 0 ? overlapDays / totalDays : 0;
    const hoursPerUnit = employeeTypeConfig(toLeaveConfigEmployeeType(request.employee.employeeType)).hoursPerUnit;
    const hours = Number(request.unitsRequested) * ratio * hoursPerUnit;
    if (request.leaveType === "ANNUAL") annualLeaveHours += hours;
    else if (request.leaveType === "SICK") sickLeaveHours += hours;
  }

  return {
    payrollItem: item,
    company,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    siteName,
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
