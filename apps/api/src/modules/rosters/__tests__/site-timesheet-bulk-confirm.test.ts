import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    siteTimesheet: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteTimesheetRow: {
      update: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    leaveRequest: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/timezone.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/timezone.js")>();
  return { ...actual, getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg") };
});

import { createAuditLog } from "../../../lib/audit.js";
import { prisma } from "../../../lib/prisma.js";
import { bulkConfirmSiteTimesheetRows } from "../site-timesheets.service.js";

const site = {
  rosterDayShiftGuardsRequired: 1,
  rosterNightShiftGuardsRequired: 0,
  rosterDayShiftDays: null,
  rosterNightShiftDays: null,
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    companyId: "co-1",
    siteTimesheetId: "ts-1",
    siteId: "site-1",
    workDate: new Date("2026-08-03T00:00:00.000Z"),
    plannedGuardId: "g1",
    actualGuardId: null,
    plannedShiftType: "day",
    plannedShiftCode: "D",
    actualShiftType: null,
    actualShiftCode: null,
    clockIn: null,
    clockOut: null,
    hoursWorked: null,
    attendanceStatus: "pending",
    approvalStatus: "pending",
    dutyOnObNumber: null,
    dutyOffObNumber: null,
    occurrenceBookNumber: null,
    ...overrides,
  };
}

function mockSheet(rows: Array<ReturnType<typeof makeRow>>, status = "draft") {
  vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
    id: "ts-1",
    companyId: "co-1",
    status,
    site,
    rows,
  } as never);
}

const rowUpdate = vi.fn();

