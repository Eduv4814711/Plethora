import { addDays, format } from "date-fns";
import { prisma } from "../lib/prisma.js";
import { parseDateOnly, parseDateOnlyEnd } from "../lib/timezone.js";
import { formatSiteRulesForMatrix } from "./site-roster-policy.service.js";

type ShiftWithRelations = {
  id: string;
  employeeId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  supersededEmployeeIds: string[];
  post: { shiftType: string | null };
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string | null;
    phone: string | null;
  };
  attendances: { clockIn: Date | null }[];
};

function shiftOverlapsDay(shiftStart: Date, shiftEnd: Date, dayStart: Date, dayEnd: Date): boolean {
  return shiftStart < dayEnd && shiftEnd > dayStart;
}

function hasClockIn(shift: ShiftWithRelations): boolean {
  return shift.attendances.some((a) => a.clockIn != null);
}

/** Same predicate as GET /attendance/missed — ended shift, created/assigned, no clock-in (shown as **A** in the matrix). */
export function isMissedShift(shift: ShiftWithRelations, now: Date = new Date()): boolean {
  if (shift.endTime >= now) return false;
  if (shift.status !== "created" && shift.status !== "assigned") return false;
  return !hasClockIn(shift);
}

function shiftTypeLetter(postShiftType: string | null): "D" | "N" {
  return (postShiftType ?? "day") === "night" ? "N" : "D";
}

/** Multiple assignments same calendar day: stable combined label. */
function combineTypes(types: ("D" | "N")[]): string {
  const uniq = [...new Set(types)].sort();
  if (uniq.length === 1) return uniq[0]!;
  return uniq.join("+");
}

function normalizeGender(g: string | null | undefined): "male" | "female" | null {
  if (!g) return null;
  const u = g.trim().toUpperCase();
  if (u === "M" || u === "MALE") return "male";
  if (u === "F" || u === "FEMALE") return "female";
  return null;
}

export interface SiteRosterMatrixDay {
  date: string;
  weekday: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
  dayOfMonth: number;
  isSunday: boolean;
}

export interface SiteRosterMatrixRow {
  employeeId: string;
  displayName: string;
  gender: "male" | "female" | null;
  contact: string | null;
  cells: string[];
}

export interface SiteRosterMatrixResult {
  site: { id: string; name: string };
  periodLabel: string;
  siteRules: string | null;
  days: SiteRosterMatrixDay[];
  rows: SiteRosterMatrixRow[];
}

const WEEKDAYS: SiteRosterMatrixDay["weekday"][] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
];

/**
 * Cell codes for one employee on one calendar day (site-scoped shifts only).
 *
 * - **D** / **N** — Scheduled day or night (from post.shiftType), shift not missed.
 * - **O** — Off: not rostered on that day for this site (no overlapping shift as assignee or superseded-only R).
 * - **A** — AWOL: current assignee on an overlapping shift that ended without clock-in (same rules as missed shifts).
 * - **R** — Replaced: listed in `supersededEmployeeIds` on an overlapping shift, not the current assignee.
 *
 * If any overlapping shift for this employee is missed, the cell is **A** (even when another shift the same day would be D/N).
 */
export function cellForEmployeeDay(employeeId: string, shiftsOnDay: ShiftWithRelations[], now?: Date): string {
  const t = now ?? new Date();
  const currentShifts = shiftsOnDay.filter((s) => s.employeeId === employeeId);
  const supersededOnly = shiftsOnDay.filter(
    (s) => s.employeeId !== employeeId && s.supersededEmployeeIds.includes(employeeId)
  );

  if (currentShifts.length > 0) {
    const letters: ("D" | "N")[] = [];
    let anyMissed = false;
    for (const s of currentShifts) {
      if (isMissedShift(s, t)) {
        anyMissed = true;
      } else {
        letters.push(shiftTypeLetter(s.post.shiftType));
      }
    }
    if (anyMissed) {
      return "A";
    }
    return combineTypes(letters);
  }

  if (supersededOnly.length > 0) {
    return "R";
  }

  return "O";
}

