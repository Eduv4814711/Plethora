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
import {
  getLeaveCompanySettings,
  getLeaveCycleContext,
  isStatutoryEngineEnabled,
  resolveEmploymentAnchors,
  resolveGraceMonths,
  resolvePolicyCoverageForEmployee,
  resolvePolicyVersionForEmployee,
} from "./leave-cycle-context.service.js";
import {
  allocateLeaveConsumption,
  type LeaveLedgerFact,
} from "../lib/leave-allocation.js";
import { enumerateLeaveCycles, type LeaveCycleSpec } from "../lib/leave-cycles.js";
import {
  DEFAULT_DAYS_PER_WEEK,
  effectiveEntitlementMinutes,
  STATUTORY_LEAVE_RULES,
  statutoryPolicyDefaults,
} from "./leave-statutory-rules.js";
import { buildAccrualPlan } from "../lib/leave-accrual-plan.js";
import {
  summariseWorkPattern,
  type ObservedWorkPattern,
} from "../lib/leave-work-pattern.js";
import { splitCycleCloseMinutes } from "../lib/leave-allocation.js";
import { closableLeaveCycles } from "../lib/leave-cycles.js";

/** Leave type codes the BCEA regulates, and which therefore get a seeded floor. */
const STATUTORY_TYPE_CODES = Object.keys(STATUTORY_LEAVE_RULES);

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

/** Marks a policy version this service seeded from the BCEA minimums. */
const STATUTORY_DEFAULT_AUTHORITY = "BCEA_STATUTORY_DEFAULT";

/**
 * Seed a company's statutory baseline policy.
 *
 * Entitlement figures are the BCEA minimum for a standard five-day, eight-hour
 * week. They are a floor, not a ceiling: the rule engine raises the figure per
 * employee where their own working pattern is longer, and HR may configure more
 * generous terms at any time. The statutory version is effective from the
 * seeding date rather than the BCEA's own 1997 commencement, so switching the
 * engine on never re-prices leave that has already been taken and paid.
 *
 * A company that has already configured its own active policy for a leave type
 * is left alone: replacing a deliberate HR decision would be worse than leaving
 * it in place, and the statutory floor check surfaces it at confirmation time
 * if the configured terms fall below the Act.
 */
