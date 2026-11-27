import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditFromRequest } from "../../lib/audit.js";
import { parsePayrollCalendarSettings } from "../../lib/payroll-calendar-settings.js";
import {
  formatDateKey,
  getCurrentPayPeriod,
  listPayPeriods,
  resolvePayPeriodByKey,
  serializePayPeriod,
  type PayPeriodBounds,
} from "../../services/payroll-period.service.js";
import { aggregateTimesheets, type TimesheetAggregate } from "../../services/timesheet.service.js";
import { markLeaveExported, unmarkLeaveExported } from "../../services/leave-v3.service.js";
import {
  getPeriodExportReadiness,
  type PeriodExportReadiness,
} from "../attendance-exceptions/exceptions.service.js";
import {
  DEFAULT_PAY_CODE_MAPPING,
  renderPayrollExport,
  resolveCustomColumns,
  resolvePayCodeMapping,
  toDelimitedTable,
  type ExportBatchContext,
  type NormalizedExportLine,
  type PayrollExportProviderType,
} from "./adapters/index.js";

export class PayrollExportError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PayrollExportError";
  }
}

interface InternalBuiltLine extends NormalizedExportLine {
  missingPayrollCode: boolean;
  sourceSiteTimesheetIds: string[];
  sourceLeaveRequestIds: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeChecksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function resolveCompanyAndPeriod(companyId: string, periodKey?: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      legalName: true,
      payeReference: true,
      settings: true,
    },
  });
  if (!company) {
    throw new PayrollExportError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  const calendar = parsePayrollCalendarSettings(company.settings);
  let period: PayPeriodBounds | null;
  if (periodKey) {
    period = resolvePayPeriodByKey(calendar, periodKey);
    if (!period) {
      throw new PayrollExportError(400, "INVALID_PERIOD_KEY", `Invalid period key: ${periodKey}`);
    }
  } else {
    period = getCurrentPayPeriod(calendar);
  }
  return { company, calendar, period };
}

export async function ensureDefaultProfiles(companyId: string) {
  const count = await prisma.payrollExportProfile.count({ where: { companyId } });
  if (count > 0) return;

  await prisma.payrollExportProfile.createMany({
    data: [
      {
        companyId,
        name: "Sage Business Cloud Payroll ZA",
        provider: "SAGE_BUSINESS_CLOUD_ZA",
        isDefault: true,
        splitBySite: true,
        delimiter: ",",
        dateFormat: "yyyy-MM-dd",
        codeMappingJson: DEFAULT_PAY_CODE_MAPPING as unknown as Prisma.InputJsonValue,
      },
      {
        companyId,
        name: "Generic Timesheet CSV",
        provider: "GENERIC_CSV",
        isDefault: false,
        splitBySite: true,
        delimiter: ",",
        dateFormat: "yyyy-MM-dd",
        codeMappingJson: {} as Prisma.InputJsonValue,
      },
    ],
  });
}

