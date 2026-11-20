import type { SiteRosterShiftCode } from "@prisma/client";
import { createAuditLog } from "../../../lib/audit.js";
import { prisma } from "../../../lib/prisma.js";
import { resolveSiteCoverageDays } from "../../../lib/site-coverage-days.js";
import {
  addDaysToDateKey,
  buildEffectiveHolidaySet,
  getIsoWeekStartKey,
  getSastDayOfWeek,
  parseLabourComplianceSettings,
  resolveEmployeeBceaCategory,
  resolveSitePsiraMode,
  toSastDateKey,
  type ObBookMode,
  type PsiraEnforcementMode,
} from "../../../lib/sa-labour-rules.config.js";
import { dateKey, dateOnly, ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX } from "../rosters.service.js";
import { ExternalHttpSolver } from "./external-http.solver.js";
import {
  calculateFrameworkStaffing,
  getSaSecurityFramework,
  type SaSecurityFrameworkId,
} from "./sa-frameworks.js";
import { buildShiftUtcBounds } from "./solver-helpers.js";
import type {
  SmartRosterDaySpec,
  SmartRosterGuardInput,
  SmartRosterPostInput,
  SmartRosterSolveRequest,
} from "./solver.types.js";

const solverAdapter = new ExternalHttpSolver();

function enumerateDateKeys(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate && keys.length < 62) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return keys;
}

function mapSiteGenderToPost(gender: string | null | undefined): "M" | "F" | "any" {
  if (!gender) return "any";
  const g = gender.trim().toLowerCase();
  if (g === "male" || g === "m") return "M";
  if (g === "female" || g === "f") return "F";
  return "any";
}

export async function updateSiteRosterSetup(
  companyId: string,
  siteId: string,
  userId: string,
  input: {
    operatingFramework?: SaSecurityFrameworkId;
    obBookMode?: ObBookMode | null;
    psiraEnforcementMode?: PsiraEnforcementMode | null;
    mealIntervalPaid?: boolean;
    mealIntervalMinutes?: number;
    dayGuardsRequired?: number;
    nightGuardsRequired?: number;
    dayStartTime?: string;
    dayEndTime?: string;
    nightStartTime?: string;
    nightEndTime?: string;
    dayShiftDays?: number[];
    nightShiftDays?: number[];
    assignedGuardIds?: string[];
    postUpdates?: Array<{
      id?: string;
      name: string;
      shiftType: "day" | "night";
      requiredPsiraGrade?: "E" | "D" | "C" | "B" | "A" | null;
      requiresFirearm?: boolean;
      requiredGender?: "M" | "F" | "any" | null;
    }>;
  },
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const fw = input.operatingFramework ? getSaSecurityFramework(input.operatingFramework) : null;
  const sitePatch: Record<string, unknown> = {};
  if (input.operatingFramework !== undefined) sitePatch.operatingFramework = input.operatingFramework;
  if (input.obBookMode !== undefined) sitePatch.obBookMode = input.obBookMode;
  if (input.psiraEnforcementMode !== undefined) {
    sitePatch.psiraEnforcementMode = input.psiraEnforcementMode;
  }
  if (input.mealIntervalPaid !== undefined) sitePatch.mealIntervalPaid = input.mealIntervalPaid;
  if (input.mealIntervalMinutes !== undefined) {
    sitePatch.mealIntervalMinutes = input.mealIntervalMinutes;
  }
  if (input.dayGuardsRequired !== undefined) {
    sitePatch.rosterDayShiftGuardsRequired = input.dayGuardsRequired;
  }
  if (input.nightGuardsRequired !== undefined) {
    sitePatch.rosterNightShiftGuardsRequired = input.nightGuardsRequired;
  }
  if (input.dayStartTime !== undefined) sitePatch.rosterDayShiftStartTime = input.dayStartTime;
  else if (fw && !site.rosterDayShiftStartTime) sitePatch.rosterDayShiftStartTime = fw.defaultDayStart;

  if (input.dayEndTime !== undefined) sitePatch.rosterDayShiftEndTime = input.dayEndTime;
  else if (fw && !site.rosterDayShiftEndTime) sitePatch.rosterDayShiftEndTime = fw.defaultDayEnd;

  if (input.nightStartTime !== undefined) {
    sitePatch.rosterNightShiftStartTime = input.nightStartTime;
  } else if (fw && !site.rosterNightShiftStartTime) {
    sitePatch.rosterNightShiftStartTime = fw.defaultNightStart;
  }

  if (input.nightEndTime !== undefined) sitePatch.rosterNightShiftEndTime = input.nightEndTime;
  else if (fw && !site.rosterNightShiftEndTime) {
    sitePatch.rosterNightShiftEndTime = fw.defaultNightEnd;
  }

  if (input.dayShiftDays !== undefined) sitePatch.rosterDayShiftDays = input.dayShiftDays;
  if (input.nightShiftDays !== undefined) sitePatch.rosterNightShiftDays = input.nightShiftDays;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(sitePatch).length > 0) {
      await tx.site.updateMany({ where: { id: siteId, companyId }, data: sitePatch });
    }

    if (input.assignedGuardIds !== undefined) {
      const validGuards = input.assignedGuardIds.length > 0
        ? await tx.employee.findMany({
            where: {
              id: { in: input.assignedGuardIds },
              companyId,
              employeeType: "security_officer",
              status: { in: ["active", "reliever"] },
              OR: [
                { jobRole: null },
                { jobRole: { not: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } } },
              ],
            },
            select: { id: true },
          })
        : [];
      await tx.siteAssignment.deleteMany({ where: { siteId } });
      if (validGuards.length > 0) {
        await tx.siteAssignment.createMany({
          data: validGuards.map((g) => ({ siteId, employeeId: g.id, isActive: true })),
          skipDuplicates: true,
        });
      }
    }

    if (input.postUpdates) {
      for (const p of input.postUpdates) {
        if (p.id) {
          await tx.sitePost.updateMany({
            where: { id: p.id, siteId },
            data: {
              name: p.name,
              requiredPsiraGrade: p.requiredPsiraGrade ?? null,
              requiresFirearm: p.requiresFirearm ?? false,
              requiredGender: p.requiredGender ?? null,
              shiftPatternPreference: p.shiftType,
            },
          });
        } else {
          const created = await tx.sitePost.create({
            data: {
              siteId,
              name: p.name,
              requiredPsiraGrade: p.requiredPsiraGrade ?? null,
              requiresFirearm: p.requiresFirearm ?? false,
              requiredGender: p.requiredGender ?? null,
              shiftPatternPreference: p.shiftType,
            },
          });
          await tx.coverageRequirement.create({
            data: {
              siteId,
              sitePostId: created.id,
              shiftTypeCode: p.shiftType,
              guardsRequired: 1,
              genderRule: "any",
            },
          });
        }
      }
    }
  });

  await createAuditLog({
    userId,
    companyId,
    action: "site.roster_setup_updated",
    entityType: "Site",
    entityId: siteId,
    metadata: {
      operatingFramework: input.operatingFramework,
      dayGuardsRequired: input.dayGuardsRequired,
      nightGuardsRequired: input.nightGuardsRequired,
    },
  });

  return { success: true, siteId };
}

