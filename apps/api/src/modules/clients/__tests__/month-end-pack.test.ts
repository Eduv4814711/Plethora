import { describe, expect, it } from "vitest";
import {
  MAX_PACK_SITES,
  mergeTimesheetCsvs,
  planMonthEndPack,
  timesheetPdfRows,
  TIMESHEET_PDF_COLUMNS,
  watermarkForTimesheet,
} from "../month-end-pack.service.js";
import { safeFilenamePart } from "../../../services/company-branding.js";

const sites = [
  { id: "s2", name: "Zulu Warehouse" },
  { id: "s1", name: "Alpha Head Office" },
  { id: "s3", name: "Midtown Depot" },
];

describe("planMonthEndPack", () => {
  it("orders sites by name so the pack is stable between runs", () => {
    const plan = planMonthEndPack(sites);
    expect(plan.ok && plan.sites.map((s) => s.name)).toEqual([
      "Alpha Head Office",
      "Midtown Depot",
      "Zulu Warehouse",
    ]);
  });

  it("narrows to the requested sites, keeping the name order", () => {
    const plan = planMonthEndPack(sites, ["s3", "s1"]);
    expect(plan.ok && plan.sites.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("refuses a site that is not linked to this client", () => {
    const plan = planMonthEndPack(sites, ["s1", "someone-elses-site"]);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toContain("someone-elses-site");
  });

  it("refuses when the client has no sites", () => {
    expect(planMonthEndPack([]).ok).toBe(false);
  });

  it("caps the number of sites in one pack", () => {
    const many = Array.from({ length: MAX_PACK_SITES + 1 }, (_, i) => ({
      id: `s${i}`,
      name: `Site ${String(i).padStart(2, "0")}`,
    }));
    const plan = planMonthEndPack(many);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toContain(String(MAX_PACK_SITES));
  });

  it("honours a raised cap, which is how the CSV route skips the render limit", () => {
    const many = Array.from({ length: MAX_PACK_SITES + 5 }, (_, i) => ({
      id: `s${i}`,
      name: `Site ${String(i).padStart(2, "0")}`,
    }));
    expect(planMonthEndPack(many, undefined, Number.MAX_SAFE_INTEGER).ok).toBe(true);
  });
});

describe("mergeTimesheetCsvs", () => {
  const a = '"Site","Date"\n"Alpha","2026-07-01"\n"Alpha","2026-07-02"';
  const b = '"Site","Date"\n"Midtown","2026-07-01"';

  it("keeps exactly one header row across sites", () => {
    const merged = mergeTimesheetCsvs([a, b]);
    const headerCount = merged.split("\n").filter((line) => line.startsWith('"Site","Date"')).length;
    expect(headerCount).toBe(1);
    expect(merged.split("\n")).toHaveLength(4);
    expect(merged).toContain('"Midtown","2026-07-01"');
  });

  it("drops sites that produced nothing", () => {
    expect(mergeTimesheetCsvs(["", a, ""])).toBe(a);
  });

  it("returns an empty string when there is nothing at all", () => {
    expect(mergeTimesheetCsvs([])).toBe("");
    expect(mergeTimesheetCsvs(["", "  "])).toBe("");
  });

  it("drops a header-only sheet rather than leaving a blank line", () => {
    expect(mergeTimesheetCsvs([a, '"Site","Date"'])).toBe(a);
  });
});

describe("watermarkForTimesheet", () => {
  it("marks anything unapproved", () => {
    expect(watermarkForTimesheet("draft")).toBe("DRAFT - NOT APPROVED");
    expect(watermarkForTimesheet("approved")).toBeNull();
    expect(watermarkForTimesheet("locked")).toBeNull();
  });
});

describe("safeFilenamePart", () => {
  it("strips characters that would break a Content-Disposition header", () => {
    expect(safeFilenamePart("Acme (Pty) Ltd / North", "client")).toBe("Acme Pty Ltd  North");
    expect(safeFilenamePart('bad"name', "client")).toBe("badname");
  });

  it("falls back when nothing usable survives", () => {
    expect(safeFilenamePart("///", "client")).toBe("client");
    expect(safeFilenamePart("", "client")).toBe("client");
  });
});

describe("timesheetPdfRows", () => {
  it("emits one cell per column, with times trimmed to HH:MM", () => {
    const rows = timesheetPdfRows({
      rows: [
        {
          workDate: "2026-07-01",
          dayOfWeek: "Wed",
          plannedGuardName: "Guard One",
          actualGuardName: null,
          employeeNumber: null,
          psiraRegistrationNumber: "PSIRA123",
          plannedShiftCode: "D",
          plannedShiftType: "day",
          actualShiftCode: null,
          actualShiftType: null,
          clockIn: "2026-07-01T06:05:00.000Z",
          clockOut: null,
          hoursWorked: null,
          overtimeHours: 1.5,
          attendanceStatus: "absent",
          approvalStatus: "pending",
          dutyOnObNumber: null,
          dutyOffObNumber: null,
          comments: null,
          discrepancyCodes: ["NO_CLOCK_OUT"],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(TIMESHEET_PDF_COLUMNS.length);
    expect(rows[0][4]).toBe("PSIRA123");
    expect(rows[0][7]).toBe("06:05");
    expect(rows[0][8]).toBe("");
    expect(rows[0][9]).toBe("");
    expect(rows[0][10]).toBe("1.5");
    expect(rows[0][15]).toBe("NO_CLOCK_OUT");
  });
});
