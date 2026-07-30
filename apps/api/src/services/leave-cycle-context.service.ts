/**
 * Resolves the entitlement cycle an employee is in for a given leave type.
 *
 * Three things have to line up before a cycle can be built:
 *
 *   1. the employment anchor — BCEA cycles run from the individual's start
 *      date, not the calendar year;
 *   2. the applicable policy version, which supplies the cycle length and the
 *      s20(4)-style grace period; and
 *   3. the company's cut-over date, because cycle scoping changes what an
 *      existing tenant's balances say and must not be applied retroactively.
 *
 * Kept apart from `leave-management.service.ts` so the accrual runner, the
 * balance reader, the cycle-close runner and the termination settlement all
 * resolve cycles the same way.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  enumerateLeaveCycles,
  resolveLeaveCycle,
  type LeaveCycleSpec,
  type LeaveCycleWindow,
} from "../lib/leave-cycles.js";
import { normalizeLeaveDate } from "./leave-availability.service.js";

/** Grace months by leave type, where the BCEA prescribes one. */
const STATUTORY_GRACE_MONTHS: Record<string, number> = {
  // BCEA s20(4): annual leave must be granted within six months of the cycle
  // ending. Jooste v Kohler Packaging and Hartley v SMD Trading confirm that
  // untaken statutory leave is forfeited after that 18-month window.
  annual: 6,
};

export type LeaveCycleContext = {
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  spec: LeaveCycleSpec;
  /** The cycle containing `asOf`. */
  current: LeaveCycleWindow;
  /** Every cycle from the anchor through `asOf`, oldest first. */
  history: LeaveCycleWindow[];
  policyVersionId: string | null;
  cycleMonths: number;
  graceMonths: number;
  carryOverLimitMinutes: number | null;
};

export type LeaveCompanySettingsView = {
  statutoryEngineEnabledFrom: Date | null;
  defaultGraceMonths: number;
};

const DEFAULT_SETTINGS: LeaveCompanySettingsView = {
  statutoryEngineEnabledFrom: null,
  defaultGraceMonths: 6,
};

export async function getLeaveCompanySettings(
  companyId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<LeaveCompanySettingsView> {
  const row = await client.leaveCompanySettings.findUnique({
    where: { companyId },
    select: { statutoryEngineEnabledFrom: true, defaultGraceMonths: true },
  });
  return row ?? DEFAULT_SETTINGS;
}

/**
 * Whether cycle scoping, carry-over and forfeiture apply for this company.
 *
 * A company that has not been cut over keeps the original flat running-balance
 * behaviour, so upgrading the software never silently expires anyone's leave.
 */
export async function isStatutoryEngineEnabled(
  companyId: string,
  asOf: Date = new Date(),
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const settings = await getLeaveCompanySettings(companyId, client);
  if (!settings.statutoryEngineEnabledFrom) return false;
  return (
    normalizeLeaveDate(settings.statutoryEngineEnabledFrom) <=
    normalizeLeaveDate(asOf)
  );
}

/**
 * Employment anchor per employee.
 *
 * The earliest effective-dated employment term wins because it is the
 * HR-confirmed record; `commencementDate` is the controlled fallback for
 * tenants that have not captured terms yet. This is the same precedence the
 * accrual runner already applies.
 */
export async function resolveEmploymentAnchors(
  companyId: string,
  employeeIds: string[],
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Map<string, Date>> {
  const anchors = new Map<string, Date>();
  if (employeeIds.length === 0) return anchors;

  const [employees, terms] = await Promise.all([
    client.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: { id: true, commencementDate: true },
    }),
    client.employmentTerm.findMany({
      where: { companyId, employeeId: { in: employeeIds } },
      orderBy: { effectiveFrom: "asc" },
      select: { employeeId: true, effectiveFrom: true },
    }),
  ]);

  const earliestTerm = new Map<string, Date>();
  for (const term of terms) {
    if (!earliestTerm.has(term.employeeId)) {
      earliestTerm.set(term.employeeId, term.effectiveFrom);
    }
  }
  for (const employee of employees) {
    const anchor = earliestTerm.get(employee.id) ?? employee.commencementDate;
    if (anchor) anchors.set(employee.id, normalizeLeaveDate(anchor));
  }
  return anchors;
}

/**
 * The policy version that governs an employee's leave type on a date.
 *
 * Resolution order, most specific first:
 *   1. an assignment scoped to this employee *and* this leave type;
 *   2. an assignment scoped to this employee across all leave types;
 *   3. the company statutory baseline.
 *
 * An ACTIVE version always wins; a pending version is returned only so callers
 * can preview it, and `reviewStatus` lets them refuse to act on it.
 */
export async function resolvePolicyVersionForEmployee(params: {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  from: Date;
  to?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
}) {
  const coverage = await resolvePolicyCoverageForEmployee(params);
  return coverage.version;
}

/**
 * The policy governing a leave period, and whether that period is fully
 * covered by active policy.
 *
 * The version in force on the **first day** of the leave governs the whole
 * application. Requiring one version to span the entire period instead would
 * mean that publishing any new policy version immediately made every in-flight
 * application unapprovable — a leave request running from June to August would
 * be stranded by a policy change in July, through no fault of the employee.
 *
 * A genuine gap in active policy is still reported, because that is a real
 * configuration failure rather than an ordinary version change.
 */