async function buildSolveRequestForSite(
  companyId: string,
  siteId: string,
  input: {
    startDate: string;
    endDate: string;
    frameworkId?: SaSecurityFrameworkId;
    guardIds?: string[];
    includeRelieverPool?: boolean;
    allowOvertime?: boolean;
    maxWeeklyOvertimeHours?: number;
    preferDedicatedDayNight?: boolean;
  },
): Promise<{ request: SmartRosterSolveRequest; guardsPoolCount: number } | null> {
  const [site, company] = await Promise.all([
    prisma.site.findFirst({
      where: { id: siteId, companyId },
      include: {
        assignedGuards: { where: { isActive: true }, select: { employeeId: true } },
        posts: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: {
            coverageRequirements: { where: { isEnabled: true } },
            guardEligibilities: { select: { employeeId: true } },
          },
        },
      },
    }),
    prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } }),
  ]);

  if (!site) return null;

  const frameworkId =
    input.frameworkId ??
    (site.operatingFramework as SaSecurityFrameworkId | null) ??
    "4on4off_12h";
  const fw = getSaSecurityFramework(frameworkId);
  const labourSettings = parseLabourComplianceSettings(company?.settings);
  const psiraEnforcementMode = resolveSitePsiraMode(company?.settings, site.psiraEnforcementMode);

  const dayStartTime = site.rosterDayShiftStartTime ?? fw.defaultDayStart;
  const dayEndTime = site.rosterDayShiftEndTime ?? fw.defaultDayEnd;
  const nightStartTime = site.rosterNightShiftStartTime ?? fw.defaultNightStart;
  const nightEndTime = site.rosterNightShiftEndTime ?? fw.defaultNightEnd;

  const sampleBounds = buildShiftUtcBounds(input.startDate, "day", {
    dayStartTime,
    dayEndTime,
    nightStartTime,
    nightEndTime,
    shiftDurationHours: fw.shiftDurationHours,
  });

  const dateKeys = enumerateDateKeys(input.startDate, input.endDate);
  const lookbackStart = addDaysToDateKey(input.startDate, -7);
  const lookbackEnd = addDaysToDateKey(input.startDate, -1);

  const holidayYears = new Set<number>([
    Number(input.startDate.slice(0, 4)),
    Number(input.endDate.slice(0, 4)),
  ]);
  const dbHolidays = await prisma.publicHoliday.findMany({
    where: {
      companyId,
      date: {
        gte: dateOnly(input.startDate),
        lte: dateOnly(input.endDate),
      },
    },
  });
  const effectiveHolidays = buildEffectiveHolidaySet(
    holidayYears,
    dbHolidays.map((h) => ({ date: h.date, name: h.name ?? undefined, isRecurring: false })),
    true,
  );
  const holidaysMap: Record<string, string> = {};
  for (const [k, v] of effectiveHolidays) {
    holidaysMap[k] = v.name;
  }

  const days: SmartRosterDaySpec[] = dateKeys.map((dk) => {
    const dow = getSastDayOfWeek(dk);
    return {
      dateKey: dk,
      dayOfWeek: dow,
      isoWeekStartKey: getIsoWeekStartKey(dk),
      isSunday: dow === 0,
      isPublicHoliday: effectiveHolidays.has(dk),
    };
  });

  // Coverage days resolution (defaults to framework 5-day vs 7-day when site has null custom array)
  const coverage = resolveSiteCoverageDays(site);
  const defaultDayDays =
    site.rosterDayShiftDays != null ? [...coverage.day] : fw.id === "5on2off_day" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  const defaultNightDays =
    site.rosterNightShiftDays != null ? [...coverage.night] : fw.id === "5on2off_day" ? [] : [0, 1, 2, 3, 4, 5, 6];

  // Expand site posts or synthesize site-level post from headcounts
  const posts: SmartRosterPostInput[] = [];
  if (site.posts.length > 0) {
    const totalDayCov = site.posts.reduce(
      (n, p) => n + p.coverageRequirements.filter((c) => c.shiftTypeCode === "day").reduce((s, c) => s + c.guardsRequired, 0),
      0,
    );
    const totalNightCov = site.posts.reduce(
      (n, p) => n + p.coverageRequirements.filter((c) => c.shiftTypeCode === "night").reduce((s, c) => s + c.guardsRequired, 0),
      0,
    );

    site.posts.forEach((p, idx) => {
      let dayReq = p.coverageRequirements
        .filter((c) => c.shiftTypeCode === "day")
        .reduce((s, c) => s + c.guardsRequired, 0);
      let nightReq = p.coverageRequirements
        .filter((c) => c.shiftTypeCode === "night")
        .reduce((s, c) => s + c.guardsRequired, 0);
      if (totalDayCov === 0 && idx === 0) dayReq = site.rosterDayShiftGuardsRequired;
      if (totalNightCov === 0 && idx === 0) nightReq = site.rosterNightShiftGuardsRequired;

      posts.push({
        id: p.id,
        name: p.name,
        dayRequired: dayReq,
        nightRequired: nightReq,
        requiredPsiraGrade: p.requiredPsiraGrade ?? null,
        requiresFirearm: Boolean(p.requiresFirearm),
        requiredGender: (p.requiredGender as "M" | "F" | "any" | null) ?? "any",
        dayAllowedDays: defaultDayDays,
        nightAllowedDays: defaultNightDays,
      });
    });
  } else {
    posts.push({
      id: null,
      name: `${site.name} Post`,
      dayRequired: site.rosterDayShiftGuardsRequired,
      nightRequired: fw.id === "5on2off_day" ? 0 : site.rosterNightShiftGuardsRequired,
      requiredPsiraGrade: null,
      requiresFirearm: false,
      requiredGender: mapSiteGenderToPost(site.rosterDayShiftGender),
      dayAllowedDays: defaultDayDays,
      nightAllowedDays: defaultNightDays,
    });
  }

  // Load candidate guards: assigned guards + reliever pool (or all active guards if site has 0 assigned yet)
  const primaryGuardIds = new Set(site.assignedGuards.map((g) => g.employeeId));
  const allCompanyGuards = await prisma.employee.findMany({
    where: {
      companyId,
      employeeType: "security_officer",
      status: { in: ["active", "reliever"] },
      OR: [
        { jobRole: null },
        { jobRole: { not: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } } },
      ],
    },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      status: true,
      employeeType: true,
      bceaSectorOverride: true,
      gender: true,
      psiraGrade: true,
      psiraRegistrationNumber: true,
      psiraRegistrationExpiry: true,
      firearmCompetency: true,
      firearmCompetencyExpiry: true,
      armedGuard: true,
      preferredShiftType: true,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const explicitSet = input.guardIds && input.guardIds.length > 0 ? new Set(input.guardIds) : null;
  const candidateEmployees = allCompanyGuards.filter((emp) => {
    if (explicitSet) return explicitSet.has(emp.id);
    if (primaryGuardIds.size === 0) return true; // brand-new site without pre-assigned guards
    if (primaryGuardIds.has(emp.id)) return true;
    return (input.includeRelieverPool ?? true) && emp.status === "reliever";
  });

  const candidateIds = candidateEmployees.map((e) => e.id);
  const eligibilityByGuard = new Map<string, string[]>();
  for (const post of site.posts) {
    for (const el of post.guardEligibilities) {
      if (!eligibilityByGuard.has(el.employeeId)) eligibilityByGuard.set(el.employeeId, []);
      eligibilityByGuard.get(el.employeeId)!.push(post.id);
    }
  }

  const [lookbackGenerated, otherSiteShifts, approvedLeaves] =
    candidateIds.length > 0
      ? await Promise.all([
          prisma.siteRosterGeneratedShift.findMany({
            where: {
              companyId,
              guardId: { in: candidateIds },
              rosterDate: { gte: dateOnly(lookbackStart), lte: dateOnly(lookbackEnd) },
              shiftCode: { in: ["D", "N", "R"] },
            },
            select: { guardId: true, rosterDate: true, shiftType: true },
          }),
          prisma.shift.findMany({
            where: {
              companyId,
              employeeId: { in: candidateIds },
              siteId: { not: siteId },
              status: { in: ["created", "assigned", "active", "completed", "verified"] },
              startTime: { lt: new Date(`${addDaysToDateKey(input.endDate, 2)}T00:00:00+02:00`) },
              endTime: { gt: new Date(`${addDaysToDateKey(input.startDate, -2)}T00:00:00+02:00`) },
            },
            select: {
              employeeId: true,
              siteId: true,
              shiftType: true,
              startTime: true,
              endTime: true,
              site: { select: { name: true } },
            },
          }),
          prisma.leaveRequest.findMany({
            where: {
              companyId,
              employeeId: { in: candidateIds },
              status: "APPROVED",
              startDate: { lte: dateOnly(input.endDate) },
              endDate: { gte: dateOnly(input.startDate) },
            },
            select: { employeeId: true, startDate: true, endDate: true },
          }),
        ])
      : [[], [], []];

  // Build quick lookup maps
  const priorHoursMap = new Map<string, Record<string, number>>();
  const priorDatesMap = new Map<string, string[]>();
  const priorLastShiftMap = new Map<string, "day" | "night" | "off" | null>();

  for (const row of lookbackGenerated) {
    const dk = dateKey(row.rosterDate);
    const wk = getIsoWeekStartKey(dk);
    if (!priorHoursMap.has(row.guardId)) priorHoursMap.set(row.guardId, {});
    const hrs = priorHoursMap.get(row.guardId)!;
    hrs[wk] = (hrs[wk] ?? 0) + sampleBounds.durationHours;

    if (!priorDatesMap.has(row.guardId)) priorDatesMap.set(row.guardId, []);
    priorDatesMap.get(row.guardId)!.push(dk);

    if (dk === lookbackEnd) {
      priorLastShiftMap.set(
        row.guardId,
        row.shiftType === "night" ? "night" : row.shiftType === "day" ? "day" : "off",
      );
    }
  }

  const otherShiftsMap = new Map<string, SmartRosterGuardInput["otherSiteShiftsByDate"]>();
  for (const s of otherSiteShifts) {
    const dk = toSastDateKey(s.startTime);
    const wk = getIsoWeekStartKey(dk);
    // Also fold lookback other-site shifts into weekly hours
    if (dk < input.startDate) {
      if (!priorHoursMap.has(s.employeeId)) priorHoursMap.set(s.employeeId, {});
      const hrs = priorHoursMap.get(s.employeeId)!;
      hrs[wk] = (hrs[wk] ?? 0) + Math.max(0, (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000);
      if (!priorDatesMap.has(s.employeeId)) priorDatesMap.set(s.employeeId, []);
      priorDatesMap.get(s.employeeId)!.push(dk);
    }
    if (!otherShiftsMap.has(s.employeeId)) otherShiftsMap.set(s.employeeId, {});
    const byDate = otherShiftsMap.get(s.employeeId)!;
    if (!byDate[dk]) byDate[dk] = [];
    byDate[dk]!.push({
      siteId: s.siteId,
      siteName: s.site?.name ?? "Other Site",
      shiftType: s.shiftType === "night" ? "night" : "day",
      startTimeIso: s.startTime.toISOString(),
      endTimeIso: s.endTime.toISOString(),
    });
  }

  const leaveDatesMap = new Map<string, string[]>();
  for (const lv of approvedLeaves) {
    let cur = dateKey(lv.startDate);
    const end = dateKey(lv.endDate);
    if (!leaveDatesMap.has(lv.employeeId)) leaveDatesMap.set(lv.employeeId, []);
    const arr = leaveDatesMap.get(lv.employeeId)!;
    while (cur <= end) {
      if (cur >= input.startDate && cur <= input.endDate) arr.push(cur);
      cur = addDaysToDateKey(cur, 1);
    }
  }

  const guards: SmartRosterGuardInput[] = candidateEmployees.map((emp) => ({
    id: emp.id,
    employeeNumber: emp.employeeNumber,
    fullName: `${emp.firstName} ${emp.lastName}`.trim(),
    status: emp.status,
    employeeType: emp.employeeType,
    bceaCategory: resolveEmployeeBceaCategory(emp.employeeType, emp.bceaSectorOverride, company?.settings),
    gender: emp.gender,
    psiraGrade: emp.psiraGrade,
    psiraRegistrationNumber: emp.psiraRegistrationNumber,
    psiraRegistrationExpiry: emp.psiraRegistrationExpiry?.toISOString().slice(0, 10) ?? null,
    firearmCompetency: emp.firearmCompetency,
    firearmCompetencyExpiry: emp.firearmCompetencyExpiry?.toISOString().slice(0, 10) ?? null,
    armedGuard: emp.armedGuard,
    preferredShiftType:
      emp.preferredShiftType === "day" || emp.preferredShiftType === "night"
        ? emp.preferredShiftType
        : "any",
    isSitePrimary: primaryGuardIds.has(emp.id),
    isReliever: emp.status === "reliever",
    eligiblePostIds: eligibilityByGuard.get(emp.id) ?? [],
    priorWeekWorkedHoursByWeekKey: priorHoursMap.get(emp.id) ?? {},
    priorWorkDateKeys: priorDatesMap.get(emp.id) ?? [],
    priorDayLastShiftType: priorLastShiftMap.get(emp.id) ?? null,
    leaveDateKeys: leaveDatesMap.get(emp.id) ?? [],
    otherSiteShiftsByDate: otherShiftsMap.get(emp.id) ?? {},
  }));

  return {
    guardsPoolCount: guards.length,
    request: {
      siteId,
      siteName: site.name,
      frameworkId,
      periodStart: input.startDate,
      periodEnd: input.endDate,
      dayStartTime,
      dayEndTime,
      nightStartTime,
      nightEndTime,
      shiftDurationHours: sampleBounds.durationHours,
      mealIntervalPaid: site.mealIntervalPaid,
      mealIntervalMinutes: site.mealIntervalMinutes,
      psiraEnforcementMode,
      averagingEnabled: labourSettings.averagingEnabled,
      averagingWeeks: labourSettings.averagingWeeks,
      fortnightlyRestEnabled: labourSettings.fortnightlyRestEnabled,
      allowOvertime: input.allowOvertime ?? false,
      maxWeeklyOvertimeHours: input.maxWeeklyOvertimeHours ?? 10,
      preferDedicatedDayNight: input.preferDedicatedDayNight ?? true,
      posts,
      guards,
      days,
      holidaysMap,
    },
  };
}

export async function previewSmartRoster(
  companyId: string,
  siteId: string,
  input: {
    startDate: string;
    endDate: string;
    frameworkId?: SaSecurityFrameworkId;
    guardIds?: string[];
    includeRelieverPool?: boolean;
    allowOvertime?: boolean;
    maxWeeklyOvertimeHours?: number;
    preferDedicatedDayNight?: boolean;
  },
) {
  const built = await buildSolveRequestForSite(companyId, siteId, input);
  if (!built) return null;

  const solveResult = await solverAdapter.solve(built.request);
  const totalDayRequired = built.request.posts.reduce((n, p) => n + p.dayRequired, 0);
  const totalNightRequired = built.request.posts.reduce((n, p) => n + p.nightRequired, 0);
  const staffingEstimate = calculateFrameworkStaffing({
    frameworkId: built.request.frameworkId,
    dayGuardsRequired: totalDayRequired,
    nightGuardsRequired: totalNightRequired,
    dayDaysPerWeek: built.request.posts[0]?.dayAllowedDays.length ?? 7,
    nightDaysPerWeek: built.request.posts[0]?.nightAllowedDays.length ?? 7,
    shiftDurationHours: built.request.shiftDurationHours,
  });

  return {
    siteId,
    siteName: built.request.siteName,
    frameworkId: built.request.frameworkId,
    periodStart: built.request.periodStart,
    periodEnd: built.request.periodEnd,
    guardsPoolCount: built.guardsPoolCount,
    staffingEstimate,
    ...solveResult,
  };
}

export async function applySmartRoster(
  companyId: string,
  siteId: string,
  userId: string,
  input: {
    startDate: string;
    endDate: string;
    frameworkId?: SaSecurityFrameworkId;
    publishImmediately?: boolean;
    assignments: Array<{
      guardId: string;
      dateKey: string;
      shiftType: "day" | "night";
      shiftCode: "D" | "N" | "R";
      postId?: string | null;
    }>;
  },
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const uniqueGuardIds = [...new Set(input.assignments.map((a) => a.guardId))];
  if (uniqueGuardIds.length > 0) {
    const valid = await prisma.employee.findMany({
      where: {
        id: { in: uniqueGuardIds },
        companyId,
        employeeType: "security_officer",
        OR: [
          { jobRole: null },
          { jobRole: { not: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } } },
        ],
      },
      select: { id: true },
    });
    if (valid.length !== uniqueGuardIds.length) {
      throw new Error("All assigned guards must be active security officers belonging to this company");
    }
  }

  const startDt = dateOnly(input.startDate);
  const endDt = dateOnly(input.endDate);
  const publishRangeStart = startDt;
  const publishRangeEnd = new Date(endDt.getTime() + 2 * 86_400_000);

  // Never overwrite shifts already clocked/completed/verified in live attendance
  const protectedShifts = await prisma.shift.findMany({
    where: {
      companyId,
      siteId,
      status: { notIn: ["created", "assigned"] },
      startTime: { lt: publishRangeEnd },
      endTime: { gt: publishRangeStart },
    },
    select: { employeeId: true, startTime: true },
  });
  const protectedDateKeys = new Set(protectedShifts.map((s) => toSastDateKey(s.startTime)));

  const fw = getSaSecurityFramework(input.frameworkId ?? site.operatingFramework);
  const shiftConfig = {
    dayStartTime: site.rosterDayShiftStartTime ?? fw.defaultDayStart,
    dayEndTime: site.rosterDayShiftEndTime ?? fw.defaultDayEnd,
    nightStartTime: site.rosterNightShiftStartTime ?? fw.defaultNightStart,
    nightEndTime: site.rosterNightShiftEndTime ?? fw.defaultNightEnd,
    shiftDurationHours: fw.shiftDurationHours,
  };

  const workingAssignments = input.assignments.filter(
    (a) =>
      a.dateKey >= input.startDate &&
      a.dateKey <= input.endDate &&
      !protectedDateKeys.has(a.dateKey),
  );

  let appliedCount = 0;
  let publishedCount = 0;

  await prisma.$transaction(async (tx) => {
    if (input.frameworkId) {
      await tx.site.updateMany({
        where: { id: siteId, companyId },
        data: { operatingFramework: input.frameworkId },
      });
    }

    // Clear prior pattern shifts in non-protected dates for this site/period
    const dateList = enumerateDateKeys(input.startDate, input.endDate).filter(
      (dk) => !protectedDateKeys.has(dk),
    );
    if (dateList.length > 0) {
      await tx.siteRosterGeneratedShift.deleteMany({
        where: {
          companyId,
          siteId,
          rosterDate: { in: dateList.map((dk) => dateOnly(dk)) },
        },
      });
    }

    for (const a of workingAssignments) {
      const rosterDate = dateOnly(a.dateKey);
      await tx.siteRosterGeneratedShift.upsert({
        where: {
          siteId_guardId_rosterDate: {
            siteId,
            guardId: a.guardId,
            rosterDate,
          },
        },
        create: {
          companyId,
          siteId,
          guardId: a.guardId,
          rosterDate,
          shiftCode: a.shiftCode,
          shiftType: a.shiftType === "night" ? "night" : "day",
          source: "pattern",
          sitePostId: a.postId ?? null,
        },
        update: {
          shiftCode: a.shiftCode,
          shiftType: a.shiftType === "night" ? "night" : "day",
          source: "pattern",
          sitePostId: a.postId ?? null,
        },
      });
      appliedCount += 1;
    }

    if (input.publishImmediately !== false) {
      await tx.shift.deleteMany({
        where: {
          companyId,
          siteId,
          status: { in: ["created", "assigned"] },
          startTime: { lt: publishRangeEnd },
          endTime: { gt: publishRangeStart },
        },
      });

      if (workingAssignments.length > 0) {
        const shiftRows = workingAssignments.map((a) => {
          const { startTime, endTime } = buildShiftUtcBounds(a.dateKey, a.shiftType, shiftConfig);
          return {
            companyId,
            employeeId: a.guardId,
            siteId,
            shiftType: a.shiftType,
            legacyPostName: "Smart Roster",
            startTime,
            endTime,
            status: "assigned" as const,
          };
        });
        const created = await tx.shift.createMany({ data: shiftRows });
        publishedCount = created.count;
      }
    }
  });

  await createAuditLog({
    userId,
    companyId,
    action: "roster.smart_apply",
    entityType: "Site",
    entityId: siteId,
    metadata: {
      startDate: input.startDate,
      endDate: input.endDate,
      frameworkId: input.frameworkId ?? site.operatingFramework,
      appliedCount,
      publishedCount,
      protectedDatesSkipped: protectedDateKeys.size,
    },
  });

  return {
    success: true,
    siteId,
    appliedCount,
    publishedCount,
    protectedDatesSkipped: protectedDateKeys.size,
  };
}

