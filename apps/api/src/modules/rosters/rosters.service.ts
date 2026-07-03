import { format } from "date-fns";
import type { Prisma, SiteRosterShiftCode } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { shiftCodeToType, countsTowardCoverage } from "./lib/pattern-parser.js";
import { getCompanyTimezone, getShiftTimes } from "../../lib/timezone.js";

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;
const WORKING_SHIFT_CODES = new Set<SiteRosterShiftCode>(["D", "N"]);

type RosterWarning = {
  code: string;
  severity: "advisory" | "hard";
  message: string;
  guardId?: string;
  guardName?: string;
  dateKey?: string;
  patternDayIndex?: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function dateOnly(d: Date | string): Date {
  const s = dateKey(d);
  const [year, month, day] = s.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function patternDayForDate(anchor: Date, cycleLength: number, target: Date): number {
  const diff = Math.floor((dateOnly(target).getTime() - dateOnly(anchor).getTime()) / 86400000);
  const mod = ((diff % cycleLength) + cycleLength) % cycleLength;
  return mod;
}

function addCalendarDays(d: Date, days: number): Date {
  const next = dateOnly(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function loadSiteGuards(siteId: string, companyId: string) {
  const assignments = await prisma.siteAssignment.findMany({
    where: { siteId, isActive: true, site: { companyId } },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          gender: true,
          phone: true,
          status: true,
          employeeType: true,
          jobRole: true,
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });
  return assignments
    .map((a) => a.employee)
    .filter(
      (e) =>
        (e.employeeType ?? "security") === "security" &&
        ROSTERABLE_STATUSES.includes(e.status as (typeof ROSTERABLE_STATUSES)[number])
    );
}

function mapPatternSummary(pattern: {
  id: string;
  siteId: string;
  name: string;
  anchorDate: Date;
  cycleLengthDays: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: string;
  _count?: { cells: number };
}) {
  return {
    id: pattern.id,
    siteId: pattern.siteId,
    name: pattern.name,
    anchorDate: dateKey(pattern.anchorDate),
    cycleLengthDays: pattern.cycleLengthDays,
    effectiveFrom: dateKey(pattern.effectiveFrom),
    effectiveTo: pattern.effectiveTo ? dateKey(pattern.effectiveTo) : null,
    status: pattern.status,
    guardCount: 0,
    cellCount: pattern._count?.cells ?? 0,
  };
}

function buildCoverage(
  calendarDays: string[],
  rows: { cells: { dateKey?: string; patternDayIndex?: number; shiftCode: string }[] }[],
  requiredDay: number,
  requiredNight: number
) {
  const coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }> = {};
  for (const day of calendarDays) {
    coverageByDay[day] = { day: 0, night: 0, requiredDay, requiredNight };
  }
  for (const row of rows) {
    for (const cell of row.cells) {
      const key = cell.dateKey ?? String(cell.patternDayIndex);
      if (!coverageByDay[key]) continue;
      if (cell.shiftCode === "D") coverageByDay[key].day += 1;
      if (cell.shiftCode === "N") coverageByDay[key].night += 1;
    }
  }
  return coverageByDay;
}

function normalizeGender(gender: string | null | undefined): "M" | "F" | "" {
  const g = (gender ?? "").trim().toUpperCase();
  if (g === "M" || g.startsWith("MALE")) return "M";
  if (g === "F" || g.startsWith("FEMALE")) return "F";
  return "";
}

function requiredGenderLabel(gender: string | null | undefined): "M" | "F" | "" {
  const g = (gender ?? "").trim().toUpperCase();
  if (g === "M" || g === "MALE") return "M";
  if (g === "F" || g === "FEMALE") return "F";
  return "";
}

function buildRosterWarnings({
  calendarDays,
  rows,
  coverageByDay,
  requiredDayGender,
  requiredNightGender,
}: {
  calendarDays: string[];
  rows: Awaited<ReturnType<typeof buildGridRows>>;
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  requiredDayGender?: string | null;
  requiredNightGender?: string | null;
}): RosterWarning[] {
  const warnings: RosterWarning[] = [];

  if (rows.length === 0) {
    warnings.push({
      code: "NO_GUARDS",
      severity: "hard",
      message: "No guards are assigned to this site. Add guards before building the roster.",
    });
  }

  for (const day of calendarDays) {
    const cov = coverageByDay[day];
    if (!cov) continue;
    if (cov.day < cov.requiredDay) {
      warnings.push({
        code: "DAY_COVERAGE_SHORT",
        severity: "hard",
        dateKey: day,
        message: `${day}: Day shift is short by ${cov.requiredDay - cov.day} guard${cov.requiredDay - cov.day === 1 ? "" : "s"} (${cov.day} of ${cov.requiredDay} staffed).`,
      });
    }
    if (cov.night < cov.requiredNight) {
      warnings.push({
        code: "NIGHT_COVERAGE_SHORT",
        severity: "hard",
        dateKey: day,
        message: `${day}: Night shift is short by ${cov.requiredNight - cov.night} guard${cov.requiredNight - cov.night === 1 ? "" : "s"} (${cov.night} of ${cov.requiredNight} staffed).`,
      });
    }
  }

  const dayGender = requiredGenderLabel(requiredDayGender);
  const nightGender = requiredGenderLabel(requiredNightGender);
  if (dayGender || nightGender) {
    for (const row of rows) {
      const guardGender = normalizeGender(row.gender);
      for (const cell of row.cells) {
        if (!cell.dateKey) continue;
        const required = cell.shiftCode === "D" ? dayGender : cell.shiftCode === "N" ? nightGender : "";
        if (!required) continue;
        if (!guardGender) {
          warnings.push({
            code: "GUARD_GENDER_MISSING",
            severity: "advisory",
            guardId: row.guardId,
            guardName: row.guardName,
            dateKey: cell.dateKey,
            message: `${row.guardName} is rostered on ${cell.dateKey}, but their gender is not set for the site staffing rule.`,
          });
        } else if (guardGender !== required) {
          warnings.push({
            code: "GENDER_RULE_MISMATCH",
            severity: "hard",
            guardId: row.guardId,
            guardName: row.guardName,
            dateKey: cell.dateKey,
            message: `${row.guardName} does not match the ${cell.shiftCode === "D" ? "day" : "night"} shift gender rule on ${cell.dateKey}.`,
          });
        }
      }
    }
  }

  return warnings;
}

function emptyTotals() {
  return { D: 0, N: 0, O: 0, L: 0, SL: 0, TR: 0, SB: 0, AWOL: 0, R: 0, blank: 0 };
}

export async function getSiteRosterConfig(companyId: string, siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    include: {
      assignedGuards: { where: { isActive: true }, select: { employeeId: true } },
    },
  });
  if (!site) return null;

  const activePattern = await prisma.siteRosterPattern.findFirst({
    where: { siteId, companyId, status: "active" },
    orderBy: { effectiveFrom: "desc" },
  });

  return {
    id: site.id,
    name: site.name,
    rosterDayShiftGuardsRequired: site.rosterDayShiftGuardsRequired,
    rosterNightShiftGuardsRequired: site.rosterNightShiftGuardsRequired,
    rosterDayShiftGender: site.rosterDayShiftGender,
    rosterNightShiftGender: site.rosterNightShiftGender,
    rosterDayShiftStartTime: "06:00",
    rosterDayShiftEndTime: "18:00",
    rosterNightShiftStartTime: "18:00",
    rosterNightShiftEndTime: "06:00",
    rosterSiteMode: "day_and_night",
    rosterPeriodStartDay: 26,
    rosterPeriodEndDay: 25,
    rosterSiteRules: site.rosterSiteRules,
    rosterSheetNotes: site.rosterSheetNotes,
    rosterRelieverEmployeeIds: [] as string[],
    assignedGuardIds: site.assignedGuards.map((g) => g.employeeId),
    activePattern: activePattern
      ? {
          id: activePattern.id,
          name: activePattern.name,
          anchorDate: dateKey(activePattern.anchorDate),
          cycleLengthDays: activePattern.cycleLengthDays,
          status: activePattern.status,
          effectiveFrom: dateKey(activePattern.effectiveFrom),
        }
      : null,
  };
}

async function buildGridRows(
  guards: Awaited<ReturnType<typeof loadSiteGuards>>,
  columnKeys: string[],
  mode: "pattern" | "live",
  cellLookup: Map<string, SiteRosterShiftCode>,
  options?: { anchorDate?: string; cycleLength?: number }
) {
  return guards.map((guard) => {
    const cells = columnKeys.map((key) => {
      const lookupKey = `${guard.id}:${key}`;
      const shiftCode = (cellLookup.get(lookupKey) ?? "blank") as SiteRosterShiftCode;
      const isCalendarKey = key.includes("-");
      const patternDayIndex =
        mode === "pattern" && isCalendarKey && options?.anchorDate && options?.cycleLength
          ? patternDayForDate(dateOnly(options.anchorDate), options.cycleLength, dateOnly(key))
          : mode === "pattern" && !isCalendarKey
            ? Number(key)
            : undefined;
      return {
        guardId: guard.id,
        guardName: `${guard.firstName} ${guard.lastName}`.trim(),
        patternDayIndex,
        dateKey: isCalendarKey || mode === "live" ? key : undefined,
        shiftCode,
        shiftType: shiftCodeToType(shiftCode),
        isLocked: false,
        source: "pattern",
      };
    });
    const totals = emptyTotals();
    for (const c of cells) {
      const code = c.shiftCode as keyof typeof totals;
      if (code in totals) totals[code] += 1;
    }
    return {
      guardId: guard.id,
      guardName: `${guard.firstName} ${guard.lastName}`.trim(),
      gender: guard.gender,
      phone: guard.phone,
      isPlaceholder: (guard.jobRole ?? "").startsWith("roster_placeholder:"),
      placeholderType: (guard.jobRole ?? "").endsWith(":reliever")
        ? ("reliever" as const)
        : (guard.jobRole ?? "").startsWith("roster_placeholder:")
          ? ("unknown" as const)
          : undefined,
      cells,
      totals,
    };
  });
}

export async function getPatternGrid(
  companyId: string,
  siteId: string,
  patternId?: string,
  period?: { startDate: string; endDate: string; cycleLengthDays?: number; anchorDate?: string }
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const guards = await loadSiteGuards(siteId, companyId);
  let pattern = patternId
    ? await prisma.siteRosterPattern.findFirst({ where: { id: patternId, siteId, companyId } })
    : await prisma.siteRosterPattern.findFirst({
        where: { siteId, companyId, status: "active" },
        orderBy: { effectiveFrom: "desc" },
      });

  const start = dateOnly(period?.startDate ?? format(new Date(), "yyyy-MM-dd"));
  const end = dateOnly(period?.endDate ?? period?.startDate ?? format(new Date(), "yyyy-MM-dd"));
  const calendarDays: string[] = [];
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    calendarDays.push(dateKey(d));
  }

  const anchor = period?.anchorDate
    ? dateOnly(period.anchorDate)
    : pattern?.anchorDate ?? start;
  const cycle = period?.cycleLengthDays ?? pattern?.cycleLengthDays ?? 9;
  const columnKeys = calendarDays;

  const patternCellLookup = new Map<string, SiteRosterShiftCode>();
  if (pattern) {
    const cells = await prisma.siteRosterPatternCell.findMany({
      where: { rosterPatternId: pattern.id },
    });
    for (const c of cells) {
      patternCellLookup.set(`${c.guardId}:${c.patternDayIndex}`, c.shiftCode);
    }
  }

  const cellLookup = new Map<string, SiteRosterShiftCode>();
  for (const dateKey of calendarDays) {
    const pDay = patternDayForDate(anchor, cycle, dateOnly(dateKey));
    for (const guard of guards) {
      const code = patternCellLookup.get(`${guard.id}:${pDay}`) ?? "blank";
      cellLookup.set(`${guard.id}:${dateKey}`, code);
    }
  }

  const rows = await buildGridRows(guards, columnKeys, "pattern", cellLookup, {
    anchorDate: dateKey(anchor),
    cycleLength: cycle,
  });
  const patternDays = Array.from({ length: cycle }, (_, i) => i);
  const coverageByDay = buildCoverage(
    columnKeys,
    rows,
    site.rosterDayShiftGuardsRequired,
    site.rosterNightShiftGuardsRequired
  );

  return {
    siteId,
    siteName: site.name,
    mode: "pattern" as const,
    periodStart: dateKey(start),
    periodEnd: dateKey(end),
    patternDays,
    calendarDays,
    rows,
    warnings: buildRosterWarnings({
      calendarDays,
      rows,
      coverageByDay,
      requiredDayGender: site.rosterDayShiftGender,
      requiredNightGender: site.rosterNightShiftGender,
    }),
    coverageByDay,
    activePattern: pattern
      ? {
          id: pattern.id,
          name: pattern.name,
          anchorDate: dateKey(pattern.anchorDate),
          cycleLengthDays: pattern.cycleLengthDays,
          status: pattern.status,
        }
      : null,
  };
}

