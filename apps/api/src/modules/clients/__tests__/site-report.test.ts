import { describe, expect, it } from "vitest";
import {
  buildSiteMonthReport,
  isTimesheetApproved,
  monthPeriod,
  periodEndExclusive,
  periodFromRange,
  resolvePeriod,
  resolveReportRecipients,
  type SiteMonthReport,
  type TimesheetSnapshot,
} from "../site-report.service.js";

describe("monthPeriod", () => {
  it("covers a whole 31-day month", () => {
    expect(monthPeriod("2026-01")).toMatchObject({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      label: "January 2026",
    });
  });

  it("ends on the 29th in a leap February", () => {
    expect(monthPeriod("2028-02").periodEnd).toBe("2028-02-29");
  });

  it("ends on the 28th in a non-leap February", () => {
    expect(monthPeriod("2027-02").periodEnd).toBe("2027-02-28");
  });

  it("does not roll into the next year on December", () => {
    expect(monthPeriod("2026-12")).toMatchObject({
      periodStart: "2026-12-01",
      periodEnd: "2026-12-31",
    });
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => monthPeriod("2026-13")).toThrow();
    expect(() => monthPeriod("2026-00")).toThrow();
    expect(() => monthPeriod("2026-1")).toThrow();
    expect(() => monthPeriod("")).toThrow();
    expect(() => monthPeriod("2026-01-01")).toThrow();
  });

  it("is UTC-stable — the boundary days never drift with the host timezone", () => {
    for (let m = 1; m <= 12; m += 1) {
      const key = `2026-${String(m).padStart(2, "0")}`;
      const period = monthPeriod(key);
      expect(period.periodStart).toBe(`${key}-01`);
      expect(period.periodStart.slice(0, 7)).toBe(key);
      expect(period.periodEnd.slice(0, 7)).toBe(key);
    }
  });
});

describe("periodEndExclusive", () => {
  it("is midnight on the day after the last day, so evening rows are not lost", () => {
    expect(periodEndExclusive(monthPeriod("2026-01")).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z"
    );
  });
});

describe("periodFromRange / resolvePeriod", () => {
  it("supports a payroll cycle that is not a calendar month", () => {
    const period = periodFromRange("2026-06-26", "2026-07-25");
    expect(period.month).toBeNull();
    expect(period.label).toBe("2026-06-26 to 2026-07-25");
  });

  it("rejects an inverted range", () => {
    expect(() => periodFromRange("2026-07-25", "2026-06-26")).toThrow();
  });

  it("prefers an explicit range over the month", () => {
    const period = resolvePeriod({
      month: "2026-01",
      periodStart: "2026-06-26",
      periodEnd: "2026-07-25",
    });
    expect(period.periodStart).toBe("2026-06-26");
  });

  it("requires one of the two forms", () => {
    expect(() => resolvePeriod({})).toThrow();
    expect(() => resolvePeriod({ periodStart: "2026-06-26" })).toThrow();
  });
});

describe("isTimesheetApproved", () => {
  it("treats locked as approved and everything else as not", () => {
    expect(isTimesheetApproved("approved")).toBe(true);
    expect(isTimesheetApproved("locked")).toBe(true);
    expect(isTimesheetApproved("draft")).toBe(false);
    expect(isTimesheetApproved("none")).toBe(false);
  });
});

describe("resolveReportRecipients", () => {
  it("uses the explicit list when present", () => {
    expect(
      resolveReportRecipients({
        reportRecipients: ["ops@client.co.za", "fin@client.co.za"],
        billingEmail: "billing@client.co.za",
        email: "info@client.co.za",
      })
    ).toEqual(["ops@client.co.za", "fin@client.co.za"]);
  });

  it("falls back to billing email, then the primary email", () => {
    expect(
      resolveReportRecipients({ reportRecipients: [], billingEmail: "billing@x.co", email: "info@x.co" })
    ).toEqual(["billing@x.co"]);
    expect(resolveReportRecipients({ reportRecipients: [], billingEmail: null, email: "info@x.co" })).toEqual([
      "info@x.co",
    ]);
  });

  it("returns nothing rather than an empty string when no address exists", () => {
    expect(resolveReportRecipients({ reportRecipients: [], billingEmail: null, email: null })).toEqual([]);
  });
});

// ——— buildSiteMonthReport ———

const site = {
  id: "site-1",
  name: "Acme North Gate",
  physicalAddress: "12 Main Rd",
  serviceType: "Static guarding",
  contactPersonName: "Thandi",
  contactPersonPhone: "0821112222",
  clientContactEmail: "ops@acme.co.za",
  supervisorName: "Sipho",
};

