import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import {
  createLeaveApplication,
  createOpeningBalanceAdjustment,
  decideLeaveApplication,
} from "../../../services/leave-management.service.js";
import { resyncSiteTimesheet } from "../site-timesheets.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("site timesheet row seeding respects approved leave (PostgreSQL integration)", () => {
  let companyId: string;
  let actorId: string;
  let siteId: string;
  const suffix = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Timesheet Leave Test Co ${suffix}`, settings: { timezone: "Africa/Johannesburg" } },
    });
    companyId = company.id;
    const actor = await prisma.user.create({
      data: {
        companyId,
        name: "HR",
        email: `timesheet-leave-hr-${suffix}@plethora-test.local`,
        passwordHash: await hashPassword("timesheet-leave-test-password!!"),
      },
    });
    actorId = actor.id;
    const site = await prisma.site.create({ data: { companyId, name: `Timesheet Leave Site ${suffix}` } });
    siteId = site.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  async function approveLeaveFor(employeeId: string, date: string) {
    await createOpeningBalanceAdjustment({
      companyId,
      employeeId,
      leaveTypeCode: "annual",
      minutes: 24 * 60,
      reason: "Integration test opening balance",
      actorId,
    });
    const application = await createLeaveApplication({
      companyId,
      employeeId,
      leaveTypeCode: "annual",
      startDate: date,
      endDate: date,
      reason: "Integration test leave",
      actorId,
      idempotencyKey: `timesheet-leave:${suffix}:${employeeId}`,
    });
    await prisma.leavePolicyVersion.updateMany({
      where: { companyId, leaveType: { code: "annual" }, reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION" },
      data: {
        reviewStatus: "ACTIVE",
        confirmedBy: actorId,
        confirmedAt: new Date(),
        accrualMethod: "EVEN_MONTHLY",
        entitlementMinutes: 180 * 60,
      },
    });
    await decideLeaveApplication({
      companyId,
      applicationId: application.id,
      actorId,
      decision: "approve",
      expectedVersion: application.version,
    });
  }

  it("seeds a row as 'leave' instead of stuck 'pending' when the rostered guard has approved leave and no shift exists", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `TS-LEAVE-${suffix}`, firstName: "On", lastName: "Leave", status: "active", employeeType: "security" },
    });
    const workDate = "2026-12-15";
    await prisma.siteRosterGeneratedShift.create({
      data: {
        companyId,
        siteId,
        guardId: employee.id,
        rosterDate: new Date(`${workDate}T00:00:00.000Z`),
        shiftCode: "D",
        shiftType: "day",
      },
    });
    // A real Shift must exist for createLeaveApplication to compute non-zero paid minutes
    // for a security-type employee; delete it afterward to reproduce the real trigger —
    // leave approved against a published shift that's since been cancelled/reassigned,
    // leaving the roster's planned D/N/R row stale with no live Shift behind it.
    const tempShift = await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId,
        startTime: new Date(`${workDate}T06:00:00.000Z`),
        endTime: new Date(`${workDate}T18:00:00.000Z`),
        shiftType: "day",
        status: "assigned",
      },
    });
    await approveLeaveFor(employee.id, workDate);
    await prisma.shift.delete({ where: { id: tempShift.id } });

    await resyncSiteTimesheet(companyId, siteId, workDate, workDate);

    const row = await prisma.siteTimesheetRow.findFirstOrThrow({
      where: { companyId, siteId, plannedGuardId: employee.id, workDate: new Date(`${workDate}T00:00:00.000Z`) },
    });
    expect(row.attendanceStatus).toBe("leave");
  });

  it("still seeds a row as 'pending' when there is no leave and no shift yet", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `TS-PENDING-${suffix}`, firstName: "No", lastName: "Leave", status: "active", employeeType: "security" },
    });
    const workDate = "2026-12-16";
    await prisma.siteRosterGeneratedShift.create({
      data: {
        companyId,
        siteId,
        guardId: employee.id,
        rosterDate: new Date(`${workDate}T00:00:00.000Z`),
        shiftCode: "D",
        shiftType: "day",
      },
    });

    await resyncSiteTimesheet(companyId, siteId, workDate, workDate);

    const row = await prisma.siteTimesheetRow.findFirstOrThrow({
      where: { companyId, siteId, plannedGuardId: employee.id, workDate: new Date(`${workDate}T00:00:00.000Z`) },
    });
    expect(row.attendanceStatus).toBe("pending");
  });
});