export async function ensureDefaultLeavePolicy(companyId: string, actorId?: string) {
  const existing = await prisma.leavePolicy.findFirst({
    where: { companyId, category: "STATUTORY_BASELINE" },
    include: { versions: true },
  });

  // The guard must count what seeding actually produces, not raw version rows.
  // A tenant that has hand-created extra versions would otherwise never satisfy
  // a fixed row count, and this function runs on every balance and preview read.
  if (existing) {
    const seededTypeIds = new Set(
      existing.versions
        .filter((version) => version.sourceAuthority === STATUTORY_DEFAULT_AUTHORITY)
        .map((version) => version.leaveTypeId)
    );
    const configuredTypeIds = new Set(
      existing.versions
        .filter((version) => version.reviewStatus === "ACTIVE")
        .map((version) => version.leaveTypeId)
    );
    const settledTypeIds = new Set([...seededTypeIds, ...configuredTypeIds]);
    const statutoryTypes = await prisma.leaveTypeDefinition.findMany({
      where: { companyId, code: { in: STATUTORY_TYPE_CODES } },
      select: { id: true },
    });
    const everyTypeSeeded =
      existing.versions.length >= DEFAULT_TYPES.length &&
      statutoryTypes.length === STATUTORY_TYPE_CODES.length &&
      statutoryTypes.every((type) => settledTypeIds.has(type.id));
    if (everyTypeSeeded) return existing;
  }

  const effectiveFrom = normalizeLeaveDate(new Date());
  const placeholderEffectiveTo = addDays(effectiveFrom, -1);

  return prisma.$transaction(async (tx) => {
    const policy = await tx.leavePolicy.upsert({
      where: { companyId_name: { companyId, name: "South African statutory and private-security baseline" } },
      create: {
        companyId,
        name: "South African statutory and private-security baseline",
        category: "STATUTORY_BASELINE",
        description: "BCEA statutory minimums, seeded active. HR may configure more generous terms; the engine will not accept less.",
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

      const statutory = statutoryPolicyDefaults(definition.code);
      if (!statutory) continue;

      const siblingVersions = await tx.leavePolicyVersion.findMany({
        where: { policyId: policy.id, leaveTypeId: leaveType.id },
        select: { id: true, version: true, reviewStatus: true, sourceAuthority: true, effectiveTo: true },
        orderBy: { version: "desc" },
      });

      // Never seed twice, and never displace a policy this company deliberately
      // configured and activated. If their terms fall below the Act, the
      // statutory floor check reports it at confirmation rather than silently
      // rewriting an HR decision here.
      const alreadySeeded = siblingVersions.some(
        (version) => version.sourceAuthority === STATUTORY_DEFAULT_AUTHORITY
      );
      const hasConfiguredActive = siblingVersions.some(
        (version) =>
          version.reviewStatus === "ACTIVE" &&
          version.sourceAuthority !== STATUTORY_DEFAULT_AUTHORITY
      );
      if (alreadySeeded || hasConfiguredActive) continue;

      // Close the placeholder so the active-overlap exclusion constraint has
      // no two ACTIVE versions covering the same day for this leave type.
      await tx.leavePolicyVersion.updateMany({
        where: {
          policyId: policy.id,
          leaveTypeId: leaveType.id,
          version: 1,
          effectiveTo: null,
        },
        data: { effectiveTo: placeholderEffectiveTo },
      });

      // Take the next free version number: a fixed "version 2" collides with
      // any version a tenant created by hand, and the upsert would then no-op.
      const nextVersion = (siblingVersions[0]?.version ?? 0) + 1;

      await tx.leavePolicyVersion.upsert({
        where: {
          policyId_leaveTypeId_version: {
            policyId: policy.id,
            leaveTypeId: leaveType.id,
            version: nextVersion,
          },
        },
        create: {
          companyId,
          policyId: policy.id,
          leaveTypeId: leaveType.id,
          version: nextVersion,
          effectiveFrom,
          reviewStatus: "ACTIVE",
          sourceAuthority: STATUTORY_DEFAULT_AUTHORITY,
          legalReference: statutory.reference,
          entitlementMinutes: statutory.entitlementMinutes,
          accrualMethod: statutory.accrualMethod,
          cycleMonths: statutory.cycleMonths,
          carryOverLimitMinutes: statutory.carryOverLimitMinutes,
          expiryMonths: statutory.graceMonths,
          negativeBalanceAllowed: false,
          approvalFlow: [{ order: 1, module: "/employees/leave", capability: "approve", required: true }],
          documentRules: { required: definition.requiresDocument },
          calculationRules: {
            statutoryFloor: true,
            reference: statutory.reference,
            note: "Entitlement is the BCEA minimum for a five-day, eight-hour week and is raised per employee where their working pattern is longer.",
          },
          confirmedBy: actorId,
          confirmedAt: new Date(),
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
    const isPublicHoliday = holidayKeys.has(key);
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
        // A public holiday inside a leave period stays paid and roster-relevant
        // but must not reduce the balance: BCEA s21(3) excludes it from annual
        // leave, and an employee cannot be sick on a day they were not due to
        // work. Leave types such as unpaid, parental and IOD never carry a
        // balance at all.
        balanceMinutes: leaveOccurrenceBalanceMinutes({
          requiresBalance: leaveType.requiresBalance,
          leaveTypeCode: leaveType.code,
          isPublicHoliday,
          requestedMinutes,
          publicHolidayConsumesBalance: leaveType.publicHolidayConsumesBalance,
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

  // Resolution honours a leave-type-scoped assignment before a company-wide
  // one, so an employee can sit on a sector annual-leave policy while their
  // sick leave stays on the statutory baseline. The version in force on the
  // first day of the leave governs the application.
  const policyCoverage = await resolvePolicyCoverageForEmployee({
    companyId: params.companyId,
    employeeId: params.employeeId,
    leaveTypeId: leaveType.id,
    from: start,
    to: end,
  });
  const policyVersion = policyCoverage.version;
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
    : ["No policy version applies to this leave period."];
  // A gap in active policy is a real configuration failure. An ordinary version
  // change part-way through the period is not: the version in force on the
  // first day governs, so an in-flight application is never stranded.
  if (policyVersion && !policyCoverage.coversFullPeriod) {
    policyConfigurationIssues.push(
      "Active policy does not cover every day of this leave period; close the gap between policy versions before approving."
    );
  }
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

/**
 * Reverses every not-yet-reversed original debit (RESERVATION/TAKEN) ledger entry for an
 * application. Must skip RESERVATION_RELEASE and REVERSAL entries too — those are already
 * reversals of something else, and re-reversing them re-applies the original debit they undid.
 */
async function reverseUnreversedLedgerEntries(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    employeeId: string;
    leaveTypeId: string;
    applicationId: string;
    reason: string;
    actorId?: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const unreversed = await tx.leaveLedgerEntry.findMany({
    where: { applicationId: params.applicationId, reversedBy: null },
  });
  for (const entry of unreversed) {
    if (entry.entryType === "RESERVATION_RELEASE" || entry.entryType === "REVERSAL") continue;
    await tx.leaveLedgerEntry.create({
      data: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        applicationId: params.applicationId,
        entryType: entry.entryType === "RESERVATION" ? "RESERVATION_RELEASE" : "REVERSAL",
        effectiveDate: normalizeLeaveDate(new Date()),
        minutes: -entry.minutes,
        reason: params.reason,
        createdById: params.actorId,
        reversalOfId: entry.id,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
    });
  }
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
      await reverseUnreversedLedgerEntries(tx, { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, reason: params.reason.trim(), actorId: params.actorId });
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

export type ApprovedLeaveChangePreview = {
  applicationId: string;
  version: number;
  previous: {
    startDate: string;
    endDate: string;
    calculatedMinutes: number;
    paidMinutes: number;
    unpaidMinutes: number;
    balanceMinutes: number;
    shiftsAffected: number;
  };
  proposed: LeavePreview;
  delta: {
    calculatedMinutes: number;
    paidMinutes: number;
    unpaidMinutes: number;
    balanceMinutes: number;
    shiftsAffected: number;
  };
  payroll: {
    posted: boolean;
    locked: boolean;
    paid: boolean;
    action: "NONE" | "REVERT_TO_DRAFT" | "EXTERNAL_CORRECTION_REQUIRED";
  };
};

async function loadApprovedLeaveForChange(companyId: string, applicationId: string) {
  const application = await prisma.leaveApplication.findFirst({
    where: { id: applicationId, companyId },
    include: {
      leaveType: true,
      occurrences: true,
      payrollPostings: { where: { isReversal: false }, include: { payrollRun: { select: { status: true } } } },
    },
  });
  if (!application) throw new LeaveManagementError("Leave application not found", 404, "NOT_FOUND");
  if (!["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED"].includes(application.status)) {
    throw new LeaveManagementError("Only approved leave can be amended or ended early", 409, "LEAVE_STATUS_CONFLICT");
  }
  return application;
}

export async function previewApprovedLeaveChange(params: {
  companyId: string;
  applicationId: string;
  startDate?: string;
  endDate: string;
  requestedMinutesPerDay?: number;
}): Promise<ApprovedLeaveChangePreview> {
  const application = await loadApprovedLeaveForChange(params.companyId, params.applicationId);
  const startDate = params.startDate ?? formatLeaveDateKey(application.startDate);
  const proposed = await previewLeave({
    companyId: params.companyId,
    employeeId: application.employeeId,
    leaveTypeCode: application.leaveType.code,
    startDate,
    endDate: params.endDate,
    requestedMinutesPerDay: params.requestedMinutesPerDay,
    excludeApplicationId: application.id,
  });
  const previousBalanceMinutes = application.occurrences.reduce((sum, occurrence) => sum + occurrence.balanceMinutes, 0);
  const proposedBalanceMinutes = proposed.occurrences.reduce((sum, occurrence) => sum + occurrence.balanceMinutes, 0);
  const paid = application.payrollPostings.some((posting) => posting.payrollRun.status === "paid");
  const locked = application.payrollPostings.some((posting) => posting.payrollRun.status === "approved");
  return {
    applicationId: application.id,
    version: application.version,
    previous: {
      startDate: formatLeaveDateKey(application.startDate),
      endDate: formatLeaveDateKey(application.endDate),
      calculatedMinutes: application.calculatedMinutes,
      paidMinutes: application.paidMinutes,
      unpaidMinutes: application.unpaidMinutes,
      balanceMinutes: previousBalanceMinutes,
      shiftsAffected: application.occurrences.filter((occurrence) => occurrence.shiftId).length,
    },
    proposed,
    delta: {
      calculatedMinutes: proposed.calculatedMinutes - application.calculatedMinutes,
      paidMinutes: proposed.paidMinutes - application.paidMinutes,
      unpaidMinutes: proposed.unpaidMinutes - application.unpaidMinutes,
      balanceMinutes: proposedBalanceMinutes - previousBalanceMinutes,
      shiftsAffected: proposed.staffingImpact.shiftsAffected - application.occurrences.filter((occurrence) => occurrence.shiftId).length,
    },
    payroll: {
      posted: application.payrollPostings.length > 0,
      locked,
      paid,
      action: paid ? "EXTERNAL_CORRECTION_REQUIRED" : locked ? "REVERT_TO_DRAFT" : "NONE",
    },
  };
}

export async function amendApprovedLeave(params: {
  companyId: string;
  applicationId: string;
  actorId: string;
  startDate?: string;
  endDate: string;
  requestedMinutesPerDay?: number;
  reason: string;
  expectedVersion?: number;
  confirmed: boolean;
  changeType?: "AMENDMENT" | "EARLY_RETURN";
}) {
  if (!params.reason.trim()) throw new LeaveManagementError("A reason is required for an approved leave change");
  if (!params.confirmed) throw new LeaveManagementError("Confirm the impact preview before changing approved leave", 409, "CONFIRMATION_REQUIRED");
  const application = await loadApprovedLeaveForChange(params.companyId, params.applicationId);
  if (params.expectedVersion != null && application.version !== params.expectedVersion) {
    throw new LeaveManagementError("Leave application changed since the impact was previewed; preview it again", 409, "VERSION_CONFLICT");
  }
  const impact = await previewApprovedLeaveChange(params);
  if (impact.proposed.conflicts.length) throw new LeaveManagementError("The amended dates overlap another active leave", 409, "LEAVE_OVERLAP");
  if (!impact.proposed.policyConfirmed) throw new LeaveManagementError("A confirmed policy version must cover the amended leave period", 409, "POLICY_NOT_CONFIRMED");
  if (impact.proposed.balanceImpact.projectedMinutes < 0 && !impact.proposed.negativeBalanceAllowed) {
    throw new LeaveManagementError("The amendment would create a negative leave balance", 409, "INSUFFICIENT_LEAVE_BALANCE");
  }
  if (impact.payroll.paid) {
    throw new LeaveManagementError("Paid payroll contains this leave; use cancellation and complete an external payroll correction", 409, "EXTERNAL_CORRECTION_REQUIRED");
  }
  if (impact.payroll.locked) {
    throw new LeaveManagementError("Revert the approved payroll run to draft before amending this leave", 409, "PAYROLL_REVERT_REQUIRED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.leaveApplication.updateMany({
      where: { id: application.id, companyId: params.companyId, version: application.version, status: application.status },
      data: {
        startDate: normalizeLeaveDate(impact.proposed.startDate),
        endDate: normalizeLeaveDate(impact.proposed.endDate),
        requestedMinutes: params.requestedMinutesPerDay ?? impact.proposed.calculatedMinutes,
        calculatedMinutes: impact.proposed.calculatedMinutes,
        paidMinutes: impact.proposed.paidMinutes,
        unpaidMinutes: impact.proposed.unpaidMinutes,
        policyVersionId: impact.proposed.policyVersionId,
        decisionReason: params.reason.trim(),
        status: "APPROVED",
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new LeaveManagementError("Leave application changed during amendment; preview it again", 409, "VERSION_CONFLICT");

    await tx.leavePayrollPosting.deleteMany({ where: { applicationId: application.id } });
    await tx.leaveOccurrence.deleteMany({ where: { applicationId: application.id } });
    await tx.leaveOccurrence.createMany({
      data: impact.proposed.occurrences.map((occurrence) => ({
        companyId: params.companyId,
        applicationId: application.id,
        employeeId: application.employeeId,
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

    const takenEntries = await tx.leaveLedgerEntry.findMany({
      where: { applicationId: application.id, entryType: "TAKEN", reversedBy: null },
    });
    for (const entry of takenEntries) {
      await tx.leaveLedgerEntry.create({
        data: {
          companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId,
          applicationId: application.id, entryType: "REVERSAL", effectiveDate: normalizeLeaveDate(new Date()),
          minutes: -entry.minutes, reason: params.reason.trim(), createdById: params.actorId, reversalOfId: entry.id,
          metadata: { changeType: params.changeType ?? "AMENDMENT", applicationVersion: application.version + 1 },
        },
      });
    }
    const balanceMinutes = impact.proposed.occurrences.reduce((sum, occurrence) => sum + occurrence.balanceMinutes, 0);
    if (balanceMinutes > 0) {
      await tx.leaveLedgerEntry.upsert({
        where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: `approved-leave-change:${application.id}:v${application.version + 1}:taken` } },
        create: {
          companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId,
          applicationId: application.id, entryType: "TAKEN", effectiveDate: normalizeLeaveDate(impact.proposed.startDate),
          minutes: -balanceMinutes, reason: `Approved leave ${params.changeType === "EARLY_RETURN" ? "ended early" : "amended"}`,
          createdById: params.actorId, idempotencyKey: `approved-leave-change:${application.id}:v${application.version + 1}:taken`,
        },
        update: {},
      });
    }
    const legacyIds = Array.isArray(application.legacyLeaveRecordIds) ? application.legacyLeaveRecordIds.filter((id): id is string => typeof id === "string") : [];
    if (legacyIds.length) await tx.leaveRecord.deleteMany({ where: { id: { in: legacyIds } } });
    const rowsByDate = new Map<string, { date: Date; hours: number }>();
    for (const occurrence of impact.proposed.occurrences) {
      const key = formatLeaveDateKey(occurrence.leaveDate);
      const current = rowsByDate.get(key) ?? { date: occurrence.leaveDate, hours: 0 };
      current.hours += occurrence.requestedMinutes / 60;
      rowsByDate.set(key, current);
    }
    const legacyRecords = await tx.leaveRecord.createManyAndReturn({
      data: [...rowsByDate.values()].map((row) => ({ employeeId: application.employeeId, date: row.date, type: application.leaveType.code, hours: row.hours })),
    });
    await tx.leaveApplication.update({ where: { id: application.id }, data: { legacyLeaveRecordIds: legacyRecords.map((row) => row.id) } });
    await tx.operationalAlert.updateMany({
      where: { companyId: params.companyId, dedupeKey: { startsWith: `leave_vacancy:${application.id}:` }, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: params.actorId },
    });
    for (const occurrence of impact.proposed.occurrences.filter((row) => row.shiftId && row.siteId)) {
      const dedupeKey = `leave_vacancy:${application.id}:${occurrence.shiftId}`;
      await tx.operationalAlert.upsert({
        where: { companyId_dedupeKey: { companyId: params.companyId, dedupeKey } },
        create: {
          companyId: params.companyId, title: "Roster cover required for amended approved leave",
          message: `Approved leave on ${formatLeaveDateKey(occurrence.leaveDate)} leaves a rostered shift requiring cover.`,
          priority: "CRITICAL", sourceModule: "ROSTERING",
          dedupeKey, sourceId: occurrence.shiftId!,
          siteId: occurrence.siteId!, employeeId: application.employeeId,
          metadata: { applicationId: application.id, shiftId: occurrence.shiftId, leaveDate: formatLeaveDateKey(occurrence.leaveDate), applicationVersion: application.version + 1 },
        },
        update: {
          title: "Roster cover required for amended approved leave",
          message: `Approved leave on ${formatLeaveDateKey(occurrence.leaveDate)} leaves a rostered shift requiring cover.`,
          status: "OPEN", resolvedAt: null, resolvedById: null,
          metadata: { applicationId: application.id, shiftId: occurrence.shiftId, leaveDate: formatLeaveDateKey(occurrence.leaveDate), applicationVersion: application.version + 1 },
        },
      });
    }
    await addLeaveAudit(tx, {
      companyId: params.companyId, employeeId: application.employeeId, applicationId: application.id, userId: params.actorId,
      eventType: params.changeType === "EARLY_RETURN" ? "APPROVED_LEAVE_EARLY_RETURN" : "APPROVED_LEAVE_AMENDED",
      reason: params.reason.trim(),
      previousValue: impact.previous,
      newValue: {
        startDate: impact.proposed.startDate, endDate: impact.proposed.endDate,
        calculatedMinutes: impact.proposed.calculatedMinutes, paidMinutes: impact.proposed.paidMinutes,
        unpaidMinutes: impact.proposed.unpaidMinutes, balanceMinutes,
      },
      metadata: { impact: impact.delta, confirmed: true, previousVersion: application.version, newVersion: application.version + 1 },
    });
    return tx.leaveApplication.findUniqueOrThrow({ where: { id: application.id } });
  });
  await reconcileContinuityForEmployee(application.employeeId, params.companyId, params.changeType === "EARLY_RETURN" ? "leave_early_return" : "leave_amended").catch(() => undefined);
  return getLeaveApplication(params.companyId, result.id);
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
  statuses?: LeaveApplicationStatus[];
  employeeId?: string;
  employeeIds?: string[];
  start?: string;
  end?: string;
  leaveTypeCode?: string;
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: "startDate" | "endDate" | "createdAt" | "employee";
  sortOrder?: "asc" | "desc";
}) {
  const search = filter.search?.trim();
  const where: Prisma.LeaveApplicationWhereInput = {
    companyId,
    ...(filter.status ? { status: filter.status } : filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
    ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
    ...(!filter.employeeId && filter.employeeIds ? { employeeId: { in: filter.employeeIds } } : {}),
    ...(filter.leaveTypeCode ? { leaveType: { code: filter.leaveTypeCode } } : {}),
    ...(search ? { OR: [
      { employee: { firstName: { contains: search, mode: "insensitive" } } },
      { employee: { lastName: { contains: search, mode: "insensitive" } } },
      { employee: { employeeNumber: { contains: search, mode: "insensitive" } } },
      { reason: { contains: search, mode: "insensitive" } },
    ] } : {}),
    ...(filter.start || filter.end ? {
      startDate: filter.end ? { lte: normalizeLeaveDate(filter.end) } : undefined,
      endDate: filter.start ? { gte: normalizeLeaveDate(filter.start) } : undefined,
    } : {}),
  };
  const orderBy: Prisma.LeaveApplicationOrderByWithRelationInput[] = filter.sortBy === "employee"
    ? [{ employee: { lastName: filter.sortOrder ?? "asc" } }, { employee: { firstName: filter.sortOrder ?? "asc" } }, { id: "asc" }]
    : [{ [filter.sortBy ?? "createdAt"]: filter.sortOrder ?? "desc" }, { id: "asc" }];
  const [data, total] = await Promise.all([
    prisma.leaveApplication.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, group: { select: { id: true, name: true } } } },
        leaveType: true,
        documents: { select: LEAVE_DOCUMENT_PUBLIC_SELECT },
        _count: { select: { occurrences: true } },
      },
      orderBy,
      take: Math.min(filter.limit ?? 100, 500),
      skip: filter.offset ?? 0,
    }),
    prisma.leaveApplication.count({ where }),
  ]);
  return { data, total };
}

export type LeaveCycleBalance = {
  cycleKey: string;
  cycleIndex: number;
  startDate: string;
  endDate: string;
  /** Last day this cycle's leave may still be taken (BCEA s20(4) for annual). */
  expiresOn: string;
  credited: number;
  taken: number;
  reserved: number;
  expired: number;
  paidOut: number;
  adjusted: number;
  remaining: number;
  /** True once the grace period has passed and the remainder is at risk. */
  closed: boolean;
};

export async function getLeaveBalances(
  companyId: string,
  employeeId?: string,
  asOf = new Date(),
  employeeIds?: string[],
  options?: { includeCycles?: boolean }
) {
  await ensureDefaultLeavePolicy(companyId);
  const asOfDate = normalizeLeaveDate(asOf);
  const employeeFilter = employeeId
    ? { employeeId }
    : employeeIds
      ? { employeeId: { in: employeeIds } }
      : {};
  const entries = await prisma.leaveLedgerEntry.groupBy({
    by: ["employeeId", "leaveTypeId", "entryType"],
    where: { companyId, ...employeeFilter, effectiveDate: { lte: asOfDate } },
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

  // Cycle scoping is opt-in per company and, because it reads the raw ledger
  // rather than an aggregate, is only computed when the caller asks for it.
  // Company-wide listings keep the cheap flat totals.
  const includeCycles =
    options?.includeCycles ?? Boolean(employeeId ?? employeeIds);
  const cyclesByKey = includeCycles
    ? await buildCycleBalances(companyId, balanceEmployeeIds, typeMap, asOfDate)
    : new Map<string, LeaveCycleBalance[]>();

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    employee: employeeMap.get(bucket.employeeId),
    leaveType: typeMap.get(bucket.leaveTypeId),
    cycles: cyclesByKey.get(`${bucket.employeeId}:${bucket.leaveTypeId}`) ?? [],
  }));
}

/**
 * Bucket each employee/leave-type ledger into entitlement cycles.
 *
 * Returns an empty map for a company that has not been cut over to the
 * statutory engine, so its balances read exactly as they did before.
 */
async function buildCycleBalances(
  companyId: string,
  employeeIds: string[],
  typeMap: Map<string, { id: string; code: string; requiresBalance: boolean }>,
  asOf: Date
): Promise<Map<string, LeaveCycleBalance[]>> {
  const result = new Map<string, LeaveCycleBalance[]>();
  if (employeeIds.length === 0) return result;

  const settings = await getLeaveCompanySettings(companyId);
  if (
    !settings.statutoryEngineEnabledFrom ||
    normalizeLeaveDate(settings.statutoryEngineEnabledFrom) > asOf
  ) {
    return result;
  }

  const [anchors, rows] = await Promise.all([
    resolveEmploymentAnchors(companyId, employeeIds),
    prisma.leaveLedgerEntry.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        effectiveDate: { lte: asOf },
      },
      select: {
        employeeId: true,
        leaveTypeId: true,
        entryType: true,
        minutes: true,
        effectiveDate: true,
        cycleKey: true,
        createdAt: true,
      },
    }),
  ]);

  const factsByKey = new Map<string, LeaveLedgerFact[]>();
  for (const row of rows) {
    const key = `${row.employeeId}:${row.leaveTypeId}`;
    const list = factsByKey.get(key) ?? [];
    list.push({
      entryType: row.entryType,
      minutes: row.minutes,
      effectiveDate: row.effectiveDate,
      createdAt: row.createdAt,
      cycleKey: row.cycleKey,
    });
    factsByKey.set(key, list);
  }

  for (const [key, facts] of factsByKey) {
    const [employeeId, leaveTypeId] = key.split(":");
    const leaveType = typeMap.get(leaveTypeId);
    const anchor = anchors.get(employeeId);
    // No entitlement cycle without a leave type that carries a balance and an
    // employment anchor to hang the cycle on.
    if (!leaveType?.requiresBalance || !anchor) continue;

    const policyVersion = await resolvePolicyVersionForEmployee({
      companyId,
      employeeId,
      leaveTypeId,
      from: asOf,
    });
    const cycleMonths = policyVersion?.cycleMonths ?? 12;
    if (cycleMonths <= 0) continue;

    const spec: LeaveCycleSpec = {
      leaveTypeCode: leaveType.code,
      anchor,
      cycleMonths,
      graceMonths: resolveGraceMonths({
        leaveTypeCode: leaveType.code,
        expiryMonths: policyVersion?.expiryMonths ?? null,
        defaultGraceMonths: settings.defaultGraceMonths,
      }),
    };
    const cycles = enumerateLeaveCycles(spec, anchor, asOf);
    const allocations = allocateLeaveConsumption(facts, cycles);

    result.set(
      key,
      allocations.map((allocation) => ({
        cycleKey: allocation.cycleKey,
        cycleIndex: allocation.cycleIndex,
        startDate: formatLeaveDateKey(allocation.start),
        endDate: formatLeaveDateKey(allocation.end),
        expiresOn: formatLeaveDateKey(allocation.graceEnd),
        credited: allocation.credited,
        taken: allocation.taken,
        reserved: allocation.reserved,
        expired: allocation.expired,
        paidOut: allocation.paidOut,
        adjusted: allocation.adjusted,
        remaining: allocation.remaining,
        closed: allocation.graceEnd < asOf,
      }))
    );
  }
  return result;
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
    await reverseUnreversedLedgerEntries(tx, { companyId: params.companyId, employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, applicationId: application.id, reason: params.reason.trim(), actorId: params.actorId, metadata: { adjustmentId: adjustment.id, payrollReference: params.payrollReference!.trim() } });
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

/**
 * Post every accrual that is due and not yet in the ledger.
 *
 * This is a catch-up runner: it works out the complete set of periods from each
 * employee's anchor to `asOf` and posts whatever is missing. Running it twice
 * changes nothing; running it after a gap back-fills the gap. The previous
 * behaviour — posting only for the month it was called with — meant any month
 * nobody ran was lost permanently.
 *
 * Entitlement is resolved per employee against their own working pattern and
 * raised to the BCEA floor where the configured policy falls short.
 */
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
    prisma.employee.findMany({ where: { companyId: params.companyId, status: { not: "offboarded" } }, select: { id: true, commencementDate: true, employeeType: true } }),
    prisma.employeeLeavePolicyAssignment.findMany({ where: { employee: { companyId: params.companyId }, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } }),
    prisma.employmentTerm.findMany({ where: { companyId: params.companyId }, orderBy: { effectiveFrom: "asc" } }),
  ]);

  const employeeIds = employees.map((employee) => employee.id);
  const anchors = await resolveEmploymentAnchors(params.companyId, employeeIds);
  const settings = await getLeaveCompanySettings(params.companyId);

  const termByEmployee = new Map<string, (typeof terms)[number]>();
  for (const term of terms) {
    if (term.effectiveFrom <= asOf && (!term.effectiveTo || term.effectiveTo >= asOf)) {
      termByEmployee.set(term.employeeId, term);
    }
  }
  const employeesWithAnyTerm = new Set(terms.map((term) => term.employeeId));

  const needsDaysWorked = versions.some(
    (version) => version.accrualMethod.trim().toUpperCase() === "DAYS_WORKED_RATIO"
  );
  const [daysWorked, suspensions, rosterPatterns, existingAccruals] = await Promise.all([
    needsDaysWorked ? loadDaysWorkedByMonth(params.companyId, employeeIds, asOf) : Promise.resolve(new Map<string, Map<string, number>>()),
    loadUnpaidLeaveMonths(params.companyId, employeeIds, asOf),
    loadRosterWorkPatterns(params.companyId, employeeIds, asOf),
    prisma.leaveLedgerEntry.findMany({
      where: { companyId: params.companyId, employeeId: { in: employeeIds }, entryType: "ACCRUAL" },
      select: { employeeId: true, leaveTypeId: true, minutes: true, cycleKey: true, metadata: true, idempotencyKey: true },
    }),
  ]);

  // Period keys and per-cycle totals already in the ledger, so the planner can
  // subtract what exists rather than re-granting it.
  const postedKeys = new Map<string, Set<string>>();
  const postedMinutes = new Map<string, Map<string, number>>();
  for (const entry of existingAccruals) {
    const scope = `${entry.employeeId}:${entry.leaveTypeId}`;
    const period = (entry.metadata as { periodKey?: string } | null)?.periodKey;
    if (period) {
      const keys = postedKeys.get(scope) ?? new Set<string>();
      keys.add(period);
      postedKeys.set(scope, keys);
    }
    if (entry.cycleKey) {
      const byCycle = postedMinutes.get(scope) ?? new Map<string, number>();
      byCycle.set(entry.cycleKey, (byCycle.get(entry.cycleKey) ?? 0) + entry.minutes);
      postedMinutes.set(scope, byCycle);
    }
  }

  const posted: Array<{ employeeId: string; leaveTypeCode: string; minutes: number; key: string }> = [];
  const skipped: Array<{ policyVersionId: string; reason: string; employeeId?: string }> = [];

  for (const version of versions) {
    const applicableEmployees = employees.filter((employee) => {
      const assigned = assignments.find(
        (item) =>
          item.employeeId === employee.id &&
          (item.leaveTypeId === version.leaveTypeId || item.leaveTypeId == null)
      );
      return assigned
        ? assigned.policyId === version.policyId
        : version.policy.category === "STATUTORY_BASELINE";
    });
    if (applicableEmployees.length === 0) continue;

    const configurationIssues = leavePolicyConfigurationIssues(version);
    if (configurationIssues.length > 0) {
      skipped.push({ policyVersionId: version.id, reason: configurationIssues.join(" ") });
      continue;
    }

    for (const employee of applicableEmployees) {
      // Effective terms take precedence. Older tenants may not have migrated
      // terms yet, so a valid commencement date is the controlled fallback.
      if (employeesWithAnyTerm.has(employee.id) && !termByEmployee.has(employee.id)) continue;
      const anchor = anchors.get(employee.id);
      if (!anchor || anchor > asOf) {
        skipped.push({ policyVersionId: version.id, employeeId: employee.id, reason: "No eligible commencement date or active employment term" });
        continue;
      }

      // Working pattern, most authoritative first: the HR-captured employment
      // term, then the employee's observed roster, then the office default.
      // A twelve-hour guard and an eight-hour administrator each end up with
      // their own correct statutory entitlement from the same policy.
      const term = termByEmployee.get(employee.id);
      const roster = rosterPatterns.get(employee.id);
      const minutesPerShift =
        term?.normalMinutesPerShift ??
        roster?.minutesPerShift ??
        (employee.employeeType === "office" ? 480 : 0);
      if (minutesPerShift <= 0) {
        skipped.push({ policyVersionId: version.id, employeeId: employee.id, reason: "No employment term or rostered shift supplies the employee's ordinary daily hours" });
        continue;
      }

      const ctx = {
        // A roster span too short to describe a rotation reports zero days a
        // week, which means "unknown" rather than "never works".
        normalDaysPerWeek: Number(
          term?.normalDaysPerWeek ??
            (roster?.daysPerWeek ? roster.daysPerWeek : DEFAULT_DAYS_PER_WEEK)
        ),
        normalMinutesPerShift: minutesPerShift,
        employedFrom: anchor,
        asOf,
      };
      // BCEA s4-5: the configured policy may improve on the statute, never
      // undercut it, so the effective entitlement is the more generous figure.
      const entitlementMinutes = effectiveEntitlementMinutes({
        leaveTypeCode: version.leaveType.code,
        configuredMinutes: version.entitlementMinutes,
        ctx,
      });

      const scope = `${employee.id}:${version.leaveTypeId}`;
      const plan = buildAccrualPlan({
        method: version.accrualMethod,
        spec: {
          leaveTypeCode: version.leaveType.code,
          anchor,
          cycleMonths: version.cycleMonths,
          graceMonths: resolveGraceMonths({
            leaveTypeCode: version.leaveType.code,
            expiryMonths: version.expiryMonths,
            defaultGraceMonths: settings.defaultGraceMonths,
          }),
        },
        entitlementMinutes,
        accrualRateMinutes: version.accrualRateMinutes != null ? Number(version.accrualRateMinutes) : null,
        accrualRatioDays: version.accrualRatioDays,
        minutesPerShift,
        employedFrom: anchor,
        asOf,
        postedPeriodKeys: postedKeys.get(scope) ?? new Set<string>(),
        postedMinutesByCycleKey: postedMinutes.get(scope) ?? new Map<string, number>(),
        daysWorkedByMonth: daysWorked.get(employee.id),
        suspendedMonths: suspensions.get(employee.id),
      });

      if (plan.length === 0) continue;

      for (const entry of plan) {
        // The key deliberately excludes the policy version: a mid-period policy
        // change must not grant the same leave type twice for one employee.
        const key = `accrual:${version.leaveTypeId}:${employee.id}:${entry.periodKey}`;
        const created = await prisma.leaveLedgerEntry.upsert({
          where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: key } },
          create: {
            companyId: params.companyId,
            employeeId: employee.id,
            leaveTypeId: version.leaveTypeId,
            entryType: "ACCRUAL",
            effectiveDate: entry.effectiveDate,
            minutes: entry.minutes,
            cycleKey: entry.cycleKey,
            reason: entry.reason,
            createdById: params.actorId,
            idempotencyKey: key,
            metadata: { policyVersionId: version.id, periodKey: entry.periodKey, method: version.accrualMethod },
          },
          update: {},
        });
        if (created.idempotencyKey === key && created.minutes === entry.minutes) {
          posted.push({ employeeId: employee.id, leaveTypeCode: version.leaveType.code, minutes: entry.minutes, key });
        }
      }
    }
  }
  await prisma.leaveAuditEvent.create({ data: { companyId: params.companyId, userId: params.actorId, eventType: "LEAVE_ACCRUAL_RUN", newValue: { asOf: params.asOf, posted: posted.length, skipped } } });
  return { asOf: params.asOf, posted, skipped };
}

export type LeaveCycleCloseResult = {
  employeeId: string;
  leaveTypeCode: string;
  cycleKey: string;
  /** Last day the leave could still have been taken. */
  expiresOn: string;
  carryOverMinutes: number;
  expiredMinutes: number;
};

/**
 * Close entitlement cycles whose grace period has lapsed.
 *
 * This is what makes BCEA s20(4) real: annual leave from a cycle stays usable
 * for six months after that cycle ends, and whatever is left at the end of that
 * window is forfeited. Sick leave has no grace period and simply resets on its
 * 36-month boundary. Both are expressed through the same two ledger entries —
 * a `CARRY_OVER` for whatever the policy lets the employee keep, and an
 * `EXPIRY` for the rest.
 *
 * Idempotent per employee, leave type and cycle, so it is safe to call on every
 * balance read. Pass `dryRun` to report what would happen without writing.
 */
export async function runLeaveCycleClose(params: {
  companyId: string;
  actorId?: string;
  asOf?: Date;
  employeeId?: string;
  dryRun?: boolean;
}): Promise<{ asOf: string; closed: LeaveCycleCloseResult[] }> {
  const asOf = normalizeLeaveDate(params.asOf ?? new Date());
  const closed: LeaveCycleCloseResult[] = [];

  // Forfeiture only applies to companies that have been cut over; before that
  // the flat running balance stands and nothing is ever expired.
  if (!(await isStatutoryEngineEnabled(params.companyId, asOf))) {
    return { asOf: formatLeaveDateKey(asOf), closed };
  }

  const balances = await getLeaveBalances(
    params.companyId,
    params.employeeId,
    asOf,
    undefined,
    { includeCycles: true }
  );

  for (const balance of balances) {
    const leaveType = balance.leaveType;
    if (!leaveType?.requiresBalance) continue;

    const context = await getLeaveCycleContext({
      companyId: params.companyId,
      employeeId: balance.employeeId,
      leaveTypeId: balance.leaveTypeId,
      leaveTypeCode: leaveType.code,
      asOf,
    });
    if (!context) continue;

    const closable = new Set(
      closableLeaveCycles(context.spec, asOf).map((cycle) => cycle.cycleKey)
    );
    if (closable.size === 0) continue;

    // The statutory rule is the floor: a company may let more carry over, but
    // not less. Sick leave's floor of zero is what makes the cycle reset.
    const statutoryLimit =
      STATUTORY_LEAVE_RULES[leaveType.code]?.carryOverLimitMinutes ?? null;
    const carryOverLimitMinutes =
      context.carryOverLimitMinutes != null && statutoryLimit != null
        ? Math.max(context.carryOverLimitMinutes, statutoryLimit)
        : (context.carryOverLimitMinutes ?? statutoryLimit);

    for (const cycle of balance.cycles) {
      if (!closable.has(cycle.cycleKey)) continue;
      if (cycle.remaining <= 0) continue;

      const { carryOverMinutes, expiredMinutes } = splitCycleCloseMinutes({
        remainingMinutes: cycle.remaining,
        carryOverLimitMinutes,
      });
      if (carryOverMinutes === 0 && expiredMinutes === 0) continue;

      const result: LeaveCycleCloseResult = {
        employeeId: balance.employeeId,
        leaveTypeCode: leaveType.code,
        cycleKey: cycle.cycleKey,
        expiresOn: cycle.expiresOn,
        carryOverMinutes,
        expiredMinutes,
      };

      if (params.dryRun) {
        closed.push(result);
        continue;
      }

      const written = await closeSingleLeaveCycle({
        companyId: params.companyId,
        actorId: params.actorId,
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        leaveTypeCode: leaveType.code,
        cycleKey: cycle.cycleKey,
        nextCycleKey: context.current.cycleKey,
        effectiveDate: normalizeLeaveDate(cycle.expiresOn),
        carryOverMinutes,
        expiredMinutes,
      });
      if (written) closed.push(result);
    }
  }

  return { asOf: formatLeaveDateKey(asOf), closed };
}

/**
 * Write the two ledger entries that close one cycle, in a single transaction.
 *
 * The `EXPIRY` debit is stamped with the cycle being closed so the allocator
 * attributes it there, while the `CARRY_OVER` credit is stamped with the cycle
 * receiving it. Both keys are deterministic, so a concurrent second run is a
 * no-op rather than a double forfeiture.
 */
async function closeSingleLeaveCycle(params: {
  companyId: string;
  actorId?: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  cycleKey: string;
  nextCycleKey: string;
  effectiveDate: Date;
  carryOverMinutes: number;
  expiredMinutes: number;
}): Promise<boolean> {
  const baseKey = `cycle-close:${params.employeeId}:${params.leaveTypeId}:${params.cycleKey}`;
  const existing = await prisma.leaveLedgerEntry.findFirst({
    where: {
      companyId: params.companyId,
      idempotencyKey: { in: [`${baseKey}:carry`, `${baseKey}:expiry`] },
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.$transaction(async (tx) => {
    if (params.expiredMinutes > 0) {
      await tx.leaveLedgerEntry.upsert({
        where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: `${baseKey}:expiry` } },
        create: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          leaveTypeId: params.leaveTypeId,
          entryType: "EXPIRY",
          effectiveDate: params.effectiveDate,
          minutes: -params.expiredMinutes,
          cycleKey: params.cycleKey,
          reason: `Entitlement not taken by ${formatLeaveDateKey(params.effectiveDate)} was forfeited at cycle close`,
          createdById: params.actorId,
          idempotencyKey: `${baseKey}:expiry`,
          metadata: { cycleKey: params.cycleKey, reference: params.leaveTypeCode === "annual" ? "BCEA s20(4)" : "Leave cycle reset" },
        },
        update: {},
      });
    }
    if (params.carryOverMinutes > 0) {
      // The carry-over moves the balance forward: a debit out of the closing
      // cycle and a credit into the current one, so neither cycle's totals lie.
      await tx.leaveLedgerEntry.upsert({
        where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: `${baseKey}:carry-out` } },
        create: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          leaveTypeId: params.leaveTypeId,
          entryType: "EXPIRY",
          effectiveDate: params.effectiveDate,
          minutes: -params.carryOverMinutes,
          cycleKey: params.cycleKey,
          reason: "Balance carried forward to the current cycle",
          createdById: params.actorId,
          idempotencyKey: `${baseKey}:carry-out`,
          metadata: { cycleKey: params.cycleKey, carriedTo: params.nextCycleKey },
        },
        update: {},
      });
      await tx.leaveLedgerEntry.upsert({
        where: { companyId_idempotencyKey: { companyId: params.companyId, idempotencyKey: `${baseKey}:carry` } },
        create: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          leaveTypeId: params.leaveTypeId,
          entryType: "CARRY_OVER",
          effectiveDate: params.effectiveDate,
          minutes: params.carryOverMinutes,
          cycleKey: params.nextCycleKey,
          reason: `Balance carried over from ${params.cycleKey}`,
          createdById: params.actorId,
          idempotencyKey: `${baseKey}:carry`,
          metadata: { carriedFrom: params.cycleKey },
        },
        update: {},
      });
    }
    await tx.leaveAuditEvent.create({
      data: {
        companyId: params.companyId,
        employeeId: params.employeeId,
        userId: params.actorId,
        eventType: "LEAVE_CYCLE_CLOSED",
        reason: `Cycle ${params.cycleKey} closed on ${formatLeaveDateKey(params.effectiveDate)}`,
        newValue: {
          cycleKey: params.cycleKey,
          leaveTypeCode: params.leaveTypeCode,
          carryOverMinutes: params.carryOverMinutes,
          expiredMinutes: params.expiredMinutes,
        },
      },
    });
  });
  return true;
}

