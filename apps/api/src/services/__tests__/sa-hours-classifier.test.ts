import { describe, expect, it } from "vitest";
import {
  buildEffectiveHolidaySet,
  DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
  getNightAllowanceRateForDate,
  getStatutorySaPublicHolidays,
  hasMinimumPsiraGrade,
  parseLabourComplianceSettings,
} from "../../lib/sa-labour-rules.config.js";
import { classifyEmployeePeriodShifts, computeNightWindowMinutes } from "../sa-hours-classifier.service.js";

function sastDate(isoLocal: string): Date {
  // isoLocal e.g. "2026-04-06T06:00:00" in SAST (UTC+2)
  return new Date(`${isoLocal}+02:00`);
}

describe("sa-hours-classifier.service (South African NBCPSS + BCEA compliance)", () => {
  it("computes statutory SA public holidays including Easter and Sunday->Monday observed rollover", () => {
    // 2026: Day of Goodwill (Dec 26) is Saturday, Freedom Day (Apr 27) Mon, Aug 9 (National Women's Day) is Sunday -> Aug 10 Observed!
    const holidays2026 = getStatutorySaPublicHolidays(2026);
    const byDate = new Map(holidays2026.map((h) => [h.dateKey, h]));

    expect(byDate.get("2026-04-03")?.name).toBe("Good Friday");
    expect(byDate.get("2026-04-06")?.name).toBe("Family Day");
    expect(byDate.get("2026-08-09")?.name).toBe("National Women's Day");
    expect(byDate.get("2026-08-10")).toMatchObject({
      name: "National Women's Day (Observed)",
      isObservedMonday: true,
    });
  });

  it("applies the R8.00 night shift allowance from 2026-03-01 and R6.00 prior", () => {
    expect(getNightAllowanceRateForDate("2026-02-28")).toBe(6);
    expect(getNightAllowanceRateForDate("2026-03-01")).toBe(8);
  });

  it("validates PSIRA grade hierarchy A > B > C > D > E", () => {
    expect(hasMinimumPsiraGrade("B", "C")).toBe(true);
    expect(hasMinimumPsiraGrade("C", "C")).toBe(true);
    expect(hasMinimumPsiraGrade("D", "C")).toBe(false);
    expect(hasMinimumPsiraGrade(null, "C")).toBe(false);
    expect(hasMinimumPsiraGrade("E", null)).toBe(true);
  });

  it("caps security officer ordinary Mon-Sat hours at 48h/week across multiple sites and spills excess into 1.5x overtime", () => {
    // Same guard works Mon, Tue, Wed, Thu (12h each = 48h) at Site A, plus Friday 12h at Site B = 60h total
    const shifts = [
      { id: "mon", employeeId: "g1", siteId: "siteA", startTime: sastDate("2026-04-06T06:00:00"), endTime: sastDate("2026-04-06T18:00:00"), isScheduledOnRoster: true }, // Mon is Family Day? Wait: test non-holiday week: Apr 13 Mon..Apr 17 Fri
    ];
    void shifts;

    const nonHolidayShifts = [
      { id: "mon", employeeId: "g1", siteId: "siteA", startTime: sastDate("2026-04-13T06:00:00"), endTime: sastDate("2026-04-13T18:00:00"), isScheduledOnRoster: true },
      { id: "tue", employeeId: "g1", siteId: "siteA", startTime: sastDate("2026-04-14T06:00:00"), endTime: sastDate("2026-04-14T18:00:00"), isScheduledOnRoster: true },
      { id: "wed", employeeId: "g1", siteId: "siteA", startTime: sastDate("2026-04-15T06:00:00"), endTime: sastDate("2026-04-15T18:00:00"), isScheduledOnRoster: true },
      { id: "thu", employeeId: "g1", siteId: "siteA", startTime: sastDate("2026-04-16T06:00:00"), endTime: sastDate("2026-04-16T18:00:00"), isScheduledOnRoster: true },
      { id: "fri", employeeId: "g1", siteId: "siteB", startTime: sastDate("2026-04-17T06:00:00"), endTime: sastDate("2026-04-17T18:00:00"), isScheduledOnRoster: true },
    ];

    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts: nonHolidayShifts,
      holidays: buildEffectiveHolidaySet([2026]),
      settings: DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
    });

    expect(summary.totalWorkedHours).toBe(60);
    expect(summary.basicHours).toBe(48);
    expect(summary.overtimeHours).toBe(12);
    expect(summary.flags.some((f) => f.code === "WEEKLY_OT_CAP_EXCEEDED")).toBe(true);
  });

  it("counts prior-week carryover shifts before a Saturday 26th cycle boundary toward that week's 48h cap", () => {
    // Apr 2026: Mon Apr 20..Thu Apr 23 (carryover context, 4x12h=48h), plus Sat Apr 25 / no Apr 26 is Sun so test Mar 2026:
    // Mon Mar 23, Tue Mar 24, Wed Mar 25 = carryover 36h; Thu Mar 26 (cycle day 1), Fri Mar 27 = 24h in period.
    // Expected for Thu+Fri: first 12h completes the week's 48h cap, final 12h overflows into overtime!
    const holidays = new Map();
    const shifts = [
      { id: "c1", employeeId: "g1", startTime: sastDate("2026-03-23T06:00:00"), endTime: sastDate("2026-03-23T18:00:00"), isCarryoverContextOnly: true },
      { id: "c2", employeeId: "g1", startTime: sastDate("2026-03-24T06:00:00"), endTime: sastDate("2026-03-24T18:00:00"), isCarryoverContextOnly: true },
      { id: "c3", employeeId: "g1", startTime: sastDate("2026-03-25T06:00:00"), endTime: sastDate("2026-03-25T18:00:00"), isCarryoverContextOnly: true },
      { id: "p1", employeeId: "g1", startTime: sastDate("2026-03-26T06:00:00"), endTime: sastDate("2026-03-26T18:00:00"), isCarryoverContextOnly: false },
      { id: "p2", employeeId: "g1", startTime: sastDate("2026-03-27T06:00:00"), endTime: sastDate("2026-03-27T18:00:00"), isCarryoverContextOnly: false },
    ];

    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts,
      holidays,
      settings: DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
    });

    expect(summary.totalWorkedHours).toBe(24);
    expect(summary.basicHours).toBe(12);
    expect(summary.overtimeHours).toBe(12);
  });

  it("distinguishes scheduled Sunday (1.5x) from unscheduled Sunday reliever call-in (2.0x)", () => {
    const holidays = new Map();
    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts: [
        {
          id: "sun-sched",
          employeeId: "g1",
          startTime: sastDate("2026-04-12T06:00:00"),
          endTime: sastDate("2026-04-12T18:00:00"),
          isScheduledOnRoster: true,
        },
        {
          id: "sun-unsched",
          employeeId: "g1",
          startTime: sastDate("2026-04-19T06:00:00"),
          endTime: sastDate("2026-04-19T18:00:00"),
          isScheduledOnRoster: false,
        },
      ],
      holidays,
      settings: { ...DEFAULT_LABOUR_COMPLIANCE_SETTINGS, sundayDoubleRateSplit: true },
    });

    expect(summary.sundayHours).toBe(12);
    expect(summary.sundayDoubleHours).toBe(12);
    expect(summary.flags.some((f) => f.code === "SUNDAY_UNSCHEDULED_2X")).toBe(true);
  });

  it("awards night shift count & R8.00 allowance only when >= 50% of shift falls in 18:00-06:00", () => {
    expect(computeNightWindowMinutes(sastDate("2026-04-13T18:00:00"), sastDate("2026-04-14T06:00:00"))).toBe(720);
    expect(computeNightWindowMinutes(sastDate("2026-04-13T08:00:00"), sastDate("2026-04-13T20:00:00"))).toBe(120);

    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts: [
        // 18:00-06:00 -> 100% night -> qualifies (count 1, R8)
        { id: "n1", employeeId: "g1", startTime: sastDate("2026-04-13T18:00:00"), endTime: sastDate("2026-04-14T06:00:00") },
        // 08:00-20:00 -> 2h / 12h = 16.7% night -> does NOT qualify as night shift count, still logs 2h nightShiftHours
        { id: "d1", employeeId: "g1", startTime: sastDate("2026-04-15T08:00:00"), endTime: sastDate("2026-04-15T20:00:00") },
      ],
      holidays: new Map(),
      settings: DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
    });

    expect(summary.nightShiftCount).toBe(1);
    expect(summary.nightShiftHours).toBe(14);
    expect(summary.nightAllowanceTotalRand).toBe(8);
  });

  it("supports midnight_split boundary mode when a shift crosses into a public holiday", () => {
    // Sunday Apr 26 18:00 -> Mon Apr 27 (Freedom Day) 06:00
    const holidays = buildEffectiveHolidaySet([2026]);
    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts: [
        {
          id: "cross",
          employeeId: "g1",
          startTime: sastDate("2026-04-26T18:00:00"),
          endTime: sastDate("2026-04-27T06:00:00"),
          isScheduledOnRoster: true,
        },
      ],
      holidays,
      settings: parseLabourComplianceSettings({ overnightBoundaryMode: "midnight_split" }),
    });

    expect(summary.sundayHours).toBe(6);
    expect(summary.publicHolidayHours).toBe(6);
  });

  it("supports BCEA s12 averaging across weeks and deducts unpaid meal intervals when configured", () => {
    const settings = parseLabourComplianceSettings({ averagingEnabled: true, averagingWeeks: 4 });
    // 5 shifts x 12h = 60h in week 1, 3 shifts x 12h = 36h in week 2 (96h total <= 96h cap over 2 weeks)
    const shifts = [
      { id: "w1-1", employeeId: "g1", startTime: sastDate("2026-04-13T06:00:00"), endTime: sastDate("2026-04-13T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w1-2", employeeId: "g1", startTime: sastDate("2026-04-14T06:00:00"), endTime: sastDate("2026-04-14T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w1-3", employeeId: "g1", startTime: sastDate("2026-04-15T06:00:00"), endTime: sastDate("2026-04-15T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w1-4", employeeId: "g1", startTime: sastDate("2026-04-16T06:00:00"), endTime: sastDate("2026-04-16T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w1-5", employeeId: "g1", startTime: sastDate("2026-04-17T06:00:00"), endTime: sastDate("2026-04-17T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w2-1", employeeId: "g1", startTime: sastDate("2026-04-20T06:00:00"), endTime: sastDate("2026-04-20T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w2-2", employeeId: "g1", startTime: sastDate("2026-04-21T06:00:00"), endTime: sastDate("2026-04-21T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
      { id: "w2-3", employeeId: "g1", startTime: sastDate("2026-04-22T06:00:00"), endTime: sastDate("2026-04-22T18:00:00"), mealIntervalPaid: false, mealIntervalMinutes: 60 },
    ];

    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts,
      holidays: new Map(),
      settings,
    });

    // 8 shifts * 11 net hours (60m unpaid meal break deducted per shift) = 88h all ordinary!
    expect(summary.totalWorkedHours).toBe(88);
    expect(summary.basicHours).toBe(88);
    expect(summary.overtimeHours).toBe(0);
  });

  it("flags insufficient daily rest (<12h) and expired PSIRA registration", () => {
    const summary = classifyEmployeePeriodShifts({
      employeeId: "g1",
      shifts: [
        { id: "s1", employeeId: "g1", startTime: sastDate("2026-04-13T06:00:00"), endTime: sastDate("2026-04-13T18:00:00") },
        // Starts at 04:00 next morning -> only 10h gap!
        { id: "s2", employeeId: "g1", startTime: sastDate("2026-04-14T04:00:00"), endTime: sastDate("2026-04-14T16:00:00") },
      ],
      holidays: new Map(),
      settings: DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
      employeeCredentials: {
        psiraRegistrationExpiry: sastDate("2026-04-01T00:00:00"),
      },
    });

    expect(summary.flags.some((f) => f.code === "DAILY_REST_UNDER_12H")).toBe(true);
    expect(summary.flags.some((f) => f.code === "PSIRA_EXPIRED")).toBe(true);
  });

  it("caps general staff daily ordinary hours at 9h (spilling excess to overtime) and enforces daily cap across midnight_split segments", () => {
    const generalSummary = classifyEmployeePeriodShifts({
      employeeId: "gen-1",
      defaultCategory: "general",
      shifts: [
        {
          id: "gs1",
          employeeId: "gen-1",
          startTime: sastDate("2026-04-13T08:00:00"),
          endTime: sastDate("2026-04-13T19:00:00"), // 11h worked -> 9h basic + 2h OT
        },
      ],
      holidays: new Map(),
      settings: DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
    });
    expect(generalSummary.basicHours).toBe(9);
    expect(generalSummary.overtimeHours).toBe(2);

    // Security officer working 14h overnight under midnight_split: 12h ordinary cap per shift, 2h overtime
    const splitSummary = classifyEmployeePeriodShifts({
      employeeId: "g-split",
      shifts: [
        {
          id: "sp1",
          employeeId: "g-split",
          startTime: sastDate("2026-04-13T18:00:00"),
          endTime: sastDate("2026-04-14T08:00:00"), // 14h shift -> 12h ordinary + 2h OT
        },
      ],
      holidays: new Map(),
      settings: parseLabourComplianceSettings({ overnightBoundaryMode: "midnight_split" }),
    });
    expect(splitSummary.basicHours).toBe(12);
    expect(splitSummary.overtimeHours).toBe(2);
  });

  it("spills hours exceeding BCEA s12 multi-week averaging cap into overtime", () => {
    const settings = parseLabourComplianceSettings({ averagingEnabled: true, averagingWeeks: 2 });
    // 2 active weeks * 48h = 96h ordinary cap; 9 shifts * 12h = 108h -> 96h basic/sunday + 12h OT
    const shifts = [
      "2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17",
      "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23",
    ].map((d, idx) => ({
      id: `av-${idx}`,
      employeeId: "g-avg",
      startTime: sastDate(`${d}T06:00:00`),
      endTime: sastDate(`${d}T18:00:00`),
    }));

    const summary = classifyEmployeePeriodShifts({
      employeeId: "g-avg",
      shifts,
      holidays: new Map(),
      settings,
    });
    expect(summary.basicHours).toBe(96);
    expect(summary.overtimeHours).toBe(12);
  });
});
