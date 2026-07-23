import { addDays, differenceInCalendarDays } from "date-fns";
import type {
  LeaveApplicationSource,
  LeaveApplicationStatus,
  LeavePayrollTreatment,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import {
  enumerateLeaveDates,
  formatLeaveDateKey,
  normalizeLeaveDate,
  validateLeaveDateRange,
} from "./leave-availability.service.js";
import { reconcileContinuityForEmployee } from "../modules/rosters/roster-continuity.service.js";
import { createNotification } from "../modules/notifications/notifications.service.js";
import { sendText } from "../whatsapp/services/send.service.js";
import {
  leaveOccurrenceBalanceMinutes,
  leavePolicyConfigurationIssues,
} from "./leave-policy.service.js";

const ACTIVE_APPLICATION_STATUSES: LeaveApplicationStatus[] = [
  "SUBMITTED",
  "PENDING_HR",
  "APPROVED",
  "CANCELLATION_REQUESTED",
  "PAYROLL_PROCESSED",
  "ADJUSTMENT_REQUIRED",
  "IMPORTED_APPROVED",
];

const LEAVE_DOCUMENT_PUBLIC_SELECT = {
  id: true,
  documentType: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  reviewStatus: true,
  uploadedById: true,
  uploadedByEmployeeId: true,
  verifiedById: true,
  verifiedAt: true,
  reviewNote: true,
  createdAt: true,
} satisfies Prisma.LeaveApplicationDocumentSelect;

const TERMINAL_EMPLOYEE_STATUSES = new Set(["offboarded"]);

export class LeaveManagementError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "LEAVE_VALIDATION"
  ) {
    super(message);
    this.name = "LeaveManagementError";
  }
}

type LeaveOperationContext = {
  /** Reuse an outer transaction for compatibility writes that must commit together. */
  transaction?: Prisma.TransactionClient;
};

type PreviewOccurrence = {
  leaveDate: Date;
  shiftId: string | null;
  siteId: string | null;
  scheduledMinutes: number;
  requestedMinutes: number;
  balanceMinutes: number;
  paidMinutes: number;
  unpaidMinutes: number;
  payrollTreatment: LeavePayrollTreatment;
};

export type LeavePreview = {
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  calendarDays: number;
  calculatedMinutes: number;
  paidMinutes: number;
  unpaidMinutes: number;
  occurrences: PreviewOccurrence[];
  warnings: string[];
  conflicts: Array<{ id: string; startDate: Date; endDate: Date; status: LeaveApplicationStatus }>;
  policyVersionId: string | null;
  policyConfirmed: boolean;
  documentRequired: boolean;
  negativeBalanceAllowed: boolean;
  maxConsecutiveDays: number | null;
  balanceImpact: { currentMinutes: number; reservedMinutes: number; projectedMinutes: number };
  staffingImpact: { shiftsAffected: number; siteIds: string[]; unrosteredCalendarDays: number };
};

const DEFAULT_TYPES: Array<{
  code: string;
  name: string;
  description: string;
  isPaid: boolean;
  payrollTreatment: LeavePayrollTreatment;
  durationMode: "CALENDAR_CONSECUTIVE" | "SCHEDULED_WORK" | "SHIFT_COUNT" | "HOURS";
  requiresBalance: boolean;
  allowPartialDay: boolean;
  requiresDocument: boolean;
  authority: string;
  legalReference: string;
  cycleMonths: number;
}> = [
  { code: "annual", name: "Annual leave", description: "Paid annual leave; final entitlement follows the confirmed employee policy.", isPaid: true, payrollTreatment: "PAID_EMPLOYER", durationMode: "SCHEDULED_WORK", requiresBalance: true, allowPartialDay: true, requiresDocument: false, authority: "BCEA/NBCPSS", legalReference: "BCEA s20; NBCPSS MCA clause 11", cycleMonths: 12 },
  { code: "sick", name: "Sick leave", description: "Paid sick leave subject to cycle and proof-of-incapacity rules.", isPaid: true, payrollTreatment: "PAID_EMPLOYER", durationMode: "SCHEDULED_WORK", requiresBalance: true, allowPartialDay: true, requiresDocument: false, authority: "BCEA/NBCPSS", legalReference: "BCEA ss22-23; NBCPSS MCA clauses 12-13", cycleMonths: 36 },
  { code: "family_responsibility", name: "Family responsibility leave", description: "Policy-specific paid family responsibility leave.", isPaid: true, payrollTreatment: "PAID_EMPLOYER", durationMode: "SCHEDULED_WORK", requiresBalance: true, allowPartialDay: true, requiresDocument: false, authority: "BCEA/NBCPSS", legalReference: "BCEA s27; NBCPSS MCA clause 14", cycleMonths: 12 },
  { code: "parental", name: "Parental leave", description: "Parental leave under the operative legal framework; UIF treatment requires confirmation.", isPaid: false, payrollTreatment: "UIF_NO_EMPLOYER_PAY", durationMode: "CALENDAR_CONSECUTIVE", requiresBalance: false, allowPartialDay: false, requiresDocument: true, authority: "Constitutional Court/BCEA", legalReference: "Van Wyk interim order; BCEA ss25-25C", cycleMonths: 0 },
  { code: "adoption", name: "Adoption leave", description: "Adoption leave under the operative parental-leave framework.", isPaid: false, payrollTreatment: "UIF_NO_EMPLOYER_PAY", durationMode: "CALENDAR_CONSECUTIVE", requiresBalance: false, allowPartialDay: false, requiresDocument: true, authority: "Constitutional Court/BCEA", legalReference: "Van Wyk interim order; BCEA s25B", cycleMonths: 0 },
  { code: "commissioning_parental", name: "Commissioning parental leave", description: "Leave for a commissioning parent in a surrogate motherhood agreement.", isPaid: false, payrollTreatment: "UIF_NO_EMPLOYER_PAY", durationMode: "CALENDAR_CONSECUTIVE", requiresBalance: false, allowPartialDay: false, requiresDocument: true, authority: "Constitutional Court/BCEA", legalReference: "Van Wyk interim order; BCEA s25C", cycleMonths: 0 },
  { code: "maternity", name: "Maternity / birth-parent leave", description: "Legacy-compatible birth-parent leave code; policy must reflect the operative parental framework.", isPaid: false, payrollTreatment: "UIF_NO_EMPLOYER_PAY", durationMode: "CALENDAR_CONSECUTIVE", requiresBalance: false, allowPartialDay: false, requiresDocument: true, authority: "Constitutional Court/BCEA", legalReference: "Van Wyk interim order; BCEA s25", cycleMonths: 0 },
  { code: "study", name: "Study leave", description: "Study leave where the sector or company policy permits it.", isPaid: true, payrollTreatment: "PAID_EMPLOYER", durationMode: "SCHEDULED_WORK", requiresBalance: true, allowPartialDay: true, requiresDocument: true, authority: "NBCPSS/company policy", legalReference: "NBCPSS MCA clause 17", cycleMonths: 12 },
  { code: "special", name: "Special / compassionate leave", description: "Company-configured special or compassionate leave.", isPaid: true, payrollTreatment: "PAID_EMPLOYER", durationMode: "SCHEDULED_WORK", requiresBalance: true, allowPartialDay: true, requiresDocument: false, authority: "Company policy", legalReference: "HR confirmation required", cycleMonths: 12 },
  { code: "injury_on_duty", name: "Injury on duty", description: "Occupational injury leave with compensation treatment.", isPaid: false, payrollTreatment: "IOD_COMPENSATION", durationMode: "SCHEDULED_WORK", requiresBalance: false, allowPartialDay: true, requiresDocument: true, authority: "COIDA/company policy", legalReference: "COIDA and HR confirmation required", cycleMonths: 0 },
  { code: "unpaid", name: "Unpaid leave", description: "Authorised unpaid leave; never treated as paid leave.", isPaid: false, payrollTreatment: "UNPAID_DEDUCTION", durationMode: "SCHEDULED_WORK", requiresBalance: false, allowPartialDay: true, requiresDocument: false, authority: "Agreement/company policy", legalReference: "Written agreement and HR confirmation required", cycleMonths: 0 },
];

export async function ensureDefaultLeavePolicy(companyId: string, actorId?: string) {
  const existing = await prisma.leavePolicy.findFirst({
    where: { companyId, category: "STATUTORY_BASELINE" },
    include: { versions: true },
  });
  if (existing && existing.versions.length >= DEFAULT_TYPES.length) return existing;

  return prisma.$transaction(async (tx) => {
    const policy = await tx.leavePolicy.upsert({
      where: { companyId_name: { companyId, name: "South African statutory and private-security baseline" } },
      create: {
        companyId,
        name: "South African statutory and private-security baseline",
        category: "STATUTORY_BASELINE",
        description: "Seeded for review. HR or labour counsel must confirm before entitlement enforcement.",
      },
      update: {},
    });
    for (const definition of DEFAULT_TYPES) {
      const leaveType = await tx.leaveTypeDefinition.upsert({
        where: { companyId_code: { companyId, code: definition.code } },
        create: {
          companyId,
          code: definition.code,
          name: definition.name,
          description: definition.description,
          isPaid: definition.isPaid,
          payrollTreatment: definition.payrollTreatment,
          durationMode: definition.durationMode,
          requiresBalance: definition.requiresBalance,
          allowPartialDay: definition.allowPartialDay,
          requiresDocument: definition.requiresDocument,
        },
        update: {},
      });
      await tx.leavePolicyVersion.upsert({
        where: { policyId_leaveTypeId_version: { policyId: policy.id, leaveTypeId: leaveType.id, version: 1 } },
        create: {
          companyId,
          policyId: policy.id,
          leaveTypeId: leaveType.id,
          version: 1,
          effectiveFrom: normalizeLeaveDate("1997-12-01"),
          reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION",
          sourceAuthority: definition.authority,
          legalReference: definition.legalReference,
          entitlementMinutes: null,
          accrualMethod: definition.requiresBalance ? "POLICY_CONFIRMATION_REQUIRED" : "NONE",
          cycleMonths: definition.cycleMonths,
          approvalFlow: [{ order: 1, module: "/employees/leave", capability: "approve", required: true }],
          documentRules: { required: definition.requiresDocument },
          calculationRules: { legalReviewRequired: true },
          createdBy: actorId,
        },
        update: {},
      });
    }
    return tx.leavePolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { versions: true } });
  });
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