export type LeavePolicyVersionUsage = {
  /** Leave applications whose treatment this version decided. */
  applicationCount: number;
  /** Ledger movements posted under this version. */
  ledgerEntryCount: number;
  /** True when retiring this version would leave the type with no active policy. */
  isOnlyActiveVersion: boolean;
  /** Safe to edit in place: nothing has relied on it yet. */
  canEditInPlace: boolean;
  /** Safe to delete outright: unused, and not the last thing holding the type up. */
  canDelete: boolean;
  /** Why an edit or delete is refused, for the caller to show the user. */
  reasons: string[];
};

/**
 * Establish what a policy version has already decided.
 *
 * Policy versions are effective-dated evidence: the version recorded against an
 * approved application is the rule that authorised it, and the audit trail is
 * only worth anything if that record cannot move underneath a decision that has
 * already been made. So a version that has governed leave may be superseded or
 * retired, but never rewritten or deleted.
 *
 * A version nobody has relied on carries no such history and can be corrected
 * or removed freely — which is what makes an abandoned draft tidy-up-able.
 */
export async function getLeavePolicyVersionUsage(
  companyId: string,
  versionId: string
): Promise<LeavePolicyVersionUsage | null> {
  const version = await prisma.leavePolicyVersion.findFirst({
    where: { id: versionId, companyId },
    select: { id: true, leaveTypeId: true, policyId: true, reviewStatus: true },
  });
  if (!version) return null;

  const [applicationCount, ledgerEntryCount, activeSiblingCount] = await Promise.all([
    prisma.leaveApplication.count({ where: { companyId, policyVersionId: versionId } }),
    prisma.leaveLedgerEntry.count({
      where: {
        companyId,
        leaveTypeId: version.leaveTypeId,
        metadata: { path: ["policyVersionId"], equals: versionId },
      },
    }),
    prisma.leavePolicyVersion.count({
      where: {
        companyId,
        policyId: version.policyId,
        leaveTypeId: version.leaveTypeId,
        reviewStatus: "ACTIVE",
        id: { not: versionId },
      },
    }),
  ]);

  const reasons: string[] = [];
  if (applicationCount > 0) {
    reasons.push(
      `${applicationCount} leave application${applicationCount === 1 ? " was" : "s were"} decided under this version, so it must stay unchanged as evidence.`
    );
  }
  if (ledgerEntryCount > 0) {
    reasons.push(
      `${ledgerEntryCount} balance movement${ledgerEntryCount === 1 ? " was" : "s were"} posted under this version.`
    );
  }

  const isOnlyActiveVersion =
    version.reviewStatus === "ACTIVE" && activeSiblingCount === 0;
  if (isOnlyActiveVersion) {
    reasons.push(
      "This is the only active version for this leave type; removing it would leave the leave type without a policy."
    );
  }

  const unused = applicationCount === 0 && ledgerEntryCount === 0;
  return {
    applicationCount,
    ledgerEntryCount,
    isOnlyActiveVersion,
    canEditInPlace: unused,
    canDelete: unused && !isOnlyActiveVersion,
    reasons,
  };
}

