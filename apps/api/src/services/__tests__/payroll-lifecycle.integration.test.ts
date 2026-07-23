import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
} from "../../test-utils/tenant-harness.js";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../../lib/config.js";
import { hashPassword } from "../auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("payroll lifecycle smoke test (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  let payrollRunId: string;
  let runId: string;

  beforeAll(async () => {
    app = await buildApp();
    runId = randomBytes(6).toString("hex");

    const company = await prisma.company.create({
      data: {
        name: `Payroll Smoke Co ${runId}`,
        payeReference: "PAYE123",
        sdlReference: "SDL123",
        uifReference: "UIF123",
      },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Payroll Admin",
        email: `payroll-smoke-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("payroll-smoke-password-32chars!!"),
        capabilities: {
        "/payroll": ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"],
        },
      },
    });

    accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        companyId,
      },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    const grade = await prisma.payGrade.create({
      data: { companyId, name: "Grade A", hourlyRate: 50, sortOrder: 0 },
    });

    const officeEmployee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `OFF-${runId}`,
        firstName: "Office",
        lastName: "Worker",
        status: "active",
        employeeType: "office",
        monthlySalary: 20000,
        idNumber: "9001015800085",
        taxNumber: "TAX001",
        dateOfBirth: new Date("1990-01-01"),
        physicalAddress: "1 Main Rd",
        bankAccountNumber: "1111111111",
        bankBranchCode: "632005",
      },
    });

    const guardEmployee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `GRD-${runId}`,
        firstName: "Guard",
        lastName: "One",
        status: "active",
        employeeType: "security",
        gradeId: grade.id,
        idNumber: "8001015800086",
        dateOfBirth: new Date("1980-01-01"),
        physicalAddress: "2 Guard St",
        bankAccountNumber: "2222222222",
        bankBranchCode: "632005",
      },
    });

    const relieverEmployee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `REL-${runId}`,
        firstName: "Reliever",
        lastName: "Guard",
        status: "reliever",
        employeeType: "security",
        gradeId: grade.id,
        idNumber: "8501015800087",
        dateOfBirth: new Date("1985-01-01"),
        physicalAddress: "3 Relief Ave",
        bankAccountNumber: "3333333333",
        bankBranchCode: "632005",
      },
    });

    const site = await prisma.site.create({
      data: { companyId, name: `Smoke Site ${runId}` },
    });
    const post = await prisma.sitePost.create({
      data: { siteId: site.id, name: "Gate" },
    });

    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");

    // Payroll requires an approved site timesheet for every site with shifts
    // in the period (attendance gate). Mirror the real business flow: raw
    // shifts + attendance exist, and the controller approves the site
    // timesheet whose rows carry the payable hours.
    const siteTimesheet = await prisma.siteTimesheet.create({
      data: {
        companyId,
        siteId: site.id,
        periodStart,
        periodEnd,
        status: "approved",
        approvedAt: new Date("2026-07-01T08:00:00.000Z"),
      },
    });

    for (const [employeeId, hours] of [
      [guardEmployee.id, 12],
      [relieverEmployee.id, 8],
    ] as const) {
      const shift = await prisma.shift.create({
        data: {
          companyId,
          employeeId,
          siteId: site.id,
          shiftType: "day",
          legacyPostName: post.name,
          startTime: new Date("2026-06-10T06:00:00.000Z"),
          endTime: new Date("2026-06-10T18:00:00.000Z"),
          status: "completed",
        },
      });
      const attendance = await prisma.attendance.create({
        data: {
          shiftId: shift.id,
          clockIn: new Date("2026-06-10T06:00:00.000Z"),
          clockOut: new Date("2026-06-10T18:00:00.000Z"),
          hoursWorked: hours,
          overtimeHours: 0,
        },
      });
      await prisma.siteTimesheetRow.create({
        data: {
          companyId,
          siteTimesheetId: siteTimesheet.id,
          siteId: site.id,
          workDate: new Date("2026-06-10T00:00:00.000Z"),
          actualGuardId: employeeId,
          actualShiftType: "day",
          clockIn: new Date("2026-06-10T06:00:00.000Z"),
          clockOut: new Date("2026-06-10T18:00:00.000Z"),
          hoursWorked: hours,
          overtimeHours: 0,
          attendanceStatus: "present",
          approvalStatus: "approved",
          sourceShiftId: shift.id,
          sourceAttendanceId: attendance.id,
        },
      });
    }

    await prisma.leaveRecord.create({
      data: {
        employeeId: guardEmployee.id,
        date: new Date("2026-06-15T00:00:00.000Z"),
        type: "annual",
        hours: 4,
      },
    });

    void officeEmployee;

    const createRes = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });
    expect(createRes.statusCode).toBe(201);
    payrollRunId = createRes.json().id;
  }, 120_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  }, 30_000);

  it("creates a draft payroll run", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/payroll/runs/${payrollRunId}`,
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("draft");
  });

  it("calculates payroll including office, guard, reliever, and partial leave", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/payroll/runs/${payrollRunId}/calculate`,
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(200);

    const itemsRes = await app.inject({
      method: "GET",
      url: `/payroll/runs/${payrollRunId}/items`,
      headers: authHeader(accessToken),
    });
    const items = itemsRes.json().data as Array<{
      employee: { firstName: string; lastName: string };
      grossPay: string;
      basePay: string;
    }>;

    const names = items.map((i) => `${i.employee.firstName} ${i.employee.lastName}`);
    expect(names).toContain("Office Worker");
    expect(names).toContain("Guard One");
    expect(names).toContain("Reliever Guard");

    const guardItem = items.find((i) => i.employee.firstName === "Guard");
    expect(Number(guardItem?.basePay)).toBeGreaterThan(600);
  });

  it("blocks approval when validation endpoint reports readiness", async () => {
    const validationRes = await app.inject({
      method: "GET",
      url: `/payroll/runs/${payrollRunId}/validation`,
      headers: authHeader(accessToken),
    });
    expect(validationRes.statusCode).toBe(200);
    const validation = validationRes.json();
    expect(validation.canApprove).toBe(true);
    expect(validation.bankExport.valid).toBe(true);
    expect(validation.statutoryReconciliation.matched).toBe(true);
  });

  it("approves then marks paid", async () => {
    const approveRes = await app.inject({
      method: "POST",
      url: `/payroll/runs/${payrollRunId}/approve`,
      headers: authHeader(accessToken),
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe("approved");

    const paidRes = await app.inject({
      method: "POST",
      url: `/payroll/runs/${payrollRunId}/mark-paid`,
      headers: authHeader(accessToken),
    });
    expect(paidRes.statusCode).toBe(200);
    expect(paidRes.json().status).toBe("paid");

    const draftRevert = await app.inject({
      method: "POST",
      url: `/payroll/runs/${payrollRunId}/revert-to-draft`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { reason: "Should not revert paid run" },
    });
    expect(draftRevert.statusCode).toBe(400);
  });

  it("generates exports that reconcile to payroll totals", async () => {
    const summaryRes = await app.inject({
      method: "GET",
      url: `/payroll/runs/${payrollRunId}/summary`,
      headers: authHeader(accessToken),
    });
    const summary = summaryRes.json();
    const totalNetPay = summary.totalNetPay as number;

    const fnbRes = await app.inject({
      method: "GET",
      url: `/payroll/runs/${payrollRunId}/export/fnb`,
      headers: authHeader(accessToken),
    });
    expect(fnbRes.statusCode).toBe(200);
    const fnbCsv = fnbRes.body as string;
    const fnbRows = fnbCsv.trim().split("\n").slice(1);
    const fnbTotal = fnbRows.reduce((sum, row) => {
      const cols = row.match(/"([^"]*)"/g)?.map((c) => c.replace(/"/g, "")) ?? [];
      return sum + Number(cols[4] ?? 0);
    }, 0);
    expect(Math.abs(fnbTotal - totalNetPay)).toBeLessThan(0.05);

    const emp201Res = await app.inject({
      method: "GET",
      url: "/payroll/emp201-export?period=2026-06",
      headers: authHeader(accessToken),
    });
    expect(emp201Res.statusCode).toBe(200);

    const irp5Res = await app.inject({
      method: "GET",
      url: "/payroll/irp5-export?taxYear=2027",
      headers: authHeader(accessToken),
    });
    expect(irp5Res.statusCode).toBe(200);
    expect(irp5Res.body).toContain("Office");
    expect(irp5Res.body).toContain("9001015800085");
  });

  it("blocks calculate when a site has worked shifts without an approved timesheet, ignoring unworked shifts", async () => {
    const periodStart = new Date("2026-09-01T00:00:00.000Z");
    const periodEnd = new Date("2026-09-30T23:59:59.999Z");

    const unapprovedSite = await prisma.site.create({
      data: { companyId, name: `Unapproved Site ${runId}` },
    });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: (await prisma.employee.findFirstOrThrow({ where: { companyId } })).id,
        siteId: unapprovedSite.id,
        shiftType: "day",
        startTime: new Date("2026-09-05T06:00:00.000Z"),
        endTime: new Date("2026-09-05T18:00:00.000Z"),
        status: "completed",
      },
    });

    // A site with only planned (assigned) shifts must NOT block the run.
    const plannedOnlySite = await prisma.site.create({
      data: { companyId, name: `Planned Only Site ${runId}` },
    });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: (await prisma.employee.findFirstOrThrow({ where: { companyId } })).id,
        siteId: plannedOnlySite.id,
        shiftType: "day",
        startTime: new Date("2026-09-06T06:00:00.000Z"),
        endTime: new Date("2026-09-06T18:00:00.000Z"),
        status: "assigned",
      },
    });

    const createRes = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });
    const gatedRunId = createRes.json().id as string;

    const calcRes = await app.inject({
      method: "POST",
      url: `/payroll/runs/${gatedRunId}/calculate`,
      headers: authHeader(accessToken),
    });
    expect(calcRes.statusCode).toBe(400);
    const body = calcRes.json();
    const blockedIds = (body.details?.sitesNeedingApproval ?? []).map(
      (s: { id: string }) => s.id
    );
    expect(blockedIds).toContain(unapprovedSite.id);
    expect(blockedIds).not.toContain(plannedOnlySite.id);
  });

  it("supports revert to draft on a fresh calculated run", async () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-31T23:59:59.999Z");

    const createRes = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });
    const revertRunId = createRes.json().id as string;

    await app.inject({
      method: "POST",
      url: `/payroll/runs/${revertRunId}/calculate`,
      headers: authHeader(accessToken),
    });

    const revertRes = await app.inject({
      method: "POST",
      url: `/payroll/runs/${revertRunId}/revert-to-draft`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { reason: "Fixing guard attendance before recalculation" },
    });
    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json().status).toBe("draft");
  });
});