async function employmentAndSchedule(companyId: string, employeeId: string, start: Date, end: Date) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, status: true, employeeType: true, commencementDate: true },
  });
  if (!employee) throw new LeaveManagementError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
  if (TERMINAL_EMPLOYEE_STATUSES.has(employee.status)) {
    throw new LeaveManagementError("Leave cannot be captured for an offboarded employee");
  }
  if (employee.commencementDate && start < normalizeLeaveDate(employee.commencementDate)) {
    throw new LeaveManagementError("Leave cannot start before the employee's commencement date");
  }
  const [term, termCount] = await Promise.all([prisma.employmentTerm.findFirst({
    where: {
      companyId,
      employeeId,
      effectiveFrom: { lte: start },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: end } }],
    },
    orderBy: { effectiveFrom: "desc" },
  }), prisma.employmentTerm.count({ where: { companyId, employeeId } })]);
  if (!term && termCount > 0) {
    throw new LeaveManagementError("The leave period falls outside the employee's effective employment terms");
  }
  return { employee, term };
}

export async function previewLeave(params: {
  companyId: string;
  employeeId: string;
  leaveTypeCode: string;
  startDate: string;
  endDate?: string;
  requestedMinutesPerDay?: number;
  excludeApplicationId?: string;
  /** Legacy forms always carry an hours field; for non-partial types it means a full scheduled day. */
  legacyFullDayCapture?: boolean;
}): Promise<LeavePreview> {
  await ensureDefaultLeavePolicy(params.companyId);
  const { start, end, dates } = validateLeaveDateRange(params.startDate, params.endDate);
  const leaveType = await prisma.leaveTypeDefinition.findFirst({
    where: { companyId: params.companyId, code: params.leaveTypeCode, isActive: true },
  });
  if (!leaveType) throw new LeaveManagementError("Leave type is not configured");
  if (params.requestedMinutesPerDay != null && params.requestedMinutesPerDay <= 0) {
    throw new LeaveManagementError("Partial-day minutes must be greater than zero");
  }
  if (params.requestedMinutesPerDay != null && !leaveType.allowPartialDay && !params.legacyFullDayCapture) {
    throw new LeaveManagementError(`${leaveType.name} does not allow partial-day leave`);
  }
  const requestedMinutesPerDay = params.legacyFullDayCapture && !leaveType.allowPartialDay
    ? undefined
    : params.requestedMinutesPerDay;

  const { employee, term } = await employmentAndSchedule(params.companyId, params.employeeId, start, end);
  const conflicts = await prisma.leaveApplication.findMany({
    where: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      status: { in: ACTIVE_APPLICATION_STATUSES },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(params.excludeApplicationId ? { id: { not: params.excludeApplicationId } } : {}),
    },
    select: { id: true, startDate: true, endDate: true, status: true },
  });

  const timeZone = await getCompanyTimezone(params.companyId);
  const queryStart = addDays(start, -1);
  const queryEnd = addDays(end, 2);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      startTime: { gte: queryStart, lt: queryEnd },
      status: { in: ["created", "assigned", "active", "completed", "verified"] },
    },
    select: { id: true, siteId: true, startTime: true, endTime: true },
  });
  const shiftsByDate = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const key = dateKeyInTimeZone(shift.startTime, timeZone);
    shiftsByDate.set(key, [...(shiftsByDate.get(key) ?? []), shift]);
  }
  const holidays = await prisma.publicHoliday.findMany({
    where: { companyId: params.companyId, date: { gte: start, lte: end } },
    select: { date: true },
  });
  const holidayKeys = new Set(holidays.map((h) => formatLeaveDateKey(h.date)));
  const warnings: string[] = [];
  const occurrences: PreviewOccurrence[] = [];
  const defaultMinutes = term?.normalMinutesPerShift ?? (employee.employeeType === "office" ? 480 : 0);

  for (const date of dates) {
    const key = formatLeaveDateKey(date);
    const annualPublicHoliday = leaveType.code === "annual" && holidayKeys.has(key);
    const dayShifts = (shiftsByDate.get(key) ?? []).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const payableSegments = dayShifts.length > 0
      ? dayShifts.map((shift) => ({
          shiftId: shift.id,
          siteId: shift.siteId,
          scheduledMinutes: minutesBetween(shift.startTime, shift.endTime),
        }))
      : employee.employeeType === "office" && date.getUTCDay() !== 0 && date.getUTCDay() !== 6
        ? [{ shiftId: null, siteId: null, scheduledMinutes: defaultMinutes }]
        : [];

    let remainingRequestedMinutes = requestedMinutesPerDay ?? Number.POSITIVE_INFINITY;
    for (const segment of payableSegments) {
      const requestedMinutes = Math.min(segment.scheduledMinutes, remainingRequestedMinutes);
      if (requestedMinutes <= 0) continue;
      const unpaid = leaveType.payrollTreatment === "UNPAID_DEDUCTION" || leaveType.payrollTreatment === "UIF_NO_EMPLOYER_PAY";
      occurrences.push({
        leaveDate: date,
        shiftId: segment.shiftId,
        siteId: segment.siteId,
        scheduledMinutes: segment.scheduledMinutes,
        requestedMinutes,
        // Public holidays inside annual leave remain paid/roster-relevant but
        // must not reduce the annual leave balance. Leave types such as unpaid,
        // parental and IOD never maintain a leave balance.
        balanceMinutes: leaveOccurrenceBalanceMinutes({
          requiresBalance: leaveType.requiresBalance,
          leaveTypeCode: leaveType.code,
          isPublicHoliday: annualPublicHoliday,
          requestedMinutes,
        }),
        paidMinutes: leaveType.payrollTreatment === "PAID_EMPLOYER" ? requestedMinutes : 0,
        unpaidMinutes: unpaid ? requestedMinutes : 0,
        payrollTreatment: leaveType.payrollTreatment,
      });
      remainingRequestedMinutes -= requestedMinutes;
      if (remainingRequestedMinutes <= 0) break;
    }
  }

  if (employee.employeeType !== "office" && occurrences.every((item) => item.scheduledMinutes === 0)) {
    warnings.push("No rostered shifts or confirmed employment pattern were found; HR must confirm payable hours before approval.");
  }
  if (!term) warnings.push("No effective-dated employment term exists; legacy employee fields were used where possible.");
  if (conflicts.length > 0) warnings.push("The requested period overlaps another active leave application.");

  const assignment = await prisma.employeeLeavePolicyAssignment.findFirst({
    where: { employeeId: params.employeeId, policy: { companyId: params.companyId }, effectiveFrom: { lte: start }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: end } }] },
    orderBy: { effectiveFrom: "desc" },
  });
  const policyVersionWhere: Prisma.LeavePolicyVersionWhereInput = {
    companyId: params.companyId,
    leaveTypeId: leaveType.id,
    ...(assignment
      ? { policyId: assignment.policyId }
      : { policy: { category: "STATUTORY_BASELINE" } }),
    effectiveFrom: { lte: start },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: end } }],
  };
  const activePolicyVersion = await prisma.leavePolicyVersion.findFirst({
    where: { ...policyVersionWhere, reviewStatus: "ACTIVE" },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  const policyVersion = activePolicyVersion ?? await prisma.leavePolicyVersion.findFirst({
    where: { ...policyVersionWhere, reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION" },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  const [balance, currentApplicationBalance] = await Promise.all([
    prisma.leaveLedgerEntry.aggregate({
      where: { companyId: params.companyId, employeeId: params.employeeId, leaveTypeId: leaveType.id, effectiveDate: { lte: start } },
      _sum: { minutes: true },
    }),
    params.excludeApplicationId
      ? prisma.leaveLedgerEntry.aggregate({
          where: { companyId: params.companyId, employeeId: params.employeeId, leaveTypeId: leaveType.id, applicationId: params.excludeApplicationId, effectiveDate: { lte: start } },
          _sum: { minutes: true },
        })
      : Promise.resolve({ _sum: { minutes: 0 } }),
  ]);
  // Re-previewing a draft/pending application must start from the balance that
  // existed before that application's reservation. Otherwise approval counts
  // the same request once in the ledger and again in projectedMinutes.
  const currentMinutes = (balance._sum.minutes ?? 0) - (currentApplicationBalance._sum.minutes ?? 0);
  const policyConfigurationIssues = policyVersion
    ? leavePolicyConfigurationIssues({ ...policyVersion, leaveType })
    : ["No policy version covers the full leave period."];
  const policyConfirmed = policyVersion?.reviewStatus === "ACTIVE" && policyConfigurationIssues.length === 0;
  if (!policyConfirmed) {
    warnings.push("The applicable policy version is not active with an executable balance formula; approval is blocked until HR completes policy configuration.");
    warnings.push(...policyConfigurationIssues);
  } else if (policyVersion.maxConsecutiveDays != null && differenceInCalendarDays(end, start) + 1 > policyVersion.maxConsecutiveDays) {
    warnings.push(`The request exceeds the confirmed maximum of ${policyVersion.maxConsecutiveDays} consecutive calendar days.`);
  }

  return {
    employeeId: params.employeeId,
    leaveTypeId: leaveType.id,
    leaveTypeCode: leaveType.code,
    startDate: formatLeaveDateKey(start),
    endDate: formatLeaveDateKey(end),
    calendarDays: differenceInCalendarDays(end, start) + 1,
    calculatedMinutes: occurrences.reduce((sum, item) => sum + item.requestedMinutes, 0),
    paidMinutes: occurrences.reduce((sum, item) => sum + item.paidMinutes, 0),
    unpaidMinutes: occurrences.reduce((sum, item) => sum + item.unpaidMinutes, 0),
    occurrences,
    warnings,
    conflicts,
    policyVersionId: policyVersion?.id ?? null,
    policyConfirmed,
    documentRequired: leaveType.requiresDocument,
    negativeBalanceAllowed: policyVersion?.negativeBalanceAllowed ?? false,
    maxConsecutiveDays: policyVersion?.maxConsecutiveDays ?? null,
    balanceImpact: {
      currentMinutes,
      reservedMinutes: previewReservationMinutes(occurrences),
      projectedMinutes: currentMinutes - previewReservationMinutes(occurrences),
    },
    staffingImpact: {
      shiftsAffected: occurrences.filter((item) => item.shiftId).length,
      siteIds: [...new Set(occurrences.map((item) => item.siteId).filter((id): id is string => Boolean(id)))],
      unrosteredCalendarDays: dates.length - new Set(occurrences.map((item) => formatLeaveDateKey(item.leaveDate))).size,
    },
  };
}

function previewReservationMinutes(occurrences: PreviewOccurrence[]): number {
  return occurrences.reduce((sum, item) => sum + item.balanceMinutes, 0);
}

async function addLeaveAudit(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    employeeId?: string;
    applicationId?: string;
    userId?: string;
    eventType: string;
    reason?: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  }
) {
  await tx.leaveAuditEvent.create({ data: input });
}

export async function createLeaveApplication(params: {
  companyId: string;
  employeeId: string;
  leaveTypeCode: string;
  startDate: string;
  endDate?: string;
  requestedMinutesPerDay?: number;
  reason?: string;
  retrospectiveReason?: string;
  idempotencyKey?: string;
  source?: LeaveApplicationSource;
  actorId?: string;
  submit?: boolean;
  legacyLeaveRequestId?: string;
  legacyFullDayCapture?: boolean;
}, context: LeaveOperationContext = {}) {
  const db = context.transaction ?? prisma;
  if (params.idempotencyKey) {
    const existing = await db.leaveApplication.findUnique({
      where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: params.idempotencyKey } },
      include: { leaveType: true, employee: true, occurrences: true, documents: { select: LEAVE_DOCUMENT_PUBLIC_SELECT } },
    });
    if (existing) return existing;
  }
  const preview = await previewLeave(params);
  if (preview.conflicts.length > 0) {
    throw new LeaveManagementError("This request overlaps existing active leave", 409, "LEAVE_OVERLAP");
  }
  if (preview.calculatedMinutes === 0) {
    throw new LeaveManagementError("No working days or rostered shifts fall inside this request; add an effective employment pattern before submitting leave");
  }
  const reservationMinutes = previewReservationMinutes(preview.occurrences);
  const nowKey = dateKeyInTimeZone(new Date(), await getCompanyTimezone(params.companyId));
  if (preview.startDate < nowKey && !params.retrospectiveReason?.trim()) {
    throw new LeaveManagementError("A reason is required for retrospective leave");
  }
  const status: LeaveApplicationStatus = params.submit === false ? "DRAFT" : "PENDING_HR";
  let result: { id: string };
  try {
    const persist = async (tx: Prisma.TransactionClient) => {
      const application = await tx.leaveApplication.create({
        data: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          leaveTypeId: preview.leaveTypeId,
          policyVersionId: preview.policyVersionId,
          startDate: normalizeLeaveDate(preview.startDate),
          endDate: normalizeLeaveDate(preview.endDate),
          requestedMinutes: preview.calculatedMinutes,
          calculatedMinutes: preview.calculatedMinutes,
          paidMinutes: preview.paidMinutes,
          unpaidMinutes: preview.unpaidMinutes,
          status,
          source: params.source ?? "ADMIN",
          reason: params.reason?.trim() || null,
          retrospectiveReason: params.retrospectiveReason?.trim() || null,
          idempotencyKey: params.idempotencyKey,
          legacyLeaveRequestId: params.legacyLeaveRequestId,
          submittedAt: status === "PENDING_HR" ? new Date() : null,
          createdById: params.actorId,
          metadata: { warnings: preview.warnings, requestedMinutesPerDay: params.requestedMinutesPerDay ?? null, legacyFullDayCapture: params.legacyFullDayCapture === true },
          occurrences: {
            create: preview.occurrences.map((occurrence) => ({
              companyId: params.companyId,
              employeeId: params.employeeId,
              leaveDate: occurrence.leaveDate,
              shiftId: occurrence.shiftId,
              siteId: occurrence.siteId,
              scheduledMinutes: occurrence.scheduledMinutes,
              requestedMinutes: occurrence.requestedMinutes,
              balanceMinutes: occurrence.balanceMinutes,
              paidMinutes: occurrence.paidMinutes,
              unpaidMinutes: occurrence.unpaidMinutes,
              payrollTreatment: occurrence.payrollTreatment,
              status: "RESERVED",
            })),
          },
          approvalSteps: {
            create: [{ stepOrder: 1, requiredCapability: "/employees/leave:approve", decision: "PENDING" }],
          },
        },
      });
      if (status === "PENDING_HR" && reservationMinutes > 0) {
        await tx.leaveLedgerEntry.create({
          data: {
            companyId: params.companyId,
            employeeId: params.employeeId,
            leaveTypeId: preview.leaveTypeId,
            applicationId: application.id,
            entryType: "RESERVATION",
            effectiveDate: normalizeLeaveDate(preview.startDate),
            minutes: -reservationMinutes,
            reason: "Leave submitted and balance reserved",
            createdById: params.actorId,
          },
        });
      }
      await addLeaveAudit(tx, {
        companyId: params.companyId,
        employeeId: params.employeeId,
        applicationId: application.id,
        userId: params.actorId,
        eventType: status === "DRAFT" ? "APPLICATION_DRAFTED" : "APPLICATION_SUBMITTED",
        newValue: { status, startDate: preview.startDate, endDate: preview.endDate, calculatedMinutes: preview.calculatedMinutes },
        metadata: { source: params.source ?? "ADMIN" },
      });
      return application;
    };
    result = context.transaction
      ? await persist(context.transaction)
      : await prisma.$transaction(persist);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("LeaveApplication_no_active_overlap") || message.includes("exclusion constraint")) {
      throw new LeaveManagementError("This request overlaps existing active leave", 409, "LEAVE_OVERLAP");
    }
    throw error;
  }
  if (status === "PENDING_HR" && !context.transaction) {
    const [reviewers, company] = await Promise.all([
      prisma.user.findMany({
        where: {
          companyId: params.companyId,
          isActive: true,
          capabilities: { path: ["/employees/leave"], array_contains: ["approve"] },
        },
        select: { id: true },
      }),
      prisma.company.findUnique({
        where: { id: params.companyId },
        select: { owner: { select: { id: true, isActive: true } } },
      }),
    ]);
    const reviewerIds = new Set(reviewers.map((reviewer) => reviewer.id));
    if (company?.owner?.isActive) reviewerIds.add(company.owner.id);
    await Promise.all([...reviewerIds].map((reviewerId) => createNotification({ companyId: params.companyId, userId: reviewerId, title: "Leave awaiting HR decision", message: `Leave application ${result.id} is ready for review.`, dedupeKey: `leave-submitted:${result.id}:${reviewerId}`, sourceModule: "leave", sourceId: result.id, linkUrl: "/employees/leave" }).catch(() => undefined)));
  }
  return db.leaveApplication.findUniqueOrThrow({
    where: { id: result.id },
    include: { employee: true, leaveType: true, occurrences: true, approvalSteps: true, documents: { select: LEAVE_DOCUMENT_PUBLIC_SELECT } },
  });
}