export type RosterWorkPattern = ObservedWorkPattern;

/**
 * Derive each employee's ordinary working pattern from their actual roster.
 *
 * Statutory entitlement is a function of the days and hours a person ordinarily
 * works — a twelve-hour guard on a six-day roster and an eight-hour
 * administrator on a five-day week are entitled to different amounts, and both
 * figures are correct. `EmploymentTerm` is the authoritative source for that
 * pattern, but most tenants have not captured terms yet, and without them
 * security staff fall back to zero minutes a day and accrue nothing at all.
 *
 * The roster is the honest fallback: it is real observed work rather than an
 * assumed contract. The median shift length is used rather than the mean so
 * that one unusual double shift cannot inflate an entitlement.
 */
export async function loadRosterWorkPatterns(
  companyId: string,
  employeeIds: string[],
  asOf: Date,
  lookbackDays = 180
): Promise<Map<string, RosterWorkPattern>> {
  const patterns = new Map<string, RosterWorkPattern>();
  if (employeeIds.length === 0) return patterns;

  const from = addDays(asOf, -lookbackDays);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      employeeId: { in: employeeIds },
      startTime: { gte: from, lte: addDays(asOf, 1) },
      status: { in: ["created", "assigned", "active", "completed", "verified"] },
    },
    select: { employeeId: true, startTime: true, endTime: true },
  });

  const byEmployee = new Map<string, { lengths: number[]; days: Set<string> }>();
  for (const shift of shifts) {
    if (!shift.employeeId) continue;
    const minutes = Math.round(
      (shift.endTime.getTime() - shift.startTime.getTime()) / 60_000
    );
    if (minutes <= 0) continue;
    const bucket = byEmployee.get(shift.employeeId) ?? { lengths: [], days: new Set<string>() };
    bucket.lengths.push(minutes);
    bucket.days.add(formatLeaveDateKey(normalizeLeaveDate(shift.startTime)));
    byEmployee.set(shift.employeeId, bucket);
  }

  for (const [employeeId, bucket] of byEmployee) {
    const pattern = summariseWorkPattern({
      shiftMinutes: bucket.lengths,
      workedDayKeys: [...bucket.days],
    });
    if (pattern) patterns.set(employeeId, pattern);
  }
  return patterns;
}