export async function getLiveRoster(
  companyId: string,
  siteId: string,
  startDate: string,
  endDate: string,
  fillFromPattern = false
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const guards = await loadSiteGuards(siteId, companyId);
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  const calendarDays: string[] = [];
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    calendarDays.push(dateKey(d));
  }

  const [generated, overrides, activePattern] = await Promise.all([
    prisma.siteRosterGeneratedShift.findMany({
      where: { siteId, companyId, rosterDate: { gte: start, lte: end } },
    }),
    prisma.siteRosterManualOverride.findMany({
      where: { siteId, companyId, rosterDate: { gte: start, lte: end } },
    }),
    prisma.siteRosterPattern.findFirst({
      where: { siteId, companyId, status: "active" },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);

  const cellLookup = new Map<string, SiteRosterShiftCode>();
  for (const g of generated) {
    cellLookup.set(`${g.guardId}:${dateKey(g.rosterDate)}`, g.shiftCode);
  }
  for (const o of overrides) {
    cellLookup.set(`${o.guardId}:${dateKey(o.rosterDate)}`, o.overrideShiftCode);
  }

  // Optionally pre-fill empty cells from an active repeating pattern
  if (fillFromPattern && activePattern) {
    const patternCells = await prisma.siteRosterPatternCell.findMany({
      where: { rosterPatternId: activePattern.id },
    });
    const byGuardDay = new Map<string, SiteRosterShiftCode>();
    for (const c of patternCells) {
      byGuardDay.set(`${c.guardId}:${c.patternDayIndex}`, c.shiftCode);
    }
    for (const day of calendarDays) {
      const dayDate = dateOnly(day);
      const pDay = patternDayForDate(activePattern.anchorDate, activePattern.cycleLengthDays, dayDate);
      for (const guard of guards) {
        const key = `${guard.id}:${day}`;
        if (!cellLookup.has(key)) {
          const code = byGuardDay.get(`${guard.id}:${pDay}`) ?? "blank";
          cellLookup.set(key, code);
        }
      }
    }
  }

  const rows = await buildGridRows(guards, calendarDays, "live", cellLookup);
  const coverageByDay = buildCoverage(
    calendarDays,
    rows,
    site.rosterDayShiftGuardsRequired,
    site.rosterNightShiftGuardsRequired
  );

  return {
    siteId,
    siteName: site.name,
    mode: "live" as const,
    periodStart: startDate,
    periodEnd: endDate,
    calendarDays,
    rows,
    warnings: buildRosterWarnings({
      calendarDays,
      rows,
      coverageByDay,
      requiredDayGender: site.rosterDayShiftGender,
      requiredNightGender: site.rosterNightShiftGender,
    }),
    coverageByDay,
    activePattern: activePattern
      ? {
          id: activePattern.id,
          name: activePattern.name,
          anchorDate: dateKey(activePattern.anchorDate),
          cycleLengthDays: activePattern.cycleLengthDays,
          status: activePattern.status,
        }
      : null,
  };
}

export async function createPattern(
  companyId: string,
  userId: string,
  input: {
    siteId: string;
    name: string;
    anchorDate: string;
    cycleLengthDays: number;
    effectiveFrom: string;
    cells?: { guardId: string; patternDayIndex: number; shiftCode: SiteRosterShiftCode; isLocked?: boolean }[];
  }
) {
  const site = await prisma.site.findFirst({ where: { id: input.siteId, companyId } });
  if (!site) return null;

  const pattern = await prisma.siteRosterPattern.create({
    data: {
      companyId,
      siteId: input.siteId,
      name: input.name,
      anchorDate: dateOnly(input.anchorDate),
      cycleLengthDays: input.cycleLengthDays,
      effectiveFrom: dateOnly(input.effectiveFrom),
      status: "draft",
      createdBy: userId,
      cells: input.cells?.length
        ? {
            create: input.cells.map((c) => ({
              guardId: c.guardId,
              patternDayIndex: c.patternDayIndex,
              shiftCode: c.shiftCode,
              shiftType: shiftCodeToType(c.shiftCode),
              isLocked: c.isLocked ?? false,
            })),
          }
        : undefined,
    },
    include: { _count: { select: { cells: true } } },
  });

  return mapPatternSummary(pattern);
}

export async function updatePattern(
  companyId: string,
  patternId: string,
  input: {
    name?: string;
    anchorDate?: string;
    cycleLengthDays?: number;
    effectiveFrom?: string;
    cells?: { guardId: string; patternDayIndex: number; shiftCode: SiteRosterShiftCode; isLocked?: boolean }[];
  }
) {
  const existing = await prisma.siteRosterPattern.findFirst({
    where: { id: patternId, companyId },
  });
  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    await tx.siteRosterPattern.update({
      where: { id: patternId },
      data: {
        name: input.name,
        anchorDate: input.anchorDate ? dateOnly(input.anchorDate) : undefined,
        cycleLengthDays: input.cycleLengthDays,
        effectiveFrom: input.effectiveFrom ? dateOnly(input.effectiveFrom) : undefined,
      },
    });
    if (input.cells) {
      await tx.siteRosterPatternCell.deleteMany({ where: { rosterPatternId: patternId } });
      if (input.cells.length > 0) {
        await tx.siteRosterPatternCell.createMany({
          data: input.cells.map((c) => ({
            rosterPatternId: patternId,
            guardId: c.guardId,
            patternDayIndex: c.patternDayIndex,
            shiftCode: c.shiftCode,
            shiftType: shiftCodeToType(c.shiftCode),
            isLocked: c.isLocked ?? false,
          })),
        });
      }
    }
  });

  const updated = await prisma.siteRosterPattern.findFirst({
    where: { id: patternId },
    include: { _count: { select: { cells: true } } },
  });
  return updated ? mapPatternSummary(updated) : null;
}

