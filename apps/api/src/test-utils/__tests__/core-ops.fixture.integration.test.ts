import { describe, expect, it } from "vitest";
import {
  isIntegrationDatabaseAvailable,
} from "../../test-utils/tenant-harness.js";
import { provisionCoreOpsFixture } from "../../test-utils/core-ops.fixture.js";
import { computeSiteCaptureFromRows } from "../../modules/rosters/site-timesheets.service.js";
import { prisma } from "../../lib/prisma.js";

describe("core ops fixture integration", () => {
  it("provisions 26–25 period with day approved and night pending rows", async () => {
    if (!(await isIntegrationDatabaseAvailable())) return;

    const fx = await provisionCoreOpsFixture();
    try {
      expect(fx.periodStart.getUTCDate()).toBe(26);
      expect(fx.periodEnd.getUTCDate()).toBe(25);

      const rows = await prisma.siteTimesheetRow.findMany({
        where: { siteTimesheetId: fx.siteTimesheetId },
        select: {
          id: true,
          workDate: true,
          approvalStatus: true,
          plannedShiftType: true,
        },
      });

      const overview = computeSiteCaptureFromRows({
        siteId: fx.siteId,
        siteName: "Audit Site",
        timesheetStatus: "draft",
        rows,
        shiftType: "all",
      });

      expect(overview.pendingDayRows).toBe(1);
      expect(overview.pendingNightRows).toBe(1);

      const dayRow = rows.find((r) => r.id === fx.dayRowId);
      const nightRow = rows.find((r) => r.id === fx.nightRowId);
      expect(dayRow?.approvalStatus).toBe("approved");
      expect(nightRow?.approvalStatus).toBe("pending");
    } finally {
      await fx.teardown();
    }
  });
});
