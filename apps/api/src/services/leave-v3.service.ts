/**
 * Simple leave management — service layer.
 *
 * Thin wrapper around the pure functions in leave-rules.ts: loads the
 * employee, resolves the right cycle window, calls the formula, and writes
 * one PENDING/APPROVED/REJECTED/CANCELLED row plus one audit row. No ledger,
 * no policy versioning, no accrual job — balance is always computed fresh
 * from leave_requests + leave_adjustments at read time.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { LEAVE_RULES, type EmployeeTypeKey } from "../lib/leave-rules.config.js";
import {
  annualLeaveDeductibleUnits,
  annualLeaveEntitlementUnits,
  availableUnits,
  currentCycleWindow,
  familyResponsibilityEntitlementUnits,
  isEligibleForFamilyResponsibilityLeave,
  isLeaveTypeAvailable,
  isMedicalCertificateRequired,
  parentalLeaveMaxDays,
  sickLeaveEntitlementUnits,
  studyLeaveEntitlementUnits,
  type LeaveTypeCode,
  type ParentalLeaveScenarioCode,
} from "./leave-rules.js";

export class LeaveV3Error extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "LeaveV3Error";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function toLeaveConfigEmployeeType(employeeType: string): EmployeeTypeKey {
  if (employeeType === "general" || employeeType === "security_officer") return employeeType;
  throw new LeaveV3Error(400, "UNKNOWN_EMPLOYEE_TYPE", `Unrecognised employeeType "${employeeType}"`);
}

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;
const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

interface EmployeeLeaveContext {
  id: string;
  companyId: string;
  employeeType: EmployeeTypeKey;
  commencementDate: Date;
}

async function loadEmployeeContext(companyId: string, employeeId: string): Promise<EmployeeLeaveContext> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, companyId: true, employeeType: true, commencementDate: true, sickLeaveCycleAnchor: true },
  });
  if (!employee) throw new LeaveV3Error(404, "EMPLOYEE_NOT_FOUND", "Employee not found");
  if (!employee.commencementDate) {
    throw new LeaveV3Error(
      400,
      "MISSING_COMMENCEMENT_DATE",
      "Employee has no commencement date on file — required to calculate leave cycles",
    );
  }
  return {
    id: employee.id,
    companyId: employee.companyId,
    employeeType: toLeaveConfigEmployeeType(employee.employeeType),
    commencementDate: employee.commencementDate,
  };
}

function cycleAnchorFor(leaveType: LeaveTypeCode, employee: EmployeeLeaveContext, sickLeaveCycleAnchor: Date | null): Date {
  if (leaveType === "SICK") return sickLeaveCycleAnchor ?? employee.commencementDate;
  return employee.commencementDate;
}

function cycleMonthsFor(leaveType: LeaveTypeCode): number {
  return leaveType === "SICK" ? LEAVE_RULES.sickLeaveCycleMonths : 12;
}

function entitlementUnitsFor(params: {
  leaveType: LeaveTypeCode;
  employee: EmployeeLeaveContext;
  asOf: Date;
}): number {
  switch (params.leaveType) {
    case "ANNUAL":
      return annualLeaveEntitlementUnits(params.employee.employeeType);
    case "SICK":
      return sickLeaveEntitlementUnits({
        employeeType: params.employee.employeeType,
        commencementDate: params.employee.commencementDate,
        asOf: params.asOf,
      });
    case "FAMILY_RESPONSIBILITY":
      return familyResponsibilityEntitlementUnits();
    case "STUDY":
      return studyLeaveEntitlementUnits(params.employee.employeeType);
    case "PARENTAL":
      return Infinity; // parental leave has no balance concept — capped separately per request
  }
}

function deductibleUnitsFor(params: {
  leaveType: LeaveTypeCode;
  unitsRequested: number;
  startDate: Date;
  endDate: Date;
}): number {
  if (params.leaveType === "ANNUAL") {
    return annualLeaveDeductibleUnits({
      unitsRequested: params.unitsRequested,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }
  return params.unitsRequested;
}

const BALANCE_CONSUMING_STATUSES: Prisma.LeaveRequestWhereInput["status"] = { in: ["PENDING", "APPROVED"] };

/** Sum of deductible units already consuming this employee's balance for a leave type within a cycle window. */
async function takenUnitsInCycle(params: {
  companyId: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  cycleStart: Date;
  cycleEnd: Date;
  excludeRequestId?: string;
}): Promise<number> {
  const requests = await prisma.leaveRequest.findMany({
    where: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      leaveType: params.leaveType,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { gte: params.cycleStart, lte: params.cycleEnd },
      ...(params.excludeRequestId ? { id: { not: params.excludeRequestId } } : {}),
    },
    select: { unitsRequested: true, startDate: true, endDate: true },
  });
  return requests.reduce((sum, request) => {
    const deducted = deductibleUnitsFor({
      leaveType: params.leaveType,
      unitsRequested: Number(request.unitsRequested),
      startDate: request.startDate,
      endDate: request.endDate,
    });
    return sum + deducted;
  }, 0);
}