export async function activatePattern(
  companyId: string,
  patternId: string,
  effectiveFrom?: string
) {
  const pattern = await prisma.siteRosterPattern.findFirst({
    where: { id: patternId, companyId },
  });
  if (!pattern) return null;

  await prisma.$transaction(async (tx) => {
    await tx.siteRosterPattern.updateMany({
      where: { siteId: pattern.siteId, companyId, status: "active", id: { not: patternId } },
      data: { status: "archived" },
    });
    await tx.siteRosterPattern.update({
      where: { id: patternId },
      data: {
        status: "active",
        effectiveFrom: effectiveFrom ? dateOnly(effectiveFrom) : pattern.effectiveFrom,
      },
    });
  });

  const updated = await prisma.siteRosterPattern.findFirst({
    where: { id: patternId },
    include: { _count: { select: { cells: true } } },
  });
  return updated ? mapPatternSummary(updated) : null;
}

export async function generateRosterFromPattern(
  companyId: string,
  siteId: string,
  startDate: string,
  endDate: string,
  persist = true
) {
  const grid = await getLiveRoster(companyId, siteId, startDate, endDate);
  if (!grid) return null;

  const activePattern = await prisma.siteRosterPattern.findFirst({
    where: { siteId, companyId, status: "active" },
  });
  if (!activePattern) {
    return { generatedCount: 0, grid };
  }

  let generatedCount = 0;
  if (persist) {
    const patternCells = await prisma.siteRosterPatternCell.findMany({
      where: { rosterPatternId: activePattern.id },
    });
    const byGuardDay = new Map<string, SiteRosterShiftCode>();
    for (const c of patternCells) {
      byGuardDay.set(`${c.guardId}:${c.patternDayIndex}`, c.shiftCode);
    }

    const start = dateOnly(startDate);
    const end = dateOnly(endDate);
    for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
      const dayKey = dateKey(d);
      const pDay = patternDayForDate(activePattern.anchorDate, activePattern.cycleLengthDays, d);
      for (const row of grid.rows) {
        const code = byGuardDay.get(`${row.guardId}:${pDay}`) ?? "blank";
        if (!countsTowardCoverage(shiftCodeToType(code)) && code === "blank") continue;
        await prisma.siteRosterGeneratedShift.upsert({
          where: {
            siteId_guardId_rosterDate: {
              siteId,
              guardId: row.guardId,
              rosterDate: d,
            },
          },
          create: {
            companyId,
            siteId,
            guardId: row.guardId,
            rosterDate: d,
            shiftCode: code,
            shiftType: shiftCodeToType(code),
            source: "pattern",
            rosterPatternId: activePattern.id,
          },
          update: {
            shiftCode: code,
            shiftType: shiftCodeToType(code),
            source: "pattern",
            rosterPatternId: activePattern.id,
          },
        });
        generatedCount += 1;
      }
    }
    const refreshed = await getLiveRoster(companyId, siteId, startDate, endDate);
    return { generatedCount, grid: refreshed ?? grid };
  }

  return { generatedCount: 0, grid };
}

