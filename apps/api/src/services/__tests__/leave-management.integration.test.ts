import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../auth.service.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { AttendanceValidationError, validateClockIn } from "../attendance.service.js";
import { revertPayrollToDraft } from "../payroll.service.js";
import {
  cancelOrWithdrawLeave,
  accrueConfirmedLeave,
  createLeaveApplication,
  createOpeningBalanceAdjustment,
  decideLeaveApplication,
  getLeaveApplication,
  getLeaveReadiness,
  listLeaveApplications,
  postLeaveToPayroll,
  previewLeave,
  resolveLeaveAdjustment,
} from "../leave-management.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("authoritative leave source of truth (PostgreSQL integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let employeeId: string;
  let actorId: string;
  let shiftId: string;
  let otherCompanyId: string;
  let controllerToken: string;
  let otherTenantToken: string;
  const suffix = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({ data: { name: `Leave V2 ${suffix}`, settings: { timezone: "Africa/Johannesburg" } } });
    companyId = company.id;
    const actor = await prisma.user.create({ data: { companyId, name: "HR", email: `leave-v2-hr-${suffix}@test.local`, passwordHash: await hashPassword("leave-source-test-password!!") } });
    actorId = actor.id;
    const controller = await prisma.user.create({ data: { companyId, name: "Controller", email: `leave-v2-controller-${suffix}@test.local`, passwordHash: actor.passwordHash, capabilities: { "/employees/leave": ["view", "approve"] } } });
    controllerToken = jwt.sign({ sub: controller.id, email: controller.email, companyId }, config.jwt.accessSecret, { expiresIn: "1h" });
    const employee = await prisma.employee.create({ data: { companyId, employeeNumber: `LV2-${suffix}`, firstName: "Night", lastName: "Guard", status: "active", employeeType: "security", hourlyRate: 100, commencementDate: new Date("2026-01-01") } });
    employeeId = employee.id;
    await prisma.employmentTerm.create({ data: { companyId, employeeId, effectiveFrom: new Date("2026-01-01"), contractType: "permanent", normalMinutesPerShift: 720, workingPattern: { rosterControlled: true } } });
    const site = await prisma.site.create({ data: { companyId, name: `Night Site ${suffix}` } });
    const shift = await prisma.shift.create({ data: { companyId, employeeId, siteId: site.id, startTime: new Date("2026-12-01T16:00:00.000Z"), endTime: new Date("2026-12-02T04:00:00.000Z"), shiftType: "night", status: "assigned" } });
    shiftId = shift.id;
    const other = await prisma.company.create({ data: { name: `Other Leave Tenant ${suffix}` } });
    otherCompanyId = other.id;
    const otherUser = await prisma.user.create({ data: { companyId: other.id, name: "Other", email: `leave-other-${suffix}@test.local`, passwordHash: actor.passwordHash, capabilities: { "/employees/leave": ["view"] } } });
    otherTenantToken = jwt.sign({ sub: otherUser.id, email: otherUser.email, companyId: other.id }, config.jwt.accessSecret, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { name: { in: [`Leave V2 ${suffix}`, `Other Leave Tenant ${suffix}`] } } });
    await app.close();
  });

  it("anchors an overnight occurrence to shift start and previews payroll/balance impact", async () => {
    await createOpeningBalanceAdjustment({ companyId, employeeId, leaveTypeCode: "annual", minutes: 24 * 60, reason: "HR-approved opening balance", actorId });
    const preview = await previewLeave({ companyId, employeeId, leaveTypeCode: "annual", startDate: "2026-12-01", endDate: "2026-12-01" });
    expect(preview.calculatedMinutes).toBe(720);
    expect(preview.paidMinutes).toBe(720);
    expect(preview.occurrences[0]?.shiftId).toBe(shiftId);
    expect(preview.balanceImpact.projectedMinutes).toBe(720);
    expect(preview.policyConfirmed).toBe(false);
  });

  it("captures every rostered shift on the same local leave date", async () => {
    const firstShift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { siteId: true } });
    const secondShift = await prisma.shift.create({
      data: {
        companyId,
        employeeId,
        siteId: firstShift.siteId,
        startTime: new Date("2026-12-01T06:00:00.000Z"),
        endTime: new Date("2026-12-01T10:00:00.000Z"),
        shiftType: "day",
        status: "assigned",
      },
    });
    try {
      const preview = await previewLeave({ companyId, employeeId, leaveTypeCode: "annual", startDate: "2026-12-01" });
      expect(preview.occurrences.map((row) => row.shiftId)).toEqual([secondShift.id, shiftId]);
      expect(preview.calculatedMinutes).toBe(16 * 60);
      expect(preview.staffingImpact.shiftsAffected).toBe(2);
      expect(preview.staffingImpact.unrosteredCalendarDays).toBe(0);
    } finally {
      await prisma.shift.delete({ where: { id: secondShift.id } });
    }
  });

  it("creates, approves, blocks attendance, posts payroll once, and requires an unpaid run to be reverted before cancellation", async () => {
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
    const application = await createLeaveApplication({ companyId, employeeId, leaveTypeCode: "annual", startDate: "2026-12-01", reason: "Holiday", actorId, idempotencyKey: `integration:${suffix}` });
    const retry = await createLeaveApplication({ companyId, employeeId, leaveTypeCode: "annual", startDate: "2026-12-01", reason: "Holiday", actorId, idempotencyKey: `integration:${suffix}` });
    expect(retry.id).toBe(application.id);
    const approvalPreview = await previewLeave({ companyId, employeeId, leaveTypeCode: "annual", startDate: "2026-12-01", excludeApplicationId: application.id });
    expect(approvalPreview.balanceImpact.currentMinutes).toBe(24 * 60);
    expect(approvalPreview.balanceImpact.projectedMinutes).toBe(12 * 60);
    expect(approvalPreview.policyConfirmed).toBe(true);
    await decideLeaveApplication({ companyId, applicationId: application.id, actorId, decision: "approve", expectedVersion: application.version });
    await expect(validateClockIn(shiftId, companyId)).rejects.toThrow(AttendanceValidationError);

    const payroll = await prisma.payrollRun.create({ data: { companyId, periodStart: new Date("2026-12-01"), periodEnd: new Date("2026-12-31"), status: "approved", lockedAt: new Date() } });
    expect((await postLeaveToPayroll(companyId, payroll.id, payroll.periodStart, payroll.periodEnd)).posted).toBe(1);
    expect((await postLeaveToPayroll(companyId, payroll.id, payroll.periodStart, payroll.periodEnd)).posted).toBe(0);
    expect(await prisma.leavePayrollPosting.count({ where: { applicationId: application.id, isReversal: false } })).toBe(1);
    await expect(cancelOrWithdrawLeave({ companyId, applicationId: application.id, actorId, reason: "Employee returned; correct the approved run" })).rejects.toThrow(/Revert the approved payroll run/);
    await revertPayrollToDraft(payroll.id, companyId, "Correct leave before payment");
    const cancelled = await cancelOrWithdrawLeave({ companyId, applicationId: application.id, actorId, reason: "Employee returned; reverse in next open run" });
    expect(cancelled?.status).toBe("CANCELLED");
    expect(await prisma.leavePayrollPosting.count({ where: { applicationId: application.id } })).toBe(0);
    expect(await prisma.leaveAdjustment.count({ where: { applicationId: application.id } })).toBe(0);
  });

  it("uses assigned capabilities and preserves tenant isolation", async () => {
    const application = await prisma.leaveApplication.findFirstOrThrow({ where: { companyId } });
    const permitted = await app.inject({ method: "POST", url: `/leave/applications/${application.id}/decision`, headers: { ...authHeader(controllerToken), "content-type": "application/json" }, payload: { decision: "approve" } });
    expect(permitted.statusCode).not.toBe(403);
    const hidden = await app.inject({ method: "GET", url: `/leave/applications/${application.id}`, headers: authHeader(otherTenantToken) });
    expect(hidden.statusCode).toBe(404);
  });

  it("posts a monthly accrual once per employee and leave type period", async () => {
    const first = await accrueConfirmedLeave({ companyId, actorId, asOf: "2026-07-15" });
    const second = await accrueConfirmedLeave({ companyId, actorId, asOf: "2026-07-20" });
    expect(first.posted).toEqual([
      expect.objectContaining({ employeeId, leaveTypeCode: "annual", minutes: 15 * 60 }),
    ]);
    expect(second.posted).toEqual([]);
    expect(await prisma.leaveLedgerEntry.count({
      where: { companyId, employeeId, entryType: "ACCRUAL" },
    })).toBe(1);
  });

  it("aggregates a modern multi-shift leave day into one compatibility row", async () => {
    const originalShift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { siteId: true } });
    const shifts = await prisma.shift.createManyAndReturn({ data: [
      { companyId, employeeId, siteId: originalShift.siteId, startTime: new Date("2026-12-05T06:00:00.000Z"), endTime: new Date("2026-12-05T10:00:00.000Z"), shiftType: "day", status: "assigned" },
      { companyId, employeeId, siteId: originalShift.siteId, startTime: new Date("2026-12-05T16:00:00.000Z"), endTime: new Date("2026-12-05T20:00:00.000Z"), shiftType: "night", status: "assigned" },
    ] });
    const application = await createLeaveApplication({
      companyId,
      employeeId,
      leaveTypeCode: "annual",
      startDate: "2026-12-05",
      reason: "Multi-shift readiness test",
      actorId,
      idempotencyKey: `multi-shift-readiness:${suffix}`,
    });
    await decideLeaveApplication({ companyId, applicationId: application.id, actorId, decision: "approve", expectedVersion: application.version });
    const compatibilityRows = await prisma.leaveRecord.findMany({ where: { employeeId, date: new Date("2026-12-05") } });
    expect(compatibilityRows).toHaveLength(1);
    expect(Number(compatibilityRows[0]?.hours)).toBe(8);
    const readiness = await getLeaveReadiness(companyId, new Date("2026-12-05"), new Date("2026-12-05"));
    expect(readiness.duplicateLegacyDays).toEqual([]);
    expect(readiness.blocked).toBe(false);
    await cancelOrWithdrawLeave({ companyId, applicationId: application.id, actorId, reason: "Regression test cleanup" });
    await prisma.shift.deleteMany({ where: { id: { in: shifts.map((shift) => shift.id) } } });
  });

  it("refuses to post tenant leave into another tenant's payroll run", async () => {
    const foreignPayroll = await prisma.payrollRun.create({
      data: {
        companyId: otherCompanyId,
        periodStart: new Date("2026-12-01"),
        periodEnd: new Date("2026-12-31"),
        status: "approved",
        lockedAt: new Date(),
      },
    });

    await expect(
      postLeaveToPayroll(companyId, foreignPayroll.id, foreignPayroll.periodStart, foreignPayroll.periodEnd)
    ).rejects.toMatchObject({ statusCode: 404, code: "PAYROLL_RUN_NOT_FOUND" });
  });

  it("requires and records an external correction before cancelling leave posted to paid payroll", async () => {
    const originalShift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { siteId: true } });
    const paidShift = await prisma.shift.create({
      data: {
        companyId,
        employeeId,
        siteId: originalShift.siteId,
        startTime: new Date("2026-12-03T06:00:00.000Z"),
        endTime: new Date("2026-12-03T18:00:00.000Z"),
        shiftType: "day",
        status: "assigned",
      },
    });
    const application = await createLeaveApplication({
      companyId,
      employeeId,
      leaveTypeCode: "annual",
      startDate: "2026-12-03",
      reason: "Paid-run correction test",
      actorId,
      idempotencyKey: `paid-correction:${suffix}`,
    });
    await decideLeaveApplication({ companyId, applicationId: application.id, actorId, decision: "approve", expectedVersion: application.version });
    const payroll = await prisma.payrollRun.create({ data: { companyId, periodStart: new Date("2026-12-01"), periodEnd: new Date("2026-12-31"), status: "approved", lockedAt: new Date() } });
    expect((await postLeaveToPayroll(companyId, payroll.id, payroll.periodStart, payroll.periodEnd)).posted).toBe(1);
    await prisma.payrollRun.update({ where: { id: payroll.id }, data: { status: "paid" } });

    const awaitingCorrection = await cancelOrWithdrawLeave({ companyId, applicationId: application.id, actorId, reason: "Employee worked; correct the paid payroll" });
    expect(awaitingCorrection?.status).toBe("ADJUSTMENT_REQUIRED");
    const adjustment = await prisma.leaveAdjustment.findFirstOrThrow({ where: { applicationId: application.id, status: "PENDING" } });
    await expect(resolveLeaveAdjustment({ companyId, adjustmentId: adjustment.id, actorId, decision: "confirm_external_correction", reason: "Payroll correction completed" })).rejects.toThrow(/reference is required/i);

    const resolved = await resolveLeaveAdjustment({ companyId, adjustmentId: adjustment.id, actorId, decision: "confirm_external_correction", reason: "Payroll correction completed", payrollReference: `PAY-CORR-${suffix}` });
    expect(resolved.status).toBe("POSTED");
    expect((await getLeaveApplication(companyId, application.id))?.status).toBe("CANCELLED");
    expect(await prisma.leavePayrollPosting.count({ where: { applicationId: application.id, isReversal: true } })).toBe(1);
    expect(await prisma.leaveOccurrence.count({ where: { applicationId: application.id, status: "CANCELLED" } })).toBe(1);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: payroll.id } })).status).toBe("paid");
    await prisma.shift.delete({ where: { id: paidShift.id } });
  });

  it("treats legacy hours as a full day for non-partial leave without weakening modern partial-day validation", async () => {
    await expect(previewLeave({
      companyId,
      employeeId,
      leaveTypeCode: "maternity",
      startDate: "2026-12-01",
      requestedMinutesPerDay: 8 * 60,
    })).rejects.toThrow(/does not allow partial-day leave/i);

    const application = await createLeaveApplication({
      companyId,
      employeeId,
      leaveTypeCode: "maternity",
      startDate: "2026-12-01",
      requestedMinutesPerDay: 8 * 60,
      legacyFullDayCapture: true,
      reason: "Legacy birth-parent request",
      source: "LEGACY_IMPORT",
      actorId,
      idempotencyKey: `legacy-full-day:${suffix}`,
    });
    expect(application.calculatedMinutes).toBe(12 * 60);
    await expect(decideLeaveApplication({ companyId, applicationId: application.id, actorId, decision: "approve" })).rejects.toThrow(/verified supporting document is required/i);
    const withdrawn = await cancelOrWithdrawLeave({ companyId, applicationId: application.id, actorId, reason: "Test cleanup" });
    expect(withdrawn?.status).toBe("WITHDRAWN");
  });

  it("returns the document metadata needed for secure HR review without exposing its storage URL", async () => {
    const application = await prisma.leaveApplication.findFirstOrThrow({ where: { companyId } });
    const created = await prisma.leaveApplicationDocument.create({
      data: {
        applicationId: application.id,
        documentType: "medical_certificate",
        fileUrl: `/uploads/leave-private/${companyId}/${application.id}/certificate.pdf`,
        fileName: "medical-certificate.pdf",
        mimeType: "application/pdf",
        fileSize: 4096,
        uploadedById: actorId,
      },
    });

    const result = await listLeaveApplications(companyId, { employeeId, limit: 100 });
    const listed = result.data
      .flatMap((leaveApplication) => leaveApplication.documents)
      .find((document) => document.id === created.id);

    expect(listed).toMatchObject({
      id: created.id,
      documentType: "medical_certificate",
      reviewStatus: "PENDING_REVIEW",
      fileName: "medical-certificate.pdf",
      mimeType: "application/pdf",
      fileSize: 4096,
    });
    expect(listed).not.toHaveProperty("fileUrl");

    const detail = await getLeaveApplication(companyId, application.id);
    const detailedDocument = detail?.documents.find((document) => document.id === created.id);
    expect(detailedDocument).toMatchObject({ id: created.id, fileName: "medical-certificate.pdf" });
    expect(detailedDocument).not.toHaveProperty("fileUrl");
  });
});
