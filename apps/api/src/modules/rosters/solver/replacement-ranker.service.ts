import { prisma } from "../../../lib/prisma.js";
import {
  addDaysToDateKey,
  getIsoWeekStartKey,
  hasMinimumPsiraGrade,
  resolveEmployeeBceaCategory,
  resolveSitePsiraMode,
  SA_NBCPSS_RULES,
  toSastDateKey,
  type PsiraEnforcementMode,
} from "../../../lib/sa-labour-rules.config.js";
import { ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX } from "../rosters.service.js";
import { buildShiftUtcBounds, normalizeGenderCode } from "./solver-helpers.js";

export interface RankedReplacementCandidate {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  status: string;
  psiraGrade: string | null;
  psiraExpiry: string | null;
  firearmCompetency: boolean;
  gender: string | null;
  isSitePrimary: boolean;
  isReliever: boolean;
  weekHoursBefore: number;
  weekHoursAfter: number;
  projectedOvertimeHours: number;
  eligible: boolean;
  ineligibleReason?: string;
  score: number;
  badges: string[];
  warnings: string[];
}

export async function rankReplacementCandidates(params: {
  companyId: string;
  siteId: string;
  workDate: string; // YYYY-MM-DD
  shiftType: "day" | "night";
  postId?: string | null;
  excludeEmployeeId?: string | null;
}): Promise<{
  siteName: string;
  requiredGrade: string | null;
  requiresFirearm: boolean;
  psiraEnforcementMode: PsiraEnforcementMode;
  candidates: RankedReplacementCandidate[];
}> {
  const [site, company, employees] = await Promise.all([
    prisma.site.findFirst({
      where: { id: params.siteId, companyId: params.companyId },
      include: {
        assignedGuards: { where: { isActive: true }, select: { employeeId: true } },
        posts: {
          where: { isActive: true },
          include: { guardEligibilities: { select: { employeeId: true } } },
        },
      },
    }),
    prisma.company.findUnique({
      where: { id: params.companyId },
      select: { settings: true },
    }),
    prisma.employee.findMany({
      where: {
        companyId: params.companyId,
        employeeType: "security_officer",
        status: { in: ["active", "reliever"] },
        OR: [
          { jobRole: null },
          { jobRole: { not: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        status: true,
        employeeType: true,
        bceaSectorOverride: true,
        gender: true,
        psiraGrade: true,
        psiraRegistrationExpiry: true,
        firearmCompetency: true,
        firearmCompetencyExpiry: true,
        preferredShiftType: true,
      },
    }),
  ]);

  if (!site) {
    throw new Error("Site not found");
  }

  const psiraMode = resolveSitePsiraMode(company?.settings, site.psiraEnforcementMode);
  const post = params.postId ? site.posts.find((p) => p.id === params.postId) : site.posts[0] ?? null;
  const requiredGrade = post?.requiredPsiraGrade ?? null;
  const requiresFirearm = Boolean(post?.requiresFirearm);
  const siteShiftGender =
    params.shiftType === "night" ? site.rosterNightShiftGender : site.rosterDayShiftGender;
  const requiredGender =
    post?.requiredGender && post.requiredGender !== "any"
      ? normalizeGenderCode(post.requiredGender)
      : normalizeGenderCode(siteShiftGender);

  const weekStartKey = getIsoWeekStartKey(params.workDate);
  const weekEndKey = addDaysToDateKey(weekStartKey, 6);
  const queryStartKey = addDaysToDateKey(
    weekStartKey < addDaysToDateKey(params.workDate, -6)
      ? weekStartKey
      : addDaysToDateKey(params.workDate, -6),
    -1,
  );
  const queryEndKey = addDaysToDateKey(
    weekEndKey > addDaysToDateKey(params.workDate, 6)
      ? weekEndKey
      : addDaysToDateKey(params.workDate, 6),
    2,
  );
  const queryStart = new Date(`${queryStartKey}T00:00:00+02:00`);
  const queryEnd = new Date(`${queryEndKey}T00:00:00+02:00`);

  const targetBounds = buildShiftUtcBounds(params.workDate, params.shiftType, {
    dayStartTime: site.rosterDayShiftStartTime ?? "06:00",
    dayEndTime: site.rosterDayShiftEndTime ?? "18:00",
    nightStartTime: site.rosterNightShiftStartTime ?? "18:00",
    nightEndTime: site.rosterNightShiftEndTime ?? "06:00",
    shiftDurationHours: 12,
  });

  const [weekShifts, leaveRequests] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId: params.companyId,
        status: { in: ["created", "assigned", "active", "completed", "verified"] },
        startTime: { lt: queryEnd },
        endTime: { gt: queryStart },
      },
      select: {
        employeeId: true,
        siteId: true,
        startTime: true,
        endTime: true,
        site: { select: { name: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: {
        companyId: params.companyId,
        status: "APPROVED",
        startDate: { lte: new Date(`${params.workDate}T23:59:59.999Z`) },
        endDate: { gte: new Date(`${params.workDate}T00:00:00.000Z`) },
      },
      select: { employeeId: true },
    }),
  ]);

  const leaveSet = new Set(leaveRequests.map((l) => l.employeeId));
  const primarySet = new Set(site.assignedGuards.map((g) => g.employeeId));
  const shiftsByEmp = new Map<string, typeof weekShifts>();
  for (const s of weekShifts) {
    if (!shiftsByEmp.has(s.employeeId)) shiftsByEmp.set(s.employeeId, []);
    shiftsByEmp.get(s.employeeId)!.push(s);
  }

  const minRestMs = SA_NBCPSS_RULES.minDailyRestHours * 3_600_000;
  const candidates: RankedReplacementCandidate[] = [];

  for (const emp of employees) {
    if (params.excludeEmployeeId && emp.id === params.excludeEmployeeId) continue;

    const fullName = `${emp.firstName} ${emp.lastName}`.trim();
    const isSitePrimary = primarySet.has(emp.id);
    const isReliever = emp.status === "reliever";
    const empShifts = shiftsByEmp.get(emp.id) ?? [];

    let weekHoursBefore = 0;
    let overlapReason: string | undefined;
    let restReason: string | undefined;
    const workedDateKeys = new Set<string>();

    for (const s of empShifts) {
      const sDk = toSastDateKey(s.startTime);
      workedDateKeys.add(sDk);
      if (sDk >= weekStartKey && sDk <= weekEndKey) {
        weekHoursBefore += Math.max(0, (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000);
      }
      if (
        s.startTime.getTime() < targetBounds.endTime.getTime() &&
        s.endTime.getTime() > targetBounds.startTime.getTime()
      ) {
        overlapReason = `Already working at ${s.site?.name ?? "another site"}`;
      } else {
        const gapAfter = targetBounds.startTime.getTime() - s.endTime.getTime();
        const gapBefore = s.startTime.getTime() - targetBounds.endTime.getTime();
        if ((gapAfter >= 0 && gapAfter < minRestMs) || (gapBefore >= 0 && gapBefore < minRestMs)) {
          restReason = `Less than 12h rest around shift at ${s.site?.name ?? "site"}`;
        }
      }
    }

    if (!overlapReason && !restReason) {
      let streak = 1;
      for (let off = 1; off <= 6; off++) {
        if (!workedDateKeys.has(addDaysToDateKey(params.workDate, -off))) break;
        streak += 1;
      }
      for (let off = 1; off <= 6; off++) {
        if (!workedDateKeys.has(addDaysToDateKey(params.workDate, off))) break;
        streak += 1;
      }
      if (streak > 6) {
        restReason = "Would exceed 6 consecutive working days";
      }
    }

    weekHoursBefore = Math.round(weekHoursBefore * 10) / 10;
    const weekHoursAfter = Math.round((weekHoursBefore + targetBounds.durationHours) * 10) / 10;
    const empCategory = resolveEmployeeBceaCategory(
      emp.employeeType,
      emp.bceaSectorOverride,
      company?.settings,
    );
    const ordCap =
      empCategory === "general"
        ? SA_NBCPSS_RULES.generalStaffMaxWeeklyOrdinaryHours
        : SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours;
    const projectedOvertimeHours = Math.max(0, Math.round((weekHoursAfter - ordCap) * 10) / 10);

    let eligible = true;
    let ineligibleReason: string | undefined;
    const warnings: string[] = [];
    const badges: string[] = [];

    if (leaveSet.has(emp.id)) {
      eligible = false;
      ineligibleReason = "On approved leave";
    } else if (overlapReason) {
      eligible = false;
      ineligibleReason = overlapReason;
    } else if (restReason) {
      eligible = false;
      ineligibleReason = restReason;
    }

    if (eligible && requiredGender) {
      if (normalizeGenderCode(emp.gender) !== requiredGender) {
        eligible = false;
        ineligibleReason = `Post requires ${requiredGender === "M" ? "Male" : "Female"} guard`;
      }
    }

    if (eligible && requiresFirearm) {
      const firearmExpired =
        emp.firearmCompetencyExpiry != null &&
        emp.firearmCompetencyExpiry.toISOString().slice(0, 10) < params.workDate;
      if (!emp.firearmCompetency || firearmExpired) {
        const msg = !emp.firearmCompetency ? "No firearm competency" : "Firearm competency expired";
        if (psiraMode !== "OFF") {
          eligible = false;
          ineligibleReason = msg;
        } else {
          warnings.push(msg);
        }
      }
    }

    const psiraExpired =
      emp.psiraRegistrationExpiry != null &&
      emp.psiraRegistrationExpiry.toISOString().slice(0, 10) < params.workDate;
    if (psiraExpired) {
      const msg = "PSIRA expired";
      if (psiraMode === "BLOCK" && eligible) {
        eligible = false;
        ineligibleReason = msg;
      } else {
        warnings.push(msg);
      }
    }

    if (requiredGrade && !hasMinimumPsiraGrade(emp.psiraGrade, requiredGrade)) {
      const msg = `Below Grade ${requiredGrade} (Grade ${emp.psiraGrade ?? "?"})`;
      if (psiraMode === "BLOCK" && eligible) {
        eligible = false;
        ineligibleReason = msg;
      } else {
        warnings.push(msg);
      }
    }

    // Plain-English badges
    if (projectedOvertimeHours === 0) badges.push("Zero OT");
    else badges.push(`+${projectedOvertimeHours}h OT`);
    if (isReliever) badges.push("Reliever");
    if (isSitePrimary) badges.push("Site Team");
    if (emp.psiraGrade) badges.push(`Grade ${emp.psiraGrade}`);
    if (emp.firearmCompetency) badges.push("Armed");

    let score = eligible ? 100 : -1000;
    if (eligible) {
      if (projectedOvertimeHours === 0) score += 35;
      else score -= projectedOvertimeHours * 5;
      if (isReliever) score += 20;
      if (isSitePrimary) score += 18;
      if (emp.preferredShiftType === params.shiftType) score += 10;
      if (warnings.length > 0) score -= warnings.length * 25;
      score -= weekHoursBefore * 0.4;
    }

    candidates.push({
      employeeId: emp.id,
      fullName,
      employeeNumber: emp.employeeNumber,
      status: emp.status,
      psiraGrade: emp.psiraGrade,
      psiraExpiry: emp.psiraRegistrationExpiry?.toISOString().slice(0, 10) ?? null,
      firearmCompetency: emp.firearmCompetency,
      gender: emp.gender,
      isSitePrimary,
      isReliever,
      weekHoursBefore,
      weekHoursAfter,
      projectedOvertimeHours,
      eligible,
      ineligibleReason,
      score: Math.round(score * 10) / 10,
      badges,
      warnings,
    });
  }

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score || a.fullName.localeCompare(b.fullName);
  });

  return {
    siteName: site.name,
    requiredGrade,
    requiresFirearm,
    psiraEnforcementMode: psiraMode,
    candidates,
  };
}