export async function quickEditRosterCell(
  companyId: string,
  siteId: string,
  userId: string,
  input: {
    rosterDate: string;
    guardId: string;
    replacementGuardId?: string;
    shiftCode: "D" | "N" | "O" | "R";
    sitePostId?: string | null;
    reason?: string;
    syncPublishedShift?: boolean;
  },
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const targetGuardId = input.replacementGuardId ?? input.guardId;
  const checkIds = input.replacementGuardId
    ? [input.guardId, input.replacementGuardId]
    : [input.guardId];

  const validGuards = await prisma.employee.findMany({
    where: {
      id: { in: checkIds },
      companyId,
      OR: [
        { jobRole: null },
        { jobRole: { not: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } } },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
  });
  if (validGuards.length !== new Set(checkIds).size) {
    throw new Error("Guard does not belong to this company");
  }

  const rosterDate = dateOnly(input.rosterDate);
  const warnings: string[] = [];

  if (input.shiftCode !== "O") {
    const leaveConflict = await prisma.leaveRequest.findFirst({
      where: {
        companyId,
        employeeId: targetGuardId,
        status: "APPROVED",
        startDate: { lte: rosterDate },
        endDate: { gte: rosterDate },
      },
      select: { leaveType: true },
    });
    if (leaveConflict) {
      return {
        error: `Selected guard has approved ${leaveConflict.leaveType.toLowerCase()} leave on ${input.rosterDate}.`,
      };
    }

    const otherShift = await prisma.shift.findFirst({
      where: {
        companyId,
        employeeId: targetGuardId,
        siteId: { not: siteId },
        status: { in: ["created", "assigned", "active"] },
        startTime: { lt: new Date(`${addDaysToDateKey(input.rosterDate, 1)}T18:00:00+02:00`) },
        endTime: { gt: new Date(`${input.rosterDate}T06:00:00+02:00`) },
      },
      include: { site: { select: { name: true } } },
    });
    if (otherShift) {
      warnings.push(`Note: guard also has a shift at ${otherShift.site?.name ?? "another site"} nearby.`);
    }
  }

  const shiftType = input.shiftCode === "N" ? "night" : input.shiftCode === "O" ? "off" : "day";
  const fw = getSaSecurityFramework(site.operatingFramework);
  const bounds =
    input.shiftCode === "O"
      ? null
      : buildShiftUtcBounds(input.rosterDate, input.shiftCode === "N" ? "night" : "day", {
          dayStartTime: site.rosterDayShiftStartTime ?? fw.defaultDayStart,
          dayEndTime: site.rosterDayShiftEndTime ?? fw.defaultDayEnd,
          nightStartTime: site.rosterNightShiftStartTime ?? fw.defaultNightStart,
          nightEndTime: site.rosterNightShiftEndTime ?? fw.defaultNightEnd,
          shiftDurationHours: fw.shiftDurationHours,
        });

  await prisma.$transaction(async (tx) => {
    if (input.replacementGuardId && input.replacementGuardId !== input.guardId) {
      // Clear original guard's generated cell -> Off
      await tx.siteRosterGeneratedShift.upsert({
        where: {
          siteId_guardId_rosterDate: { siteId, guardId: input.guardId, rosterDate },
        },
        create: {
          companyId,
          siteId,
          guardId: input.guardId,
          rosterDate,
          shiftCode: "O",
          shiftType: "off",
          source: "replacement",
        },
        update: {
          shiftCode: "O",
          shiftType: "off",
          source: "replacement",
        },
      });
    }

    await tx.siteRosterGeneratedShift.upsert({
      where: {
        siteId_guardId_rosterDate: { siteId, guardId: targetGuardId, rosterDate },
      },
      create: {
        companyId,
        siteId,
        guardId: targetGuardId,
        rosterDate,
        shiftCode: input.shiftCode as SiteRosterShiftCode,
        shiftType,
        source: input.replacementGuardId ? "replacement" : "manual_override",
        sitePostId: input.sitePostId ?? null,
      },
      update: {
        shiftCode: input.shiftCode as SiteRosterShiftCode,
        shiftType,
        source: input.replacementGuardId ? "replacement" : "manual_override",
        sitePostId: input.sitePostId ?? null,
      },
    });

    if (input.syncPublishedShift !== false) {
      const dayWinStart = new Date(`${input.rosterDate}T00:00:00+02:00`);
      const dayWinEnd = new Date(`${addDaysToDateKey(input.rosterDate, 1)}T00:00:00+02:00`);

      await tx.shift.deleteMany({
        where: {
          companyId,
          siteId,
          employeeId: { in: checkIds },
          status: { in: ["created", "assigned"] },
          startTime: { gte: dayWinStart, lt: dayWinEnd },
        },
      });

      if (bounds && input.shiftCode !== "O") {
        await tx.shift.create({
          data: {
            companyId,
            siteId,
            employeeId: targetGuardId,
            shiftType: input.shiftCode === "N" ? "night" : "day",
            legacyPostName: "Roster quick edit",
            startTime: bounds.startTime,
            endTime: bounds.endTime,
            status: "assigned",
          },
        });
      }
    }
  });

  await createAuditLog({
    userId,
    companyId,
    action: "roster.quick_edit",
    entityType: "Site",
    entityId: siteId,
    metadata: {
      rosterDate: input.rosterDate,
      guardId: input.guardId,
      replacementGuardId: input.replacementGuardId ?? null,
      shiftCode: input.shiftCode,
      reason: input.reason ?? null,
    },
  });

  return { success: true, warnings };
}

export async function autoBuildUnrosteredSites(
  companyId: string,
  userId: string,
  input: {
    startDate: string;
    endDate: string;
    dryRun?: boolean;
    siteIds?: string[];
  },
) {
  const sites = await prisma.site.findMany({
    where: {
      companyId,
      siteStatus: "ACTIVE",
      ...(input.siteIds && input.siteIds.length > 0 ? { id: { in: input.siteIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      operatingFramework: true,
      rosterDayShiftGuardsRequired: true,
      rosterNightShiftGuardsRequired: true,
    },
    orderBy: { name: "asc" },
    take: 30,
  });

  const existingCounts = await prisma.siteRosterGeneratedShift.groupBy({
    by: ["siteId"],
    where: {
      companyId,
      siteId: { in: sites.map((s) => s.id) },
      rosterDate: { gte: dateOnly(input.startDate), lte: dateOnly(input.endDate) },
      shiftCode: { in: ["D", "N", "R"] },
    },
    _count: { _all: true },
  });
  const countBySite = new Map(existingCounts.map((c) => [c.siteId, c._count._all]));

  const results: Array<{
    siteId: string;
    siteName: string;
    status: "built" | "previewed" | "skipped_already_rostered" | "skipped_zero_headcount";
    coveragePercent: number;
    filledSlots: number;
    requiredSlots: number;
    overtimeHours: number;
    unfilledCount: number;
  }> = [];

  for (const site of sites) {
    if ((countBySite.get(site.id) ?? 0) > 0) {
      results.push({
        siteId: site.id,
        siteName: site.name,
        status: "skipped_already_rostered",
        coveragePercent: 100,
        filledSlots: countBySite.get(site.id) ?? 0,
        requiredSlots: countBySite.get(site.id) ?? 0,
        overtimeHours: 0,
        unfilledCount: 0,
      });
      continue;
    }

    if (site.rosterDayShiftGuardsRequired === 0 && site.rosterNightShiftGuardsRequired === 0) {
      results.push({
        siteId: site.id,
        siteName: site.name,
        status: "skipped_zero_headcount",
        coveragePercent: 0,
        filledSlots: 0,
        requiredSlots: 0,
        overtimeHours: 0,
        unfilledCount: 0,
      });
      continue;
    }

    const preview = await previewSmartRoster(companyId, site.id, {
      startDate: input.startDate,
      endDate: input.endDate,
      frameworkId: (site.operatingFramework as SaSecurityFrameworkId | null) ?? "4on4off_12h",
      includeRelieverPool: true,
      allowOvertime: false,
      preferDedicatedDayNight: true,
    });
    if (!preview) continue;

    if (!input.dryRun && preview.assignments.length > 0) {
      await applySmartRoster(companyId, site.id, userId, {
        startDate: input.startDate,
        endDate: input.endDate,
        frameworkId: preview.frameworkId,
        publishImmediately: true,
        assignments: preview.assignments.map((a) => ({
          guardId: a.guardId,
          dateKey: a.dateKey,
          shiftType: a.shiftType,
          shiftCode: a.shiftCode,
          postId: a.postId,
        })),
      });
    }

    results.push({
      siteId: site.id,
      siteName: site.name,
      status: input.dryRun ? "previewed" : "built",
      coveragePercent: preview.metrics.coveragePercent,
      filledSlots: preview.metrics.totalFilledSlots,
      requiredSlots: preview.metrics.totalRequiredSlots,
      overtimeHours: preview.metrics.totalOvertimeHours,
      unfilledCount: preview.unfilledSlots.length,
    });
  }

  return {
    periodStart: input.startDate,
    periodEnd: input.endDate,
    dryRun: Boolean(input.dryRun),
    builtCount: results.filter((r) => r.status === "built").length,
    previewedCount: results.filter((r) => r.status === "previewed").length,
    sites: results,
  };
}