/** Distinct days each employee actually worked, keyed by employee then `YYYY-MM`. */
async function loadDaysWorkedByMonth(
  companyId: string,
  employeeIds: string[],
  asOf: Date
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (employeeIds.length === 0) return result;
  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      employeeId: { in: employeeIds },
      startTime: { lte: addDays(asOf, 1) },
      status: { in: ["completed", "verified"] },
    },
    select: { employeeId: true, startTime: true },
  });
  const seen = new Map<string, Set<string>>();
  for (const shift of shifts) {
    if (!shift.employeeId) continue;
    const dayKey = formatLeaveDateKey(normalizeLeaveDate(shift.startTime));
    // A double shift is still one day worked for BCEA ratio purposes.
    const days = seen.get(shift.employeeId) ?? new Set<string>();
    if (days.has(dayKey)) continue;
    days.add(dayKey);
    seen.set(shift.employeeId, days);

    const byMonth = result.get(shift.employeeId) ?? new Map<string, number>();
    const month = dayKey.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    result.set(shift.employeeId, byMonth);
  }
  return result;
}

/**
 * Months in which an employee was on approved unpaid leave.
 *
 * Unpaid leave does not earn entitlement, so accrual is suspended for those
 * months rather than quietly crediting time the employee did not work.
 */
async function loadUnpaidLeaveMonths(
  companyId: string,
  employeeIds: string[],
  asOf: Date
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (employeeIds.length === 0) return result;
  const occurrences = await prisma.leaveOccurrence.findMany({
    where: {
      companyId,
      employeeId: { in: employeeIds },
      leaveDate: { lte: asOf },
      status: { in: ["APPROVED", "PAYROLL_PROCESSED"] },
      payrollTreatment: "UNPAID_DEDUCTION",
    },
    select: { employeeId: true, leaveDate: true },
  });
  for (const occurrence of occurrences) {
    const months = result.get(occurrence.employeeId) ?? new Set<string>();
    months.add(formatLeaveDateKey(occurrence.leaveDate).slice(0, 7));
    result.set(occurrence.employeeId, months);
  }
  return result;
}

