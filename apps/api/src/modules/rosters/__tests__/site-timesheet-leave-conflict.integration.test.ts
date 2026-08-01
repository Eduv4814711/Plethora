import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { createLeaveRequest, decideLeaveRequest } from "../../../services/leave-v3.service.js";
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
    const request = await createLeaveRequest(companyId, actorId, {
      employeeId,
      leaveType: "ANNUAL",
      startDate: new Date(`${date}T00:00:00.000Z`),
      endDate: new Date(`${date}T00:00:00.000Z`),
      unitsRequested: 1,
      reason: "Integration test leave",
    });
    await decideLeaveRequest({ companyId, actorUserId: actorId, requestId: request.id, decision: "APPROVED" });
  }

  it("seeds a row as 'leave' instead of stuck 'pending' when the rostered guard has approved leave and no shift exists", async () => {
    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `TS-LEAVE-${suffix}`,
        firstName: "On",
        lastName: "Leave",
        status: "active",
        employeeType: "security_officer",
        commencementDate: new Date("2022-01-01T00:00:00.000Z"),
      },
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
    // No Shift needs to exist behind the roster row: the new leave engine
    // doesn't compute paid minutes from a roster/shift lookup, so approving
    // leave directly reproduces "planned D row, no live Shift behind it".
    await approveLeaveFor(employee.id, workDate);

    await resyncSiteTimesheet(companyId, siteId, workDate, workDate);

    const row = await prisma.siteTimesheetRow.findFirstOrThrow({
      where: { companyId, siteId, plannedGuardId: employee.id, workDate: new Date(`${workDate}T00:00:00.000Z`) },
    });
    expect(row.attendanceStatus).toBe("leave");
  });

  it("still seeds a row as 'pending' when there is no leave and no shift yet", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `TS-PENDING-${suffix}`, firstName: "No", lastName: "Leave", status: "active", employeeType: "security_officer" },
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
