import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import {
  applyRosterPlan,
  generateRosterPlan,
  type RosterPlan,
} from "./roster-engine.service.js";
import {
  formatDateKey,
  getPayrollCalendarFromCompanySettings,
  getRosterWindow,
} from "./payroll-period.service.js";

export type RosterAutomationStatus =
  | "applied"
  | "pending_review"
  | "failed"
  | "skipped"
  | "dismissed";

export type AutoRosterTrigger = "cron" | "manual" | "site_enabled" | "settings_changed";

export type AutoRosterSiteResult = {
  siteId: string;
  siteName: string;
  status: RosterAutomationStatus;
  coveragePercent: number | null;
  automationRunId: string | null;
  created: number;
  message?: string;
};

export type AutoRosterCompanyResult = {
  companyId: string;
  sites: AutoRosterSiteResult[];
};

export type AutoRosterGlobalResult = {
  companies: AutoRosterCompanyResult[];
};

function planMeetsThreshold(plan: RosterPlan, minCoveragePercent: number): boolean {
  const coverage = plan.summary.coveragePercent;
  if (coverage == null) return false;
  return coverage >= minCoveragePercent;
}

async function upsertPendingRun(params: {
  companyId: string;
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  plan: RosterPlan;
  coveragePercent: number | null;
}): Promise<string> {
  const existing = await prisma.rosterAutomationRun.findFirst({
    where: {
      companyId: params.companyId,
      siteId: params.siteId,
      status: "pending_review",
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    status: "pending_review",
    coveragePercent: params.coveragePercent,
    planSnapshot: params.plan as unknown as Prisma.InputJsonValue,
    warnings: params.plan.warnings as unknown as Prisma.InputJsonValue,
    errorMessage: null,
    appliedAt: null,
  };

  if (existing) {
    await prisma.rosterAutomationRun.update({
      where: { id: existing.id },
      data,
    });
    return existing.id;
  }

  const created = await prisma.rosterAutomationRun.create({
    data: {
      companyId: params.companyId,
      siteId: params.siteId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      ...data,
    },
  });
  return created.id;
}

export async function runAutoRosterForSite(params: {
  companyId: string;
  siteId: string;
  triggeredBy?: AutoRosterTrigger;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<AutoRosterSiteResult> {
  const site = await prisma.site.findFirst({
    where: { id: params.siteId, companyId: params.companyId },
    include: {
      company: { select: { settings: true, name: true } },
      posts: { select: { id: true, shiftType: true } },
      assignedGuards: {
        include: {
          employee: { select: { id: true, status: true, employeeType: true } },
        },
      },
    },
  });

  if (!site) {
    return {
      siteId: params.siteId,
      siteName: "Unknown",
      status: "failed",
      coveragePercent: null,
      automationRunId: null,
      created: 0,
      message: "Site not found",
    };
  }

  if (!site.autoRosterEnabled) {
    return {
      siteId: site.id,
      siteName: site.name,
      status: "skipped",
      coveragePercent: null,
      automationRunId: null,
      created: 0,
      message: "Auto-roster disabled",
    };
  }

  const hasDayPost = site.posts.some((p) => p.shiftType === "day");
  const hasNightPost = site.posts.some((p) => p.shiftType === "night");
  const rosterableGuards = site.assignedGuards.filter((a) => {
    const e = a.employee;
    return (
      (e.employeeType ?? "security") === "security" &&
      ["active", "training", "hired", "reliever"].includes(e.status)
    );
  }).length;

  if (!hasDayPost || !hasNightPost || rosterableGuards === 0) {
    await prisma.site.update({
      where: { id: site.id },
      data: { autoRosterLastRunAt: new Date(), autoRosterLastStatus: "skipped" },
    });
    return {
      siteId: site.id,
      siteName: site.name,
      status: "skipped",
      coveragePercent: null,
      automationRunId: null,
      created: 0,
      message: "Site not ready for auto-roster",
    };
  }

  const calendar = getPayrollCalendarFromCompanySettings(site.company.settings);
  const window =
    params.startDate && params.endDate
      ? { startDate: params.startDate, endDate: params.endDate }
      : getRosterWindow(calendar, new Date(), calendar.autoRosterHorizonPeriods);

  if (window.startDate > window.endDate) {
    return {
      siteId: site.id,
      siteName: site.name,
      status: "skipped",
      coveragePercent: null,
      automationRunId: null,
      created: 0,
      message: "Roster window empty",
    };
  }

  try {
    const plan = await generateRosterPlan({
      companyId: params.companyId,
      siteId: site.id,
      startDate: window.startDate,
      endDate: window.endDate,
    });

    const coveragePercent = plan.summary.coveragePercent ?? null;
    const threshold = site.autoRosterMinCoveragePercent ?? 100;

    if (planMeetsThreshold(plan, threshold)) {
      const applyResult = await applyRosterPlan({
        companyId: params.companyId,
        userId: params.userId,
        plan,
        options: { replaceExisting: true },
      });

      await prisma.rosterAutomationRun.create({
        data: {
          companyId: params.companyId,
          siteId: site.id,
          periodStart: window.startDate,
          periodEnd: window.endDate,
          status: "applied",
          coveragePercent,
          planSnapshot: plan as unknown as Prisma.InputJsonValue,
          warnings: plan.warnings as unknown as Prisma.InputJsonValue,
          appliedAt: new Date(),
        },
      });

      await prisma.site.update({
        where: { id: site.id },
        data: { autoRosterLastRunAt: new Date(), autoRosterLastStatus: "applied" },
      });

      return {
        siteId: site.id,
        siteName: site.name,
        status: "applied",
        coveragePercent,
        automationRunId: null,
        created: applyResult.created,
      };
    }

    const automationRunId = await upsertPendingRun({
      companyId: params.companyId,
      siteId: site.id,
      periodStart: window.startDate,
      periodEnd: window.endDate,
      plan,
      coveragePercent,
    });

    await prisma.site.update({
      where: { id: site.id },
      data: { autoRosterLastRunAt: new Date(), autoRosterLastStatus: "pending_review" },
    });

    return {
      siteId: site.id,
      siteName: site.name,
      status: "pending_review",
      coveragePercent,
      automationRunId,
      created: 0,
      message: `Coverage ${coveragePercent ?? 0}% below threshold ${threshold}%`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-roster failed";
    await prisma.rosterAutomationRun.create({
      data: {
        companyId: params.companyId,
        siteId: site.id,
        periodStart: window.startDate,
        periodEnd: window.endDate,
        status: "failed",
        errorMessage: message,
      },
    });
    await prisma.site.update({
      where: { id: site.id },
      data: { autoRosterLastRunAt: new Date(), autoRosterLastStatus: "failed" },
    });
    return {
      siteId: site.id,
      siteName: site.name,
      status: "failed",
      coveragePercent: null,
      automationRunId: null,
      created: 0,
      message,
    };
  }
}

export async function runAutoRosterForCompany(
  companyId: string,
  options?: { triggeredBy?: AutoRosterTrigger; userId?: string }
): Promise<AutoRosterCompanyResult> {
  const sites = await prisma.site.findMany({
    where: { companyId, autoRosterEnabled: true },
    select: { id: true },
  });

  const results: AutoRosterSiteResult[] = [];
  for (const site of sites) {
    results.push(
      await runAutoRosterForSite({
        companyId,
        siteId: site.id,
        triggeredBy: options?.triggeredBy,
        userId: options?.userId,
      })
    );
  }

  return { companyId, sites: results };
}

export async function runGlobalAutoRoster(): Promise<AutoRosterGlobalResult> {
  const companies = await prisma.company.findMany({
    select: { id: true },
  });

  const results: AutoRosterCompanyResult[] = [];
  for (const company of companies) {
    const companyResult = await runAutoRosterForCompany(company.id, { triggeredBy: "cron" });
    if (companyResult.sites.length > 0) {
      results.push(companyResult);
    }
  }

  return { companies: results };
}

export async function listAutomationRuns(companyId: string, status?: RosterAutomationStatus) {
  return prisma.rosterAutomationRun.findMany({
    where: {
      companyId,
      ...(status ? { status } : { status: { in: ["pending_review", "failed"] } }),
    },
    include: { site: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function applyAutomationRun(
  companyId: string,
  runId: string,
  userId: string
): Promise<{ created: number; deleted: number } | { error: string }> {
  const run = await prisma.rosterAutomationRun.findFirst({
    where: { id: runId, companyId, status: "pending_review" },
  });
  if (!run) return { error: "Automation run not found or not pending review" };
  if (!run.planSnapshot || typeof run.planSnapshot !== "object") {
    return { error: "Plan snapshot missing" };
  }

  const plan = run.planSnapshot as RosterPlan;
  try {
    const result = await applyRosterPlan({
      companyId,
      userId,
      plan,
      options: { replaceExisting: true },
    });
    await prisma.rosterAutomationRun.update({
      where: { id: run.id },
      data: {
        status: "applied",
        appliedAt: new Date(),
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    });
    await prisma.site.update({
      where: { id: run.siteId },
      data: { autoRosterLastRunAt: new Date(), autoRosterLastStatus: "applied" },
    });
    return { created: result.created, deleted: result.deleted };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Apply failed" };
  }
}

export async function dismissAutomationRun(
  companyId: string,
  runId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const run = await prisma.rosterAutomationRun.findFirst({
    where: { id: runId, companyId, status: "pending_review" },
  });
  if (!run) return { error: "Automation run not found or not pending review" };

  await prisma.rosterAutomationRun.update({
    where: { id: run.id },
    data: {
      status: "dismissed",
      reviewedBy: userId,
      reviewedAt: new Date(),
    },
  });
  await prisma.site.update({
    where: { id: run.siteId },
    data: { autoRosterLastStatus: "dismissed" },
  });
  return { ok: true };
}

export function serializeAutomationRun(run: {
  id: string;
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  coveragePercent: number | null;
  planSnapshot: unknown;
  warnings: unknown;
  errorMessage: string | null;
  createdAt: Date;
  site?: { id: string; name: string };
}) {
  return {
    id: run.id,
    siteId: run.siteId,
    siteName: run.site?.name,
    periodStart: formatDateKey(run.periodStart),
    periodEnd: formatDateKey(run.periodEnd),
    status: run.status,
    coveragePercent: run.coveragePercent,
    plan: run.planSnapshot,
    warnings: run.warnings,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
  };
}

export { parsePayrollCalendarSettings };
