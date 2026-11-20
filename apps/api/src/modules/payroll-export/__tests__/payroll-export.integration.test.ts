import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../../lib/prisma.js";
import { config } from "../../../lib/config.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { hashPassword } from "../../../services/auth.service.js";
import { getSpanningPeriodContainingBounds } from "../../../services/payroll-period.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("external payroll export module (integration)", () => {
  let app: FastifyInstance;
  const runId = randomBytes(6).toString("hex");
  const companyIds: string[] = [];

  let companyId: string;
  let ownerToken: string;
  let exportOnlyToken: string;
  let otherTenantToken: string;

  let site1Id: string;
  let site2Id: string;
  let approvedGuardId: string;
  let unapprovedGuardId: string;
  let approvedTimesheetId: string;
  let approvedLeaveId: string;
  let defaultProfileId: string;

  const targetDate = new Date("2026-06-15T12:00:00.000Z");
  const { periodStart, periodEnd, periodKey } = getSpanningPeriodContainingBounds(
    { startDay: 26, endDay: 25 },
    targetDate
  );

  async function signUserToken(user: { id: string; email: string; companyId: string }) {
    return jwt.sign(
      { sub: user.id, email: user.email, companyId: user.companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const pwHash = await hashPassword("payroll-export-test-password-32ch");

    const companyA = await prisma.company.create({
      data: {
        name: `Sage Export Co A ${runId}`,
        payeReference: `7${runId.slice(0, 9)}`,
        settings: {
          timezone: "Africa/Johannesburg",
          payPeriodStartDay: 26,
          payPeriodEndDay: 25,
          payrollPeriod: "monthly",
        },
      },
    });
    companyId = companyA.id;
    companyIds.push(companyA.id);

    const ownerUser = await prisma.user.create({
      data: {
        companyId,
        name: "Export Owner",
        email: `exp-owner-${runId}@plethora-test.local`,
        passwordHash: pwHash,
        capabilities: {},
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: ownerUser.id } });
    ownerToken = await signUserToken(ownerUser);

    const exportOnlyUser = await prisma.user.create({
      data: {
        companyId,
        name: "Export Operator",
        email: `exp-op-${runId}@plethora-test.local`,
        passwordHash: pwHash,
        capabilities: {
          "/payroll-exports": ["view", "create", "edit", "approve", "export"],
        },
      },
    });
    exportOnlyToken = await signUserToken(exportOnlyUser);

    const companyB = await prisma.company.create({
      data: { name: `Sage Export Co B ${runId}` },
    });
    companyIds.push(companyB.id);
    const ownerB = await prisma.user.create({
      data: {
        companyId: companyB.id,
        name: "Other Owner",
        email: `exp-other-${runId}@plethora-test.local`,
        passwordHash: pwHash,
        capabilities: {},
      },
    });
    await prisma.company.update({ where: { id: companyB.id }, data: { ownerUserId: ownerB.id } });
    otherTenantToken = await signUserToken(ownerB);

    const site1 = await prisma.site.create({
      data: {
        companyId,
        name: `Sandton Tower ${runId}`,
        costCenterCode: "CC-SAN-01",
        siteStatus: "ACTIVE",
      },
    });
    site1Id = site1.id;

    // Second active site intentionally left without an approved timesheet to trigger readiness blocker on lock.
    const site2 = await prisma.site.create({
      data: {
        companyId,
        name: `Pretoria Depot ${runId}`,
        costCenterCode: "CC-PTA-02",
        siteStatus: "ACTIVE",
      },
    });
    site2Id = site2.id;

    const approvedGuard = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `EMP-APP-${runId}`,
        externalPayrollCode: `SAGE-101-${runId}`,
        firstName: "Thabo",
        lastName: "Mokoena",
        idNumber: "9001015009087",
        taxNumber: "0123456789",
        bankName: "FNB",
        bankAccountNumber: "62000123456",
        status: "active",
        employeeType: "security_officer",
        commencementDate: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    approvedGuardId = approvedGuard.id;

    // Guard with only a scheduled shift + pending attendance (must NOT enter export calculations).
    const unapprovedGuard = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `EMP-SCH-${runId}`,
        externalPayrollCode: `SAGE-999-${runId}`,
        firstName: "Scheduled",
        lastName: "Only",
        status: "active",
        employeeType: "security_officer",
        commencementDate: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    unapprovedGuardId = unapprovedGuard.id;

    const unapprovedShift = await prisma.shift.create({
      data: {
        companyId,
        employeeId: unapprovedGuardId,
        siteId: site1Id,
        shiftType: "day",
        startTime: new Date("2026-06-12T06:00:00.000Z"),
        endTime: new Date("2026-06-12T18:00:00.000Z"),
        status: "assigned",
      },
    });
    await prisma.attendance.create({
      data: {
        shiftId: unapprovedShift.id,
        clockIn: new Date("2026-06-12T06:00:00.000Z"),
        clockOut: new Date("2026-06-12T18:00:00.000Z"),
        hoursWorked: 12,
        status: "pending",
      },
    });

    const timesheet = await prisma.siteTimesheet.create({
      data: {
        companyId,
        siteId: site1Id,
        periodStart,
        periodEnd,
        status: "approved",
        approvedAt: new Date(),
      },
    });
    approvedTimesheetId = timesheet.id;

    await prisma.siteTimesheetRow.create({
      data: {
        companyId,
        siteTimesheetId: approvedTimesheetId,
        siteId: site1Id,
        workDate: new Date("2026-06-10T00:00:00.000Z"),
        plannedGuardId: approvedGuardId,
        actualGuardId: approvedGuardId,
        plannedShiftType: "day",
        actualShiftType: "day",
        clockIn: new Date("2026-06-10T06:00:00.000Z"),
        clockOut: new Date("2026-06-10T18:00:00.000Z"),
        hoursWorked: 12,
        attendanceStatus: "present",
        approvalStatus: "approved",
      },
    });

    const leaveReq = await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: approvedGuardId,
        leaveType: "ANNUAL",
        startDate: new Date("2026-06-14T00:00:00.000Z"),
        endDate: new Date("2026-06-14T00:00:00.000Z"),
        unitsRequested: 1,
        status: "APPROVED",
        retentionUntil: new Date("2029-06-14T00:00:00.000Z"),
      },
    });
    approvedLeaveId = leaveReq.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.payrollExportBatch.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.payrollExportProfile.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await app?.close();
  }, 30_000);

  it("auto-seeds default Sage & Generic profiles on GET /payroll-exports/profiles", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/payroll-exports/profiles",
      headers: authHeader(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const profiles = res.json().profiles as Array<{ id: string; provider: string; isDefault: boolean }>;
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    const sageDefault = profiles.find((p) => p.provider === "SAGE_BUSINESS_CLOUD_ZA" && p.isDefault);
    expect(sageDefault).toBeDefined();
    defaultProfileId = sageDefault!.id;
  });

  it("supports profile CRUD and enforces cross-tenant 404 isolation", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/payroll-exports/profiles",
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: {
        name: `Sage VIP Test ${runId}`,
        provider: "SAGE_VIP",
        splitBySite: true,
        delimiter: ";",
        dateFormat: "dd/MM/yyyy",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const customProfileId = createRes.json().id as string;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/payroll-exports/profiles/${customProfileId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { name: `Sage VIP Renamed ${runId}` },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().name).toBe(`Sage VIP Renamed ${runId}`);

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/payroll-exports/profiles/${customProfileId}`,
      headers: { ...authHeader(otherTenantToken), "content-type": "application/json" },
      payload: { name: "Hijacked" },
    });
    expect(crossPatch.statusCode).toBe(404);

    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/payroll-exports/profiles/${customProfileId}`,
      headers: authHeader(otherTenantToken),
    });
    expect(crossDelete.statusCode).toBe(404);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/payroll-exports/profiles/${customProfileId}`,
      headers: authHeader(ownerToken),
    });
    expect(delRes.statusCode).toBe(204);
  });

  it("enforces the strict approved-attendance gate and includes costCenterCode on splitBySite preview", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payroll-exports/preview",
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: {
        periodKey,
        profileId: defaultProfileId,
        splitBySite: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const employeeIds = (body.lines as Array<{ employeeId: string }>).map((l) => l.employeeId);

    // Approved guard IS included; scheduled-only guard MUST NOT appear.
    expect(employeeIds).toContain(approvedGuardId);
    expect(employeeIds).not.toContain(unapprovedGuardId);

    const siteLine = (body.lines as Array<Record<string, unknown>>).find(
      (l) => l.employeeId === approvedGuardId && l.siteId === site1Id
    );
    expect(siteLine).toBeDefined();
    expect(siteLine?.costCenterCode).toBe("CC-SAN-01");
    expect(siteLine?.basicHours).toBe(12);
    expect((body.readiness?.unapprovedSiteTimesheets as number) ?? 0).toBeGreaterThanOrEqual(1);
    expect(site2Id).toBeTruthy();
  });

  it("walks batch lifecycle: DRAFT -> READINESS_BLOCKED without override -> LOCKED (locks timesheet & leave) -> duplicate lock 409 -> DOWNLOAD (EXPORTED + checksum) -> VOID (unlocks leave)", async () => {
    // 1. Create DRAFT batch
    const createDraftRes = await app.inject({
      method: "POST",
      url: "/payroll-exports/batches",
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { periodKey, profileId: defaultProfileId, splitBySite: true },
    });
    expect(createDraftRes.statusCode).toBe(201);
    const draftBatch = createDraftRes.json();
    expect(draftBatch.status).toBe("DRAFT");
    expect(draftBatch.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    const batchId = draftBatch.id as string;

    // 2. Download blocked while still DRAFT
    const draftDownload = await app.inject({
      method: "GET",
      url: `/payroll-exports/batches/${batchId}/download`,
      headers: authHeader(ownerToken),
    });
    expect(draftDownload.statusCode).toBe(409);

    // 3. Lock blocked without overrideReason because site2 has no approved timesheet
    const blockedLock = await app.inject({
      method: "POST",
      url: `/payroll-exports/batches/${batchId}/lock`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: {},
    });
    expect(blockedLock.statusCode).toBe(409);
    expect(blockedLock.json().error).toBe("READINESS_BLOCKED");

    // 4. Lock succeeds with overrideReason -> transitions LOCKED, locks timesheet, marks leave exported
    const lockRes = await app.inject({
      method: "POST",
      url: `/payroll-exports/batches/${batchId}/lock`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { overrideReason: "Pretoria Depot had zero scheduled shifts in cycle" },
    });
    expect(lockRes.statusCode).toBe(200);
    expect(lockRes.json().status).toBe("LOCKED");

    const lockedSheet = await prisma.siteTimesheet.findUniqueOrThrow({ where: { id: approvedTimesheetId } });
    expect(lockedSheet.status).toBe("locked");
    const markedLeave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: approvedLeaveId } });
    expect(markedLeave.payrollExportBatchId).toBe(batchId);

    // 5. Creating a second draft & attempting lock for same periodKey fails with ACTIVE_BATCH_EXISTS (409)
    const secondDraftRes = await app.inject({
      method: "POST",
      url: "/payroll-exports/batches",
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { periodKey, profileId: defaultProfileId },
    });
    expect(secondDraftRes.statusCode).toBe(201);
    const secondDraftId = secondDraftRes.json().id as string;

    const duplicateLockRes = await app.inject({
      method: "POST",
      url: `/payroll-exports/batches/${secondDraftId}/lock`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { overrideReason: "Attempt duplicate lock for active period" },
    });
    expect(duplicateLockRes.statusCode).toBe(409);
    expect(duplicateLockRes.json().error).toBe("ACTIVE_BATCH_EXISTS");

    // Clean up second draft via DELETE
    const delDraftRes = await app.inject({
      method: "DELETE",
      url: `/payroll-exports/batches/${secondDraftId}`,
      headers: authHeader(ownerToken),
    });
    expect(delDraftRes.statusCode).toBe(204);

    // 6. Download transitions LOCKED -> EXPORTED and returns X-Export-Checksum-Sha256
    const downloadRes = await app.inject({
      method: "GET",
      url: `/payroll-exports/batches/${batchId}/download`,
      headers: authHeader(ownerToken),
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers["x-export-checksum-sha256"]).toBe(draftBatch.checksumSha256);
    expect(downloadRes.body).toContain(`SAGE-101-${runId}`);
    expect(downloadRes.body).toContain("CC-SAN-01");

    const afterDownload = await prisma.payrollExportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(afterDownload.status).toBe("EXPORTED");

    // 7. Void rejects short reason, succeeds with valid reason, and clears LeaveRequest.payrollExportBatchId
    const shortVoid = await app.inject({
      method: "POST",
      url: `/payroll-exports/batches/${batchId}/void`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { reason: "oops" },
    });
    expect(shortVoid.statusCode).toBe(400);

    const voidRes = await app.inject({
      method: "POST",
      url: `/payroll-exports/batches/${batchId}/void`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { reason: "Correction required after late shift adjustment" },
    });
    expect(voidRes.statusCode).toBe(200);
    expect(voidRes.json().status).toBe("VOIDED");

    const clearedLeave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: approvedLeaveId } });
    expect(clearedLeave.payrollExportBatchId).toBeNull();

    // 8. Download blocked once VOIDED
    const voidDownload = await app.inject({
      method: "GET",
      url: `/payroll-exports/batches/${batchId}/download`,
      headers: authHeader(ownerToken),
    });
    expect(voidDownload.statusCode).toBe(409);
  });

  it("enforces dual capability gate on GET /payroll-exports/employee-master.csv", async () => {
    // Export operator lacks /employees:view_sensitive -> 403
    const denied = await app.inject({
      method: "GET",
      url: "/payroll-exports/employee-master.csv",
      headers: authHeader(exportOnlyToken),
    });
    expect(denied.statusCode).toBe(403);

    // Owner holds both -> 200 CSV with externalPayrollCode and sensitive fields
    const allowed = await app.inject({
      method: "GET",
      url: "/payroll-exports/employee-master.csv",
      headers: authHeader(ownerToken),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["content-type"]).toContain("text/csv");
    expect(allowed.body).toContain("External Payroll Code");
    expect(allowed.body).toContain(`SAGE-101-${runId}`);
    expect(allowed.body).toContain("9001015009087");
    expect(allowed.body).toContain("62000123456");
  });
});
