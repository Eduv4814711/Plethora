import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { aggregateTimesheets } from "../timesheet.service.js";
import { fetchPayslipData } from "../payslip-data.service.js";
import { getLeaveReadiness, postLeaveToPayroll, unpostLeaveFromPayroll } from "../leave-v3.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

/**
 * Covers the leave-rebuild touchpoints that have no other test coverage:
 * timesheet aggregation's leave-hours bucketing, the payslip leave breakdown,
 * and the payroll-readiness/posting functions that replaced the old
 * LeavePayrollPosting/LeaveOccurrence lifecycle.
 */
describe.runIf(dbReady)("leave rebuild — payroll touchpoints (integration)", () => {
  let companyId: string;
  let generalEmployeeId: string;
  let securityEmployeeId: string;
  const runId = randomBytes(6).toString("hex");
  const periodStart = new Date("2026-06-01T00:00:00.000Z");
  const periodEnd = new Date("2026-06-30T00:00:00.000Z");

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Leave Payroll Touchpoints ${runId}` } });
    companyId = company.id;

    const commencementDate = new Date("2022-01-01T00:00:00.000Z");
    const general = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `GEN-${runId}`,
        firstName: "General",
        lastName: "Staffer",
        status: "active",
        employeeType: "general",
        monthlySalary: 15000,
        commencementDate,
      },
    });
    generalEmployeeId = general.id;

    const security = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `SEC-${runId}`,
        firstName: "Security",
        lastName: "Officer",
        status: "active",
        employeeType: "security_officer",
        hourlyRate: 100,
        commencementDate,
      },
    });
    securityEmployeeId = security.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  it("aggregateTimesheets turns an approved ANNUAL request into leaveHours using the employee's hoursPerUnit", async () => {
    const request = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: generalEmployeeId,
        leaveType: "ANNUAL",
        startDate: new Date("2026-06-10T00:00:00.000Z"),
        endDate: new Date("2026-06-11T00:00:00.000Z"),
        unitsRequested: 2,
        status: "APPROVED",
        retentionUntil: new Date("2029-06-10T00:00:00.000Z"),
      },
    });

    const aggregates = await aggregateTimesheets(companyId, periodStart, periodEnd);
    const mine = aggregates.find((a) => a.employeeId === generalEmployeeId);
    expect(mine?.leaveHours).toBe(16); // 2 units x 8 hours/unit for general staff
    expect(mine?.unpaidLeaveHours ?? 0).toBe(0);

    await prisma.leaveRequest.delete({ where: { id: request.id } });
  });

  it("aggregateTimesheets turns an approved PARENTAL request into unpaidLeaveHours, not leaveHours", async () => {
    const request = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: securityEmployeeId,
        leaveType: "PARENTAL",
        parentalLeaveScenario: "SOLE_OR_ONLY_EMPLOYED_PARENT",
        startDate: new Date("2026-06-05T00:00:00.000Z"),
        endDate: new Date("2026-06-05T00:00:00.000Z"),
        unitsRequested: 1,
        status: "APPROVED",
        retentionUntil: new Date("2029-06-05T00:00:00.000Z"),
      },
    });

    const aggregates = await aggregateTimesheets(companyId, periodStart, periodEnd);
    const mine = aggregates.find((a) => a.employeeId === securityEmployeeId);
    expect(mine?.leaveHours ?? 0).toBe(0);
    expect(mine?.unpaidLeaveHours).toBe(12); // 1 unit x 12 hours/shift for security officers

    await prisma.leaveRequest.delete({ where: { id: request.id } });
  });

  it("aggregateTimesheets prorates a request spanning a pay-period boundary", async () => {
    // 4-day request, half inside June (this period) half inside July.
    const request = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: generalEmployeeId,
        leaveType: "ANNUAL",
        startDate: new Date("2026-06-29T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
        unitsRequested: 4,
        status: "APPROVED",
        retentionUntil: new Date("2029-06-29T00:00:00.000Z"),
      },
    });

    const aggregates = await aggregateTimesheets(companyId, periodStart, periodEnd);
    const mine = aggregates.find((a) => a.employeeId === generalEmployeeId);
    // 2 of the 4 days fall in June: 4 units x (2/4) x 8 hours/unit = 16 hours.
    expect(mine?.leaveHours).toBe(16);

    await prisma.leaveRequest.delete({ where: { id: request.id } });
  });

  it("fetchPayslipData buckets ANNUAL and SICK leave hours separately, ignoring other leave types", async () => {
    const [annual, sick] = await Promise.all([
      prisma.leaveRequest.create({
        data: {
          companyId,
          employeeId: generalEmployeeId,
          leaveType: "ANNUAL",
          startDate: new Date("2026-06-08T00:00:00.000Z"),
          endDate: new Date("2026-06-08T00:00:00.000Z"),
          unitsRequested: 1,
          status: "APPROVED",
          retentionUntil: new Date("2029-06-08T00:00:00.000Z"),
        },
      }),
      prisma.leaveRequest.create({
        data: {
          companyId,
          employeeId: generalEmployeeId,
          leaveType: "SICK",
          startDate: new Date("2026-06-09T00:00:00.000Z"),
          endDate: new Date("2026-06-09T00:00:00.000Z"),
          unitsRequested: 1,
          status: "APPROVED",
          retentionUntil: new Date("2029-06-09T00:00:00.000Z"),
        },
      }),
    ]);

    const run = await prisma.payrollRun.create({
      data: { companyId, periodStart, periodEnd, payPeriod: "monthly", status: "draft" },
    });
    const item = await prisma.payrollItem.create({
      data: {
        payrollRunId: run.id,
        employeeId: generalEmployeeId,
        hoursWorked: 160,
        overtimeHours: 0,
        basePay: 15000,
        overtimePay: 0,
        grossPay: 15000,
        deductions: 0,
        netPay: 15000,
      },
    });

    const data = await fetchPayslipData(run.id, item.id, companyId);
    expect(data?.leaveBreakdown?.annualHours).toBe(8);
    expect(data?.leaveBreakdown?.sickHours).toBe(8);

    await prisma.payrollItem.delete({ where: { id: item.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: [annual.id, sick.id] } } });
  });

  it("getLeaveReadiness blocks a payroll period with an unresolved (PENDING) leave request", async () => {
    const pending = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: generalEmployeeId,
        leaveType: "ANNUAL",
        startDate: new Date("2026-06-15T00:00:00.000Z"),
        endDate: new Date("2026-06-15T00:00:00.000Z"),
        unitsRequested: 1,
        status: "PENDING",
        retentionUntil: new Date("2029-06-15T00:00:00.000Z"),
      },
    });

    const readiness = await getLeaveReadiness(companyId, periodStart, periodEnd);
    expect(readiness.blocked).toBe(true);
    expect(readiness.unresolved.map((r) => r.id)).toContain(pending.id);

    await prisma.leaveRequest.delete({ where: { id: pending.id } });
    const clear = await getLeaveReadiness(companyId, periodStart, periodEnd);
    expect(clear.blocked).toBe(false);
  });

  it("postLeaveToPayroll links approved requests in the period to the run; unpostLeaveFromPayroll clears it", async () => {
    const approved = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: generalEmployeeId,
        leaveType: "ANNUAL",
        startDate: new Date("2026-06-20T00:00:00.000Z"),
        endDate: new Date("2026-06-20T00:00:00.000Z"),
        unitsRequested: 1,
        status: "APPROVED",
        retentionUntil: new Date("2029-06-20T00:00:00.000Z"),
      },
    });
    const run = await prisma.payrollRun.create({
      data: { companyId, periodStart, periodEnd, payPeriod: "monthly", status: "draft" },
    });

    const posted = await postLeaveToPayroll(companyId, run.id, periodStart, periodEnd);
    expect(posted.posted).toBe(1);
    const afterPost = await prisma.leaveRequest.findUnique({ where: { id: approved.id } });
    expect(afterPost?.payrollRunId).toBe(run.id);

    // Posting again is a no-op — the request is already linked to a run.
    const postedAgain = await postLeaveToPayroll(companyId, run.id, periodStart, periodEnd);
    expect(postedAgain.posted).toBe(0);

    const unposted = await unpostLeaveFromPayroll(companyId, run.id);
    expect(unposted.cleared).toBe(1);
    const afterUnpost = await prisma.leaveRequest.findUnique({ where: { id: approved.id } });
    expect(afterUnpost?.payrollRunId).toBeNull();

    await prisma.leaveRequest.delete({ where: { id: approved.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
  });
});
