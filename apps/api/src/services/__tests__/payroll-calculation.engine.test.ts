import { describe, expect, it } from "vitest";
import type { EarningsRule, Employee, PayGrade } from "@prisma/client";
import {
  buildPayrollCalculationSnapshot,
  computePayrollLines,
  DEFAULT_OT_MULTIPLIER,
  DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
  DEFAULT_SUNDAY_MULTIPLIER,
  monthlySalaryForPayPeriod,
  PayrollCalculationPricingError,
  validateComputedPayrollLines,
  type PayrollCalculationContext,
  type PayrollDeductionResult,
} from "../payroll-calculation.engine.js";
import type { TimesheetAggregate } from "../timesheet.service.js";

function baseEmployee(overrides: Partial<Employee> & { grade?: PayGrade | null }): Employee & {
  grade: PayGrade | null;
} {
  return {
    id: "emp-1",
    companyId: "co-1",
    firstName: "Test",
    lastName: "Guard",
    employeeNumber: "G001",
    status: "active",
    employeeType: "security_officer",
    groupId: null,
    siteId: "site-a",
    postId: "post-1",
    gradeId: null,
    hourlyRate: null,
    monthlySalary: null,
    dateOfBirth: new Date("1990-01-01"),
    grade: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Employee & { grade: PayGrade | null };
}

function ctx(overrides: Partial<PayrollCalculationContext>): PayrollCalculationContext {
  return {
    payrollRunId: "run-1",
    companyId: "co-1",
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    periodEnd: new Date("2026-05-31T23:59:59.999Z"),
    payPeriod: "monthly",
    isSdlLiable: false,
    timezone: "Africa/Johannesburg",
    publicHolidayDates: ["2026-05-01"],
    companyPayRules: new Map(),
    companyEarningsRules: [],
    groupPayRulesByGroup: new Map(),
    groupEarningsByGroup: new Map(),
    aggregates: new Map(),
    employees: [],
    deductionsByEmployee: new Map(),
    ...overrides,
  };
}

function agg(partial: Partial<TimesheetAggregate>): TimesheetAggregate {
  return {
    employeeId: "emp-1",
    basicHours: 0,
    overtimeHours: 0,
    sundayHours: 0,
    publicHolidayHours: 0,
    leaveDays: 0,
    leaveHours: 0,
    ...partial,
  };
}

describe("computePayrollLines", () => {
  it("calculates hourly basic, overtime, Sunday, and public holiday pay with multipliers", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: {
        id: "g1",
        companyId: "co-1",
        name: "Grade A",
        hourlyRate: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PayGrade,
    });
    const aggregates = new Map([
      [
        "emp-1",
        agg({
          basicHours: 160,
          overtimeHours: 10,
          sundayHours: 8,
          publicHolidayHours: 12,
        }),
      ],
    ]);
    const companyPayRules = new Map([
      ["overtime", 1.5],
      ["sunday", 2],
      ["public_holiday", 2],
    ]);

    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates,
        companyPayRules,
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );

    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.basePay).toBe(16000);
    expect(line.overtimePay).toBe(1500);
    expect(line.sundayPay).toBe(1600);
    expect(line.publicHolidayPay).toBe(2400);
    expect(line.grossPay).toBe(21500);
  });

  it("uses office monthly salary without timesheet hours", () => {
    const emp = baseEmployee({
      employeeType: "general",
      monthlySalary: 25000,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.grossPay).toBe(25000);
    expect(lines[0]!.hoursWorked).toBe(0);
  });

  it("pays overtime, Sunday, and public holiday premiums on top of a fixed monthly salary", () => {
    const emp = baseEmployee({
      employeeType: "security_officer",
      monthlySalary: 20800,
    });
    const aggregates = new Map([
      [
        "emp-1",
        agg({
          overtimeHours: 10,
          sundayHours: 8,
          publicHolidayHours: 12,
        }),
      ],
    ]);

    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates,
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );

    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    // effective hourly rate = 20800 / 208 standard monthly hours = 100
    expect(line.overtimePay).toBe(1500); // 10 * 100 * 1.5
    expect(line.sundayPay).toBe(1600); // 8 * 100 * 2.0
    expect(line.publicHolidayPay).toBe(2400); // 12 * 100 * 2.0
    expect(line.grossPay).toBe(26300); // 20800 + 1500 + 1600 + 2400
    expect(line.earningsLines.map((l) => l.name)).toEqual(
      expect.arrayContaining(["Overtime", "Sunday", "Public Holiday"])
    );
  });

  it("prorates contractual monthly salary for weekly and biweekly runs", () => {
    expect(monthlySalaryForPayPeriod(26_000, "weekly")).toBe(6_000);
    expect(monthlySalaryForPayPeriod(26_000, "biweekly")).toBe(12_000);

    const emp = baseEmployee({
      employeeType: "general",
      monthlySalary: 26_000,
    });
    const weekly = computePayrollLines(
      ctx({
        payPeriod: "weekly",
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    const biweekly = computePayrollLines(
      ctx({
        payPeriod: "biweekly",
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );

    expect(weekly.lines[0]!.grossPay).toBe(6_000);
    expect(biweekly.lines[0]!.grossPay).toBe(12_000);
  });

  it("uses monthly salary without timesheet hours when employeeType is security", () => {
    const emp = baseEmployee({
      employeeType: "security_officer",
      monthlySalary: 18000,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.grossPay).toBe(18000);
    expect(lines[0]!.hoursWorked).toBe(0);
  });

  it("skips office employee without monthly salary (missing_monthly_salary)", () => {
    const emp = baseEmployee({
      employeeType: "general",
      monthlySalary: null,
    });
    const { employeeSnapshots } = computePayrollLines(ctx({ employees: [emp] }));
    expect(employeeSnapshots[0]!.output.skipped).toBe(true);
    expect(employeeSnapshots[0]!.output.skipReason).toBe("missing_monthly_salary");
  });

  it("skips hourly employee with missing pay grade and no rate (missing_pay_rate)", () => {
    const emp = baseEmployee({ hourlyRate: null, grade: null });
    const { employeeSnapshots } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 40 })]]),
      })
    );
    expect(employeeSnapshots[0]!.output.skipped).toBe(true);
    expect(employeeSnapshots[0]!.output.skipReason).toBe("missing_pay_rate");
  });

  it("skips hourly employee with no timesheet hours", () => {
    const emp = baseEmployee({
      hourlyRate: 80,
      grade: { id: "g1", name: "B", hourlyRate: 80, companyId: "co-1" } as PayGrade,
    });
    const { employeeSnapshots } = computePayrollLines(ctx({ employees: [emp] }));
    expect(employeeSnapshots[0]!.output.skipped).toBe(true);
    expect(employeeSnapshots[0]!.output.skipReason).toBe("no_timesheet_hours");
  });

  it("includes suspended employees when in payroll employee set", () => {
    const emp = baseEmployee({
      status: "suspended",
      hourlyRate: 50,
      grade: { id: "g1", name: "C", hourlyRate: 50, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 8 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.basePay).toBe(400);
  });

  it("captures employee site/post context in snapshot", () => {
    const emp = {
      ...baseEmployee({
        employeeType: "general",
        monthlySalary: 10000,
      }),
      siteAssignments: [{ siteId: "site-mid" }],
      guardSiteEligibilities: [{ sitePostId: "post-mid" }],
    };
    const { employeeSnapshots } = computePayrollLines(
      ctx({
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(employeeSnapshots[0]!.context.siteId).toBe("site-mid");
    expect(employeeSnapshots[0]!.context.postId).toBe("post-mid");
  });

  it("produces identical outputs for identical context (repeatability)", () => {
    const emp = baseEmployee({
      hourlyRate: 75,
      grade: { id: "g1", name: "D", hourlyRate: 75, companyId: "co-1" } as PayGrade,
    });
    const baseCtx = ctx({
      employees: [emp],
      aggregates: new Map([["emp-1", agg({ basicHours: 40, overtimeHours: 5 })]]),
      companyPayRules: new Map([["overtime", DEFAULT_OT_MULTIPLIER]]),
      deductionsByEmployee: new Map<string, PayrollDeductionResult>([
        ["emp-1", { total: 100, lines: [{ name: "Pension", amount: 100 }] }],
      ]),
    });
    const first = computePayrollLines(baseCtx);
    const second = computePayrollLines(baseCtx);
    expect(first.lines).toEqual(second.lines);
  });

  it("builds snapshot with totals and default multipliers", () => {
    const emp = baseEmployee({
      employeeType: "general",
      monthlySalary: 5000,
    });
    const calculationCtx = ctx({
      employees: [emp],
      deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
    });
    const { lines, employeeSnapshots } = computePayrollLines(calculationCtx);
    const snapshot = buildPayrollCalculationSnapshot({
      ctx: calculationCtx,
      employeeSnapshots,
      lines,
      calculatedAt: new Date("2026-05-15T12:00:00.000Z"),
      sdlStatus: {
        isLiable: false,
        liableFrom: null,
        rolling12MonthPayroll: 0,
        projectedRolling12Month: 5000,
        threshold: 500000,
        includeRelieversWithAttendance: true,
      },
    });
    expect(snapshot.version).toBe("2.0.0");
    expect(snapshot.totals.grossPay).toBe(5000);
    expect(snapshot.inputs.defaultMultipliers).toEqual({
      overtime: DEFAULT_OT_MULTIPLIER,
      sunday: DEFAULT_SUNDAY_MULTIPLIER,
      public_holiday: DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
    });
  });

  it("applies group pay rules when employee has groupId", () => {
    const emp = baseEmployee({
      groupId: "grp-1",
      hourlyRate: 100,
      grade: { id: "g1", name: "E", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const groupPayRulesByGroup = new Map([
      ["grp-1", new Map([["overtime", 2]])],
    ]);
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ overtimeHours: 10, basicHours: 0 })]]),
        groupPayRulesByGroup,
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.overtimePay).toBe(2000);
  });

  it("applies percentage earnings rule on base pay", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: { id: "g1", name: "F", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const earningsRule = {
      id: "er-1",
      companyId: "co-1",
      name: "Shift Allowance",
      type: "percentage",
      rate: 10,
      amount: null,
      appliesTo: "security_officer",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EarningsRule;

    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 100 })]]),
        companyEarningsRules: [earningsRule],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.grossPay).toBe(11000);
  });

  it("uses actual leave hours for partial-day leave pay", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: { id: "g1", name: "Partial", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ leaveHours: 4, leaveDays: 0.5 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.hoursWorked).toBe(4);
    expect(lines[0]!.basePay).toBe(400);
  });

  it("applies fixed tax directive rate when configured on employee", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      taxDirectiveRate: 25 as unknown as Employee["taxDirectiveRate"],
      taxDirectiveNumber: "DIR-123",
      grade: { id: "g1", name: "Tax", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 100 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.tax).toBe(2500);
  });

  it("pays hourly guard for approved leave days without attendance", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: { id: "g1", name: "Leave", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ leaveDays: 2, leaveHours: 16 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.hoursWorked).toBe(16);
    expect(lines[0]!.basePay).toBe(1600);
    expect(lines[0]!.grossPay).toBe(1600);
  });

  it("adds paid leave on top of worked hours in the same period", () => {
    const emp = baseEmployee({
      hourlyRate: 50,
      grade: { id: "g1", name: "Mixed", hourlyRate: 50, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 40, leaveDays: 1, leaveHours: 8 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.basePay).toBe(2400);
    expect(lines[0]!.hoursWorked).toBe(48);
  });

  it("does not pay an hourly employee for authorised unpaid leave", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: { id: "g1", name: "Hourly", hourlyRate: 100, companyId: "co-1" } as PayGrade,
    });
    const { lines } = computePayrollLines(ctx({
      employees: [emp],
      aggregates: new Map([["emp-1", agg({ unpaidLeaveHours: 12 })]]),
      deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
    }));
    expect(lines).toHaveLength(0);
  });

  it("reduces fixed monthly salary once for authorised unpaid leave", () => {
    const emp = baseEmployee({
      employeeType: "general",
      monthlySalary: 19_500 as unknown as Employee["monthlySalary"],
      hourlyRate: null,
    });
    const { lines } = computePayrollLines(ctx({
      employees: [emp],
      aggregates: new Map([["emp-1", agg({ unpaidLeaveHours: 8 })]]),
      deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
    }));
    expect(lines[0]!.grossPay).toBe(18_700);
    expect(lines[0]!.earningsLines).toContainEqual({ name: "Unpaid Leave Reduction", amount: -800 });
  });

  it("keeps UIF-supported leave distinct from ordinary unpaid leave", () => {
    const emp = baseEmployee({ employeeType: "general", monthlySalary: 19_500 as unknown as Employee["monthlySalary"], hourlyRate: null });
    const { lines } = computePayrollLines(ctx({
      employees: [emp],
      aggregates: new Map([["emp-1", agg({ uifLeaveHours: 8 })]]),
      deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
    }));
    expect(lines[0]!.grossPay).toBe(18_700);
    expect(lines[0]!.earningsLines).toContainEqual({ name: "UIF-supported Leave Reduction", amount: -800 });
    expect(lines[0]!.earningsLines).not.toContainEqual({ name: "Unpaid Leave Reduction", amount: -800 });
  });

  it("computes net pay as gross minus deductions, PAYE, and UIF", () => {
    const emp = baseEmployee({
      hourlyRate: 100,
      grade: { id: "g1", name: "G", hourlyRate: 100, companyId: "co-1" } as PayGrade,
      dateOfBirth: new Date("1990-01-01"),
    });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ basicHours: 160 })]]),
        deductionsByEmployee: new Map([
          ["emp-1", { total: 200, lines: [{ name: "Pension", amount: 200 }] }],
        ]),
      })
    );
    const line = lines[0]!;
    expect(line.grossPay).toBe(16000);
    expect(line.deductions).toBeGreaterThan(200);
    expect(line.netPay).toBe(Math.round((line.grossPay - line.deductions) * 100) / 100);
  });

  it("records the period salary as base pay on a fixed-monthly line", () => {
    const emp = baseEmployee({ employeeType: "general", monthlySalary: 25_000 as never });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    // basePay drives PayrollItem.basePay, which cost reporting and compliance rules read.
    expect(lines[0]!.basePay).toBe(25_000);
    expect(lines[0]!.grossPay).toBe(25_000);
  });

  it("excludes unpaid leave from a salaried employee's base pay", () => {
    const emp = baseEmployee({ employeeType: "general", monthlySalary: 19_500 as never });
    const { lines } = computePayrollLines(
      ctx({
        employees: [emp],
        aggregates: new Map([["emp-1", agg({ unpaidLeaveHours: 8 })]]),
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    expect(lines[0]!.basePay).toBe(18_700);
  });

  it("bases percentage earnings rules on basic pay for salaried and hourly alike", () => {
    const rule = {
      id: "er-1",
      companyId: "co-1",
      name: "Allowance",
      type: "percentage",
      rate: 10,
      amount: null,
      appliesTo: "all",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EarningsRule;
    const aggregates = new Map([["emp-1", agg({ basicHours: 208, overtimeHours: 10 })]]);

    const hourly = computePayrollLines(
      ctx({
        employees: [
          baseEmployee({
            hourlyRate: 100 as never,
            grade: { id: "g1", name: "A", hourlyRate: 100, companyId: "co-1" } as PayGrade,
          }),
        ],
        aggregates,
        companyEarningsRules: [rule],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );
    const salaried = computePayrollLines(
      ctx({
        employees: [baseEmployee({ employeeType: "general", monthlySalary: 20_800 as never })],
        aggregates,
        companyEarningsRules: [rule],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      })
    );

    // 10% of basic in both cases — overtime must not inflate the allowance.
    expect(hourly.lines[0]!.earningsLines).toContainEqual({ name: "Allowance", amount: 2_080 });
    expect(salaried.lines[0]!.earningsLines).toContainEqual({ name: "Allowance", amount: 2_080 });
  });

  it("taxes a run on the tax year of its period, not the current date", () => {
    const emp = baseEmployee({ employeeType: "general", monthlySalary: 30_000 as never });
    const build = (periodStart: Date, periodEnd: Date) => {
      const calculationCtx = ctx({
        periodStart,
        periodEnd,
        employees: [emp],
        deductionsByEmployee: new Map([["emp-1", { total: 0, lines: [] }]]),
      });
      const { lines, employeeSnapshots } = computePayrollLines(calculationCtx);
      return buildPayrollCalculationSnapshot({
        ctx: calculationCtx,
        employeeSnapshots,
        lines,
        calculatedAt: new Date("2026-07-28T00:00:00.000Z"),
        sdlStatus: {
          isLiable: false,
          liableFrom: null,
          rolling12MonthPayroll: 0,
          projectedRolling12Month: 0,
          threshold: 500_000,
          includeRelieversWithAttendance: true,
        },
      });
    };

    // February 2026 still falls in the 2025/2026 year of assessment.
    const feb = build(new Date("2026-02-01T00:00:00.000Z"), new Date("2026-02-28T00:00:00.000Z"));
    expect(feb.inputs.taxYear.year).toBe(2025);
    expect(feb.inputs.taxYear.label).toBe("2025/2026");

    // March 2026 begins the next one.
    const mar = build(new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T00:00:00.000Z"));
    expect(mar.inputs.taxYear.year).toBe(2026);
    expect(mar.inputs.taxYear.provisional).toBe(true);
  });

  it("flags deductions that would create negative net pay", () => {
    const issues = validateComputedPayrollLines([
      {
        employeeId: "emp-1",
        hoursWorked: 40,
        overtimeHours: 0,
        basePay: 1_000,
        overtimePay: 0,
        sundayPay: 0,
        publicHolidayPay: 0,
        grossPay: 1_000,
        deductions: 1_200,
        netPay: -200,
        earningsLines: [{ name: "Basic", amount: 1_000 }],
        deductionLines: [{ name: "Invalid deduction", amount: 1_200 }],
        tax: 0,
        taxableEarnings: 1_000,
        uifEmployee: 0,
        uifEmployer: 0,
        sdl: 0,
      },
    ]);

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["deductions", "netPay"])
    );
  });

  describe("site_area_grade wage matrix calculation engine", () => {
    it("calculates wages for an employee working at a single site with Area × Grade pricing", () => {
      const emp = baseEmployee({
        id: "emp-guard-1",
        firstName: "John",
        lastName: "Doe",
      });

      const sitePricingResolver = (siteId: string, _at: Date) => {
        if (siteId === "site-alpha") {
          return {
            hourlyRate: 38.99,
            areaId: "area-1",
            areaName: "Area 1",
            gradeId: "grade-a",
            gradeName: "Grade A",
            rateId: "rate-1",
            effectiveFrom: new Date("2026-01-01"),
          };
        }
        return null;
      };

      const aggregates = new Map([
        [
          "emp-guard-1",
          agg({
            employeeId: "emp-guard-1",
            basicHours: 160,
            overtimeHours: 10,
            sundayHours: 12,
            publicHolidayHours: 8,
            segments: [
              {
                siteId: "site-alpha",
                workDate: new Date("2026-05-10"),
                basicHours: 160,
                overtimeHours: 10,
                sundayHours: 12,
                publicHolidayHours: 8,
              },
            ],
          }),
        ],
      ]);

      const companyPayRules = new Map([
        ["overtime", 1.5],
        ["sunday", 2.0],
        ["public_holiday", 2.0],
      ]);

      const siteNames = new Map([["site-alpha", "Site Alpha"]]);

      const { lines, employeeSnapshots } = computePayrollLines(
        ctx({
          employees: [emp],
          aggregates,
          rateSource: "site_area_grade",
          sitePricingResolver,
          companyPayRules,
          siteNames,
          deductionsByEmployee: new Map([["emp-guard-1", { total: 0, lines: [] }]]),
        })
      );

      expect(lines).toHaveLength(1);
      const line = lines[0]!;

      // 160 * 38.99 = 6238.40
      expect(line.basePay).toBe(6238.4);
      // 10 * 38.99 * 1.5 = 584.85
      expect(line.overtimePay).toBe(584.85);
      // 12 * 38.99 * 2.0 = 935.76
      expect(line.sundayPay).toBe(935.76);
      // 8 * 38.99 * 2.0 = 623.84
      expect(line.publicHolidayPay).toBe(623.84);
      // Gross = 6238.40 + 584.85 + 935.76 + 623.84 = 8382.85
      expect(line.grossPay).toBe(8382.85);
      expect(line.hoursWorked).toBe(160);
      expect(line.overtimeHours).toBe(10);

      const snapshot = employeeSnapshots[0]!;
      expect(snapshot.pricingMode).toBe("site_area_grade");
      expect(snapshot.segments).toHaveLength(1);
      expect(snapshot.segments![0]).toMatchObject({
        siteId: "site-alpha",
        siteName: "Site Alpha",
        areaName: "Area 1",
        gradeName: "Grade A",
        hourlyRate: 38.99,
        basicHours: 160,
        basePay: 6238.4,
        overtimePay: 584.85,
        sundayPay: 935.76,
        publicHolidayPay: 623.84,
      });
    });

    it("calculates wages for a multi-site guard working at different sites with different rates in one period", () => {
      const emp = baseEmployee({
        id: "emp-multi",
        firstName: "Sipho",
        lastName: "Khumalo",
      });

      const sitePricingResolver = (siteId: string, _at: Date) => {
        if (siteId === "site-alpha") {
          // Area 1, Grade A = R38.99
          return {
            hourlyRate: 38.99,
            areaId: "area-1",
            areaName: "Area 1",
            gradeId: "grade-a",
            gradeName: "Grade A",
            rateId: "rate-1",
            effectiveFrom: new Date("2026-01-01"),
          };
        }
        if (siteId === "site-bravo") {
          // Area 1, Grade C = R32.32
          return {
            hourlyRate: 32.32,
            areaId: "area-1",
            areaName: "Area 1",
            gradeId: "grade-c",
            gradeName: "Grade C",
            rateId: "rate-2",
            effectiveFrom: new Date("2026-01-01"),
          };
        }
        return null;
      };

      const aggregates = new Map([
        [
          "emp-multi",
          agg({
            employeeId: "emp-multi",
            basicHours: 160,
            overtimeHours: 10,
            sundayHours: 0,
            publicHolidayHours: 0,
            segments: [
              {
                siteId: "site-alpha",
                workDate: new Date("2026-05-05"),
                basicHours: 80,
                overtimeHours: 6,
                sundayHours: 0,
                publicHolidayHours: 0,
              },
              {
                siteId: "site-bravo",
                workDate: new Date("2026-05-15"),
                basicHours: 80,
                overtimeHours: 4,
                sundayHours: 0,
                publicHolidayHours: 0,
              },
            ],
          }),
        ],
      ]);

      const companyPayRules = new Map([
        ["overtime", 1.5],
        ["sunday", 2.0],
        ["public_holiday", 2.0],
      ]);

      const siteNames = new Map([
        ["site-alpha", "Alpha Security Site"],
        ["site-bravo", "Bravo Retail Site"],
      ]);

      const { lines, employeeSnapshots } = computePayrollLines(
        ctx({
          employees: [emp],
          aggregates,
          rateSource: "site_area_grade",
          sitePricingResolver,
          companyPayRules,
          siteNames,
          deductionsByEmployee: new Map([["emp-multi", { total: 0, lines: [] }]]),
        })
      );

      expect(lines).toHaveLength(1);
      const line = lines[0]!;

      // Site Alpha: 80 * 38.99 = 3119.20 base, OT: 6 * 38.99 * 1.5 = 350.91
      // Site Bravo: 80 * 32.32 = 2585.60 base, OT: 4 * 32.32 * 1.5 = 193.92
      // Total Base: 3119.20 + 2585.60 = 5704.80
      // Total OT: 350.91 + 193.92 = 544.83
      // Gross: 5704.80 + 544.83 = 6249.63
      expect(line.basePay).toBe(5704.8);
      expect(line.overtimePay).toBe(544.83);
      expect(line.grossPay).toBe(6249.63);

      const snapshot = employeeSnapshots[0]!;
      expect(snapshot.segments).toHaveLength(2);
      expect(snapshot.segments![0].siteName).toBe("Alpha Security Site");
      expect(snapshot.segments![0].hourlyRate).toBe(38.99);
      expect(snapshot.segments![1].siteName).toBe("Bravo Retail Site");
      expect(snapshot.segments![1].hourlyRate).toBe(32.32);

      // Verify itemized earnings lines appear for each site
      expect(line.earningsLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining("Alpha Security Site") }),
          expect.objectContaining({ name: expect.stringContaining("Bravo Retail Site") }),
        ])
      );
    });

    it("prices paid leave using the employee primary payroll home site", () => {
      const emp = baseEmployee({
        id: "emp-leave",
        firstName: "Thabo",
        lastName: "Mokoena",
      });

      const sitePricingResolver = (siteId: string, _at: Date) => {
        if (siteId === "site-home") {
          return {
            hourlyRate: 40.0,
            areaId: "area-1",
            areaName: "Area 1",
            gradeId: "grade-a",
            gradeName: "Grade A",
            rateId: "rate-home",
            effectiveFrom: new Date("2026-01-01"),
          };
        }
        if (siteId === "site-worked") {
          return {
            hourlyRate: 35.0,
            areaId: "area-2",
            areaName: "Area 2",
            gradeId: "grade-b",
            gradeName: "Grade B",
            rateId: "rate-worked",
            effectiveFrom: new Date("2026-01-01"),
          };
        }
        return null;
      };

      const payrollHomeSiteResolver = (employeeId: string, _at: Date) => {
        if (employeeId === "emp-leave") return "site-home";
        return null;
      };

      const aggregates = new Map([
        [
          "emp-leave",
          agg({
            employeeId: "emp-leave",
            basicHours: 80,
            leaveHours: 16,
            segments: [
              {
                siteId: "site-worked",
                workDate: new Date("2026-05-02"),
                basicHours: 80,
                overtimeHours: 0,
                sundayHours: 0,
                publicHolidayHours: 0,
              },
            ],
            leaveDaysList: [
              {
                date: new Date("2026-05-20"),
                leaveType: "ANNUAL",
                hours: 16,
                isPaid: true,
              },
            ],
          }),
        ],
      ]);

      const siteNames = new Map([
        ["site-home", "Primary Home Site"],
        ["site-worked", "Secondary Field Site"],
      ]);

      const { lines, employeeSnapshots } = computePayrollLines(
        ctx({
          employees: [emp],
          aggregates,
          rateSource: "site_area_grade",
          sitePricingResolver,
          payrollHomeSiteResolver,
          siteNames,
          deductionsByEmployee: new Map([["emp-leave", { total: 0, lines: [] }]]),
        })
      );

      expect(lines).toHaveLength(1);
      const line = lines[0]!;

      // Worked: 80 hrs @ R35 = 2800.00
      // Leave: 16 hrs @ R40 (Home site rate) = 640.00
      // Total Base = 3440.00
      expect(line.basePay).toBe(3440);
      expect(line.grossPay).toBe(3440);
      expect(line.hoursWorked).toBe(96);

      const snapshot = employeeSnapshots[0]!;
      expect(snapshot.primaryPayrollSite).toMatchObject({
        siteId: "site-home",
        siteName: "Primary Home Site",
        hourlyRate: 40.0,
      });

      expect(line.earningsLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining("Paid Leave (Primary Home Site") }),
        ])
      );
    });

    it("throws PayrollCalculationPricingError when a worked site has no effective rate", () => {
      const emp = baseEmployee({
        id: "emp-unpriced",
        firstName: "Nelson",
        lastName: "Mandela",
      });

      const aggregates = new Map([
        [
          "emp-unpriced",
          agg({
            employeeId: "emp-unpriced",
            basicHours: 40,
            segments: [
              {
                siteId: "site-unpriced",
                workDate: new Date("2026-05-10"),
                basicHours: 40,
                overtimeHours: 0,
                sundayHours: 0,
                publicHolidayHours: 0,
              },
            ],
          }),
        ],
      ]);

      expect(() =>
        computePayrollLines(
          ctx({
            employees: [emp],
            aggregates,
            rateSource: "site_area_grade",
            sitePricingResolver: () => null,
            siteNames: new Map([["site-unpriced", "Unconfigured Site"]]),
            deductionsByEmployee: new Map(),
          })
        )
      ).toThrow(PayrollCalculationPricingError);
    });

    it("throws PayrollCalculationPricingError when an employee with paid leave has no primary site", () => {
      const emp = baseEmployee({
        id: "emp-noleavehome",
        firstName: "Walter",
        lastName: "Sisulu",
      });

      const aggregates = new Map([
        [
          "emp-noleavehome",
          agg({
            employeeId: "emp-noleavehome",
            basicHours: 0,
            leaveHours: 8,
            leaveDaysList: [
              {
                date: new Date("2026-05-01"),
                leaveType: "ANNUAL",
                hours: 8,
                isPaid: true,
              },
            ],
          }),
        ],
      ]);

      expect(() =>
        computePayrollLines(
          ctx({
            employees: [emp],
            aggregates,
            rateSource: "site_area_grade",
            sitePricingResolver: () => null,
            payrollHomeSiteResolver: () => null,
            deductionsByEmployee: new Map(),
          })
        )
      ).toThrow(PayrollCalculationPricingError);
    });
  });
});
