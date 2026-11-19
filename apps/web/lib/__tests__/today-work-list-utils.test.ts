import { describe, expect, it } from "vitest";
import {
  formatPayPeriodLabel,
  buildTodayWorkItems,
  type DashboardWorkData,
} from "../today-work-list-utils";
import type { CapabilityMap, AuthUser } from "../api";

const makeUser = (capabilities: CapabilityMap = {}, isOwner = false): AuthUser => ({
  id: "u-1",
  name: "Test User",
  email: "test@plethora.local",
  accountType: "staff",
  jobTitle: "Operations Controller",
  companyId: "c-1",
  isOwner,
  isActive: true,
  capabilities,
});

describe("formatPayPeriodLabel", () => {
  it("formats the period in plain language", () => {
    const label = formatPayPeriodLabel({
      label: "September 2026",
      periodStart: "2026-08-26T00:00:00.000Z",
      periodEnd: "2026-09-25T23:59:59.999Z",
    });
    expect(label).toBe("September roster · 26 Aug – 25 Sep");
  });

  it("handles missing period cleanly", () => {
    expect(formatPayPeriodLabel(null)).toBe("");
    expect(formatPayPeriodLabel(undefined)).toBe("");
  });
});

describe("buildTodayWorkItems", () => {
  const sampleDashboard: DashboardWorkData = {
    exportReadiness: {
      status: "PENDING_ATTENDANCE_REVIEW",
      openExceptions: 3,
      periodStart: "2026-08-26T00:00:00.000Z",
      periodEnd: "2026-09-25T23:59:59.999Z",
    },
    currentPayPeriod: {
      label: "September 2026",
      periodStart: "2026-08-26T00:00:00.000Z",
      periodEnd: "2026-09-25T23:59:59.999Z",
    },
    pendingApprovalsInbox: 2,
    pendingSiteTimesheetRows: 4,
    operationalAlerts: [
      {
        id: "alert-doc-1",
        title: "PSIRA Registration Expiring",
        message: "Guard PSIRA expires in 7 days",
        priority: "MEDIUM",
        status: "OPEN",
        sourceModule: "DOCUMENTS",
        createdAt: "2026-09-20T10:00:00Z",
      },
    ],
  };

  it("returns empty work list for a clear / quiet day", () => {
    const user = makeUser({ "/attendance": ["view"] });
    const clearDashboard: DashboardWorkData = {
      exportReadiness: {
        status: "READY",
        openExceptions: 0,
        periodStart: "2026-08-26T00:00:00.000Z",
        periodEnd: "2026-09-25T23:59:59.999Z",
      },
      currentPayPeriod: {
        label: "September 2026",
        periodStart: "2026-08-26T00:00:00.000Z",
        periodEnd: "2026-09-25T23:59:59.999Z",
      },
      pendingApprovalsInbox: 0,
      pendingSiteTimesheetRows: 0,
      operationalAlerts: [],
    };

    const items = buildTodayWorkItems({
      user,
      dashboard: clearDashboard,
      captureOverview: {
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        captureThrough: "2026-09-20",
        asOfDate: "2026-09-20",
        summary: { totalSites: 5, needsCapture: 0, caughtUp: 5, noShifts: 0, pendingDayRows: 0, pendingNightRows: 0 },
        sites: [],
      },
    });

    expect(items).toEqual([]);
  });

  it("filters rows strictly by user capabilities", () => {
    // User only has payroll-exports capability; attendance and documents are hidden
    const exportUser = makeUser({ "/payroll-exports": ["view"] });
    const items = buildTodayWorkItems({
      user: exportUser,
      dashboard: sampleDashboard,
    });

    // Should only have the payroll export blocker row, no attendance capture, no documents, no approvals
    expect(items.some((i) => i.sourceModule === "ATTENDANCE")).toBe(false);
    expect(items.some((i) => i.sourceModule === "DOCUMENTS")).toBe(false);
    expect(items.some((i) => i.sourceModule === "APPROVALS")).toBe(false);
    expect(items.some((i) => i.sourceModule === "PAYROLL_EXPORT")).toBe(true);

    const exportItem = items.find((i) => i.sourceModule === "PAYROLL_EXPORT")!;
    expect(exportItem.verb).toBe("Clear 3 blockers");
    expect(exportItem.href).toContain("/attendance/exceptions?status=OPEN&severity=CRITICAL");
    expect(exportItem.href).toContain("start=2026-08-26");
    expect(exportItem.href).toContain("end=2026-09-25");
  });

  it("builds attendance capture row with deep link for single site", () => {
    const attendanceUser = makeUser({ "/attendance": ["view"] });
    const items = buildTodayWorkItems({
      user: attendanceUser,
      dashboard: sampleDashboard,
      captureOverview: {
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        captureThrough: "2026-09-20",
        asOfDate: "2026-09-20",
        summary: { totalSites: 1, needsCapture: 1, caughtUp: 0, noShifts: 0, pendingDayRows: 2, pendingNightRows: 0 },
        sites: [
          {
            siteId: "site-sandton-4",
            siteName: "Sandton City Main",
            status: "needs_capture",
            dueDays: 1,
            pendingRows: 2,
            pendingDayRows: 2,
            pendingNightRows: 0,
            reviewedRows: 0,
            lastCapturedDate: "2026-09-19",
            timesheetStatus: "draft",
          },
        ],
      },
      currentShift: "day",
    });

    const captureItem = items.find((i) => i.id === "attendance-capture");
    expect(captureItem).toBeDefined();
    expect(captureItem?.verb).toBe("Confirm 1 site");
    expect(captureItem?.href).toBe("/attendance?siteId=site-sandton-4");
    expect(captureItem?.badge).toBe("day shift");
  });

  it("builds roster attention row for rostering controller", () => {
    const rosterUser = makeUser({ "/rostering": ["view"] });
    const items = buildTodayWorkItems({
      user: rosterUser,
      dashboard: sampleDashboard,
      rosterOverview: {
        summary: { total: 3, running: 2, needsAttention: 1, paused: 0, notSetup: 0 },
        permissions: { canManageBaseline: true, canManageExceptions: true, canUseAdvancedEditor: true },
        sites: [
          {
            siteId: "site-hq",
            siteName: "Corporate HQ",
            state: "needs_attention",
            maintainedThrough: "2026-09-25",
            lastReconciledAt: null,
            lastStatus: null,
            guardCount: 4,
            issueCount: 1,
            criticalIssueCount: 1,
            activePatternName: "Standard 4-on-4-off",
            calendar: { id: "cal-1", name: "26-25", startDay: 26, endDay: 25 },
            nextIssue: null,
          },
        ],
      },
    });

    const rosterItem = items.find((i) => i.id === "roster-attention");
    expect(rosterItem).toBeDefined();
    expect(rosterItem?.verb).toBe("Fix 1 roster");
    expect(rosterItem?.href).toBe("/rostering/sites/site-hq");
  });

  it("includes critical incidents when user has capability", () => {
    const opsUser = makeUser({ "/incidents": ["view"] });
    const items = buildTodayWorkItems({
      user: opsUser,
      dashboard: {
        ...sampleDashboard,
        openCriticalIncidents: 2,
      },
    });

    const incidentItem = items.find((i) => i.id === "critical-incidents");
    expect(incidentItem).toBeDefined();
    expect(incidentItem?.priority).toBe("CRITICAL");
    expect(incidentItem?.verb).toBe("Review 2 incidents");
    expect(incidentItem?.href).toBe("/incidents?severity=CRITICAL");
  });
});
