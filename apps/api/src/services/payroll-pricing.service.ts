import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parsePayrollSettings, withPayrollRateSource } from "../lib/payroll-settings.js";

export const SITE_PRICING_RATE_SOURCE = "site_area_grade" as const;
export const LEGACY_RATE_SOURCE = "legacy_employee_grade" as const;

const PAYROLL_EMPLOYEE_STATUSES = ["active", "hired", "training", "reliever"] as const;
const REQUIRED_GLOBAL_RULES = ["overtime", "sunday", "public_holiday"] as const;

export interface ResolvedSitePayRate {
  siteId: string;
  profileId: string;
  areaId: string;
  areaName: string;
  gradeId: string;
  gradeName: string;
  rateId: string;
  hourlyRate: number;
  profileEffectiveFrom: Date;
  rateEffectiveFrom: Date;
}

type ResolverProfile = {
  id: string;
  siteId: string;
  areaId: string;
  gradeId: string;
  effectiveFrom: Date;
  area: { name: string; isActive: boolean };
  grade: { name: string; isActive: boolean };
};

type ResolverRate = {
  id: string;
  areaId: string;
  gradeId: string;
  hourlyRate: Prisma.Decimal;
  effectiveFrom: Date;
};

function latestEffective<T extends { effectiveFrom: Date }>(rows: T[], at: Date): T | undefined {
  const atTime = at.getTime();
  let latest: T | undefined;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > atTime) continue;
    if (!latest || row.effectiveFrom > latest.effectiveFrom) latest = row;
  }
  return latest;
}

export async function loadSitePricingResolver(
  companyId: string,
  siteIds: string[],
  through: Date
): Promise<(siteId: string, at: Date) => ResolvedSitePayRate | null> {
  const uniqueSiteIds = [...new Set(siteIds)];
  if (uniqueSiteIds.length === 0) return () => null;

  const [profiles, rates] = await Promise.all([
    prisma.sitePayProfile.findMany({
      where: { companyId, siteId: { in: uniqueSiteIds }, effectiveFrom: { lte: through } },
      include: {
        area: { select: { name: true, isActive: true } },
        grade: { select: { name: true, isActive: true } },
      },
      orderBy: { effectiveFrom: "asc" },
    }),
    prisma.payAreaGradeRate.findMany({
      where: { companyId, effectiveFrom: { lte: through } },
      orderBy: { effectiveFrom: "asc" },
    }),
  ]);

  const profilesBySite = new Map<string, ResolverProfile[]>();
  for (const profile of profiles) {
    const list = profilesBySite.get(profile.siteId) ?? [];
    list.push(profile);
    profilesBySite.set(profile.siteId, list);
  }
  const ratesByPair = new Map<string, ResolverRate[]>();
  for (const rate of rates) {
    const key = `${rate.areaId}:${rate.gradeId}`;
    const list = ratesByPair.get(key) ?? [];
    list.push(rate);
    ratesByPair.set(key, list);
  }

  return (siteId: string, at: Date): ResolvedSitePayRate | null => {
    const profile = latestEffective(profilesBySite.get(siteId) ?? [], at);
    if (!profile || !profile.area.isActive || !profile.grade.isActive) return null;
    const rate = latestEffective(ratesByPair.get(`${profile.areaId}:${profile.gradeId}`) ?? [], at);
    if (!rate) return null;
    return {
      siteId,
      profileId: profile.id,
      areaId: profile.areaId,
      areaName: profile.area.name,
      gradeId: profile.gradeId,
      gradeName: profile.grade.name,
      rateId: rate.id,
      hourlyRate: Number(rate.hourlyRate),
      profileEffectiveFrom: profile.effectiveFrom,
      rateEffectiveFrom: rate.effectiveFrom,
    };
  };
}

