/**
 * Realistic core-ops test fixture: 26–25 pay period, day/night shifts,
 * site timesheet rows (day approved, night pending), reliever, leave overlap edge case.
 */
import { randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { hashPassword } from "../services/auth.service.js";
import { grantSystemOwner } from "../services/user-access.service.js";
import { DEFAULT_TEST_MODULE_ACCESS } from "./tenant-harness.js";
import { getSpanningPeriodContainingBounds } from "../services/payroll-period.service.js";

export type CoreOpsFixture = {
  runId: string;
  companyId: string;
  userId: string;
  accessToken: string;
  siteId: string;
  dayPostId: string;
  nightPostId: string;
  permanentGuardId: string;
  relieverGuardId: string;
  siteTimesheetId: string;
  dayRowId: string;
  nightRowId: string;
  relieverRowId: string;
  payrollRunId: string;
  periodStart: Date;
  periodEnd: Date;
  leaveRecordId: string;
  teardown: () => Promise<void>;
};

function signAccessToken(user: {
  id: string;
  email: string;
  companyId: string;
  role: UserRole;
  accessVersion?: number;
  moduleAccess?: string[] | null;
}): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
      accessVersion: user.accessVersion ?? 1,
      ...(user.moduleAccess?.length ? { moduleAccess: user.moduleAccess } : {}),
      isSystemOwner: true,
    },
    config.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