export async function submitLeaveApplication(params: {
  companyId: string;
  applicationId: string;
  actorId: string;
  expectedVersion?: number;
}) {
  const application = await prisma.leaveApplication.findFirst({
    where: { id: params.applicationId, companyId: params.companyId },
    include: { leaveType: true },
  });
  if (!application) throw new LeaveManagementError("Leave application not found", 404, "NOT_FOUND");
  if (application.status !== "DRAFT") throw new LeaveManagementError(`Only a draft can be submitted; this application is ${application.status.toLowerCase()}`);
  if (params.expectedVersion != null && params.expectedVersion !== application.version) {
    throw new LeaveManagementError("Leave application changed since it was loaded; refresh and try again", 409, "VERSION_CONFLICT");
  }
  const preview = await previewLeave({
    companyId: params.companyId,
    employeeId: application.employeeId,
    leaveTypeCode: application.leaveType.code,
    startDate: formatLeaveDateKey(application.startDate),
    endDate: formatLeaveDateKey(application.endDate),
    requestedMinutesPerDay: typeof (application.metadata as { requestedMinutesPerDay?: unknown } | null)?.requestedMinutesPerDay === "number"
      ? (application.metadata as { requestedMinutesPerDay: number }).requestedMinutesPerDay
      : undefined,
    legacyFullDayCapture: (application.metadata as { legacyFullDayCapture?: unknown } | null)?.legacyFullDayCapture === true,
    excludeApplicationId: application.id,
  });
  if (preview.conflicts.length) throw new LeaveManagementError("This request overlaps existing active leave", 409, "LEAVE_OVERLAP");
  if (preview.calculatedMinutes <= 0) throw new LeaveManagementError("No payable or rostered duration is available for this application");
  const reservationMinutes = previewReservationMinutes(preview.occurrences);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.leaveApplication.updateMany({
      where: { id: application.id, status: "DRAFT", version: application.version },
      data: { status: "PENDING_HR", submittedAt: new Date(), calculatedMinutes: preview.calculatedMinutes, paidMinutes: preview.paidMinutes, unpaidMinutes: preview.unpaidMinutes, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new LeaveManagementError("Leave application changed during submission; refresh and try again", 409, "VERSION_CONFLICT");
    await tx.leaveOccurrence.deleteMany({ where: { applicationId: application.id } });
    await tx.leaveOccurrence.createMany({ data: preview.occurrences.map((occurrence) => ({ companyId: params.companyId, applicationId: application.id, employeeId: application.employeeId, leaveDate: occurrence.leaveDate, shiftId: occurrence.shiftId, siteId: occurrence.siteId, scheduledMinutes: occurrence.scheduledMinutes, requestedMinutes: occurrence.requestedMinutes, balanceMinutes: occurrence.balanceMinutes, paidMinutes: occurrence.paidMinutes, unpaidMinutes: occurrence.unpaidMinutes, payrollTreatment: occurrence.payrollTreatment, status: "RESERVED" })) });
    if (reservationMinutes > 0) {
      await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, entryType: "RESERVATION", effectiveDate: application.startDate, minutes: -reservationMinutes, reason: "Draft submitted and balance reserved", createdById: params.actorId } });
    }
    await addLeaveAudit(tx, { companyId: params.companyId, employeeId: application.employeeId, applicationId: application.id, userId: params.actorId, eventType: "APPLICATION_SUBMITTED", previousValue: { status: "DRAFT" }, newValue: { status: "PENDING_HR", calculatedMinutes: preview.calculatedMinutes } });
  });
  return getLeaveApplication(params.companyId, application.id);
}