export async function applyManualOverride(
  companyId: string,
  userId: string,
  input: {
    siteId: string;
    guardId: string;
    rosterDate: string;
    overrideShiftCode: SiteRosterShiftCode;
    reason?: string;
    doesChangeBasePattern?: boolean;
  }
) {
  const site = await prisma.site.findFirst({ where: { id: input.siteId, companyId } });
  if (!site) return null;

  await applyManualOverrideWrite(prisma, companyId, userId, input);
  return { success: true };
}

async function applyManualOverrideWrite(
  tx: Prisma.TransactionClient | typeof prisma,
  companyId: string,
  userId: string,
  input: {
    siteId: string;
    guardId: string;
    rosterDate: string;
    overrideShiftCode: SiteRosterShiftCode;
    reason?: string;
    doesChangeBasePattern?: boolean;
  }
) {
  const rosterDate = dateOnly(input.rosterDate);

  if (input.overrideShiftCode === "blank") {
    await tx.siteRosterManualOverride.deleteMany({
      where: { siteId: input.siteId, guardId: input.guardId, rosterDate },
    });
    await tx.siteRosterGeneratedShift.deleteMany({
      where: { siteId: input.siteId, guardId: input.guardId, rosterDate },
    });
    return;
  }

  const existing = await tx.siteRosterGeneratedShift.findUnique({
    where: {
      siteId_guardId_rosterDate: {
        siteId: input.siteId,
        guardId: input.guardId,
        rosterDate,
      },
    },
  });

  await tx.siteRosterManualOverride.upsert({
    where: {
      siteId_guardId_rosterDate: {
        siteId: input.siteId,
        guardId: input.guardId,
        rosterDate,
      },
    },
    create: {
      companyId,
      siteId: input.siteId,
      guardId: input.guardId,
      rosterDate,
      originalShiftCode: existing?.shiftCode ?? null,
      overrideShiftCode: input.overrideShiftCode,
      overrideShiftType: shiftCodeToType(input.overrideShiftCode),
      reason: input.reason,
      doesChangeBasePattern: input.doesChangeBasePattern ?? false,
      createdBy: userId,
    },
    update: {
      overrideShiftCode: input.overrideShiftCode,
      overrideShiftType: shiftCodeToType(input.overrideShiftCode),
      reason: input.reason,
      doesChangeBasePattern: input.doesChangeBasePattern ?? false,
    },
  });

  await tx.siteRosterGeneratedShift.upsert({
    where: {
      siteId_guardId_rosterDate: {
        siteId: input.siteId,
        guardId: input.guardId,
        rosterDate,
      },
    },
    create: {
      companyId,
      siteId: input.siteId,
      guardId: input.guardId,
      rosterDate,
      shiftCode: input.overrideShiftCode,
      shiftType: shiftCodeToType(input.overrideShiftCode),
      source: "manual_override",
    },
    update: {
      shiftCode: input.overrideShiftCode,
      shiftType: shiftCodeToType(input.overrideShiftCode),
      source: "manual_override",
    },
  });
}