export async function loadPayrollHomeSiteResolver(
  companyId: string,
  employeeIds: string[],
  through: Date
): Promise<(employeeId: string, at: Date) => string | null> {
  const uniqueIds = [...new Set(employeeIds)];
  if (uniqueIds.length === 0) return () => null;
  const homes = await prisma.employeePayrollHomeSite.findMany({
    where: { companyId, employeeId: { in: uniqueIds }, effectiveFrom: { lte: through } },
    orderBy: { effectiveFrom: "asc" },
  });
  const byEmployee = new Map<string, typeof homes>();
  for (const home of homes) {
    const list = byEmployee.get(home.employeeId) ?? [];
    list.push(home);
    byEmployee.set(home.employeeId, list);
  }
  return (employeeId: string, at: Date) =>
    latestEffective(byEmployee.get(employeeId) ?? [], at)?.siteId ?? null;
}

export async function setSitePayProfile(params: {
  companyId: string;
  siteId: string;
  areaId: string;
  gradeId: string;
  effectiveFrom: Date;
}) {
  const [site, area, grade] = await Promise.all([
    prisma.site.findFirst({ where: { id: params.siteId, companyId: params.companyId }, select: { id: true } }),
    prisma.payArea.findFirst({ where: { id: params.areaId, companyId: params.companyId, isActive: true }, select: { id: true } }),
    prisma.payGradeDefinition.findFirst({ where: { id: params.gradeId, companyId: params.companyId, isActive: true }, select: { id: true } }),
  ]);
  if (!site || !area || !grade) return null;
  const rate = await prisma.payAreaGradeRate.findFirst({
    where: {
      companyId: params.companyId,
      areaId: params.areaId,
      gradeId: params.gradeId,
      effectiveFrom: { lte: params.effectiveFrom },
    },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true },
  });
  if (!rate) return null;
  return prisma.sitePayProfile.upsert({
    where: { siteId_effectiveFrom: { siteId: params.siteId, effectiveFrom: params.effectiveFrom } },
    create: params,
    update: { areaId: params.areaId, gradeId: params.gradeId },
    include: { area: true, grade: true },
  });
}

export async function assignAutomaticPayrollHomes(
  companyId: string,
  employeeIds: string[],
  effectiveFrom = new Date()
): Promise<void> {
  const uniqueIds = [...new Set(employeeIds)];
  if (uniqueIds.length === 0) return;
  const at = new Date(effectiveFrom);
  at.setUTCHours(0, 0, 0, 0);
  const employees = await prisma.employee.findMany({
    where: { companyId, id: { in: uniqueIds }, employeeType: "security_officer" },
    select: {
      id: true,
      siteAssignments: { where: { isActive: true }, select: { siteId: true } },
      payrollHomeSites: {
        where: { effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { siteId: true },
      },
    },
  });
  for (const employee of employees) {
    const sites = [...new Set(employee.siteAssignments.map((assignment) => assignment.siteId))];
    const currentHome = employee.payrollHomeSites[0]?.siteId;
    if (sites.length === 1 && currentHome !== sites[0]) {
      await prisma.employeePayrollHomeSite.upsert({
        where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom: at } },
        create: { companyId, employeeId: employee.id, siteId: sites[0]!, effectiveFrom: at },
        update: { siteId: sites[0]! },
      });
    }
  }
}

export interface SitePricingReadiness {
  rateSource: "legacy_employee_grade" | "site_area_grade";
  ready: boolean;
  activeSites: number;
  configuredActiveSites: number;
  missingSites: Array<{ id: string; name: string; reason: string }>;
  missingPrimaryEmployees: Array<{ id: string; name: string; activeSiteCount: number }>;
  missingGlobalRules: string[];
  unresolvedGroupRuleCounts: { earnings: number; deductions: number };
}