function row(overrides: Partial<TimesheetSnapshot["rows"][number]>): TimesheetSnapshot["rows"][number] {
  return {
    id: "row-1",
    workDate: "2026-07-01",
    dayOfWeek: "Wed",
    plannedGuardId: "e1",
    plannedGuardName: "Guard One",
    actualGuardId: "e1",
    actualGuardName: "Guard One",
    employeeNumber: "E001",
    psiraRegistrationNumber: null,
    plannedShiftCode: "D",
    plannedShiftType: "day",
    actualShiftCode: "D",
    actualShiftType: "day",
    clockIn: "2026-07-01T06:00:00.000Z",
    clockOut: "2026-07-01T18:00:00.000Z",
    hoursWorked: 12,
    overtimeHours: 0,
    attendanceStatus: "present",
    approvalStatus: "confirmed",
    dutyOnObNumber: "OB1",
    dutyOffObNumber: "OB2",
    occurrenceBookNumber: "OB1",
    comments: null,
    discrepancyCodes: [],
    ...overrides,
  } as TimesheetSnapshot["rows"][number];
}

function sheet(overrides: Partial<TimesheetSnapshot> = {}): TimesheetSnapshot {
  return {
    id: "ts-1",
    siteId: "site-1",
    siteName: "Acme North Gate",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "draft",
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    approvalNotes: null,
    rows: [],
    totals: {
      dayShifts: 0,
      nightShifts: 0,
      relieverShifts: 0,
      absences: 0,
      totalHours: 0,
      overtimeHours: 0,
      discrepancies: 0,
    },
    ...overrides,
  } as TimesheetSnapshot;
}

function build(timesheet: TimesheetSnapshot): SiteMonthReport {
  return buildSiteMonthReport({
    site,
    period: monthPeriod("2026-07"),
    timesheet,
    incidents: [],
    exceptions: {
      total: 0,
      lateArrivals: 0,
      missedClockIns: 0,
      missedClockOuts: 0,
      earlyDepartures: 0,
      absences: 0,
      openCritical: 0,
    },
  });
}

describe("buildSiteMonthReport", () => {
  it("lists only rows marked absent", () => {
    const report = build(
      sheet({
        rows: [
          row({ id: "a", attendanceStatus: "present" }),
          row({ id: "b", workDate: "2026-07-02", attendanceStatus: "absent", plannedGuardName: "Guard Two" }),
          row({ id: "c", workDate: "2026-07-03", attendanceStatus: "reliever" }),
        ],
      })
    );
    expect(report.absences).toHaveLength(1);
    expect(report.absences[0]).toMatchObject({ workDate: "2026-07-02", guardName: "Guard Two" });
  });

  it("lists only rows carrying discrepancy codes", () => {
    const report = build(
      sheet({
        rows: [
          row({ id: "a", discrepancyCodes: [] }),
          row({ id: "b", workDate: "2026-07-04", discrepancyCodes: ["NO_CLOCK_OUT", "SHORT_HOURS"] }),
        ],
      })
    );
    expect(report.discrepancies).toEqual([
      { workDate: "2026-07-04", guardName: "Guard One", codes: ["NO_CLOCK_OUT", "SHORT_HOURS"] },
    ]);
  });

  it("passes the timesheet totals through untouched", () => {
    const totals = {
      dayShifts: 20,
      nightShifts: 11,
      relieverShifts: 2,
      absences: 3,
      totalHours: 372.5,
      overtimeHours: 8.25,
      discrepancies: 1,
    };
    expect(build(sheet({ totals })).timesheet.totals).toEqual(totals);
  });

  it("warns when the timesheet is not approved", () => {
    expect(build(sheet({ status: "draft" })).warnings).toContain("Timesheet has not been approved yet");
    expect(build(sheet({ status: "approved" })).warnings).not.toContain(
      "Timesheet has not been approved yet"
    );
  });

  it("warns about unresolved discrepancies", () => {
    const report = build(
      sheet({
        status: "approved",
        rows: [row({})],
        totals: {
          dayShifts: 1,
          nightShifts: 0,
          relieverShifts: 0,
          absences: 0,
          totalHours: 12,
          overtimeHours: 0,
          discrepancies: 2,
        },
      })
    );
    expect(report.warnings).toContain("2 row(s) have unresolved discrepancies");
  });

  it("produces a valid zeroed report for an empty month", () => {
    const report = build(sheet({ status: "approved" }));
    expect(report.timesheet.rowCount).toBe(0);
    expect(report.absences).toEqual([]);
    expect(report.discrepancies).toEqual([]);
    expect(report.incidents).toEqual([]);
    expect(report.warnings).toContain("No timesheet rows captured for this period");
    expect(report.site.name).toBe("Acme North Gate");
  });
});