export async function listProfiles(companyId: string) {
  await ensureDefaultProfiles(companyId);
  return prisma.payrollExportProfile.findMany({
    where: { companyId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function createProfile(
  companyId: string,
  request: FastifyRequest,
  input: {
    name: string;
    provider: PayrollExportProviderType;
    isDefault?: boolean;
    splitBySite?: boolean;
    delimiter?: string;
    dateFormat?: string;
    codeMappingJson?: Record<string, string | undefined>;
    customColumnsJson?: Array<{ header: string; fixedValue?: string; field?: string }> | null;
  }
) {
  await ensureDefaultProfiles(companyId);

  const created = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.payrollExportProfile.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.payrollExportProfile.create({
      data: {
        companyId,
        name: input.name.trim(),
        provider: input.provider,
        isDefault: Boolean(input.isDefault),
        splitBySite: input.splitBySite ?? true,
        delimiter: input.delimiter ?? ",",
        dateFormat: input.dateFormat ?? "yyyy-MM-dd",
        codeMappingJson: (input.codeMappingJson ?? DEFAULT_PAY_CODE_MAPPING) as Prisma.InputJsonValue,
        customColumnsJson:
          input.customColumnsJson === undefined
            ? undefined
            : input.customColumnsJson === null
              ? Prisma.JsonNull
              : (input.customColumnsJson as unknown as Prisma.InputJsonValue),
      },
    });
  });

  await auditFromRequest(request, {
    action: "payroll_export_profile.created",
    entityType: "PayrollExportProfile",
    entityId: created.id,
    metadata: { name: created.name, provider: created.provider },
  });

  return created;
}

export async function updateProfile(
  companyId: string,
  profileId: string,
  request: FastifyRequest,
  input: {
    name?: string;
    provider?: PayrollExportProviderType;
    isDefault?: boolean;
    splitBySite?: boolean;
    delimiter?: string;
    dateFormat?: string;
    codeMappingJson?: Record<string, string | undefined>;
    customColumnsJson?: Array<{ header: string; fixedValue?: string; field?: string }> | null;
  }
) {
  const existing = await prisma.payrollExportProfile.findFirst({
    where: { id: profileId, companyId },
  });
  if (!existing) {
    throw new PayrollExportError(404, "PROFILE_NOT_FOUND", "Export profile not found");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.payrollExportProfile.updateMany({
        where: { companyId, id: { not: profileId }, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.payrollExportProfile.update({
      where: { id: profileId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.splitBySite !== undefined ? { splitBySite: input.splitBySite } : {}),
        ...(input.delimiter !== undefined ? { delimiter: input.delimiter } : {}),
        ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
        ...(input.codeMappingJson !== undefined
          ? { codeMappingJson: input.codeMappingJson as Prisma.InputJsonValue }
          : {}),
        ...(input.customColumnsJson !== undefined
          ? {
              customColumnsJson:
                input.customColumnsJson === null
                  ? Prisma.JsonNull
                  : (input.customColumnsJson as unknown as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
  });

  await auditFromRequest(request, {
    action: "payroll_export_profile.updated",
    entityType: "PayrollExportProfile",
    entityId: updated.id,
    metadata: { name: updated.name, provider: updated.provider },
  });

  return updated;
}

export async function deleteProfile(companyId: string, profileId: string, request: FastifyRequest) {
  const existing = await prisma.payrollExportProfile.findFirst({
    where: { id: profileId, companyId },
    include: { _count: { select: { batches: true } } },
  });
  if (!existing) {
    throw new PayrollExportError(404, "PROFILE_NOT_FOUND", "Export profile not found");
  }
  if (existing._count.batches > 0) {
    throw new PayrollExportError(
      409,
      "PROFILE_IN_USE",
      "Cannot delete a profile that has historical export batches"
    );
  }
  const totalProfiles = await prisma.payrollExportProfile.count({ where: { companyId } });
  if (totalProfiles <= 1) {
    throw new PayrollExportError(409, "LAST_PROFILE", "At least one export profile must remain");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollExportProfile.delete({ where: { id: profileId } });
    if (existing.isDefault) {
      const replacement = await tx.payrollExportProfile.findFirst({
        where: { companyId },
        orderBy: { createdAt: "asc" },
      });
      if (replacement) {
        await tx.payrollExportProfile.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        });
      }
    }
  });

  await auditFromRequest(request, {
    action: "payroll_export_profile.deleted",
    entityType: "PayrollExportProfile",
    entityId: profileId,
    metadata: { name: existing.name },
  });
}

export async function listCompanyPeriods(companyId: string) {
  const { calendar, period: current } = await resolveCompanyAndPeriod(companyId);
  const periods = listPayPeriods(calendar, { before: 5, after: 1 }).reverse();
  return periods.map((p) => serializePayPeriod(p, p.periodKey === current.periodKey));
}

export async function getExportReadinessSummary(companyId: string, periodKey?: string) {
  const { period } = await resolveCompanyAndPeriod(companyId, periodKey);
  const readiness = await getPeriodExportReadiness(
    companyId,
    period.periodStart,
    period.periodEnd,
    period.periodKey
  );

  const [unmappedEmployees, existingBatches] = await Promise.all([
    prisma.employee.findMany({
      where: {
        companyId,
        status: { in: ["active", "reliever", "hired", "training"] },
        OR: [{ externalPayrollCode: null }, { externalPayrollCode: "" }],
      },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        employeeType: true,
      },
      orderBy: { employeeNumber: "asc" },
      take: 25,
    }),
    prisma.payrollExportBatch.findMany({
      where: { companyId, periodKey: period.periodKey },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        profileId: true,
        employeeCount: true,
        createdAt: true,
        lockedAt: true,
        exportedAt: true,
        voidedAt: true,
      },
    }),
  ]);

  return {
    period: serializePayPeriod(period, true),
    readiness: {
      ...readiness,
      periodStart: formatDateKey(readiness.periodStart),
      periodEnd: formatDateKey(readiness.periodEnd),
    },
    unmappedEmployees,
    existingBatches,
  };
}

async function resolveProfileForCompany(companyId: string, profileId?: string) {
  await ensureDefaultProfiles(companyId);
  if (profileId) {
    const profile = await prisma.payrollExportProfile.findFirst({
      where: { id: profileId, companyId },
    });
    if (!profile) {
      throw new PayrollExportError(404, "PROFILE_NOT_FOUND", "Export profile not found");
    }
    return profile;
  }
  const profile = await prisma.payrollExportProfile.findFirst({
    where: { companyId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!profile) {
    throw new PayrollExportError(404, "PROFILE_NOT_FOUND", "No payroll export profile configured");
  }
  return profile;
}

async function buildNormalizedLines(
  companyId: string,
  aggregates: TimesheetAggregate[],
  splitBySite: boolean
): Promise<InternalBuiltLine[]> {
  if (aggregates.length === 0) return [];

  const employeeIds = aggregates.map((a) => a.employeeId);
  const siteIds = new Set<string>();
  for (const agg of aggregates) {
    for (const seg of agg.segments ?? []) {
      siteIds.add(seg.siteId);
    }
  }

  const [employees, sites] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: {
        id: true,
        employeeNumber: true,
        externalPayrollCode: true,
        firstName: true,
        lastName: true,
      },
    }),
    siteIds.size > 0
      ? prisma.site.findMany({
          where: { companyId, id: { in: Array.from(siteIds) } },
          select: { id: true, name: true, costCenterCode: true },
        })
      : Promise.resolve([]),
  ]);

  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  const lines: InternalBuiltLine[] = [];

  for (const agg of aggregates) {
    const emp = employeeMap.get(agg.employeeId);
    if (!emp) continue;

    const fullName = `${emp.firstName} ${emp.lastName}`.trim();
    const mappedCode = emp.externalPayrollCode?.trim() || "";
    const effectiveCode = mappedCode || emp.employeeNumber;
    const missingPayrollCode = mappedCode.length === 0;

    const bySite = new Map<
      string,
      {
        basicHours: number;
        overtimeHours: number;
        sundayHours: number;
        sundayDoubleHours: number;
        publicHolidayHours: number;
        nightShiftHours: number;
        nightShiftCount: number;
      }
    >();

    for (const seg of agg.segments ?? []) {
      const existing = bySite.get(seg.siteId) ?? {
        basicHours: 0,
        overtimeHours: 0,
        sundayHours: 0,
        sundayDoubleHours: 0,
        publicHolidayHours: 0,
        nightShiftHours: 0,
        nightShiftCount: 0,
      };
      existing.basicHours += seg.basicHours;
      existing.overtimeHours += seg.overtimeHours;
      existing.sundayHours += seg.sundayHours;
      existing.sundayDoubleHours += seg.sundayDoubleHours ?? 0;
      existing.publicHolidayHours += seg.publicHolidayHours;
      existing.nightShiftHours += seg.nightShiftHours;
      existing.nightShiftCount += seg.nightShiftCount ?? 0;
      bySite.set(seg.siteId, existing);
    }

    if (splitBySite && bySite.size > 0) {
      const entries = Array.from(bySite.entries());
      // Place leave hours & shift count on the primary site (highest worked hours)
      // so employee leave is neither omitted nor duplicated across cost centres.
      let primarySiteId = entries[0][0];
      let highestHours = -1;
      for (const [sid, hrs] of entries) {
        const worked =
          hrs.basicHours +
          hrs.overtimeHours +
          hrs.sundayHours +
          hrs.sundayDoubleHours +
          hrs.publicHolidayHours;
        if (worked > highestHours) {
          highestHours = worked;
          primarySiteId = sid;
        }
      }

      for (const [sid, hrs] of entries) {
        const site = siteMap.get(sid);
        const isPrimary = sid === primarySiteId;
        lines.push({
          employeeId: emp.id,
          employeeNumber: emp.employeeNumber,
          externalPayrollCode: effectiveCode,
          employeeFullName: fullName,
          siteId: sid,
          siteName: site?.name ?? null,
          costCenterCode: site?.costCenterCode ?? null,
          basicHours: round2(hrs.basicHours),
          overtimeHours: round2(hrs.overtimeHours),
          sundayHours: round2(hrs.sundayHours),
          sundayDoubleHours: round2(hrs.sundayDoubleHours),
          publicHolidayHours: round2(hrs.publicHolidayHours),
          nightShiftHours: round2(hrs.nightShiftHours),
          nightShiftCount: hrs.nightShiftCount,
          annualLeaveHours: isPrimary ? round2(agg.annualLeaveHours) : 0,
          sickLeaveHours: isPrimary ? round2(agg.sickLeaveHours) : 0,
          familyLeaveHours: isPrimary ? round2(agg.familyLeaveHours) : 0,
          studyLeaveHours: isPrimary ? round2(agg.studyLeaveHours) : 0,
          unpaidLeaveHours: isPrimary ? round2(agg.unpaidLeaveHours ?? 0) : 0,
          workedShiftsCount: isPrimary ? agg.workedShiftsCount : 0,
          missingPayrollCode,
          sourceSiteTimesheetIds: agg.sourceSiteTimesheetIds,
          sourceLeaveRequestIds: agg.sourceLeaveRequestIds,
        });
      }
    } else {
      const onlySiteId = bySite.size === 1 ? Array.from(bySite.keys())[0] : null;
      const onlySite = onlySiteId ? siteMap.get(onlySiteId) : null;
      lines.push({
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        externalPayrollCode: effectiveCode,
        employeeFullName: fullName,
        siteId: onlySiteId,
        siteName: onlySite?.name ?? null,
        costCenterCode: onlySite?.costCenterCode ?? null,
        basicHours: round2(agg.basicHours),
        overtimeHours: round2(agg.overtimeHours),
        sundayHours: round2(agg.sundayHours),
        sundayDoubleHours: round2(agg.sundayDoubleHours ?? 0),
        publicHolidayHours: round2(agg.publicHolidayHours),
        nightShiftHours: round2(agg.nightShiftHours),
        nightShiftCount: agg.nightShiftCount ?? 0,
        annualLeaveHours: round2(agg.annualLeaveHours),
        sickLeaveHours: round2(agg.sickLeaveHours),
        familyLeaveHours: round2(agg.familyLeaveHours),
        studyLeaveHours: round2(agg.studyLeaveHours),
        unpaidLeaveHours: round2(agg.unpaidLeaveHours ?? 0),
        workedShiftsCount: agg.workedShiftsCount,
        missingPayrollCode,
        sourceSiteTimesheetIds: agg.sourceSiteTimesheetIds,
        sourceLeaveRequestIds: agg.sourceLeaveRequestIds,
      });
    }
  }

  lines.sort((a, b) => {
    const nameCmp = a.employeeFullName.localeCompare(b.employeeFullName);
    if (nameCmp !== 0) return nameCmp;
    return (a.siteName ?? "").localeCompare(b.siteName ?? "");
  });

  return lines;
}

function summarizeLines(lines: NormalizedExportLine[]) {
  const uniqueEmployees = new Set<string>();
  let totalBasicHours = 0;
  let totalOvertimeHours = 0;
  let totalSundayHours = 0;
  let totalPublicHolidayHours = 0;
  let totalNightShiftHours = 0;
  let totalPaidLeaveHours = 0;
  let totalUnpaidLeaveHours = 0;

  for (const line of lines) {
    uniqueEmployees.add(line.employeeId);
    totalBasicHours += line.basicHours;
    totalOvertimeHours += line.overtimeHours;
    totalSundayHours += line.sundayHours + (line.sundayDoubleHours ?? 0);
    totalPublicHolidayHours += line.publicHolidayHours;
    totalNightShiftHours += line.nightShiftHours;
    totalPaidLeaveHours +=
      line.annualLeaveHours +
      line.sickLeaveHours +
      line.familyLeaveHours +
      line.studyLeaveHours;
    totalUnpaidLeaveHours += line.unpaidLeaveHours;
  }

  return {
    employeeCount: uniqueEmployees.size,
    lineCount: lines.length,
    totalBasicHours: round2(totalBasicHours),
    totalOvertimeHours: round2(totalOvertimeHours),
    totalSundayHours: round2(totalSundayHours),
    totalPublicHolidayHours: round2(totalPublicHolidayHours),
    totalNightShiftHours: round2(totalNightShiftHours),
    totalPaidLeaveHours: round2(totalPaidLeaveHours),
    totalUnpaidLeaveHours: round2(totalUnpaidLeaveHours),
  };
}

function buildBlockers(
  readiness: PeriodExportReadiness,
  lines: InternalBuiltLine[]
): string[] {
  const blockers: string[] = [];
  if (readiness.openExceptions > 0) {
    blockers.push(
      `${readiness.openExceptions} attendance exception(s) are still open (${readiness.openCritical} critical)`
    );
  }
  if (readiness.unapprovedSiteTimesheets > 0) {
    blockers.push(
      `${readiness.unapprovedSiteTimesheets} active site(s) do not have an approved site timesheet`
    );
  }
  if (readiness.pendingLeaveRequests > 0) {
    blockers.push(
      `${readiness.pendingLeaveRequests} leave request(s) overlapping this period are still pending`
    );
  }
  const missingCodeCount = new Set(
    lines.filter((l) => l.missingPayrollCode).map((l) => l.employeeId)
  ).size;
  if (missingCodeCount > 0) {
    blockers.push(
      `${missingCodeCount} employee(s) in this export have no External Payroll Code and would fall back to Employee Number`
    );
  }
  return blockers;
}

export async function previewExport(
  companyId: string,
  input: { periodKey?: string; profileId?: string; splitBySite?: boolean }
) {
  const [{ company, period }, profile] = await Promise.all([
    resolveCompanyAndPeriod(companyId, input.periodKey),
    resolveProfileForCompany(companyId, input.profileId),
  ]);

  const effectiveSplitBySite = input.splitBySite ?? profile.splitBySite;

  const [readiness, aggregates] = await Promise.all([
    getPeriodExportReadiness(companyId, period.periodStart, period.periodEnd, period.periodKey),
    aggregateTimesheets(companyId, period.periodStart, period.periodEnd),
  ]);

  const builtLines = await buildNormalizedLines(companyId, aggregates, effectiveSplitBySite);
  const summary = summarizeLines(builtLines);
  const blockers = buildBlockers(readiness, builtLines);

  const missingCodeEmployees = Array.from(
    new Map(
      builtLines
        .filter((l) => l.missingPayrollCode)
        .map((l) => [
          l.employeeId,
          {
            employeeId: l.employeeId,
            employeeNumber: l.employeeNumber,
            employeeFullName: l.employeeFullName,
          },
        ])
    ).values()
  );

  const context: ExportBatchContext = {
    periodKey: period.periodKey,
    periodStart: formatDateKey(period.periodStart),
    periodEnd: formatDateKey(period.periodEnd),
    companyName: company.legalName?.trim() || company.name,
    companyPayeReference: company.payeReference,
    profileName: profile.name,
    provider: profile.provider as PayrollExportProviderType,
    delimiter: profile.delimiter,
    dateFormat: profile.dateFormat,
    codeMapping: resolvePayCodeMapping(profile.codeMappingJson),
    customColumns: resolveCustomColumns(profile.customColumnsJson),
    generatedAt: new Date().toISOString(),
  };

  const rendered = renderPayrollExport(context, builtLines);

  return {
    period: serializePayPeriod(period, true),
    profile: {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      splitBySite: effectiveSplitBySite,
      delimiter: profile.delimiter,
      dateFormat: profile.dateFormat,
    },
    readiness: {
      ...readiness,
      periodStart: formatDateKey(readiness.periodStart),
      periodEnd: formatDateKey(readiness.periodEnd),
    },
    blockers,
    missingCodeEmployees,
    summary,
    lines: builtLines,
    renderedPreview: {
      filename: rendered.filename,
      mimeType: rendered.mimeType,
      content: rendered.content,
    },
  };
}

export async function createBatch(
  companyId: string,
  userId: string,
  request: FastifyRequest,
  input: {
    periodKey?: string;
    profileId?: string;
    splitBySite?: boolean;
    overrideReason?: string;
  }
) {
  const [{ period }, profile] = await Promise.all([
    resolveCompanyAndPeriod(companyId, input.periodKey),
    resolveProfileForCompany(companyId, input.profileId),
  ]);

  const effectiveSplitBySite = input.splitBySite ?? profile.splitBySite;

  const [readiness, aggregates] = await Promise.all([
    getPeriodExportReadiness(companyId, period.periodStart, period.periodEnd, period.periodKey),
    aggregateTimesheets(companyId, period.periodStart, period.periodEnd),
  ]);

  const builtLines = await buildNormalizedLines(companyId, aggregates, effectiveSplitBySite);
  if (builtLines.length === 0) {
    throw new PayrollExportError(
      400,
      "NO_APPROVED_HOURS",
      "No approved attendance hours or approved leave found for this period"
    );
  }

  const summary = summarizeLines(builtLines);
  const checksumSha256 = computeChecksum({
    periodKey: period.periodKey,
    provider: profile.provider,
    profileId: profile.id,
    splitBySite: effectiveSplitBySite,
    lines: builtLines.map((l) => ({
      employeeId: l.employeeId,
      externalPayrollCode: l.externalPayrollCode,
      siteId: l.siteId,
      costCenterCode: l.costCenterCode,
      basicHours: l.basicHours,
      overtimeHours: l.overtimeHours,
      sundayHours: l.sundayHours,
      sundayDoubleHours: l.sundayDoubleHours ?? 0,
      publicHolidayHours: l.publicHolidayHours,
      nightShiftHours: l.nightShiftHours,
      nightShiftCount: l.nightShiftCount ?? 0,
      annualLeaveHours: l.annualLeaveHours,
      sickLeaveHours: l.sickLeaveHours,
      familyLeaveHours: l.familyLeaveHours,
      studyLeaveHours: l.studyLeaveHours,
      unpaidLeaveHours: l.unpaidLeaveHours,
      workedShiftsCount: l.workedShiftsCount,
    })),
  });

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollExportBatch.create({
      data: {
        companyId,
        profileId: profile.id,
        periodKey: period.periodKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: "DRAFT",
        employeeCount: summary.employeeCount,
        totalBasicHours: summary.totalBasicHours,
        totalOvertimeHours: summary.totalOvertimeHours,
        totalSundayHours: summary.totalSundayHours,
        totalPublicHolidayHours: summary.totalPublicHolidayHours,
        totalNightShiftHours: summary.totalNightShiftHours,
        totalPaidLeaveHours: summary.totalPaidLeaveHours,
        totalUnpaidLeaveHours: summary.totalUnpaidLeaveHours,
        readinessSnapshotJson: {
          ...readiness,
          periodStart: formatDateKey(readiness.periodStart),
          periodEnd: formatDateKey(readiness.periodEnd),
          blockers: buildBlockers(readiness, builtLines),
        } as Prisma.InputJsonValue,
        overrideReason: input.overrideReason?.trim() || null,
        checksumSha256,
        createdBy: userId,
        lines: {
          create: builtLines.map((l) => ({
            companyId,
            employeeId: l.employeeId,
            externalPayrollCode: l.externalPayrollCode,
            employeeFullName: l.employeeFullName,
            siteId: l.siteId,
            costCenterCode: l.costCenterCode,
            basicHours: l.basicHours,
            overtimeHours: l.overtimeHours,
            sundayHours: l.sundayHours,
            sundayDoubleHours: l.sundayDoubleHours ?? 0,
            publicHolidayHours: l.publicHolidayHours,
            nightShiftHours: l.nightShiftHours,
            nightShiftCount: l.nightShiftCount ?? 0,
            annualLeaveHours: l.annualLeaveHours,
            sickLeaveHours: l.sickLeaveHours,
            familyLeaveHours: l.familyLeaveHours,
            studyLeaveHours: l.studyLeaveHours,
            unpaidLeaveHours: l.unpaidLeaveHours,
            workedShiftsCount: l.workedShiftsCount,
            sourceSummaryJson: {
              missingPayrollCode: l.missingPayrollCode,
              sourceSiteTimesheetIds: l.sourceSiteTimesheetIds,
              sourceLeaveRequestIds: l.sourceLeaveRequestIds,
            } as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        profile: { select: { id: true, name: true, provider: true } },
      },
    });

    await auditFromRequest(
      request,
      {
        action: "payroll_export_batch.created",
        entityType: "PayrollExportBatch",
        entityId: created.id,
        metadata: {
          periodKey: period.periodKey,
          profileId: profile.id,
          provider: profile.provider,
          employeeCount: summary.employeeCount,
          checksumSha256,
        },
      },
      tx
    );

    return created;
  });

  return batch;
}

export async function listBatches(
  companyId: string,
  filters: { periodKey?: string; status?: string }
) {
  return prisma.payrollExportBatch.findMany({
    where: {
      companyId,
      ...(filters.periodKey ? { periodKey: filters.periodKey } : {}),
      ...(filters.status
        ? { status: filters.status as "DRAFT" | "LOCKED" | "EXPORTED" | "VOIDED" }
        : {}),
    },
    include: {
      profile: { select: { id: true, name: true, provider: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
}

export async function getBatchDetail(companyId: string, batchId: string) {
  const batch = await prisma.payrollExportBatch.findFirst({
    where: { id: batchId, companyId },
    include: {
      profile: true,
      lines: {
        include: {
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              externalPayrollCode: true,
              firstName: true,
              lastName: true,
            },
          },
          site: { select: { id: true, name: true, costCenterCode: true } },
        },
        orderBy: [{ employeeFullName: "asc" }],
      },
    },
  });
  if (!batch) {
    throw new PayrollExportError(404, "BATCH_NOT_FOUND", "Payroll export batch not found");
  }
  return batch;
}

export async function deleteDraftBatch(
  companyId: string,
  batchId: string,
  request: FastifyRequest
) {
  const batch = await prisma.payrollExportBatch.findFirst({
    where: { id: batchId, companyId },
    select: { id: true, status: true, periodKey: true },
  });
  if (!batch) {
    throw new PayrollExportError(404, "BATCH_NOT_FOUND", "Payroll export batch not found");
  }
  if (batch.status !== "DRAFT") {
    throw new PayrollExportError(
      409,
      "BATCH_NOT_DRAFT",
      "Only draft export batches can be deleted; void locked/exported batches instead"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollExportBatch.delete({ where: { id: batchId } });
    await auditFromRequest(
      request,
      {
        action: "payroll_export_batch.deleted",
        entityType: "PayrollExportBatch",
        entityId: batchId,
        metadata: { periodKey: batch.periodKey },
      },
      tx
    );
  });
}

export async function lockBatch(
  companyId: string,
  batchId: string,
  userId: string,
  request: FastifyRequest,
  input: { overrideReason?: string }
) {
  const batch = await prisma.payrollExportBatch.findFirst({
    where: { id: batchId, companyId },
    include: {
      lines: {
        include: {
          employee: { select: { id: true, externalPayrollCode: true } },
        },
      },
      profile: { select: { id: true, provider: true } },
    },
  });
  if (!batch) {
    throw new PayrollExportError(404, "BATCH_NOT_FOUND", "Payroll export batch not found");
  }
  if (batch.status !== "DRAFT") {
    throw new PayrollExportError(
      409,
      "INVALID_BATCH_STATUS",
      `Batch is ${batch.status.toLowerCase()} and cannot be locked`
    );
  }

  const activeForPeriod = await prisma.payrollExportBatch.findFirst({
    where: {
      companyId,
      periodKey: batch.periodKey,
      id: { not: batch.id },
      status: { in: ["LOCKED", "EXPORTED"] },
    },
    select: { id: true, status: true },
  });
  if (activeForPeriod) {
    throw new PayrollExportError(
      409,
      "ACTIVE_BATCH_EXISTS",
      `Another ${activeForPeriod.status.toLowerCase()} batch already exists for ${batch.periodKey}. Void it before locking a replacement.`
    );
  }

  const liveReadiness = await getPeriodExportReadiness(
    companyId,
    batch.periodStart,
    batch.periodEnd,
    batch.periodKey
  );

  const blockers: string[] = [];
  if (liveReadiness.openExceptions > 0) {
    blockers.push(
      `${liveReadiness.openExceptions} attendance exception(s) remain open (${liveReadiness.openCritical} critical)`
    );
  }
  if (liveReadiness.unapprovedSiteTimesheets > 0) {
    blockers.push(
      `${liveReadiness.unapprovedSiteTimesheets} active site(s) still lack an approved site timesheet`
    );
  }
  if (liveReadiness.pendingLeaveRequests > 0) {
    blockers.push(
      `${liveReadiness.pendingLeaveRequests} overlapping leave request(s) remain pending`
    );
  }
  const missingCodeCount = new Set(
    batch.lines
      .filter((l) => !l.employee.externalPayrollCode?.trim())
      .map((l) => l.employeeId)
  ).size;
  if (missingCodeCount > 0) {
    blockers.push(
      `${missingCodeCount} employee(s) in this batch have no External Payroll Code`
    );
  }

  const finalOverrideReason =
    input.overrideReason?.trim() || batch.overrideReason?.trim() || null;

  if (blockers.length > 0 && !finalOverrideReason) {
    throw new PayrollExportError(
      409,
      "READINESS_BLOCKED",
      "Period readiness checks failed. Resolve blockers or supply an override reason.",
      {
        blockers,
        readiness: {
          ...liveReadiness,
          periodStart: formatDateKey(liveReadiness.periodStart),
          periodEnd: formatDateKey(liveReadiness.periodEnd),
        },
      }
    );
  }

  const sourceSiteTimesheetIds = new Set<string>();
  const sourceLeaveRequestIds = new Set<string>();
  for (const line of batch.lines) {
    const meta = line.sourceSummaryJson as {
      sourceSiteTimesheetIds?: unknown;
      sourceLeaveRequestIds?: unknown;
    } | null;
    if (Array.isArray(meta?.sourceSiteTimesheetIds)) {
      for (const id of meta.sourceSiteTimesheetIds) {
        if (typeof id === "string" && id.trim()) {
          sourceSiteTimesheetIds.add(id.trim());
        }
      }
    }
    if (Array.isArray(meta?.sourceLeaveRequestIds)) {
      for (const id of meta.sourceLeaveRequestIds) {
        if (typeof id === "string" && id.trim()) {
          sourceLeaveRequestIds.add(id.trim());
        }
      }
    }
  }

  const now = new Date();
  const locked = await prisma.$transaction(async (tx) => {
    const lockKey = `payroll-export-lock:${companyId}:${batch.periodKey}`;
    try {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    } catch {
      // In mock/test environments without pg_advisory_xact_lock, continue
    }

    const activeConflict = await tx.payrollExportBatch.findFirst({
      where: {
        companyId,
        periodKey: batch.periodKey,
        id: { not: batch.id },
        status: { in: ["LOCKED", "EXPORTED"] },
      },
      select: { id: true, status: true },
    });
    if (activeConflict) {
      throw new PayrollExportError(
        409,
        "ACTIVE_BATCH_EXISTS",
        `Another ${activeConflict.status.toLowerCase()} batch already exists for ${batch.periodKey}. Void it before locking a replacement.`
      );
    }

    for (const line of batch.lines) {
      const liveCode = line.employee.externalPayrollCode?.trim() || line.externalPayrollCode;
      if (liveCode !== line.externalPayrollCode) {
        await tx.payrollExportLine.update({
          where: { id: line.id },
          data: { externalPayrollCode: liveCode },
        });
      }
    }

    const claimed = await tx.payrollExportBatch.updateMany({
      where: { id: batch.id, companyId, status: "DRAFT" },
      data: {
        status: "LOCKED",
        lockedBy: userId,
        lockedAt: now,
        overrideReason: finalOverrideReason,
        readinessSnapshotJson: {
          ...liveReadiness,
          periodStart: formatDateKey(liveReadiness.periodStart),
          periodEnd: formatDateKey(liveReadiness.periodEnd),
          blockers,
        } as Prisma.InputJsonValue,
      },
    });
    if (claimed.count === 0) {
      throw new PayrollExportError(
        409,
        "INVALID_BATCH_STATUS",
        "Batch is no longer in draft status and cannot be locked"
      );
    }

    const updated = await tx.payrollExportBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: {
        profile: { select: { id: true, name: true, provider: true } },
      },
    });

    if (sourceSiteTimesheetIds.size > 0) {
      await tx.siteTimesheet.updateMany({
        where: {
          companyId,
          id: { in: Array.from(sourceSiteTimesheetIds) },
          status: "approved",
        },
        data: { status: "locked" },
      });
    }

    const leaveMarked = await markLeaveExported(
      companyId,
      batch.id,
      batch.periodStart,
      batch.periodEnd,
      tx,
      Array.from(sourceLeaveRequestIds)
    );

    await auditFromRequest(
      request,
      {
        action: "payroll_export_batch.locked",
        entityType: "PayrollExportBatch",
        entityId: batch.id,
        metadata: {
          periodKey: batch.periodKey,
          overrideReason: finalOverrideReason,
          lockedSiteTimesheets: sourceSiteTimesheetIds.size,
          exportedLeaveRequests: leaveMarked.exported,
        },
      },
      tx
    );

    return updated;
  });

  return locked;
}

export async function downloadBatch(
  companyId: string,
  batchId: string,
  userId: string,
  request: FastifyRequest
) {
  const batch = await prisma.payrollExportBatch.findFirst({
    where: { id: batchId, companyId },
    include: {
      company: { select: { name: true, legalName: true, payeReference: true } },
      profile: true,
      lines: {
        include: {
          employee: { select: { employeeNumber: true } },
          site: { select: { name: true } },
        },
        orderBy: [{ employeeFullName: "asc" }, { siteId: "asc" }],
      },
    },
  });

  if (!batch) {
    throw new PayrollExportError(404, "BATCH_NOT_FOUND", "Payroll export batch not found");
  }
  if (batch.status === "VOIDED") {
    throw new PayrollExportError(
      409,
      "BATCH_VOIDED",
      "Voided payroll export batches cannot be downloaded"
    );
  }
  if (batch.status === "DRAFT") {
    throw new PayrollExportError(
      409,
      "BATCH_NOT_LOCKED",
      "Lock the batch before downloading the official payroll export file"
    );
  }

  const normalizedLines: NormalizedExportLine[] = batch.lines.map((l) => ({
    employeeId: l.employeeId,
    employeeNumber: l.employee.employeeNumber,
    externalPayrollCode: l.externalPayrollCode,
    employeeFullName: l.employeeFullName,
    siteId: l.siteId,
    siteName: l.site?.name ?? null,
    costCenterCode: l.costCenterCode,
    basicHours: Number(l.basicHours),
    overtimeHours: Number(l.overtimeHours),
    sundayHours: Number(l.sundayHours),
    sundayDoubleHours: Number(l.sundayDoubleHours ?? 0),
    publicHolidayHours: Number(l.publicHolidayHours),
    nightShiftHours: Number(l.nightShiftHours),
    nightShiftCount: l.nightShiftCount ?? 0,
    annualLeaveHours: Number(l.annualLeaveHours),
    sickLeaveHours: Number(l.sickLeaveHours),
    familyLeaveHours: Number(l.familyLeaveHours),
    studyLeaveHours: Number(l.studyLeaveHours),
    unpaidLeaveHours: Number(l.unpaidLeaveHours),
    workedShiftsCount: l.workedShiftsCount,
  }));

  const context: ExportBatchContext = {
    batchId: batch.id,
    periodKey: batch.periodKey,
    periodStart: formatDateKey(batch.periodStart),
    periodEnd: formatDateKey(batch.periodEnd),
    companyName: batch.company.legalName?.trim() || batch.company.name,
    companyPayeReference: batch.company.payeReference,
    profileName: batch.profile.name,
    provider: batch.profile.provider as PayrollExportProviderType,
    delimiter: batch.profile.delimiter,
    dateFormat: batch.profile.dateFormat,
    codeMapping: resolvePayCodeMapping(batch.profile.codeMappingJson),
    customColumns: resolveCustomColumns(batch.profile.customColumnsJson),
    generatedAt: (batch.lockedAt ?? batch.createdAt).toISOString(),
  };

  const rendered = renderPayrollExport(context, normalizedLines);
  const fileChecksumSha256 = createHash("sha256").update(rendered.content, "utf8").digest("hex");
  const checksumSha256 = batch.checksumSha256;

  const isFirstExport = batch.status === "LOCKED";
  if (isFirstExport) {
    await prisma.$transaction(async (tx) => {
      await tx.payrollExportBatch.update({
        where: { id: batch.id },
        data: {
          status: "EXPORTED",
          exportedBy: userId,
          exportedAt: new Date(),
        },
      });
      await auditFromRequest(
        request,
        {
          action: "payroll_export_batch.exported",
          entityType: "PayrollExportBatch",
          entityId: batch.id,
          metadata: {
            periodKey: batch.periodKey,
            provider: batch.profile.provider,
            filename: rendered.filename,
            checksumSha256,
            fileChecksumSha256,
          },
        },
        tx
      );
    });
  } else {
    await auditFromRequest(request, {
      action: "payroll_export_batch.redownloaded",
      entityType: "PayrollExportBatch",
      entityId: batch.id,
      metadata: {
        periodKey: batch.periodKey,
        provider: batch.profile.provider,
        filename: rendered.filename,
        checksumSha256,
        fileChecksumSha256,
      },
    });
  }

  return {
    ...rendered,
    checksumSha256,
  };
}

export async function voidBatch(
  companyId: string,
  batchId: string,
  userId: string,
  request: FastifyRequest,
  reason: string
) {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    throw new PayrollExportError(
      400,
      "VOID_REASON_REQUIRED",
      "Void reason must be at least 5 characters"
    );
  }

  const batch = await prisma.payrollExportBatch.findFirst({
    where: { id: batchId, companyId },
    select: {
      id: true,
      status: true,
      periodKey: true,
      lines: { select: { sourceSummaryJson: true } },
    },
  });
  if (!batch) {
    throw new PayrollExportError(404, "BATCH_NOT_FOUND", "Payroll export batch not found");
  }
  if (batch.status === "VOIDED") {
    throw new PayrollExportError(409, "ALREADY_VOIDED", "Batch is already voided");
  }

  const sourceSiteTimesheetIds = new Set<string>();
  for (const line of batch.lines) {
    const meta = line.sourceSummaryJson as { sourceSiteTimesheetIds?: unknown } | null;
    if (Array.isArray(meta?.sourceSiteTimesheetIds)) {
      for (const id of meta.sourceSiteTimesheetIds) {
        if (typeof id === "string" && id.trim()) {
          sourceSiteTimesheetIds.add(id.trim());
        }
      }
    }
  }

  const voided = await prisma.$transaction(async (tx) => {
    const updated = await tx.payrollExportBatch.update({
      where: { id: batch.id },
      data: {
        status: "VOIDED",
        voidedBy: userId,
        voidedAt: new Date(),
        voidReason: trimmedReason,
      },
      include: {
        profile: { select: { id: true, name: true, provider: true } },
      },
    });

    const cleared = await unmarkLeaveExported(companyId, batch.id, tx);
    let unlockedSiteTimesheets = 0;
    if (sourceSiteTimesheetIds.size > 0) {
      const unlocked = await tx.siteTimesheet.updateMany({
        where: {
          companyId,
          id: { in: Array.from(sourceSiteTimesheetIds) },
          status: "locked",
        },
        data: { status: "approved" },
      });
      unlockedSiteTimesheets = unlocked.count;
    }

    await auditFromRequest(
      request,
      {
        action: "payroll_export_batch.voided",
        entityType: "PayrollExportBatch",
        entityId: batch.id,
        metadata: {
          periodKey: batch.periodKey,
          previousStatus: batch.status,
          reason: trimmedReason,
          clearedLeaveRequests: cleared.cleared,
          unlockedSiteTimesheets,
        },
      },
      tx
    );

    return updated;
  });

  return voided;
}

export async function exportEmployeeMasterCsv(companyId: string, request: FastifyRequest) {
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      status: { notIn: ["applicant"] },
    },
    select: {
      employeeNumber: true,
      externalPayrollCode: true,
      firstName: true,
      lastName: true,
      idNumber: true,
      taxNumber: true,
      commencementDate: true,
      status: true,
      employeeType: true,
      jobRole: true,
      psiraRegistrationNumber: true,
      email: true,
      phone: true,
      bankName: true,
      bankAccountNumber: true,
      bankBranchCode: true,
      physicalAddress: true,
      postalCode: true,
    },
    orderBy: [{ employeeNumber: "asc" }],
  });

  const headers = [
    "Employee Number",
    "External Payroll Code",
    "First Name",
    "Last Name",
    "ID Number",
    "Tax Number",
    "Commencement Date",
    "Status",
    "Employee Type",
    "Job Role",
    "PSIRA Number",
    "Email",
    "Phone",
    "Bank Name",
    "Bank Account Number",
    "Bank Branch Code",
    "Physical Address",
    "Postal Code",
  ];

  const rows = employees.map((e) => [
    e.employeeNumber,
    e.externalPayrollCode ?? "",
    e.firstName,
    e.lastName,
    e.idNumber ?? "",
    e.taxNumber ?? "",
    e.commencementDate ? formatDateKey(e.commencementDate) : "",
    e.status,
    e.employeeType,
    e.jobRole ?? "",
    e.psiraRegistrationNumber ?? "",
    e.email ?? "",
    e.phone ?? "",
    e.bankName ?? "",
    e.bankAccountNumber ?? "",
    e.bankBranchCode ?? "",
    e.physicalAddress ?? "",
    e.postalCode ?? "",
  ]);

  await auditFromRequest(request, {
    action: "payroll_export.employee_master_exported",
    entityType: "Employee",
    metadata: { count: employees.length },
  });

  return {
    filename: `sage-employee-master-${formatDateKey(new Date())}.csv`,
    mimeType: "text/csv; charset=utf-8",
    content: toDelimitedTable(headers, rows, ","),
  };
}