export async function resolvePolicyCoverageForEmployee(params: {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  from: Date;
  to?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
}): Promise<{
  version: Awaited<ReturnType<typeof prisma.leavePolicyVersion.findFirst>>;
  coversFullPeriod: boolean;
}> {
  const client = params.client ?? prisma;
  const from = normalizeLeaveDate(params.from);
  const to = normalizeLeaveDate(params.to ?? params.from);

  const assignments = await client.employeeLeavePolicyAssignment.findMany({
    where: {
      employeeId: params.employeeId,
      policy: { companyId: params.companyId },
      effectiveFrom: { lte: from },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: to } }],
      AND: [{ OR: [{ leaveTypeId: params.leaveTypeId }, { leaveTypeId: null }] }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  const assignment =
    assignments.find((item) => item.leaveTypeId === params.leaveTypeId) ??
    assignments.find((item) => item.leaveTypeId == null) ??
    null;

  const scope: Prisma.LeavePolicyVersionWhereInput = {
    companyId: params.companyId,
    leaveTypeId: params.leaveTypeId,
    ...(assignment
      ? { policyId: assignment.policyId }
      : { policy: { category: "STATUTORY_BASELINE" } }),
  };

  // Every version that touches the requested period, oldest first.
  const overlapping = await client.leavePolicyVersion.findMany({
    where: {
      ...scope,
      effectiveFrom: { lte: to },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
    },
    orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }],
  });

  const active = overlapping.filter((item) => item.reviewStatus === "ACTIVE");
  const governing =
    // The active version in force on the first day of the leave.
    [...active].reverse().find((item) => item.effectiveFrom <= from) ??
    // Otherwise the earliest active version touching the period, so a leave
    // request that starts before any policy existed still resolves to one.
    active[0] ??
    null;

  return {
    version: governing ?? pendingFallback(overlapping, from),
    coversFullPeriod: governing ? hasContinuousCoverage(active, from, to) : false,
  };
}

/**
 * A pending version is returned only so the caller can preview it. Approval
 * checks `reviewStatus`, so a pending policy can never authorise leave.
 */
function pendingFallback(
  versions: Array<{ reviewStatus: string; effectiveFrom: Date }>,
  from: Date
) {
  const pending = versions.filter(
    (item) => item.reviewStatus === "PENDING_HR_LEGAL_CONFIRMATION"
  );
  return (
    ([...pending].reverse().find((item) => item.effectiveFrom <= from) ??
      pending[0] ??
      null) as Awaited<ReturnType<typeof prisma.leavePolicyVersion.findFirst>>
  );
}

/** Whether active versions tile `[from, to]` with no uncovered day. */
function hasContinuousCoverage(
  active: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>,
  from: Date,
  to: Date
): boolean {
  let cursor = from;
  for (const version of active) {
    if (version.effectiveFrom > cursor) break;
    if (!version.effectiveTo) return true;
    if (version.effectiveTo >= cursor) {
      cursor = new Date(version.effectiveTo.getTime() + 86_400_000);
    }
    if (cursor > to) return true;
  }
  return cursor > to;
}

/**
 * Build the full cycle context for one employee and leave type.
 *
 * Returns `null` when no anchor is known — an employee with neither an
 * employment term nor a commencement date has no cycle, and the caller must
 * report that rather than invent one.
 */
export async function getLeaveCycleContext(params: {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  asOf?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
}): Promise<LeaveCycleContext | null> {
  const client = params.client ?? prisma;
  const asOf = normalizeLeaveDate(params.asOf ?? new Date());

  const [anchors, policyVersion, settings] = await Promise.all([
    resolveEmploymentAnchors(params.companyId, [params.employeeId], client),
    resolvePolicyVersionForEmployee({
      companyId: params.companyId,
      employeeId: params.employeeId,
      leaveTypeId: params.leaveTypeId,
      from: asOf,
      client,
    }),
    getLeaveCompanySettings(params.companyId, client),
  ]);

  const anchor = anchors.get(params.employeeId);
  if (!anchor) return null;

  const cycleMonths = policyVersion?.cycleMonths ?? 12;
  if (cycleMonths <= 0) return null;
  const graceMonths = resolveGraceMonths({
    leaveTypeCode: params.leaveTypeCode,
    expiryMonths: policyVersion?.expiryMonths ?? null,
    defaultGraceMonths: settings.defaultGraceMonths,
  });

  const spec: LeaveCycleSpec = {
    leaveTypeCode: params.leaveTypeCode,
    anchor,
    cycleMonths,
    graceMonths,
  };

  return {
    employeeId: params.employeeId,
    leaveTypeId: params.leaveTypeId,
    leaveTypeCode: params.leaveTypeCode,
    spec,
    current: resolveLeaveCycle(spec, asOf),
    history: enumerateLeaveCycles(spec, anchor, asOf),
    policyVersionId: policyVersion?.id ?? null,
    cycleMonths,
    graceMonths,
    carryOverLimitMinutes: policyVersion?.carryOverLimitMinutes ?? null,
  };
}

/**
 * Grace months for a leave type.
 *
 * An explicit policy `expiryMonths` is the configured rule and wins outright.
 * Otherwise the statutory grace for the type applies, and a company may only
 * extend it — a longer window to use accrued leave is more favourable to the
 * employee, so it is permitted; a shorter one is not.
 *
 * Types with no statutory grace get none. Sick leave in particular resets hard
 * on its 36-month boundary and must not inherit an annual-leave grace period.
 */
export function resolveGraceMonths(params: {
  leaveTypeCode: string;
  expiryMonths: number | null;
  defaultGraceMonths?: number;
}): number {
  if (params.expiryMonths != null && params.expiryMonths >= 0) {
    return params.expiryMonths;
  }
  const statutory = STATUTORY_GRACE_MONTHS[params.leaveTypeCode];
  if (statutory == null) return 0;
  return Math.max(statutory, params.defaultGraceMonths ?? 0);
}
