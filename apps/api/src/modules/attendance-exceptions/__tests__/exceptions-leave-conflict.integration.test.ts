import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { dateKeyInTimeZone } from "../../../lib/timezone.js";
import {
  createLeaveApplication,
  createOpeningBalanceAdjustment,
  decideLeaveApplication,
} from "../../../services/leave-management.service.js";
import { detectAndPersistExceptions } from "../exceptions.service.js";

const dbReady = await isIntegrationDatabaseAvailable();
const TIMEZONE = "Africa/Johannesburg";

describe.runIf(dbReady)("attendance exception scan respects approved leave (PostgreSQL integration)", () => {
  let companyId: string;
  let actorId: string;
  const suffix = randomBytes(6).toString("hex");
  let employeeCounter = 0;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Exceptions Leave ${suffix}`, settings: { timezone: TIMEZONE } },
    });
    companyId = company.id;
    const actor = await prisma.user.create({
      data: {
        companyId,
        name: "HR",
        email: `exc-leave-hr-${suffix}@test.local`,
        passwordHash: await hashPassword("exceptions-leave-test-password!!"),
      },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  async function createUnattendedShift(label: string) {
    employeeCounter += 1;
    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `EXC-${suffix}-${employeeCounter}`,
        firstName: "Test",
        lastName: `Guard${employeeCounter}`,
        status: "active",
        employeeType: "security",
        hourlyRate: 100,
      },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Exc Site ${label} ${suffix}` } });
    const now = new Date();
    // Well past ABSENT_THRESHOLD_MINUTES (120min) with no clock-in, so this shift
    // reliably triggers an ABSENT exception when it isn't excluded by approved leave.
    const shiftStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const shiftEnd = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const shift = await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId: site.id,
        startTime: shiftStart,
        endTime: shiftEnd,
        shiftType: "day",
        status: "assigned",
      },
    });
    return { employee, site, shift, shiftStart };
  }

  async function approveLeaveCoveringDate(employeeId: string, leaveDate: string, key: string) {
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
      startDate: leaveDate,
      endDate: leaveDate,
      reason: "Integration test leave",
      actorId,
      idempotencyKey: key,
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
    return application;
  }

  it("does not flag a shift as an exception when the employee has approved leave that day", async () => {
    const { employee, shift, shiftStart } = await createUnattendedShift("leave");
    const leaveDate = dateKeyInTimeZone(shiftStart, TIMEZONE);
    await approveLeaveCoveringDate(employee.id, leaveDate, `exc-leave:${suffix}`);

    const result = await detectAndPersistExceptions({ companyId, lookbackHours: 24 });
    expect(result.created).toBe(0);

    const exceptions = await prisma.attendanceException.findMany({ where: { shiftId: shift.id } });
    expect(exceptions).toHaveLength(0);
  });

  it("still flags an unattended shift as ABSENT when there is no leave", async () => {
    const { shift } = await createUnattendedShift("no-leave");

    const result = await detectAndPersistExceptions({ companyId, lookbackHours: 24 });
    expect(result.created).toBeGreaterThan(0);

    const exceptions = await prisma.attendanceException.findMany({ where: { shiftId: shift.id } });
    expect(exceptions.some((exception) => exception.exceptionType === "ABSENT")).toBe(true);
  });
});