/** Provision a single company with Quick Bopha-style 26–25 calendar and core ops data. */
export async function provisionCoreOpsFixture(): Promise<CoreOpsFixture> {
  const runId = randomBytes(6).toString("hex");
  const asOf = new Date("2026-06-15T12:00:00.000Z");
  const { periodStart, periodEnd } = getSpanningPeriodContainingBounds(
    { startDay: 26, endDay: 25 },
    asOf
  );

  const company = await prisma.company.create({
    data: {
      name: `Core Ops Audit Co ${runId}`,
      settings: {
        timezone: "Africa/Johannesburg",
        payPeriodStartDay: 26,
        payPeriodEndDay: 25,
        payrollPeriod: "monthly",
        currency: "ZAR",
      },
    },
  });

  const email = `core-ops-${runId}@plethora-test.local`;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Core Ops Admin",
      email,
      passwordHash: await hashPassword("core-ops-test-password-32chars!!"),
      role: "admin",
      isSystemOwner: true,
      moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
    },
  });
  await grantSystemOwner(user.id);
  const accessRecord = await prisma.user.findUnique({
    where: { id: user.id },
    select: { accessVersion: true },
  });

  const group = await prisma.employeeGroup.create({
    data: { companyId: company.id, name: "Guards", sortOrder: 0 },
  });

  const permanentGuard = await prisma.employee.create({
    data: {
      companyId: company.id,
      employeeNumber: `GRD-${runId}`,
      firstName: "Permanent",
      lastName: "Guard",
      status: "active",
      employeeType: "guard",
      hourlyRate: 45,
      groupId: group.id,
    },
  });

  const relieverGuard = await prisma.employee.create({
    data: {
      companyId: company.id,
      employeeNumber: `REL-${runId}`,
      firstName: "Reliever",
      lastName: "Guard",
      status: "active",
      employeeType: "reliever",
      hourlyRate: 40,
      groupId: group.id,
    },
  });

  const site = await prisma.site.create({
    data: {
      companyId: company.id,
      name: `Audit Site ${runId}`,
      siteStatus: "ACTIVE",
      rosterDayShiftGuardsRequired: 1,
      rosterNightShiftGuardsRequired: 1,
    },
  });

  const dayPost = await prisma.sitePost.create({
    data: { siteId: site.id, name: "Day Gate" },
  });
  const nightPost = await prisma.sitePost.create({
    data: { siteId: site.id, name: "Night Gate" },
  });

  await prisma.coverageRequirement.createMany({
    data: [
      { siteId: site.id, sitePostId: dayPost.id, shiftTypeCode: "day", guardsRequired: 1, genderRule: "any" },
      { siteId: site.id, sitePostId: nightPost.id, shiftTypeCode: "night", guardsRequired: 1, genderRule: "any" },
    ],
  });

  const workDate = new Date("2026-06-10T00:00:00.000Z");

  const dayShift = await prisma.shift.create({
    data: {
      companyId: company.id,
      employeeId: permanentGuard.id,
      siteId: site.id,
      shiftType: "day",
      legacyPostName: dayPost.name,
      startTime: new Date("2026-06-10T06:00:00.000Z"),
      endTime: new Date("2026-06-10T18:00:00.000Z"),
      status: "verified",
    },
  });

  const nightShift = await prisma.shift.create({
    data: {
      companyId: company.id,
      employeeId: permanentGuard.id,
      siteId: site.id,
      shiftType: "night",
      legacyPostName: nightPost.name,
      startTime: new Date("2026-06-10T18:00:00.000Z"),
      endTime: new Date("2026-06-11T06:00:00.000Z"),
      status: "verified",
    },
  });

  await prisma.attendance.createMany({
    data: [
      {
        shiftId: dayShift.id,
        clockIn: new Date("2026-06-10T06:05:00.000Z"),
        clockOut: new Date("2026-06-10T18:00:00.000Z"),
        hoursWorked: 11.92,
        status: "verified",
      },
      {
        shiftId: nightShift.id,
        clockIn: new Date("2026-06-10T18:00:00.000Z"),
        clockOut: new Date("2026-06-11T06:00:00.000Z"),
        hoursWorked: 12,
        status: "verified",
      },
    ],
  });

  const siteTimesheet = await prisma.siteTimesheet.create({
    data: {
      companyId: company.id,
      siteId: site.id,
      periodStart,
      periodEnd,
      status: "draft",
    },
  });

  const dayRow = await prisma.siteTimesheetRow.create({
    data: {
      companyId: company.id,
      siteTimesheetId: siteTimesheet.id,
      siteId: site.id,
      workDate,
      plannedGuardId: permanentGuard.id,
      actualGuardId: permanentGuard.id,
      plannedShiftType: "day",
      actualShiftType: "day",
      clockIn: new Date("2026-06-10T06:05:00.000Z"),
      clockOut: new Date("2026-06-10T18:00:00.000Z"),
      hoursWorked: 11.92,
      attendanceStatus: "present",
      approvalStatus: "approved",
      dutyOnObNumber: "OB-DAY-001",
      dutyOffObNumber: "OB-DAY-002",
      sourceShiftId: dayShift.id,
    },
  });

  const nightRow = await prisma.siteTimesheetRow.create({
    data: {
      companyId: company.id,
      siteTimesheetId: siteTimesheet.id,
      siteId: site.id,
      workDate,
      plannedGuardId: permanentGuard.id,
      actualGuardId: permanentGuard.id,
      plannedShiftType: "night",
      actualShiftType: "night",
      clockIn: new Date("2026-06-10T18:00:00.000Z"),
      clockOut: new Date("2026-06-11T06:00:00.000Z"),
      hoursWorked: 12,
      attendanceStatus: "present",
      approvalStatus: "pending",
      dutyOnObNumber: "OB-NIGHT-001",
      sourceShiftId: nightShift.id,
    },
  });

  const relieverRow = await prisma.siteTimesheetRow.create({
    data: {
      companyId: company.id,
      siteTimesheetId: siteTimesheet.id,
      siteId: site.id,
      workDate: new Date("2026-06-11T00:00:00.000Z"),
      plannedGuardId: null,
      actualGuardId: relieverGuard.id,
      plannedShiftType: "day",
      actualShiftType: "day",
      attendanceStatus: "reliever",
      approvalStatus: "partially_reviewed",
      dutyOnObNumber: "OB-REL-001",
    },
  });

  const payrollRun = await prisma.payrollRun.create({
    data: {
      companyId: company.id,
      periodStart,
      periodEnd,
      status: "draft",
    },
  });

  const leaveRecord = await prisma.leaveRecord.create({
    data: {
      employeeId: permanentGuard.id,
      date: new Date("2026-06-12T00:00:00.000Z"),
      type: "annual",
      hours: 8,
    },
  });

  await prisma.siteRosterGeneratedShift.create({
    data: {
      companyId: company.id,
      siteId: site.id,
      guardId: permanentGuard.id,
      rosterDate: new Date("2026-06-12T00:00:00.000Z"),
      shiftType: "day",
      shiftCode: "D",
    },
  });

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    companyId: company.id,
    role: user.role,
    accessVersion: accessRecord?.accessVersion ?? 1,
    moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
  });

  return {
    runId,
    companyId: company.id,
    userId: user.id,
    accessToken,
    siteId: site.id,
    dayPostId: dayPost.id,
    nightPostId: nightPost.id,
    permanentGuardId: permanentGuard.id,
    relieverGuardId: relieverGuard.id,
    siteTimesheetId: siteTimesheet.id,
    dayRowId: dayRow.id,
    nightRowId: nightRow.id,
    relieverRowId: relieverRow.id,
    payrollRunId: payrollRun.id,
    periodStart,
    periodEnd,
    leaveRecordId: leaveRecord.id,
    teardown: async () => {
      await prisma.company.delete({ where: { id: company.id } });
    },
  };
}