export async function decideLeaveApplication(params: {
  companyId: string;
  applicationId: string;
  actorId: string;
  decision: "approve" | "reject";
  reason?: string;
  expectedVersion?: number;
}, context: LeaveOperationContext = {}) {
  const db = context.transaction ?? prisma;
  if (params.decision === "reject" && !params.reason?.trim()) {
    throw new LeaveManagementError("A rejection reason is required");
  }
  const existing = await db.leaveApplication.findFirst({
    where: { id: params.applicationId, companyId: params.companyId },
    include: { leaveType: true, documents: true, payrollPostings: true },
  });
  if (!existing) throw new LeaveManagementError("Leave application not found", 404, "NOT_FOUND");
  if (params.expectedVersion != null && params.expectedVersion !== existing.version) {
    throw new LeaveManagementError("Leave application changed since it was loaded; refresh and try again", 409, "VERSION_CONFLICT");
  }
  if (!['SUBMITTED', 'PENDING_HR'].includes(existing.status)) {
    throw new LeaveManagementError(`Leave application is already ${existing.status.toLowerCase()}`);
  }
  if (params.decision === "approve" && existing.leaveType.requiresDocument && !existing.documents.some((d) => d.reviewStatus === "VERIFIED")) {
    throw new LeaveManagementError(`A verified supporting document is required for ${existing.leaveType.name}`);
  }
  const preview = params.decision === "approve"
    ? await previewLeave({
        companyId: params.companyId,
        employeeId: existing.employeeId,
        leaveTypeCode: existing.leaveType.code,
        startDate: formatLeaveDateKey(existing.startDate),
        endDate: formatLeaveDateKey(existing.endDate),
        requestedMinutesPerDay: typeof (existing.metadata as { requestedMinutesPerDay?: unknown } | null)?.requestedMinutesPerDay === "number"
          ? (existing.metadata as { requestedMinutesPerDay: number }).requestedMinutesPerDay
          : undefined,
        legacyFullDayCapture: (existing.metadata as { legacyFullDayCapture?: unknown } | null)?.legacyFullDayCapture === true,
        excludeApplicationId: existing.id,
      })
    : null;
  if (preview?.conflicts.length) throw new LeaveManagementError("This request now overlaps another active leave", 409, "LEAVE_OVERLAP");
  if (preview?.warnings.some((warning) => warning.startsWith("No rostered shifts"))) {
    throw new LeaveManagementError("HR must add a roster or effective employment pattern before approval");
  }
  if (preview && !preview.policyConfirmed) {
    throw new LeaveManagementError("A confirmed policy version must cover the full leave period before approval", 409, "POLICY_NOT_CONFIRMED");
  }
  if (preview?.policyConfirmed && existing.leaveType.requiresBalance && preview.balanceImpact.projectedMinutes < 0 && !preview.negativeBalanceAllowed) {
    throw new LeaveManagementError("The confirmed leave policy does not allow this application to create a negative balance", 409, "INSUFFICIENT_LEAVE_BALANCE");
  }
  if (preview?.policyConfirmed && preview.maxConsecutiveDays != null && preview.calendarDays > preview.maxConsecutiveDays) {
    throw new LeaveManagementError(`The confirmed policy permits at most ${preview.maxConsecutiveDays} consecutive calendar days`);
  }
  const balanceTakenMinutes = preview ? previewReservationMinutes(preview.occurrences) : 0;

  const persist = async (tx: Prisma.TransactionClient) => {
    const previous = { status: existing.status };
    if (params.decision === "reject") {
      const changed = await tx.leaveApplication.updateMany({
        where: { id: existing.id, version: existing.version, status: existing.status },
        data: { status: "REJECTED", decisionReason: params.reason!.trim(), reviewedById: params.actorId, decidedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new LeaveManagementError("Leave application changed during this decision; refresh and try again", 409, "VERSION_CONFLICT");
      await tx.leaveOccurrence.updateMany({ where: { applicationId: existing.id }, data: { status: "CANCELLED" } });
      const reservations = await tx.leaveLedgerEntry.findMany({ where: { applicationId: existing.id, entryType: "RESERVATION" } });
      for (const entry of reservations) {
        await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: existing.employeeId, leaveTypeId: existing.leaveTypeId, applicationId: existing.id, entryType: "RESERVATION_RELEASE", effectiveDate: existing.startDate, minutes: -entry.minutes, reason: "Reservation released after rejection", createdById: params.actorId, reversalOfId: entry.id } });
      }
      await tx.leaveApprovalStep.updateMany({ where: { applicationId: existing.id, decision: "PENDING" }, data: { decision: "REJECTED", actorId: params.actorId, comment: params.reason, decidedAt: new Date() } });
      await addLeaveAudit(tx, { companyId: params.companyId, employeeId: existing.employeeId, applicationId: existing.id, userId: params.actorId, eventType: "APPLICATION_REJECTED", reason: params.reason, previousValue: previous, newValue: { status: "REJECTED" } });
      return;
    }

    await tx.leaveOccurrence.deleteMany({ where: { applicationId: existing.id } });
    await tx.leaveOccurrence.createMany({
      data: preview!.occurrences.map((occurrence) => ({
        companyId: params.companyId,
        applicationId: existing.id,
        employeeId: existing.employeeId,
        leaveDate: occurrence.leaveDate,
        shiftId: occurrence.shiftId,
        siteId: occurrence.siteId,
        scheduledMinutes: occurrence.scheduledMinutes,
        requestedMinutes: occurrence.requestedMinutes,
        balanceMinutes: occurrence.balanceMinutes,
        paidMinutes: occurrence.paidMinutes,
        unpaidMinutes: occurrence.unpaidMinutes,
        payrollTreatment: occurrence.payrollTreatment,
        status: "APPROVED",
      })),
    });
    for (const occurrence of preview!.occurrences.filter((item) => item.shiftId && item.siteId)) {
      const dedupeKey = `leave_vacancy:${existing.id}:${occurrence.shiftId}`;
      await tx.operationalAlert.upsert({
        where: { companyId_dedupeKey: { companyId: params.companyId, dedupeKey } },
        create: { companyId: params.companyId, title: "Roster cover required for approved leave", message: `Approved leave on ${formatLeaveDateKey(occurrence.leaveDate)} leaves a rostered shift requiring cover.`, priority: "CRITICAL", sourceModule: "ROSTERING", dedupeKey, sourceId: occurrence.shiftId!, siteId: occurrence.siteId!, employeeId: existing.employeeId, metadata: { applicationId: existing.id, shiftId: occurrence.shiftId, leaveDate: formatLeaveDateKey(occurrence.leaveDate) } },
        update: { status: "OPEN", resolvedAt: null, resolvedById: null },
      });
    }
    const changed = await tx.leaveApplication.updateMany({
      where: { id: existing.id, version: existing.version, status: existing.status },
      data: { status: "APPROVED", calculatedMinutes: preview!.calculatedMinutes, paidMinutes: preview!.paidMinutes, unpaidMinutes: preview!.unpaidMinutes, reviewedById: params.actorId, decidedAt: new Date(), decisionReason: params.reason?.trim() || null, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new LeaveManagementError("Leave application changed during this decision; refresh and try again", 409, "VERSION_CONFLICT");
    const reservations = await tx.leaveLedgerEntry.findMany({ where: { applicationId: existing.id, entryType: "RESERVATION" } });
    for (const entry of reservations) {
      await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: existing.employeeId, leaveTypeId: existing.leaveTypeId, applicationId: existing.id, entryType: "RESERVATION_RELEASE", effectiveDate: existing.startDate, minutes: -entry.minutes, reason: "Reservation converted to approved leave", createdById: params.actorId, reversalOfId: entry.id } });
    }
    if (balanceTakenMinutes > 0) {
      await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: existing.employeeId, leaveTypeId: existing.leaveTypeId, applicationId: existing.id, entryType: "TAKEN", effectiveDate: existing.startDate, minutes: -balanceTakenMinutes, reason: "Approved leave taken", createdById: params.actorId } });
    }
    const legacyDayTotals = new Map<string, { date: Date; minutes: number }>();
    for (const occurrence of preview!.occurrences) {
      if (occurrence.requestedMinutes <= 0) continue;
      const key = formatLeaveDateKey(occurrence.leaveDate);
      const current = legacyDayTotals.get(key);
      legacyDayTotals.set(key, {
        date: occurrence.leaveDate,
        minutes: (current?.minutes ?? 0) + occurrence.requestedMinutes,
      });
    }
    const legacyRecords = await tx.leaveRecord.createManyAndReturn({
      data: [...legacyDayTotals.values()].map((day) => ({
        employeeId: existing.employeeId,
        date: day.date,
        type: existing.leaveType.code,
        hours: day.minutes / 60,
      })),
    });
    await tx.leaveApplication.update({ where: { id: existing.id }, data: { legacyLeaveRecordIds: legacyRecords.map((record) => record.id) } });
    await tx.leaveApprovalStep.updateMany({ where: { applicationId: existing.id, decision: "PENDING" }, data: { decision: "APPROVED", actorId: params.actorId, comment: params.reason, decidedAt: new Date() } });
    await addLeaveAudit(tx, { companyId: params.companyId, employeeId: existing.employeeId, applicationId: existing.id, userId: params.actorId, eventType: "APPLICATION_APPROVED", reason: params.reason, previousValue: previous, newValue: { status: "APPROVED", paidMinutes: preview!.paidMinutes, unpaidMinutes: preview!.unpaidMinutes } });
  };
  if (context.transaction) await persist(context.transaction);
  else await prisma.$transaction(persist);
  if (!context.transaction) {
    await reconcileContinuityForEmployee(existing.employeeId, params.companyId, params.decision === "approve" ? "leave_approved" : "leave_rejected").catch(() => undefined);
    const employeeContact = await prisma.employee.findUnique({ where: { id: existing.employeeId }, select: { phone: true } });
    if (employeeContact?.phone) {
      const outcome = params.decision === "approve" ? "approved" : `rejected${params.reason ? `: ${params.reason}` : ""}`;
      void sendText(employeeContact.phone, `Your leave application ${existing.id} was ${outcome}.`).catch(() => undefined);
    }
  }
  return getLeaveApplication(params.companyId, existing.id, context.transaction);
}