async function adjustmentUnitsInCycle(params: {
  companyId: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  cycleStart: Date;
  cycleEnd: Date;
}): Promise<number> {
  const adjustments = await prisma.leaveAdjustment.findMany({
    where: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      leaveType: params.leaveType,
      createdAt: { gte: params.cycleStart, lte: params.cycleEnd },
    },
    select: { units: true },
  });
  return adjustments.reduce((sum, adjustment) => sum + Number(adjustment.units), 0);
}

export interface LeaveBalance {
  leaveType: LeaveTypeCode;
  cycleStart: string;
  cycleEnd: string;
  entitlementUnits: number;
  adjustmentUnits: number;
  takenUnits: number;
  availableUnits: number;
}

export async function getLeaveBalances(companyId: string, employeeId: string, asOf: Date = new Date()): Promise<LeaveBalance[]> {
  const employee = await loadEmployeeContext(companyId, employeeId);
  const sickAnchorRow = await prisma.employee.findFirst({ where: { id: employeeId }, select: { sickLeaveCycleAnchor: true } });

  const balanceLeaveTypes: LeaveTypeCode[] = ["ANNUAL", "SICK", "FAMILY_RESPONSIBILITY", "STUDY"];
  const balances: LeaveBalance[] = [];
  for (const leaveType of balanceLeaveTypes) {
    if (!isLeaveTypeAvailable(leaveType, employee.employeeType)) continue;
    const anchor = cycleAnchorFor(leaveType, employee, sickAnchorRow?.sickLeaveCycleAnchor ?? null);
    const { start, end } = currentCycleWindow(anchor, cycleMonthsFor(leaveType), asOf);
    const entitlementUnits = entitlementUnitsFor({ leaveType, employee, asOf });
    const [takenUnits, adjustmentUnits] = await Promise.all([
      takenUnitsInCycle({ companyId, employeeId, leaveType, cycleStart: start, cycleEnd: end }),
      adjustmentUnitsInCycle({ companyId, employeeId, leaveType, cycleStart: start, cycleEnd: end }),
    ]);
    balances.push({
      leaveType,
      cycleStart: start.toISOString().slice(0, 10),
      cycleEnd: end.toISOString().slice(0, 10),
      entitlementUnits,
      adjustmentUnits,
      takenUnits,
      availableUnits: availableUnits({ entitlementUnits, adjustmentUnits, takenUnits }),
    });
  }
  return balances;
}

export interface LeavePreview {
  leaveType: LeaveTypeCode;
  deductibleUnits: number;
  availableUnits: number | null; // null for PARENTAL, which has no balance concept
  exceedsBalance: boolean;
  documentRequired: boolean; // SICK only
  maxDaysForScenario: number | null; // PARENTAL only
}

export interface LeaveRequestInput {
  employeeId: string;
  leaveType: LeaveTypeCode;
  startDate: Date;
  endDate: Date;
  unitsRequested: number;
  reason?: string;
  familyResponsibilityReason?: string;
  parentalLeaveScenario?: ParentalLeaveScenarioCode;
  workedPublicHoliday?: boolean;
}

async function priorSickOccurrencesInTrailing8Weeks(companyId: string, employeeId: string, beforeDate: Date): Promise<number> {
  const windowStart = new Date(beforeDate.getTime() - EIGHT_WEEKS_MS);
  return prisma.leaveRequest.count({
    where: {
      companyId,
      employeeId,
      leaveType: "SICK",
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { gte: windowStart, lt: beforeDate },
    },
  });
}

function validateRequestShape(input: LeaveRequestInput): void {
  if (input.unitsRequested <= 0) {
    throw new LeaveV3Error(400, "INVALID_UNITS", "unitsRequested must be greater than zero");
  }
  if (input.endDate < input.startDate) {
    throw new LeaveV3Error(400, "INVALID_DATE_RANGE", "endDate cannot be before startDate");
  }
  if (input.leaveType === "FAMILY_RESPONSIBILITY" && !input.familyResponsibilityReason) {
    throw new LeaveV3Error(
      400,
      "MISSING_FAMILY_RESPONSIBILITY_REASON",
      "Family responsibility leave requires a reason from the fixed list — free text is not accepted",
    );
  }
  if (input.leaveType === "PARENTAL" && !input.parentalLeaveScenario) {
    throw new LeaveV3Error(400, "MISSING_PARENTAL_SCENARIO", "Parental leave requires a scenario to be selected");
  }
}

