import { prisma } from "../lib/prisma.js";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type IssueCandidate = {
  ruleKey: string;
  entityType: string;
  entityId?: string;
  groupKey: string;
  title: string;
  description: string;
  severity: Severity;
  recordIds: string[];
};

const WORKING_STATUSES = new Set(["present", "late", "left_early", "reliever", "shift_swapped"]);

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function scanDataQuality(companyId: string) {
  const candidates: IssueCandidate[] = [];
  const rows = await prisma.siteTimesheetRow.findMany({
    where: { companyId },
    select: {
      id: true,
      siteTimesheetId: true,
      attendanceStatus: true,
      approvalStatus: true,
      actualGuardId: true,
      hoursWorked: true,
      dutyOnObNumber: true,
      dutyOffObNumber: true,
      siteTimesheet: { select: { site: { select: { name: true } }, periodStart: true, periodEnd: true } },
    },
  });

  const rowGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowGroups.get(row.siteTimesheetId) ?? [];
    group.push(row);
    rowGroups.set(row.siteTimesheetId, group);
  }
  for (const [timesheetId, group] of rowGroups) {
    const sheet = group[0]!.siteTimesheet;
    const label = `${sheet.site.name}, ${dayKey(sheet.periodStart)} to ${dayKey(sheet.periodEnd)}`;
    const missingHours = group.filter((row) => WORKING_STATUSES.has(row.attendanceStatus) && (row.hoursWorked == null || Number(row.hoursWorked) <= 0));
    const missingGuards = group.filter((row) => WORKING_STATUSES.has(row.attendanceStatus) && !row.actualGuardId);
    const missingOb = group.filter((row) => WORKING_STATUSES.has(row.attendanceStatus) && ["reviewed", "approved"].includes(row.approvalStatus) && (!row.dutyOnObNumber || !row.dutyOffObNumber));
    if (missingHours.length) candidates.push({ ruleKey: "missing_timesheet_hours", entityType: "SiteTimesheet", entityId: timesheetId, groupKey: timesheetId, title: "Timesheet hours are missing", description: `${missingHours.length} working row(s) at ${label} need confirmed hours before payroll.`, severity: "HIGH", recordIds: missingHours.map((row) => row.id) });
    if (missingGuards.length) candidates.push({ ruleKey: "missing_guard_assignment", entityType: "SiteTimesheet", entityId: timesheetId, groupKey: timesheetId, title: "Actual guard assignment is missing", description: `${missingGuards.length} working row(s) at ${label} do not identify who worked.`, severity: "HIGH", recordIds: missingGuards.map((row) => row.id) });
    if (missingOb.length) candidates.push({ ruleKey: "missing_occurrence_book_reference", entityType: "SiteTimesheet", entityId: timesheetId, groupKey: timesheetId, title: "Occurrence-book references are missing", description: `${missingOb.length} reviewed working row(s) at ${label} need Duty ON/OFF OB references.`, severity: "MEDIUM", recordIds: missingOb.map((row) => row.id) });
  }

  const leave = await prisma.leaveRecord.findMany({
    where: { voidedAt: null, employee: { companyId } },
    select: { id: true, employeeId: true, date: true },
  });
  if (leave.length) {
    const start = new Date(Math.min(...leave.map((item) => item.date.getTime())));
    const end = new Date(Math.max(...leave.map((item) => item.date.getTime())) + 86_400_000);
    const shifts = await prisma.shift.findMany({ where: { companyId, startTime: { gte: start, lt: end } }, select: { id: true, employeeId: true, startTime: true } });
    const shiftsByPersonDay = new Map<string, string[]>();
    for (const shift of shifts) {
      const key = `${shift.employeeId}:${dayKey(shift.startTime)}`;
      shiftsByPersonDay.set(key, [...(shiftsByPersonDay.get(key) ?? []), shift.id]);
    }
    for (const item of leave) {
      const key = `${item.employeeId}:${dayKey(item.date)}`;
      const shiftIds = shiftsByPersonDay.get(key);
      if (shiftIds?.length) candidates.push({ ruleKey: "leave_roster_conflict", entityType: "LeaveRecord", entityId: item.id, groupKey: key, title: "Leave conflicts with a rostered shift", description: `The employee has approved leave and ${shiftIds.length} working shift(s) on ${dayKey(item.date)}.`, severity: "HIGH", recordIds: [item.id, ...shiftIds] });
    }
  }

  const expiredDocuments = await prisma.managedDocument.findMany({
    where: { companyId, expiryDate: { lt: new Date() }, status: { in: ["ACTIVE", "PENDING_REVIEW"] } },
    select: { id: true, employeeId: true, siteId: true, title: true, expiryDate: true },
  });
  for (const document of expiredDocuments) candidates.push({
    ruleKey: "expired_compliance_document",
    entityType: "ManagedDocument",
    entityId: document.id,
    groupKey: document.id,
    title: "Compliance document has expired",
    description: `${document.title} expired on ${dayKey(document.expiryDate!)} and needs replacement or an authorised review.`,
    severity: "HIGH",
    recordIds: [document.id],
  });

  for (const candidate of candidates) {
    const { recordIds, ...issueData } = candidate;
    await prisma.dataQualityIssue.upsert({
      where: { companyId_ruleKey_groupKey: { companyId, ruleKey: candidate.ruleKey, groupKey: candidate.groupKey } },
      create: { companyId, ...issueData, affectedRecords: { recordIds, detectedAt: new Date().toISOString() } },
      update: { entityType: candidate.entityType, entityId: candidate.entityId, title: candidate.title, description: candidate.description, severity: candidate.severity, affectedRecords: { recordIds, detectedAt: new Date().toISOString() } },
    });
  }

  return {
    detected: candidates.length,
    byRule: Object.fromEntries([...new Set(candidates.map((item) => item.ruleKey))].map((rule) => [rule, candidates.filter((item) => item.ruleKey === rule).length])),
  };
}