export async function cancelOrWithdrawLeave(params: {
  companyId: string;
  applicationId: string;
  actorId?: string;
  reason: string;
  expectedVersion?: number;
}) {
  if (!params.reason.trim()) throw new LeaveManagementError("A cancellation or withdrawal reason is required");
  const application = await prisma.leaveApplication.findFirst({
    where: { id: params.applicationId, companyId: params.companyId },
    include: { leaveType: true, payrollPostings: { include: { payrollRun: { select: { status: true } } } } },
  });
  if (!application) throw new LeaveManagementError("Leave application not found", 404, "NOT_FOUND");
  if (params.expectedVersion != null && params.expectedVersion !== application.version) {
    throw new LeaveManagementError("Leave application changed since it was loaded; refresh and try again", 409, "VERSION_CONFLICT");
  }
  const pending = ["DRAFT", "SUBMITTED", "PENDING_HR"].includes(application.status);
  const approvedOrCancellationRequested = ["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED", "CANCELLATION_REQUESTED"].includes(application.status);
  if (!pending && !approvedOrCancellationRequested) {
    throw new LeaveManagementError(`Leave cannot be cancelled from ${application.status.toLowerCase()}`);
  }
  if (!pending && !params.actorId) {
    throw new LeaveManagementError("An authenticated leave manager is required", 403, "FORBIDDEN");
  }
  const unfinalizedPayrollPostings = application.payrollPostings.filter((posting) => posting.payrollRun.status !== "paid");
  if (unfinalizedPayrollPostings.length > 0) {
    throw new LeaveManagementError("Revert the approved payroll run to draft before cancelling this leave", 409, "PAYROLL_REVERT_REQUIRED");
  }
  const payrollLocked = application.payrollPostings.length > 0;
  await prisma.$transaction(async (tx) => {
    const nextStatus: LeaveApplicationStatus = payrollLocked ? "ADJUSTMENT_REQUIRED" : pending ? "WITHDRAWN" : "CANCELLED";
    const changed = await tx.leaveApplication.updateMany({ where: { id: application.id, version: application.version, status: application.status }, data: { status: nextStatus, decisionReason: params.reason.trim(), version: { increment: 1 } } });
    if (changed.count !== 1) throw new LeaveManagementError("Leave application changed during cancellation; refresh and try again", 409, "VERSION_CONFLICT");
    if (!payrollLocked) {
      await tx.leaveOccurrence.updateMany({ where: { applicationId: application.id }, data: { status: "CANCELLED" } });
      const unreversed = await tx.leaveLedgerEntry.findMany({ where: { applicationId: application.id, reversedBy: null } });
      for (const entry of unreversed) {
        if (entry.entryType === "RESERVATION_RELEASE") continue;
        await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, entryType: entry.entryType === "RESERVATION" ? "RESERVATION_RELEASE" : "REVERSAL", effectiveDate: normalizeLeaveDate(new Date()), minutes: -entry.minutes, reason: params.reason.trim(), createdById: params.actorId, reversalOfId: entry.id } });
      }
      const legacyIds = Array.isArray(application.legacyLeaveRecordIds) ? application.legacyLeaveRecordIds.filter((id): id is string => typeof id === "string") : [];
      if (legacyIds.length) await tx.leaveRecord.deleteMany({ where: { id: { in: legacyIds } } });
      await tx.operationalAlert.updateMany({ where: { companyId: params.companyId, dedupeKey: { startsWith: `leave_vacancy:${application.id}:` }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: params.actorId } });
    } else {
      await tx.leaveAdjustment.create({ data: { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, minutes: application.calculatedMinutes, reason: params.reason.trim(), requestedById: params.actorId!, payrollImpact: { postingIds: application.payrollPostings.map((p) => p.id), action: "REVERSAL_REQUIRED", previousApplicationStatus: application.status } } });
    }
    await addLeaveAudit(tx, { companyId: params.companyId, employeeId: application.employeeId, applicationId: application.id, userId: params.actorId, eventType: payrollLocked ? "ADJUSTMENT_REQUIRED" : pending ? "APPLICATION_WITHDRAWN" : "APPLICATION_CANCELLED", reason: params.reason, previousValue: { status: application.status }, newValue: { status: nextStatus } });
  });
  if (!payrollLocked) await reconcileContinuityForEmployee(application.employeeId, params.companyId, "leave_cancelled").catch(() => undefined);
  return getLeaveApplication(params.companyId, application.id);
}

export async function getLeaveApplication(companyId: string, id: string, transaction?: Prisma.TransactionClient) {
  const db = transaction ?? prisma;
  return db.leaveApplication.findFirst({
    where: { id, companyId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, group: { select: { id: true, name: true } } } },
      leaveType: true,
      policyVersion: true,
      occurrences: { orderBy: { leaveDate: "asc" } },
      approvalSteps: { orderBy: { stepOrder: "asc" } },
      documents: { select: LEAVE_DOCUMENT_PUBLIC_SELECT, orderBy: { createdAt: "desc" } },
      payrollPostings: true,
      adjustments: true,
    },
  });
}

