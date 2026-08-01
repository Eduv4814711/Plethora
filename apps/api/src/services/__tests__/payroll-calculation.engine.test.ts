import { describe, expect, it } from "vitest";
import type { EarningsRule, Employee, PayGrade } from "@prisma/client";
import {
  buildPayrollCalculationSnapshot,
  computePayrollLines,
  DEFAULT_OT_MULTIPLIER,
  DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
  DEFAULT_SUNDAY_MULTIPLIER,
  monthlySalaryForPayPeriod,
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
    expect(snapshot.version).toBe("1.4.0");
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
});
