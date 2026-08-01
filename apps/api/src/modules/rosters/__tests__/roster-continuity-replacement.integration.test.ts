import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import { hashPassword } from "../../../services/auth.service.js";
import { isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";
import { createLeaveRequest, decideLeaveRequest } from "../../../services/leave-v3.service.js";
import { reconcileRosterContinuityForSite } from "../roster-continuity.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)(
  "roster continuity confirmed replacement takes over the absent guard's shift (PostgreSQL integration)",
  () => {
    let companyId: string;
    let actorId: string;
    let siteId: string;
    let originalGuardId: string;
    let replacementGuardId: string;
    const suffix = randomBytes(6).toString("hex");
    // Fixed instant so the test doesn't depend on the real calendar date at run time.
    const now = new Date("2026-08-15T08:00:00.000Z");
    const workDate = "2026-08-15";

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `Roster Replacement Test Co ${suffix}`, settings: { timezone: "Africa/Johannesburg" } },
      });
      companyId = company.id;
      const actor = await prisma.user.create({
        data: {
          companyId,
          name: "HR",
          email: `roster-replacement-hr-${suffix}@plethora-test.local`,
          passwordHash: await hashPassword("roster-replacement-test-password!!"),
        },
      });
      actorId = actor.id;
      const site = await prisma.site.create({
        data: {
          companyId,
          name: `Replacement Site ${suffix}`,
          rosterContinuityState: "running",
          rosterDayShiftGuardsRequired: 1,
          rosterNightShiftGuardsRequired: 1,
        },
      });
      siteId = site.id;

      const originalGuard = await prisma.employee.create({
        data: { companyId, employeeNumber: `RPL-ORIG-${suffix}`, firstName: "Original", lastName: "Guard", status: "active", employeeType: "security_officer", commencementDate: new Date("2022-01-01T00:00:00.000Z") },
      });
      originalGuardId = originalGuard.id;
      const replacementGuard = await prisma.employee.create({
        data: { companyId, employeeNumber: `RPL-NEW-${suffix}`, firstName: "Replacement", lastName: "Guard", status: "active", employeeType: "security_officer" },
      });
      replacementGuardId = replacementGuard.id;

      await prisma.siteAssignment.createMany({
        data: [
          { siteId, employeeId: originalGuardId, isActive: true },
          { siteId, employeeId: replacementGuardId, isActive: true },
        ],
      });

      // cycleLengthDays: 1 means every day maps to pattern day 0 — the original guard is
      // scheduled "D" (day shift) every day, keeping the fixture simple.
      await prisma.siteRosterPattern.create({
        data: {
          companyId,
          siteId,
          name: "Test pattern",
          anchorDate: new Date("2026-01-01T00:00:00.000Z"),
          cycleLengthDays: 1,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          status: "active",
          cells: {
            create: [{ guardId: originalGuardId, patternDayIndex: 0, shiftCode: "D", shiftType: "day" }],
          },
        },
      });
    });

    afterAll(async () => {
      await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it("reassigns the leave-covered shift instead of creating a duplicate", async () => {
      // 1. Publish the original guard's shift for the test date.
      await reconcileRosterContinuityForSite(companyId, siteId, { now, userId: actorId, trigger: "test" });
      const shiftsAfterFirstRun = await prisma.shift.findMany({
        where: { companyId, siteId, startTime: { gte: new Date(`${workDate}T00:00:00.000Z`), lt: new Date(`${workDate}T23:59:59.999Z`) } },
      });
      expect(shiftsAfterFirstRun).toHaveLength(1);
      expect(shiftsAfterFirstRun[0]!.employeeId).toBe(originalGuardId);

      // 2. Approve leave for the original guard covering that date (against the real
      // shift just published — mirrors how leave is normally approved for a rostered day).
      const request = await createLeaveRequest(companyId, actorId, {
        employeeId: originalGuardId,
        leaveType: "ANNUAL",
        startDate: new Date(`${workDate}T00:00:00.000Z`),
        endDate: new Date(`${workDate}T00:00:00.000Z`),
        unitsRequested: 1,
        reason: "Integration test leave",
      });
      await decideLeaveRequest({ companyId, actorUserId: actorId, requestId: request.id, decision: "APPROVED" });

      // 3. Manually confirm a replacement for that date/shift (mirrors what
      // confirmReplacement's transaction does, without needing to satisfy its
      // suggestion-scoring eligibility maze, which is a separate concern).
      await prisma.siteRosterManualOverride.create({
        data: {
          companyId,
          siteId,
          guardId: replacementGuardId,
          rosterDate: new Date(`${workDate}T00:00:00.000Z`),
          overrideShiftCode: "D",
          overrideShiftType: "day",
          reason: "[replacement:test-alert] test replacement",
          createdBy: actorId,
        },
      });

      // 4. Reconcile again — this is where the fix applies.
      await reconcileRosterContinuityForSite(companyId, siteId, { now, userId: actorId, trigger: "test" });

      const shiftsAfterReplacement = await prisma.shift.findMany({
        where: { companyId, siteId, startTime: { gte: new Date(`${workDate}T00:00:00.000Z`), lt: new Date(`${workDate}T23:59:59.999Z`) } },
      });
      expect(shiftsAfterReplacement).toHaveLength(1);
      expect(shiftsAfterReplacement[0]!.employeeId).toBe(replacementGuardId);

      const originalGuardGeneratedRow = await prisma.siteRosterGeneratedShift.findUnique({
        where: { siteId_guardId_rosterDate: { siteId, guardId: originalGuardId, rosterDate: new Date(`${workDate}T00:00:00.000Z`) } },
      });
      expect(originalGuardGeneratedRow?.publishedShiftId).toBeNull();
    });
  }
);