export async function getSitePricingReadiness(
  companyId: string,
  asOf = new Date()
): Promise<SitePricingReadiness> {
  const [company, sites, rules, employees, groupEarnings, groupDeductions] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }),
    prisma.site.findMany({
      where: { companyId, siteStatus: "ACTIVE" },
      select: {
        id: true,
        name: true,
        payProfiles: {
          where: { effectiveFrom: { lte: asOf } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          include: {
            area: { select: { isActive: true } },
            grade: { select: { isActive: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.payRule.findMany({ where: { companyId }, select: { ruleType: true } }),
    prisma.employee.findMany({
      where: {
        companyId,
        employeeType: "security_officer",
        status: { in: [...PAYROLL_EMPLOYEE_STATUSES] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        siteAssignments: {
          where: {
            isActive: true,
            OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: asOf } }],
            AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }],
          },
          select: { siteId: true },
        },
        payrollHomeSites: {
          where: { effectiveFrom: { lte: asOf } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { siteId: true },
        },
      },
    }),
    prisma.groupEarningsRule.count({ where: { companyId, isActive: true } }),
    prisma.groupDeductionRule.count({ where: { companyId, isActive: true } }),
  ]);

  const resolver = await loadSitePricingResolver(companyId, sites.map((site) => site.id), asOf);
  const missingSites = sites.flatMap((site) => {
    const profile = site.payProfiles[0];
    if (!profile) return [{ id: site.id, name: site.name, reason: "No Area and Grade selected" }];
    if (!profile.area.isActive || !profile.grade.isActive) {
      return [{ id: site.id, name: site.name, reason: "Selected Area or Grade is inactive" }];
    }
    if (!resolver(site.id, asOf)) {
      return [{ id: site.id, name: site.name, reason: "No effective price for the selected Area and Grade" }];
    }
    return [];
  });

  const missingPrimaryEmployees = employees.flatMap((employee) => {
    const assignedSiteIds = [...new Set(employee.siteAssignments.map((assignment) => assignment.siteId))];
    if (assignedSiteIds.length <= 1) return [];
    const homeSiteId = employee.payrollHomeSites[0]?.siteId;
    if (homeSiteId && assignedSiteIds.includes(homeSiteId)) return [];
    return [{
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      activeSiteCount: assignedSiteIds.length,
    }];
  });
  const configuredRules = new Set(rules.map((rule) => rule.ruleType));
  const missingGlobalRules = REQUIRED_GLOBAL_RULES.filter((rule) => !configuredRules.has(rule));
  const unresolvedGroupRuleCounts = { earnings: groupEarnings, deductions: groupDeductions };
  const ready =
    missingSites.length === 0 &&
    missingPrimaryEmployees.length === 0 &&
    missingGlobalRules.length === 0 &&
    groupEarnings === 0 &&
    groupDeductions === 0;

  return {
    rateSource: parsePayrollSettings(company.settings).rateSource,
    ready,
    activeSites: sites.length,
    configuredActiveSites: sites.length - missingSites.length,
    missingSites,
    missingPrimaryEmployees,
    missingGlobalRules,
    unresolvedGroupRuleCounts,
  };
}

export async function activateSitePricing(companyId: string): Promise<SitePricingReadiness> {
  const readiness = await getSitePricingReadiness(companyId);
  if (!readiness.ready) return readiness;

  await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } });
    const employees = await tx.employee.findMany({
      where: {
        companyId,
        employeeType: "security_officer",
        status: { in: [...PAYROLL_EMPLOYEE_STATUSES] },
      },
      select: {
        id: true,
        siteAssignments: { where: { isActive: true }, select: { siteId: true } },
        payrollHomeSites: { take: 1, orderBy: { effectiveFrom: "desc" }, select: { id: true } },
      },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (const employee of employees) {
      const siteIds = [...new Set(employee.siteAssignments.map((assignment) => assignment.siteId))];
      if (siteIds.length === 1 && employee.payrollHomeSites.length === 0) {
        await tx.employeePayrollHomeSite.create({
          data: { companyId, employeeId: employee.id, siteId: siteIds[0]!, effectiveFrom: today },
        });
      }
    }
    await tx.company.update({
      where: { id: companyId },
      data: { settings: withPayrollRateSource(company.settings, SITE_PRICING_RATE_SOURCE) as Prisma.InputJsonValue },
    });
  });

  return getSitePricingReadiness(companyId);
}