export async function applyManualOverridesBulk(
  companyId: string,
  userId: string,
  input: {
    siteId: string;
    changes: {
      guardId: string;
      rosterDate: string;
      overrideShiftCode: SiteRosterShiftCode;
      reason?: string;
      doesChangeBasePattern?: boolean;
    }[];
  }
) {
  const site = await prisma.site.findFirst({ where: { id: input.siteId, companyId } });
  if (!site) return null;

  const changesByKey = new Map<
    string,
    {
      guardId: string;
      rosterDate: Date;
      overrideShiftCode: SiteRosterShiftCode;
      reason?: string;
      doesChangeBasePattern?: boolean;
    }
  >();

  for (const change of input.changes) {
    const rosterDate = dateOnly(change.rosterDate);
    changesByKey.set(`${change.guardId}:${dateKey(rosterDate)}`, {
      ...change,
      rosterDate,
    });
  }

  const changes = Array.from(changesByKey.values());
  const keyWhere = changes.map((change) => ({
    siteId: input.siteId,
    guardId: change.guardId,
    rosterDate: change.rosterDate,
  }));
  const existingGenerated = await prisma.siteRosterGeneratedShift.findMany({
    where: { companyId, OR: keyWhere },
  });
  const existingOverrides = await prisma.siteRosterManualOverride.findMany({
    where: { companyId, OR: keyWhere },
  });
  const existingGeneratedByKey = new Map(
    existingGenerated.map((shift) => [`${shift.guardId}:${dateKey(shift.rosterDate)}`, shift])
  );
  const existingOverridesByKey = new Map(
    existingOverrides.map((override) => [`${override.guardId}:${dateKey(override.rosterDate)}`, override])
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.siteRosterManualOverride.deleteMany({ where: { companyId, OR: keyWhere } });
      await tx.siteRosterGeneratedShift.deleteMany({ where: { companyId, OR: keyWhere } });

      const nonBlankChanges = changes.filter((change) => change.overrideShiftCode !== "blank");
      if (nonBlankChanges.length === 0) return;

      await tx.siteRosterManualOverride.createMany({
        data: nonBlankChanges.map((change) => {
          const key = `${change.guardId}:${dateKey(change.rosterDate)}`;
          return {
            companyId,
            siteId: input.siteId,
            guardId: change.guardId,
            rosterDate: change.rosterDate,
            originalShiftCode:
              existingOverridesByKey.get(key)?.originalShiftCode ??
              existingGeneratedByKey.get(key)?.shiftCode ??
              null,
            overrideShiftCode: change.overrideShiftCode,
            overrideShiftType: shiftCodeToType(change.overrideShiftCode),
            reason: change.reason,
            doesChangeBasePattern: change.doesChangeBasePattern ?? false,
            createdBy: userId,
          };
        }),
      });

      await tx.siteRosterGeneratedShift.createMany({
        data: nonBlankChanges.map((change) => ({
          companyId,
          siteId: input.siteId,
          guardId: change.guardId,
          rosterDate: change.rosterDate,
          shiftCode: change.overrideShiftCode,
          shiftType: shiftCodeToType(change.overrideShiftCode),
          source: "manual_override",
        })),
      });
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  return { success: true, savedCount: input.changes.length };
}

export async function publishRoster(
  companyId: string,
  input: {
    siteId: string;
    startDate: string;
    endDate: string;
    replaceExisting?: boolean;
  }
) {
  const grid = await getLiveRoster(companyId, input.siteId, input.startDate, input.endDate);
  if (!grid) return null;

  const hardWarnings = grid.warnings.filter((warning) => warning.severity === "hard");
  if (hardWarnings.length > 0) {
    return {
      success: false,
      blocked: true,
      message: "Fix the roster issues before publishing shifts.",
      publishedCount: 0,
      skippedCount: 0,
      replacedCount: 0,
      warnings: hardWarnings,
    };
  }

  const timeZone = await getCompanyTimezone(companyId);
  const rangeStart = dateOnly(input.startDate);
  const rangeEnd = addCalendarDays(dateOnly(input.endDate), 2);
  const protectedShifts = await prisma.shift.findMany({
    where: {
      companyId,
      siteId: input.siteId,
      status: { notIn: ["created", "assigned"] },
      startTime: { lt: rangeEnd },
      endTime: { gt: rangeStart },
    },
    select: { id: true, startTime: true },
    take: 5,
  });

  if (protectedShifts.length > 0) {
    return {
      success: false,
      blocked: true,
      message: "Some shifts in this period are already active, completed, or verified. Adjust the period before publishing.",
      publishedCount: 0,
      skippedCount: 0,
      replacedCount: 0,
      warnings: [
        {
          code: "PROTECTED_SHIFTS_EXIST",
          severity: "hard" as const,
          message: "Existing active/completed/verified shifts prevent publishing over this period.",
        },
      ],
    };
  }

  const shiftsToCreate: Prisma.ShiftCreateManyInput[] = [];
  let skippedCount = 0;

  for (const row of grid.rows) {
    for (const cell of row.cells) {
      if (!cell.dateKey) continue;
      const code = cell.shiftCode as SiteRosterShiftCode;
      if (!WORKING_SHIFT_CODES.has(code)) {
        if (code !== "blank") skippedCount += 1;
        continue;
      }
      const shiftType = code === "N" ? "night" : "day";
      const { shiftStart, shiftEnd } = getShiftTimes(dateOnly(cell.dateKey), shiftType, timeZone);
      shiftsToCreate.push({
        companyId,
        employeeId: row.guardId,
        siteId: input.siteId,
        shiftType,
        legacyPostName: "Roster builder",
        startTime: shiftStart,
        endTime: shiftEnd,
        status: "assigned",
      });
    }
  }

  let replacedCount = 0;
  let publishedCount = 0;
  await prisma.$transaction(async (tx) => {
    if (input.replaceExisting !== false) {
      const deleted = await tx.shift.deleteMany({
        where: {
          companyId,
          siteId: input.siteId,
          status: { in: ["created", "assigned"] },
          startTime: { lt: rangeEnd },
          endTime: { gt: rangeStart },
        },
      });
      replacedCount = deleted.count;
    }
    if (shiftsToCreate.length > 0) {
      const created = await tx.shift.createMany({ data: shiftsToCreate });
      publishedCount = created.count;
    }
  });

  return {
    success: true,
    blocked: false,
    message:
      publishedCount > 0
        ? `${publishedCount} shift${publishedCount === 1 ? "" : "s"} published.`
        : "No day or night shifts were available to publish.",
    publishedCount,
    skippedCount,
    replacedCount,
    warnings: grid.warnings,
  };
}

export const ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX = "roster_placeholder";

/** Planning-only guard row — assign the real person later in attendance/timesheets. */
export async function addPlaceholderGuardToSite(
  companyId: string,
  siteId: string,
  type: "unknown" | "reliever"
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const [group, grade] = await Promise.all([
    prisma.employeeGroup.findFirst({ where: { companyId }, orderBy: { sortOrder: "asc" } }),
    prisma.payGrade.findFirst({ where: { companyId }, orderBy: { name: "asc" } }),
  ]);
  if (!group || !grade) {
    return {
      error:
        "Set up at least one employee group and pay grade before adding placeholder guards.",
    };
  }

  const existingPlaceholders = await prisma.employee.count({
    where: {
      companyId,
      jobRole: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` },
      siteAssignments: { some: { siteId, isActive: true } },
    },
  });
  const slot = existingPlaceholders + 1;
  const isReliever = type === "reliever";
  const firstName = isReliever ? "Reliever" : "Unknown";
  const lastName = slot > 1 ? `(Planning #${slot})` : "(Planning)";

  const existingNumbers = await prisma.employee.findMany({
    where: { companyId, employeeNumber: { startsWith: "PLN-" } },
    select: { employeeNumber: true },
  });
  let maxNum = 0;
  for (const row of existingNumbers) {
    const match = row.employeeNumber.match(/^PLN-(\d+)$/i);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  const employeeNumber = `PLN-${String(maxNum + 1).padStart(4, "0")}`;

  const employee = await prisma.$transaction(async (tx) => {
    const created = await tx.employee.create({
      data: {
        companyId,
        employeeNumber,
        firstName,
        lastName,
        status: isReliever ? "reliever" : "hired",
        employeeType: "security",
        jobRole: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:${type}`,
        groupId: group.id,
        gradeId: grade.id,
        psiraNumber: `ROSTER-TBD-${employeeNumber}`,
      },
    });
    await tx.siteAssignment.create({
      data: { siteId, employeeId: created.id, isActive: true },
    });
    return created;
  });

  return {
    guardId: employee.id,
    guardName: `${employee.firstName} ${employee.lastName}`.trim(),
    placeholderType: type,
  };
}