export async function listLeaveApplications(companyId: string, filter: {
  status?: LeaveApplicationStatus;
  employeeId?: string;
  employeeIds?: string[];
  start?: string;
  end?: string;
  leaveTypeCode?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.LeaveApplicationWhereInput = {
    companyId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
    ...(!filter.employeeId && filter.employeeIds ? { employeeId: { in: filter.employeeIds } } : {}),
    ...(filter.leaveTypeCode ? { leaveType: { code: filter.leaveTypeCode } } : {}),
    ...(filter.start || filter.end ? {
      startDate: filter.end ? { lte: normalizeLeaveDate(filter.end) } : undefined,
      endDate: filter.start ? { gte: normalizeLeaveDate(filter.start) } : undefined,
    } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.leaveApplication.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, group: { select: { id: true, name: true } } } },
        leaveType: true,
        documents: { select: LEAVE_DOCUMENT_PUBLIC_SELECT },
        _count: { select: { occurrences: true } },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: Math.min(filter.limit ?? 100, 500),
      skip: filter.offset ?? 0,
    }),
    prisma.leaveApplication.count({ where }),
  ]);
  return { data, total };
}

export async function getLeaveBalances(companyId: string, employeeId?: string, asOf = new Date(), employeeIds?: string[]) {
  await ensureDefaultLeavePolicy(companyId);
  const entries = await prisma.leaveLedgerEntry.groupBy({
    by: ["employeeId", "leaveTypeId", "entryType"],
    where: { companyId, ...(employeeId ? { employeeId } : employeeIds ? { employeeId: { in: employeeIds } } : {}), effectiveDate: { lte: normalizeLeaveDate(asOf) } },
    _sum: { minutes: true },
  });
  const balanceEmployeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
  const typeIds = [...new Set(entries.map((entry) => entry.leaveTypeId))];
  const [employees, types] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, id: { in: balanceEmployeeIds } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } }),
    prisma.leaveTypeDefinition.findMany({ where: { companyId, id: { in: typeIds } } }),
  ]);
  const employeeMap = new Map(employees.map((item) => [item.id, item]));
  const typeMap = new Map(types.map((item) => [item.id, item]));
  const buckets = new Map<string, { employeeId: string; leaveTypeId: string; accrued: number; reserved: number; taken: number; adjustments: number; available: number }>();
  for (const entry of entries) {
    const key = `${entry.employeeId}:${entry.leaveTypeId}`;
    const bucket = buckets.get(key) ?? { employeeId: entry.employeeId, leaveTypeId: entry.leaveTypeId, accrued: 0, reserved: 0, taken: 0, adjustments: 0, available: 0 };
    const value = entry._sum.minutes ?? 0;
    if (["ACCRUAL", "OPENING_BALANCE", "CARRY_OVER"].includes(entry.entryType)) bucket.accrued += value;
    else if (["RESERVATION", "RESERVATION_RELEASE"].includes(entry.entryType)) bucket.reserved += value;
    else if (["TAKEN", "REVERSAL", "EXPIRY", "PAYOUT"].includes(entry.entryType)) bucket.taken += value;
    else bucket.adjustments += value;
    bucket.available = bucket.accrued + bucket.reserved + bucket.taken + bucket.adjustments;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, employee: employeeMap.get(bucket.employeeId), leaveType: typeMap.get(bucket.leaveTypeId) }));
}

export async function getLeaveCalendar(companyId: string, start: string, end: string, employeeIds?: string[]) {
  const range = validateLeaveDateRange(start, end);
  return prisma.leaveApplication.findMany({
    where: { companyId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), status: { in: ACTIVE_APPLICATION_STATUSES }, startDate: { lte: range.end }, endDate: { gte: range.start } },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, group: { select: { id: true, name: true } }, siteAssignments: { where: { isActive: true }, select: { site: { select: { id: true, name: true } } } } } },
      leaveType: true,
      occurrences: { where: { leaveDate: { gte: range.start, lte: range.end } }, orderBy: { leaveDate: "asc" } },
    },
    orderBy: { startDate: "asc" },
  });
}

export async function getLeaveReport(companyId: string, start: string, end: string, employeeIds?: string[]) {
  const range = validateLeaveDateRange(start, end);
  const applications = await prisma.leaveApplication.findMany({
    where: { companyId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), startDate: { lte: range.end }, endDate: { gte: range.start } },
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, group: { select: { name: true } } } }, leaveType: true, payrollPostings: true },
  });
  const byType = new Map<string, { applications: number; paidMinutes: number; unpaidMinutes: number }>();
  for (const application of applications) {
    const row = byType.get(application.leaveType.code) ?? { applications: 0, paidMinutes: 0, unpaidMinutes: 0 };
    row.applications += 1;
    row.paidMinutes += application.paidMinutes;
    row.unpaidMinutes += application.unpaidMinutes;
    byType.set(application.leaveType.code, row);
  }
  const [balances, adjustments, expiryEntries, payrollPostings, employees] = await Promise.all([
    getLeaveBalances(companyId, undefined, range.end, employeeIds),
    prisma.leaveAdjustment.findMany({ where: { companyId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), createdAt: { lte: addDays(range.end, 1) } }, orderBy: { createdAt: "desc" } }),
    prisma.leaveLedgerEntry.findMany({ where: { companyId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), entryType: "EXPIRY", effectiveDate: { gte: range.start, lte: range.end } } }),
    prisma.leavePayrollPosting.findMany({ where: { companyId, application: { ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), startDate: { lte: range.end }, endDate: { gte: range.start } } }, include: { payrollRun: { select: { id: true, status: true, periodStart: true, periodEnd: true } } } }),
    prisma.employee.findMany({ where: { companyId, ...(employeeIds ? { id: { in: employeeIds } } : {}) }, include: { grade: true } }),
  ]);
  const employeeRates = new Map(employees.map((employee) => [employee.id, employee.monthlySalary != null && Number(employee.monthlySalary) > 0 ? Number(employee.monthlySalary) / (employee.employeeType === "office" ? 195 : 208) : employee.grade ? Number(employee.grade.hourlyRate) : Number(employee.hourlyRate ?? 0)]));
  const liability = balances.filter((balance) => balance.available > 0 && balance.leaveType?.isPaid).reduce((sum, balance) => sum + (balance.available / 60) * (employeeRates.get(balance.employeeId) ?? 0), 0);
  const byTeam = new Map<string, { applications: number; paidMinutes: number; unpaidMinutes: number }>();
  for (const application of applications) {
    const team = application.employee.group?.name ?? "Unassigned";
    const row = byTeam.get(team) ?? { applications: 0, paidMinutes: 0, unpaidMinutes: 0 };
    row.applications += 1; row.paidMinutes += application.paidMinutes; row.unpaidMinutes += application.unpaidMinutes; byTeam.set(team, row);
  }
  return {
    start: formatLeaveDateKey(range.start),
    end: formatLeaveDateKey(range.end),
    total: applications.length,
    pending: applications.filter((a) => ["SUBMITTED", "PENDING_HR"].includes(a.status)).length,
    approved: applications.filter((a) => ["APPROVED", "PAYROLL_PROCESSED", "IMPORTED_APPROVED"].includes(a.status)).length,
    payrollProcessed: applications.filter((a) => a.payrollPostings.length > 0).length,
    byType: Object.fromEntries(byType),
    byTeam: Object.fromEntries(byTeam),
    liabilityEstimate: Math.round(liability * 100) / 100,
    negativeBalances: balances.filter((balance) => balance.available < 0),
    highBalances: balances.filter((balance) => balance.available >= 120 * 60),
    unpaid: applications.filter((application) => application.unpaidMinutes > 0),
    sickness: applications.filter((application) => application.leaveType.code === "sick"),
    retrospective: applications.filter((application) => Boolean(application.retrospectiveReason)),
    adjustments,
    expiries: expiryEntries,
    payrollPostings,
    data: applications,
  };
}

export async function createOpeningBalanceAdjustment(params: {
  companyId: string;
  employeeId: string;
  leaveTypeCode: string;
  minutes: number;
  reason: string;
  actorId: string;
}) {
  if (!params.reason.trim()) throw new LeaveManagementError("An adjustment reason is required");
  if (!Number.isInteger(params.minutes) || params.minutes === 0) throw new LeaveManagementError("Adjustment minutes must be a non-zero whole number");
  await ensureDefaultLeavePolicy(params.companyId, params.actorId);
  const type = await prisma.leaveTypeDefinition.findFirst({ where: { companyId: params.companyId, code: params.leaveTypeCode } });
  if (!type) throw new LeaveManagementError("Leave type not found");
  const employee = await prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId }, select: { id: true } });
  if (!employee) throw new LeaveManagementError("Employee not found", 404);
  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.leaveAdjustment.create({ data: { companyId: params.companyId, employeeId: params.employeeId, leaveTypeId: type.id, minutes: params.minutes, reason: params.reason.trim(), status: "POSTED", requestedById: params.actorId, approvedById: params.actorId, approvedAt: new Date() } });
    await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: params.employeeId, leaveTypeId: type.id, entryType: "OPENING_BALANCE", effectiveDate: normalizeLeaveDate(new Date()), minutes: params.minutes, reason: params.reason.trim(), createdById: params.actorId, metadata: { adjustmentId: adjustment.id, approvedOpeningBalance: true } } });
    await addLeaveAudit(tx, { companyId: params.companyId, employeeId: params.employeeId, userId: params.actorId, eventType: "BALANCE_ADJUSTED", reason: params.reason, newValue: { leaveTypeCode: type.code, minutes: params.minutes }, metadata: { adjustmentId: adjustment.id } });
    return adjustment;
  });
}

