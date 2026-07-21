/**
 * Reconcile legacy LeaveRequest/LeaveRecord rows into the authoritative leave domain.
 *
 * Safety: dry-run is the default. Applying requires explicit company and database
 * target confirmation. Legacy rows are never changed or deleted.
 *
 * Usage:
 *   npx tsx scripts/migrate-leave-source-of-truth.ts --company-id <id>
 *   npx tsx scripts/migrate-leave-source-of-truth.ts --company-id <id> --apply \
 *     --expected-host <database-host> --expected-port <database-port> \
 *     --expected-database <database-name>
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeaveApplicationStatus, Prisma } from "@prisma/client";
import { confirmDatabaseTarget } from "../src/lib/leave-import-target.js";
import {
  findExistingApplicationConflicts,
  findInvalidLegacyRows,
  legacyImportIdempotencyKey,
} from "../src/lib/leave-import-reconciliation.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(scriptDir, "..", ".env") });

const args = process.argv.slice(2);
const flagValue = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
};
const requestedCompanyId = flagValue("--company-id");
const expectedHost = flagValue("--expected-host");
const expectedPort = flagValue("--expected-port");
const expectedDatabase = flagValue("--expected-database");
const apply = args.includes("--apply");

if (!requestedCompanyId) throw new Error("Missing --company-id <id>. Dry-run is the default; add --apply only after reviewing anomalies.");
const companyId: string = requestedCompanyId;

const databaseTarget = confirmDatabaseTarget({
  rawDatabaseUrl: process.env.DATABASE_URL,
  apply,
  expectedHost,
  expectedPort,
  expectedDatabase,
});

let disconnectPrisma: (() => Promise<void>) | undefined;

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const rowKey = (row: { employeeId: string; date: Date; type: string; hours: unknown }) =>
  `${row.employeeId}:${dateKey(row.date)}:${row.type}:${Number(row.hours).toFixed(2)}`;

function legacyStatus(status: string): LeaveApplicationStatus {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (status === "pending") return "PENDING_HR";
  throw new Error(`Unsupported legacy request status: ${status || "<empty>"}`);
}

async function main() {
  const [{ prisma }, { ensureDefaultLeavePolicy }] = await Promise.all([
    import("../src/lib/prisma.js"),
    import("../src/services/leave-management.service.js"),
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw new Error(`Company not found: ${companyId}`);

  const [requests, records, existingApplications, lockedPayroll, actor] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { employee: { companyId } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] }),
    prisma.leaveRecord.findMany({ where: { employee: { companyId } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] }),
    prisma.leaveApplication.findMany({
      where: { companyId },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        status: true,
        legacyLeaveRequestId: true,
        legacyLeaveRecordIds: true,
      },
    }),
    prisma.payrollRun.findMany({ where: { companyId, status: { in: ["approved", "paid"] } }, include: { items: { select: { employeeId: true } } } }),
    prisma.user.findFirst({ where: { companyId, role: { in: ["hr_payroll", "admin"] } }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  if (apply && !actor) throw new Error("An HR/payroll or company-admin user is required as the migration audit actor.");

  const requestIdsDone = new Set(existingApplications.map((a) => a.legacyLeaveRequestId).filter((id): id is string => Boolean(id)));
  const recordIdsDone = new Set(existingApplications.flatMap((a) => Array.isArray(a.legacyLeaveRecordIds) ? a.legacyLeaveRecordIds.filter((id): id is string => typeof id === "string") : []));
  const pendingRequests = requests.filter((request) => !requestIdsDone.has(request.id));
  const pendingRecords = records.filter((record) => !recordIdsDone.has(record.id));
  const recordsByKey = new Map<string, typeof records>();
  for (const record of pendingRecords) {
    const key = rowKey(record);
    recordsByKey.set(key, [...(recordsByKey.get(key) ?? []), record]);
  }

  const duplicates = [...recordsByKey.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, recordIds: rows.map((r) => r.id) }));
  const ambiguous = new Set(duplicates.flatMap((row) => row.recordIds));
  const matchedRecordIds = new Set<string>();
  const matches = pendingRequests.flatMap((request) => {
    if (request.status !== "approved") return [];
    const candidates = recordsByKey.get(rowKey(request))?.filter((record) => !ambiguous.has(record.id)) ?? [];
    if (candidates.length !== 1) return [];
    matchedRecordIds.add(candidates[0].id);
    return [{ request, record: candidates[0] }];
  });
  const unmatchedRecords = pendingRecords.filter((record) => !matchedRecordIds.has(record.id));
  const unmatchedRequests = pendingRequests.filter((request) => !matches.some((match) => match.request.id === request.id));
  const unmatchedApprovedRequests = unmatchedRequests
    .filter((request) => request.status === "approved")
    .map((request) => ({
      requestId: request.id,
      employeeId: request.employeeId,
      date: dateKey(request.date),
      type: request.type,
      hours: Number(request.hours),
    }));
  const plannedActiveRows = [
    ...matches.map((match) => ({ id: `match:${match.request.id}`, employeeId: match.request.employeeId, date: match.request.date })),
    ...unmatchedRequests.filter((request) => request.status !== "rejected").map((request) => ({ id: `request:${request.id}`, employeeId: request.employeeId, date: request.date })),
    ...unmatchedRecords.map((record) => ({ id: `record:${record.id}`, employeeId: record.employeeId, date: record.date })),
  ];
  const activeByDay = new Map<string, typeof plannedActiveRows>();
  for (const row of plannedActiveRows) {
    const key = `${row.employeeId}:${dateKey(row.date)}`;
    activeByDay.set(key, [...(activeByDay.get(key) ?? []), row]);
  }
  const overlaps = [...activeByDay.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, sourceIds: rows.map((row) => row.id) }));
  const existingApplicationConflicts = findExistingApplicationConflicts(plannedActiveRows, existingApplications);
  const invalidRows = findInvalidLegacyRows([
    ...pendingRequests.map((request) => ({
      source: "request" as const,
      id: request.id,
      hours: request.hours,
      status: request.status,
    })),
    ...pendingRecords.map((record) => ({
      source: "record" as const,
      id: record.id,
      hours: record.hours,
    })),
  ]);
  const knownTypes = new Set(["annual", "sick", "family_responsibility", "parental", "adoption", "commissioning_parental", "maternity", "study", "special", "injury_on_duty", "unpaid"]);
  const missingPolicy = [...new Set([...pendingRequests, ...pendingRecords].map((row) => row.type).filter((type) => !knownTypes.has(type)))];
  const payrollConflicts = plannedActiveRows.flatMap((row) => lockedPayroll
    .filter((run) => run.periodStart <= row.date && run.periodEnd >= row.date && run.items.some((item) => item.employeeId === row.employeeId))
    .map((run) => ({ sourceId: row.id, employeeId: row.employeeId, date: dateKey(row.date), payrollRunId: run.id, payrollStatus: run.status })));

  const report = {
    company,
    mode: apply ? "apply" : "dry-run",
    databaseTarget,
    totals: { requests: requests.length, records: records.length, existingApplications: existingApplications.length },
    reconciliation: { alreadyImportedRequests: requestIdsDone.size, alreadyImportedRecords: recordIdsDone.size, reliableMatches: matches.length, unmatchedRequests: unmatchedRequests.length, unmatchedRecords: unmatchedRecords.length, unmatchedApprovedRequests },
    anomalies: { duplicates, overlaps, existingApplicationConflicts, invalidRows, missingPolicy, payrollConflicts },
    openingBalancesRequired: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log("Dry-run only. Review the anomaly report and obtain HR-approved opening balances before running with --apply.");
    return;
  }
  if (duplicates.length || overlaps.length || existingApplicationConflicts.length || invalidRows.length || missingPolicy.length || payrollConflicts.length) {
    throw new Error("Apply stopped: resolve duplicate/overlapping rows, existing-application conflicts, invalid legacy rows, missing leave types, and locked-payroll conflicts first.");
  }

  await ensureDefaultLeavePolicy(companyId, actor!.id);
  const leaveTypes = await prisma.leaveTypeDefinition.findMany({ where: { companyId } });
  const typeByCode = new Map(leaveTypes.map((type) => [type.code, type]));

  const importOne = async (input: {
    request?: (typeof requests)[number];
    record?: (typeof records)[number];
  }) => {
    const source = input.request ?? input.record!;
    if (input.request && requestIdsDone.has(input.request.id)) return;
    if (input.record && recordIdsDone.has(input.record.id)) return;
    const leaveType = typeByCode.get(source.type);
    if (!leaveType) throw new Error(`No configured type for ${source.type}`);
    const minutes = Math.round(Number(source.hours) * 60);
    if (minutes <= 0) throw new Error(`Legacy row has non-positive hours: ${input.request?.id ?? input.record?.id}`);
    const status: LeaveApplicationStatus = input.record ? "IMPORTED_APPROVED" : legacyStatus(input.request!.status);
    const paidMinutes = leaveType.payrollTreatment === "PAID_EMPLOYER" ? minutes : 0;
    const unpaidMinutes = ["UNPAID_DEDUCTION", "UIF_NO_EMPLOYER_PAY"].includes(leaveType.payrollTreatment) ? minutes : 0;
    await prisma.$transaction(async (tx) => {
      const application = await tx.leaveApplication.create({
        data: {
          companyId,
          employeeId: source.employeeId,
          leaveTypeId: leaveType.id,
          startDate: source.date,
          endDate: source.date,
          requestedMinutes: minutes,
          calculatedMinutes: minutes,
          paidMinutes,
          unpaidMinutes,
          status,
          source: "LEGACY_IMPORT",
          idempotencyKey: legacyImportIdempotencyKey({ requestId: input.request?.id, recordId: input.record?.id }),
          reason: input.request?.reason ?? "Imported legacy approved leave record",
          decisionReason: status === "REJECTED" ? "Imported legacy rejection" : null,
          legacyLeaveRequestId: input.request?.id,
          legacyLeaveRecordIds: input.record ? [input.record.id] : [],
          submittedAt: input.request?.createdAt,
          decidedAt: input.request?.reviewedAt,
          createdById: actor!.id,
          reviewedById: status === "PENDING_HR" ? null : actor!.id,
          occurrences: status === "REJECTED" ? undefined : {
            create: [{ companyId, employeeId: source.employeeId, leaveDate: source.date, scheduledMinutes: minutes, requestedMinutes: minutes, paidMinutes, unpaidMinutes, payrollTreatment: leaveType.payrollTreatment, status: status === "PENDING_HR" ? "RESERVED" : "APPROVED" }],
          },
          approvalSteps: { create: [{ stepOrder: 1, role: "hr_payroll", decision: status === "PENDING_HR" ? "PENDING" : status === "REJECTED" ? "REJECTED" : "APPROVED", actorId: status === "PENDING_HR" ? null : actor!.id, decidedAt: status === "PENDING_HR" ? null : new Date() }] },
        },
      });
      if (status === "PENDING_HR") {
        await tx.leaveLedgerEntry.create({ data: { companyId, employeeId: source.employeeId, leaveTypeId: leaveType.id, applicationId: application.id, entryType: "RESERVATION", effectiveDate: source.date, minutes: -minutes, reason: "Imported pending request reservation", createdById: actor!.id } });
      } else if (["APPROVED", "IMPORTED_APPROVED"].includes(status)) {
        await tx.leaveLedgerEntry.create({ data: { companyId, employeeId: source.employeeId, leaveTypeId: leaveType.id, applicationId: application.id, entryType: "TAKEN", effectiveDate: source.date, minutes: -minutes, reason: "Imported approved leave", createdById: actor!.id } });
      }
      await tx.leaveAuditEvent.create({ data: { companyId, employeeId: source.employeeId, applicationId: application.id, userId: actor!.id, eventType: "LEGACY_LEAVE_IMPORTED", newValue: { status, legacyLeaveRequestId: input.request?.id, legacyLeaveRecordId: input.record?.id } as Prisma.InputJsonValue } });
    });
  };

  for (const match of matches) await importOne(match);
  for (const request of unmatchedRequests) await importOne({ request });
  for (const record of unmatchedRecords) await importOne({ record });
  console.log("Import complete. Legacy tables were retained unchanged and no payroll history was rewritten.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await disconnectPrisma?.();
});