beforeEach(() => {
  vi.mocked(prisma.siteTimesheet.findFirst).mockReset();
  vi.mocked(prisma.employee.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.leaveRequest.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(createAuditLog).mockClear();
  rowUpdate.mockReset();
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(async (fn: never) =>
      (fn as unknown as (tx: unknown) => Promise<unknown>)({
        siteTimesheetRow: { update: rowUpdate },
        siteTimesheet: { update: vi.fn() },
      })
    );
});

const actor = { canOverrideObNumbers: false, userId: "u-1" };

describe("bulkConfirmSiteTimesheetRows", () => {
  it("confirms a clean rostered row with a full patch, not just an approval flag", async () => {
    mockSheet([makeRow()]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toEqual({ confirmed: ["row-1"], failed: [] });

    // Payroll reads hoursWorked and de-dupes on actualShiftType; both must be written or
    // the row pays zero hours / double-counts the underlying Shift.
    const data = rowUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actualShiftType: "day",
      actualShiftCode: "D",
      hoursWorked: 12,
      attendanceStatus: "present",
      approvalStatus: "reviewed",
      dutyOnObNumber: "1042",
      occurrenceBookNumber: "1042",
      dutyOffObNumber: "1043",
    });
    expect(data.actualGuard).toEqual({ connect: { id: "g1" } });
    expect(data.clockIn.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(data.clockOut.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("rejects the whole request when the sheet is already approved", async () => {
    mockSheet([makeRow()], "locked");

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toEqual({ error: expect.stringContaining("Unlock") });
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it("returns 404-style null when the timesheet does not exist", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue(null as never);
    expect(
      await bulkConfirmSiteTimesheetRows("co-1", "ts-1", [{ rowId: "row-1" }], actor)
    ).toBeNull();
  });

  it("fails MISSING_OB when either OB number is absent", async () => {
    mockSheet([makeRow()]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042" }],
      actor
    );

    expect(result).toMatchObject({
      confirmed: [],
      failed: [{ rowId: "row-1", code: "MISSING_OB" }],
    });
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it("fails HAS_DISCREPANCY rather than trusting the client's stale snapshot", async () => {
    // Rostered as leave, so confirming work against it is extra/unrostered time — a
    // row-level discrepancy that must be reviewed by hand.
    mockSheet([makeRow({ plannedShiftCode: "L" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "HAS_DISCREPANCY" }] });
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  // The whole point of bulk confirm is the "13 turned up, 1 didn't" day. A date-level
  // coverage shortfall must not block the guards who actually worked.
  it("still confirms clean rows when another guard on the same date was absent", async () => {
    mockSheet([
      makeRow({ id: "row-1", plannedGuardId: "g1" }),
      makeRow({ id: "row-2", plannedGuardId: "g2", attendanceStatus: "absent" }),
    ]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toEqual({ confirmed: ["row-1"], failed: [] });
  });

  it("fails NOT_AS_SCHEDULED when someone else worked", async () => {
    mockSheet([makeRow({ actualGuardId: "g2" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "NOT_AS_SCHEDULED" }] });
  });

  it("fails NO_SHIFT_TYPE instead of defaulting to a day shift", async () => {
    mockSheet([makeRow({ plannedShiftType: null, plannedShiftCode: "R" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "NO_SHIFT_TYPE" }] });
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it("fails ON_APPROVED_LEAVE using one batched leave query", async () => {
    mockSheet([makeRow()]);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        employeeId: "g1",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-05T00:00:00.000Z"),
      },
    ] as never);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "ON_APPROVED_LEAVE" }] });
    expect(vi.mocked(prisma.leaveRequest.findMany)).toHaveBeenCalledTimes(1);
  });

  it("fails ALREADY_REVIEWED for a row that is confirmed", async () => {
    mockSheet([makeRow({ approvalStatus: "reviewed" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "ALREADY_REVIEWED" }] });
  });

  it("fails PLACEHOLDER_GUARD for roster-planning placeholders", async () => {
    mockSheet([makeRow()]);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{ id: "g1" }] as never);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "PLACEHOLDER_GUARD" }] });
  });

  it("fails OB_LOCKED when overwriting a stored OB without approval access", async () => {
    mockSheet([makeRow({ dutyOnObNumber: "1000", approvalStatus: "partially_reviewed" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toMatchObject({ failed: [{ code: "OB_LOCKED" }] });
  });

  it("allows overwriting a stored OB with attendance approval access", async () => {
    mockSheet([makeRow({ dutyOnObNumber: "1000", approvalStatus: "partially_reviewed" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" }],
      { canOverrideObNumbers: true, userId: "u-1" }
    );

    expect(result).toEqual({ confirmed: ["row-1"], failed: [] });
  });

  it("reuses a stored Duty ON when the request omits it", async () => {
    mockSheet([makeRow({ dutyOnObNumber: "1000", approvalStatus: "partially_reviewed" })]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [{ rowId: "row-1", dutyOffObNumber: "1043" }],
      actor
    );

    expect(result).toEqual({ confirmed: ["row-1"], failed: [] });
    expect(rowUpdate.mock.calls[0][0].data).toMatchObject({ dutyOnObNumber: "1000" });
  });

  it("confirms the good rows and reports the bad ones in one response", async () => {
    mockSheet([
      makeRow({ id: "row-1" }),
      makeRow({ id: "row-2", actualGuardId: "g2" }),
      makeRow({ id: "row-3", plannedGuardId: "g3" }),
    ]);

    const result = await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [
        { rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" },
        { rowId: "row-2", dutyOnObNumber: "1044", dutyOffObNumber: "1045" },
        { rowId: "row-3", dutyOnObNumber: "1046" },
      ],
      actor
    );

    expect(result).toMatchObject({
      confirmed: ["row-1"],
      failed: [
        { rowId: "row-2", code: "NOT_AS_SCHEDULED" },
        { rowId: "row-3", code: "MISSING_OB" },
      ],
    });
    // Failed rows are never written, so they keep their prior approvalStatus.
    expect(rowUpdate).toHaveBeenCalledTimes(1);
  });

  it("writes one bulk audit entry plus a per-row entry for each confirmed row", async () => {
    mockSheet([makeRow({ id: "row-1" }), makeRow({ id: "row-2", plannedGuardId: "g2" })]);

    await bulkConfirmSiteTimesheetRows(
      "co-1",
      "ts-1",
      [
        { rowId: "row-1", dutyOnObNumber: "1042", dutyOffObNumber: "1043" },
        { rowId: "row-2", dutyOnObNumber: "1044", dutyOffObNumber: "1045" },
      ],
      actor
    );

    const actions = vi.mocked(createAuditLog).mock.calls.map((call) => call[0].action);
    expect(actions).toEqual([
      "site_timesheet.rows_bulk_confirm",
      "site_timesheet.row_approve",
      "site_timesheet.row_approve",
    ]);
  });

  it("does not open a transaction when every row fails", async () => {
    mockSheet([makeRow({ actualGuardId: "g2" })]);

    await bulkConfirmSiteTimesheetRows("co-1", "ts-1", [{ rowId: "row-1" }], actor);

    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
  });
});