export async function listLeaveAdjustments(
  companyId: string,
  status?: "PENDING" | "APPROVED" | "REJECTED" | "POSTED"
) {
  return prisma.leaveAdjustment.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      leaveType: true,
      application: { select: { id: true, status: true, startDate: true, endDate: true, version: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveLeaveAdjustment(params: {
  companyId: string;
  adjustmentId: string;
  actorId: string;
  decision: "reject" | "confirm_external_correction";
  reason: string;
  payrollReference?: string;
}) {
  if (!params.reason.trim()) throw new LeaveManagementError("A resolution reason is required");
  if (params.decision === "confirm_external_correction" && !params.payrollReference?.trim()) {
    throw new LeaveManagementError("A payroll correction reference is required");
  }
  const adjustment = await prisma.leaveAdjustment.findFirst({
    where: { id: params.adjustmentId, companyId: params.companyId },
    include: {
      application: {
        include: {
          payrollPostings: { where: { isReversal: false }, include: { payrollRun: { select: { status: true } } } },
        },
      },
    },
  });
  if (!adjustment) throw new LeaveManagementError("Leave adjustment not found", 404, "NOT_FOUND");
  if (adjustment.status !== "PENDING") {
    throw new LeaveManagementError(`Leave adjustment is already ${adjustment.status.toLowerCase()}`, 409, "ADJUSTMENT_STATUS_CONFLICT");
  }
  const application = adjustment.application;
  if (!application || application.status !== "ADJUSTMENT_REQUIRED") {
    throw new LeaveManagementError("The linked leave application is not awaiting a payroll adjustment", 409, "ADJUSTMENT_STATUS_CONFLICT");
  }

  const previousImpact = adjustment.payrollImpact && typeof adjustment.payrollImpact === "object" && !Array.isArray(adjustment.payrollImpact)
    ? adjustment.payrollImpact as Record<string, unknown>
    : {};
  if (params.decision === "reject") {
    const previousStatus = previousImpact.previousApplicationStatus;
    const restoreStatus: LeaveApplicationStatus = typeof previousStatus === "string" && ["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED"].includes(previousStatus)
      ? previousStatus as LeaveApplicationStatus
      : "PAYROLL_PROCESSED";
    await prisma.$transaction(async (tx) => {
      const changed = await tx.leaveAdjustment.updateMany({
        where: { id: adjustment.id, status: "PENDING" },
        data: { status: "REJECTED", approvedById: params.actorId, approvedAt: new Date(), payrollImpact: { ...previousImpact, resolution: "REJECTED", resolutionReason: params.reason.trim() } as Prisma.InputJsonValue },
      });
      if (changed.count !== 1) throw new LeaveManagementError("Leave adjustment changed during resolution", 409, "ADJUSTMENT_STATUS_CONFLICT");
      const applicationChanged = await tx.leaveApplication.updateMany({ where: { id: application.id, status: "ADJUSTMENT_REQUIRED", version: application.version }, data: { status: restoreStatus, version: { increment: 1 } } });
      if (applicationChanged.count !== 1) throw new LeaveManagementError("Leave application changed during adjustment resolution", 409, "VERSION_CONFLICT");
      await addLeaveAudit(tx, { companyId: params.companyId, employeeId: adjustment.employeeId, applicationId: application.id, userId: params.actorId, eventType: "LEAVE_ADJUSTMENT_REJECTED", reason: params.reason, previousValue: { status: "ADJUSTMENT_REQUIRED" }, newValue: { status: restoreStatus, adjustmentId: adjustment.id } });
    });
    return prisma.leaveAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
  }

  if (application.payrollPostings.length === 0 || application.payrollPostings.some((posting) => posting.payrollRun.status !== "paid")) {
    throw new LeaveManagementError("Only leave posted to paid payroll can be resolved as an external correction; revert any unpaid run instead", 409, "PAYROLL_REVERT_REQUIRED");
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.leaveAdjustment.updateMany({
      where: { id: adjustment.id, status: "PENDING" },
      data: {
        status: "POSTED",
        approvedById: params.actorId,
        approvedAt: new Date(),
        payrollImpact: { ...previousImpact, resolution: "EXTERNAL_PAYROLL_CORRECTION_CONFIRMED", payrollReference: params.payrollReference!.trim(), resolutionReason: params.reason.trim(), resolvedAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    if (changed.count !== 1) throw new LeaveManagementError("Leave adjustment changed during resolution", 409, "ADJUSTMENT_STATUS_CONFLICT");
    for (const posting of application.payrollPostings) {
      await tx.leavePayrollPosting.upsert({
        where: { occurrenceId_isReversal: { occurrenceId: posting.occurrenceId, isReversal: true } },
        create: { companyId: params.companyId, applicationId: application.id, occurrenceId: posting.occurrenceId, payrollRunId: posting.payrollRunId, paidMinutes: -posting.paidMinutes, unpaidMinutes: -posting.unpaidMinutes, isReversal: true },
        update: {},
      });
    }
    await tx.leaveOccurrence.updateMany({ where: { applicationId: application.id }, data: { status: "CANCELLED" } });
    const unreversed = await tx.leaveLedgerEntry.findMany({ where: { applicationId: application.id, reversedBy: null } });
    for (const entry of unreversed) {
      if (entry.entryType === "RESERVATION_RELEASE") continue;
      await tx.leaveLedgerEntry.create({ data: { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, entryType: entry.entryType === "RESERVATION" ? "RESERVATION_RELEASE" : "REVERSAL", effectiveDate: normalizeLeaveDate(new Date()), minutes: -entry.minutes, reason: params.reason.trim(), createdById: params.actorId, reversalOfId: entry.id, metadata: { adjustmentId: adjustment.id, payrollReference: params.payrollReference!.trim() } } });
    }
    const legacyIds = Array.isArray(application.legacyLeaveRecordIds) ? application.legacyLeaveRecordIds.filter((id): id is string => typeof id === "string") : [];
    if (legacyIds.length) await tx.leaveRecord.deleteMany({ where: { id: { in: legacyIds } } });
    await tx.operationalAlert.updateMany({ where: { companyId: params.companyId, dedupeKey: { startsWith: `leave_vacancy:${application.id}:` }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: params.actorId } });
    const applicationChanged = await tx.leaveApplication.updateMany({ where: { id: application.id, status: "ADJUSTMENT_REQUIRED", version: application.version }, data: { status: "CANCELLED", decisionReason: params.reason.trim(), version: { increment: 1 } } });
    if (applicationChanged.count !== 1) throw new LeaveManagementError("Leave application changed during adjustment resolution", 409, "VERSION_CONFLICT");
    await addLeaveAudit(tx, { companyId: params.companyId, employeeId: adjustment.employeeId, applicationId: application.id, userId: params.actorId, eventType: "LEAVE_ADJUSTMENT_POSTED", reason: params.reason, previousValue: { status: "ADJUSTMENT_REQUIRED" }, newValue: { status: "CANCELLED", adjustmentId: adjustment.id, payrollReference: params.payrollReference!.trim() } });
  });
  await reconcileContinuityForEmployee(application.employeeId, params.companyId, "leave_adjustment_resolved").catch(() => undefined);
  return prisma.leaveAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
}

export async function accrueConfirmedLeave(params: { companyId: string; actorId: string; asOf: string }) {
  const asOf = normalizeLeaveDate(params.asOf);
  if (asOf > normalizeLeaveDate(new Date())) {
    throw new LeaveManagementError("Leave accruals cannot be posted for a future date");
  }
  const versions = await prisma.leavePolicyVersion.findMany({
    where: {
      companyId: params.companyId,
      reviewStatus: "ACTIVE",
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      leaveType: { requiresBalance: true },
    },
    include: { leaveType: true, policy: true },
  });
  const [employees, assignments, terms] = await Promise.all([
    prisma.employee.findMany({ where: { companyId: params.companyId, status: { not: "offboarded" } }, select: { id: true, commencementDate: true } }),
    prisma.employeeLeavePolicyAssignment.findMany({ where: { employee: { companyId: params.companyId }, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } }),
    prisma.employmentTerm.findMany({ where: { companyId: params.companyId }, select: { employeeId: true, effectiveFrom: true, effectiveTo: true } }),
  ]);
  const assignmentByEmployee = new Map(assignments.map((assignment) => [assignment.employeeId, assignment.policyId]));
  const employeesWithAnyTerm = new Set(terms.map((term) => term.employeeId));
  const activeTermByEmployee = new Map(terms
    .filter((term) => term.effectiveFrom <= asOf && (!term.effectiveTo || term.effectiveTo >= asOf))
    .map((term) => [term.employeeId, term]));
  const earliestTermByEmployee = new Map<string, Date>();
  for (const term of terms) {
    const current = earliestTermByEmployee.get(term.employeeId);
    if (!current || term.effectiveFrom < current) earliestTermByEmployee.set(term.employeeId, term.effectiveFrom);
  }
  const posted: Array<{ employeeId: string; leaveTypeCode: string; minutes: number; key: string }> = [];
  const skipped: Array<{ policyVersionId: string; reason: string; employeeId?: string }> = [];

  for (const version of versions) {
    const applicableEmployees = employees.filter((employee) => {
      const assignedPolicyId = assignmentByEmployee.get(employee.id);
      return assignedPolicyId
        ? assignedPolicyId === version.policyId
        : version.policy.category === "STATUTORY_BASELINE";
    });
    if (applicableEmployees.length === 0) continue;
    const configurationIssues = leavePolicyConfigurationIssues(version);
    if (configurationIssues.length > 0) {
      skipped.push({ policyVersionId: version.id, reason: configurationIssues.join(" ") });
      continue;
    }
    const method = version.accrualMethod.toUpperCase();
    let minutes = 0;
    if (["MONTHLY_FIXED", "MONTHLY"].includes(method) && version.accrualRateMinutes != null) {
      minutes = Math.round(Number(version.accrualRateMinutes));
    } else if (method === "EVEN_MONTHLY" && version.entitlementMinutes && version.cycleMonths > 0) {
      minutes = Math.round(version.entitlementMinutes / version.cycleMonths);
    } else if (method === "ANNUAL_GRANT" && version.entitlementMinutes) {
      minutes = version.entitlementMinutes;
    } else {
      skipped.push({ policyVersionId: version.id, reason: `Accrual method ${version.accrualMethod} has no confirmed executable rate` });
      continue;
    }
    if (minutes <= 0) {
      skipped.push({ policyVersionId: version.id, reason: "Calculated accrual was not positive" });
      continue;
    }
    for (const employee of applicableEmployees) {
      // Effective terms take precedence. Older tenants may not have migrated
      // terms yet, so a valid commencement date is the controlled fallback.
      if (employeesWithAnyTerm.has(employee.id) && !activeTermByEmployee.has(employee.id)) continue;
      const employmentStart = employee.commencementDate ?? earliestTermByEmployee.get(employee.id);
      if (!employmentStart || normalizeLeaveDate(employmentStart) > asOf) {
        skipped.push({ policyVersionId: version.id, employeeId: employee.id, reason: "No eligible commencement date or active employment term" });
        continue;
      }
      let periodKey = formatLeaveDateKey(asOf).slice(0, 7);
      let effectiveDate = asOf;
      if (method === "ANNUAL_GRANT") {
        const anchor = normalizeLeaveDate(employmentStart);
        let completedMonths = (asOf.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + asOf.getUTCMonth() - anchor.getUTCMonth();
        if (asOf.getUTCDate() < anchor.getUTCDate()) completedMonths -= 1;
        const cycleIndex = Math.max(0, Math.floor(completedMonths / version.cycleMonths));
        effectiveDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + cycleIndex * version.cycleMonths, anchor.getUTCDate()));
        periodKey = `cycle-${cycleIndex}-${formatLeaveDateKey(effectiveDate)}`;
      }
      // The period key deliberately excludes the policy version. A mid-period
      // policy change must not grant the same leave type twice for one employee.
      const key = `accrual:${version.leaveTypeId}:${employee.id}:${periodKey}`;
      const existed = await prisma.leaveLedgerEntry.findFirst({
        where: {
          companyId: params.companyId,
          employeeId: employee.id,
          leaveTypeId: version.leaveTypeId,
          entryType: "ACCRUAL",
          OR: [
            { idempotencyKey: key },
            { metadata: { path: ["periodKey"], equals: periodKey } },
          ],
        },
        select: { id: true },
      });
      if (existed) continue;
      await prisma.leaveLedgerEntry.upsert({
        where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: key } },
        create: { companyId: params.companyId, employeeId: employee.id, leaveTypeId: version.leaveTypeId, entryType: "ACCRUAL", effectiveDate, minutes, reason: `Confirmed ${version.accrualMethod} accrual`, createdById: params.actorId, idempotencyKey: key, metadata: { policyVersionId: version.id, periodKey } },
        update: {},
      });
      posted.push({ employeeId: employee.id, leaveTypeCode: version.leaveType.code, minutes, key });
    }
  }
  await prisma.leaveAuditEvent.create({ data: { companyId: params.companyId, userId: params.actorId, eventType: "LEAVE_ACCRUAL_RUN", newValue: { asOf: params.asOf, posted: posted.length, skipped } } });
  return { asOf: params.asOf, posted, skipped };
}

export async function getLeaveReadiness(companyId: string, start: Date, end: Date) {
  const [unresolved, missingDocuments, legacyRows, authoritativeOccurrences] = await Promise.all([
    prisma.leaveApplication.findMany({
      where: { companyId, status: { in: ["SUBMITTED", "PENDING_HR", "CANCELLATION_REQUESTED", "ADJUSTMENT_REQUIRED"] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { id: true, status: true, employeeId: true, startDate: true, endDate: true },
    }),
    prisma.leaveApplication.count({
      where: { companyId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start }, leaveType: { requiresDocument: true }, documents: { none: { reviewStatus: "VERIFIED" } } },
    }),
    prisma.leaveRecord.findMany({
      where: { employee: { companyId }, date: { gte: normalizeLeaveDate(start), lte: normalizeLeaveDate(end) } },
      select: { id: true, employeeId: true, date: true, type: true, hours: true },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }, { id: "asc" }],
    }),
    prisma.leaveOccurrence.findMany({
      where: {
        companyId,
        leaveDate: { gte: normalizeLeaveDate(start), lte: normalizeLeaveDate(end) },
        status: { not: "CANCELLED" },
      },
      select: { employeeId: true, leaveDate: true },
    }),
  ]);
  const authoritativeDayKeys = new Set(authoritativeOccurrences.map((occurrence) =>
    `${occurrence.employeeId}:${formatLeaveDateKey(occurrence.leaveDate)}`
  ));
  const legacyRowsByEmployeeDay = new Map<string, typeof legacyRows>();
  for (const row of legacyRows) {
    const key = `${row.employeeId}:${formatLeaveDateKey(row.date)}`;
    // Modern approvals retain legacy compatibility rows for older screens. A
    // multi-shift leave day can legitimately produce several such rows; only
    // standalone legacy days are migration anomalies that must block payroll.
    if (authoritativeDayKeys.has(key)) continue;
    legacyRowsByEmployeeDay.set(key, [...(legacyRowsByEmployeeDay.get(key) ?? []), row]);
  }
  const duplicateLegacyDays = [...legacyRowsByEmployeeDay.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, recordIds: rows.map((row) => row.id), types: [...new Set(rows.map((row) => row.type))] }));
  return {
    blocked: unresolved.length > 0 || missingDocuments > 0 || duplicateLegacyDays.length > 0,
    unresolved,
    missingDocuments,
    duplicateLegacyDays,
    message: unresolved.length > 0
      ? `${unresolved.length} leave application(s) affecting this payroll period require a final decision or adjustment.`
      : missingDocuments > 0
        ? `${missingDocuments} approved leave application(s) are missing verified documents.`
        : duplicateLegacyDays.length > 0
          ? `${duplicateLegacyDays.length} employee leave day(s) have duplicate legacy records and must be reconciled before payroll.`
        : undefined,
  };
}