export async function previewLeaveRequest(companyId: string, input: LeaveRequestInput): Promise<LeavePreview> {
  validateRequestShape(input);
  const employee = await loadEmployeeContext(companyId, input.employeeId);

  if (!isLeaveTypeAvailable(input.leaveType, employee.employeeType)) {
    throw new LeaveV3Error(
      400,
      "LEAVE_TYPE_NOT_AVAILABLE",
      `${input.leaveType} leave is not available for employee type "${employee.employeeType}"`,
    );
  }

  if (input.leaveType === "PARENTAL") {
    const maxDays = parentalLeaveMaxDays(input.parentalLeaveScenario!, input.startDate);
    return {
      leaveType: input.leaveType,
      deductibleUnits: input.unitsRequested,
      availableUnits: null,
      exceedsBalance: input.unitsRequested > maxDays,
      documentRequired: false,
      maxDaysForScenario: maxDays,
    };
  }

  if (input.leaveType === "FAMILY_RESPONSIBILITY") {
    const eligible = isEligibleForFamilyResponsibilityLeave({
      employeeType: employee.employeeType,
      commencementDate: employee.commencementDate,
      asOf: input.startDate,
    });
    if (!eligible) {
      throw new LeaveV3Error(
        400,
        "NOT_ELIGIBLE",
        "Employee does not yet meet the service/weekly-work-unit requirement for family responsibility leave",
      );
    }
  }

  const sickAnchorRow = await prisma.employee.findFirst({ where: { id: input.employeeId }, select: { sickLeaveCycleAnchor: true } });
  const anchor = cycleAnchorFor(input.leaveType, employee, sickAnchorRow?.sickLeaveCycleAnchor ?? null);
  const { start, end } = currentCycleWindow(anchor, cycleMonthsFor(input.leaveType), input.startDate);
  const entitlementUnits = entitlementUnitsFor({ leaveType: input.leaveType, employee, asOf: input.startDate });
  const [takenUnits, adjustmentUnits] = await Promise.all([
    takenUnitsInCycle({ companyId, employeeId: input.employeeId, leaveType: input.leaveType, cycleStart: start, cycleEnd: end }),
    adjustmentUnitsInCycle({ companyId, employeeId: input.employeeId, leaveType: input.leaveType, cycleStart: start, cycleEnd: end }),
  ]);
  const available = availableUnits({ entitlementUnits, adjustmentUnits, takenUnits });
  const deductibleUnits = deductibleUnitsFor({
    leaveType: input.leaveType,
    unitsRequested: input.unitsRequested,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  const documentRequired =
    input.leaveType === "SICK"
      ? isMedicalCertificateRequired({
          unitsRequested: input.unitsRequested,
          priorSickOccurrencesInTrailing8Weeks: await priorSickOccurrencesInTrailing8Weeks(companyId, input.employeeId, input.startDate),
        })
      : false;

  return {
    leaveType: input.leaveType,
    deductibleUnits,
    availableUnits: available,
    exceedsBalance: deductibleUnits > available,
    documentRequired,
    maxDaysForScenario: null,
  };
}

async function writeAuditLog(params: {
  companyId: string;
  employeeId: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  await prisma.leaveAuditLog.create({
    data: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      oldValue: params.oldValue as Prisma.InputJsonValue | undefined,
      newValue: params.newValue as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function createLeaveRequest(companyId: string, actorUserId: string, input: LeaveRequestInput) {
  const preview = await previewLeaveRequest(companyId, input);
  if (preview.exceedsBalance) {
    const message =
      input.leaveType === "PARENTAL"
        ? `Requested ${input.unitsRequested} days exceeds the ${preview.maxDaysForScenario} day cap for this scenario`
        : `Requested ${preview.deductibleUnits} units exceeds the ${preview.availableUnits} units available`;
    throw new LeaveV3Error(400, "EXCEEDS_BALANCE", message);
  }

  const retentionUntil = new Date(Date.now() + THREE_YEARS_MS);
  const created = await prisma.leaveRequest.create({
    data: {
      companyId,
      employeeId: input.employeeId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      unitsRequested: input.unitsRequested,
      reason: input.leaveType === "FAMILY_RESPONSIBILITY" ? null : (input.reason ?? null),
      familyResponsibilityReason: input.leaveType === "FAMILY_RESPONSIBILITY" ? (input.familyResponsibilityReason as never) : null,
      parentalLeaveScenario: input.leaveType === "PARENTAL" ? (input.parentalLeaveScenario as never) : null,
      workedPublicHoliday: input.workedPublicHoliday ?? false,
      retentionUntil,
    },
  });

  await writeAuditLog({
    companyId,
    employeeId: input.employeeId,
    actorUserId,
    action: "REQUEST_CREATED",
    entityType: "leave_request",
    entityId: created.id,
    newValue: { status: created.status, leaveType: created.leaveType, unitsRequested: input.unitsRequested },
  });

  return created;
}

export async function decideLeaveRequest(params: {
  companyId: string;
  actorUserId: string;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  reason?: string;
}) {
  const request = await prisma.leaveRequest.findFirst({ where: { id: params.requestId, companyId: params.companyId } });
  if (!request) throw new LeaveV3Error(404, "REQUEST_NOT_FOUND", "Leave request not found");
  if (request.status !== "PENDING") {
    throw new LeaveV3Error(409, "NOT_PENDING", `Leave request is ${request.status}, not PENDING`);
  }

  if (params.decision === "APPROVED" && request.leaveType !== "PARENTAL") {
    const preview = await previewLeaveRequest(params.companyId, {
      employeeId: request.employeeId,
      leaveType: request.leaveType as LeaveTypeCode,
      startDate: request.startDate,
      endDate: request.endDate,
      unitsRequested: Number(request.unitsRequested),
    });
    // The pending request itself is already counted in "taken"; re-check
    // against what's available excluding it, so approving it doesn't
    // double-subtract its own units.
    const employee = await loadEmployeeContext(params.companyId, request.employeeId);
    const sickAnchorRow = await prisma.employee.findFirst({ where: { id: request.employeeId }, select: { sickLeaveCycleAnchor: true } });
    const anchor = cycleAnchorFor(request.leaveType as LeaveTypeCode, employee, sickAnchorRow?.sickLeaveCycleAnchor ?? null);
    const { start, end } = currentCycleWindow(anchor, cycleMonthsFor(request.leaveType as LeaveTypeCode), request.startDate);
    const [takenExcludingThis, adjustmentUnits] = await Promise.all([
      takenUnitsInCycle({
        companyId: params.companyId,
        employeeId: request.employeeId,
        leaveType: request.leaveType as LeaveTypeCode,
        cycleStart: start,
        cycleEnd: end,
        excludeRequestId: request.id,
      }),
      adjustmentUnitsInCycle({ companyId: params.companyId, employeeId: request.employeeId, leaveType: request.leaveType as LeaveTypeCode, cycleStart: start, cycleEnd: end }),
    ]);
    const entitlementUnits = entitlementUnitsFor({ leaveType: request.leaveType as LeaveTypeCode, employee, asOf: request.startDate });
    const available = availableUnits({ entitlementUnits, adjustmentUnits, takenUnits: takenExcludingThis });
    const deductible = deductibleUnitsFor({
      leaveType: request.leaveType as LeaveTypeCode,
      unitsRequested: Number(request.unitsRequested),
      startDate: request.startDate,
      endDate: request.endDate,
    });
    if (deductible > available) {
      throw new LeaveV3Error(409, "EXCEEDS_BALANCE", `Balance is no longer sufficient: ${available} available, ${deductible} requested`);
    }
    void preview;
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: request.id },
    data: { status: params.decision, reviewedBy: params.actorUserId, reviewedAt: new Date() },
  });

  await writeAuditLog({
    companyId: params.companyId,
    employeeId: request.employeeId,
    actorUserId: params.actorUserId,
    action: params.decision === "APPROVED" ? "REQUEST_APPROVED" : "REQUEST_REJECTED",
    entityType: "leave_request",
    entityId: request.id,
    oldValue: { status: request.status },
    newValue: { status: updated.status, reason: params.reason ?? null },
  });

  return updated;
}

export async function cancelLeaveRequest(params: { companyId: string; actorUserId: string; requestId: string; reason: string }) {
  const request = await prisma.leaveRequest.findFirst({ where: { id: params.requestId, companyId: params.companyId } });
  if (!request) throw new LeaveV3Error(404, "REQUEST_NOT_FOUND", "Leave request not found");
  if (request.status !== "PENDING" && request.status !== "APPROVED") {
    throw new LeaveV3Error(409, "NOT_CANCELLABLE", `Leave request is ${request.status} and cannot be cancelled`);
  }

  const updated = await prisma.leaveRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });

  await writeAuditLog({
    companyId: params.companyId,
    employeeId: request.employeeId,
    actorUserId: params.actorUserId,
    action: "REQUEST_CANCELLED",
    entityType: "leave_request",
    entityId: request.id,
    oldValue: { status: request.status },
    newValue: { status: updated.status, reason: params.reason },
  });

  return updated;
}

export async function attachMedicalCertificate(params: {
  companyId: string;
  actorUserId: string;
  leaveRequestId: string;
  practitionerName: string;
  practitionerRegistrationNumber: string;
  consultationDate: Date;
  bookedOffStartDate: Date;
  bookedOffEndDate: Date;
  fileReference: string;
}) {
  const request = await prisma.leaveRequest.findFirst({ where: { id: params.leaveRequestId, companyId: params.companyId } });
  if (!request) throw new LeaveV3Error(404, "REQUEST_NOT_FOUND", "Leave request not found");
  if (request.leaveType !== "SICK") {
    throw new LeaveV3Error(400, "NOT_SICK_LEAVE", "Medical certificates can only be attached to sick leave requests");
  }
  const existing = await prisma.medicalCertificate.findUnique({ where: { leaveRequestId: request.id } });
  if (existing) {
    throw new LeaveV3Error(409, "ALREADY_EXISTS", "A medical certificate is already attached to this request");
  }

  const created = await prisma.medicalCertificate.create({
    data: {
      leaveRequestId: request.id,
      practitionerName: params.practitionerName,
      practitionerRegistrationNumber: params.practitionerRegistrationNumber,
      consultationDate: params.consultationDate,
      bookedOffStartDate: params.bookedOffStartDate,
      bookedOffEndDate: params.bookedOffEndDate,
      fileReference: params.fileReference,
    },
  });

  await writeAuditLog({
    companyId: params.companyId,
    employeeId: request.employeeId,
    actorUserId: params.actorUserId,
    action: "MEDICAL_CERTIFICATE_ATTACHED",
    entityType: "leave_request",
    entityId: request.id,
    newValue: { medicalCertificateId: created.id },
  });

  return created;
}

export async function createLeaveAdjustment(params: {
  companyId: string;
  actorUserId: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  units: number;
  reason: string;
}) {
  await loadEmployeeContext(params.companyId, params.employeeId); // tenant + existence check
  const created = await prisma.leaveAdjustment.create({
    data: {
      companyId: params.companyId,
      employeeId: params.employeeId,
      leaveType: params.leaveType,
      units: params.units,
      reason: params.reason,
      createdBy: params.actorUserId,
    },
  });

  await writeAuditLog({
    companyId: params.companyId,
    employeeId: params.employeeId,
    actorUserId: params.actorUserId,
    action: "BALANCE_ADJUSTED",
    entityType: "leave_adjustment",
    entityId: created.id,
    newValue: { leaveType: params.leaveType, units: params.units, reason: params.reason },
  });

  return created;
}

export interface LeaveReadiness {
  blocked: boolean;
  unresolved: Array<{ id: string; employeeId: string; startDate: Date; endDate: Date }>;
  message?: string;
}

/** Payroll cannot run while a leave request overlapping the period is still awaiting a decision. */
export async function getLeaveReadiness(companyId: string, start: Date, end: Date): Promise<LeaveReadiness> {
  const unresolved = await prisma.leaveRequest.findMany({
    where: { companyId, status: "PENDING", startDate: { lte: end }, endDate: { gte: start } },
    select: { id: true, employeeId: true, startDate: true, endDate: true },
  });
  return {
    blocked: unresolved.length > 0,
    unresolved,
    message: unresolved.length > 0
      ? `${unresolved.length} leave request(s) affecting this payroll period require a final decision.`
      : undefined,
  };
}

/** Marks approved leave requests in the period as consumed by this payroll run. */
export async function postLeaveToPayroll(
  companyId: string,
  payrollRunId: string,
  start: Date,
  end: Date,
  transaction?: Prisma.TransactionClient
): Promise<{ posted: number }> {
  const db = transaction ?? prisma;
  const result = await db.leaveRequest.updateMany({
    where: { companyId, status: "APPROVED", payrollRunId: null, startDate: { lte: end }, endDate: { gte: start } },
    data: { payrollRunId },
  });
  return { posted: result.count };
}

/** Clears the payroll-run link from any leave requests it had consumed, e.g. on a payroll run revert. */
export async function unpostLeaveFromPayroll(
  companyId: string,
  payrollRunId: string,
  transaction?: Prisma.TransactionClient
): Promise<{ cleared: number }> {
  const db = transaction ?? prisma;
  const result = await db.leaveRequest.updateMany({
    where: { companyId, payrollRunId },
    data: { payrollRunId: null },
  });
  return { cleared: result.count };
}