export async function buildSiteRosterMatrix(params: {
  companyId: string;
  siteId: string;
  startDate: string;
  endDate: string;
}): Promise<SiteRosterMatrixResult> {
  const { companyId, siteId, startDate, endDate } = params;

  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    select: { id: true, name: true, rosterSiteRules: true, rosterShiftGenderPolicy: true },
  });

  if (!site) {
    throw new Error("Site not found");
  }

  const rangeStart = parseDateOnly(startDate.slice(0, 10));
  const rangeEnd = parseDateOnlyEnd(endDate.slice(0, 10));

  const [shifts, assignments] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId,
        post: { siteId },
        startTime: { lt: rangeEnd },
        endTime: { gt: rangeStart },
      },
      include: {
        post: { select: { shiftType: true } },
        employee: {
          select: { id: true, firstName: true, lastName: true, gender: true, phone: true },
        },
        attendances: { select: { clockIn: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.siteAssignment.findMany({
      where: { siteId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, gender: true, phone: true },
        },
      },
    }),
  ]);

  const typedShifts = shifts as ShiftWithRelations[];

  const employeeById = new Map<
    string,
    { id: string; firstName: string; lastName: string; gender: string | null; phone: string | null }
  >();

  for (const a of assignments) {
    employeeById.set(a.employee.id, a.employee);
  }
  for (const s of typedShifts) {
    employeeById.set(s.employee.id, s.employee);
  }

  const missingSuperseded = new Set<string>();
  for (const s of typedShifts) {
    for (const sid of s.supersededEmployeeIds) {
      if (!employeeById.has(sid)) missingSuperseded.add(sid);
    }
  }
  if (missingSuperseded.size > 0) {
    const extras = await prisma.employee.findMany({
      where: { id: { in: [...missingSuperseded] }, companyId },
      select: { id: true, firstName: true, lastName: true, gender: true, phone: true },
    });
    for (const e of extras) {
      employeeById.set(e.id, e);
    }
  }

  const days: SiteRosterMatrixDay[] = [];
  for (let d = new Date(rangeStart); d.getTime() <= parseDateOnly(endDate.slice(0, 10)).getTime(); d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    days.push({
      date: format(d, "yyyy-MM-dd"),
      weekday: WEEKDAYS[dow]!,
      dayOfMonth: d.getUTCDate(),
      isSunday: dow === 0,
    });
  }

  const sortedEmployeeIds = [...employeeById.keys()].sort((a, b) => {
    const ea = employeeById.get(a)!;
    const eb = employeeById.get(b)!;
    const ln = ea.lastName.localeCompare(eb.lastName);
    if (ln !== 0) return ln;
    return ea.firstName.localeCompare(eb.firstName);
  });

  const rows: SiteRosterMatrixRow[] = sortedEmployeeIds.map((empId) => {
    const e = employeeById.get(empId)!;
    const cells: string[] = [];
    for (const day of days) {
      const dayStart = parseDateOnly(day.date);
      const dayEnd = parseDateOnlyEnd(day.date);
      const shiftsOnDay = typedShifts.filter((s) => shiftOverlapsDay(s.startTime, s.endTime, dayStart, dayEnd));
      cells.push(cellForEmployeeDay(empId, shiftsOnDay));
    }
    return {
      employeeId: empId,
      displayName: `${e.firstName} ${e.lastName}`.trim(),
      gender: normalizeGender(e.gender),
      contact: e.phone ?? null,
      cells,
    };
  });

  const startLabel = format(parseDateOnly(startDate.slice(0, 10)), "d MMMM yyyy");
  const endLabel = format(parseDateOnly(endDate.slice(0, 10)), "d MMMM yyyy");
  const periodLabel = `${startLabel} to ${endLabel}`;

  return {
    site: { id: site.id, name: site.name },
    periodLabel,
    siteRules: formatSiteRulesForMatrix(site.rosterShiftGenderPolicy, site.rosterSiteRules),
    days,
    rows,
  };
}