export async function postLeaveToPayroll(
  companyId: string,
  payrollRunId: string,
  start: Date,
  end: Date,
  transaction?: Prisma.TransactionClient
) {
  const post = async (db: Prisma.TransactionClient) => {
    const payrollRun = await db.payrollRun.findFirst({
      where: { id: payrollRunId, companyId },
      select: { id: true },
    });
    if (!payrollRun) {
      throw new LeaveManagementError("Payroll run not found", 404, "PAYROLL_RUN_NOT_FOUND");
    }

    const occurrences = await db.leaveOccurrence.findMany({
      where: {
        companyId,
        status: "APPROVED",
        leaveDate: { gte: normalizeLeaveDate(start), lte: normalizeLeaveDate(end) },
        application: { status: { in: ["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED"] } },
      },
      include: { application: true },
    });
    if (!occurrences.length) return { posted: 0 };
    for (const occurrence of occurrences) {
      await db.leavePayrollPosting.upsert({
        where: { occurrenceId_isReversal: { occurrenceId: occurrence.id, isReversal: false } },
        create: { companyId, applicationId: occurrence.applicationId, occurrenceId: occurrence.id, payrollRunId, paidMinutes: occurrence.paidMinutes, unpaidMinutes: occurrence.unpaidMinutes },
        update: {},
      });
      await db.leaveOccurrence.update({ where: { id: occurrence.id }, data: { status: "PAYROLL_PROCESSED" } });
    }
    const applicationIds = [...new Set(occurrences.map((o) => o.applicationId))];
    for (const applicationId of applicationIds) {
      const remaining = await db.leaveOccurrence.count({ where: { applicationId, status: "APPROVED" } });
      if (remaining === 0) {
        await db.leaveApplication.updateMany({
          where: { id: applicationId, status: { in: ["APPROVED", "IMPORTED_APPROVED"] } },
          data: { status: "PAYROLL_PROCESSED" },
        });
      }
    }
    return { posted: occurrences.length };
  };
  return transaction ? post(transaction) : prisma.$transaction(post);
}