export interface LegacyLeaveRowForReadiness {
  id: string;
  employeeId: string;
  date: Date;
  type: string;
  hours: unknown;
  employee: { firstName: string; lastName: string; employeeNumber: string | null };
}

/**
 * Employee-days that hold more than one legacy leave row and have no authoritative
 * occurrence to supersede them. Payroll blocks on these because aggregateTimesheets
 * collapses only rows identical in type AND hours — anything else is summed, which
 * pays a single day twice.
 *
 * `kind` decides the remedy, so callers can act without inspecting the database:
 * exact-duplicate rows can be pruned, conflicting rows need an HR decision.
 */
export function classifyDuplicateLegacyDays(
  legacyRows: LegacyLeaveRowForReadiness[],
  authoritativeDayKeys: Set<string>
) {
  const legacyRowsByEmployeeDay = new Map<string, LegacyLeaveRowForReadiness[]>();
  for (const row of legacyRows) {
    const key = `${row.employeeId}:${formatLeaveDateKey(row.date)}`;
    // Modern approvals retain legacy compatibility rows for older screens. A
    // multi-shift leave day can legitimately produce several such rows; only
    // standalone legacy days are migration anomalies that must block payroll.
    if (authoritativeDayKeys.has(key)) continue;
    legacyRowsByEmployeeDay.set(key, [...(legacyRowsByEmployeeDay.get(key) ?? []), row]);
  }

  return [...legacyRowsByEmployeeDay.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => {
      const employee = rows[0]!.employee;
      const distinctRows = new Set(rows.map((row) => `${row.type}:${Number(row.hours).toFixed(2)}`));
      return {
        key,
        recordIds: rows.map((row) => row.id),
        types: [...new Set(rows.map((row) => row.type))],
        employeeId: rows[0]!.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeNumber: employee.employeeNumber,
        date: formatLeaveDateKey(rows[0]!.date),
        kind: distinctRows.size === 1 ? ("exact-duplicate" as const) : ("conflicting-rows" as const),
        records: rows.map((row) => ({
          id: row.id,
          type: row.type,
          hours: Number(row.hours),
        })),
      };
    });
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
      select: {
        id: true,
        employeeId: true,
        date: true,
        type: true,
        hours: true,
        employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
      },
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
  const duplicateLegacyDays = classifyDuplicateLegacyDays(legacyRows, authoritativeDayKeys);
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
