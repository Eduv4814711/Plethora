#!/usr/bin/env node
/**
 * Show exactly which employee leave days are blocking payroll with
 * "N employee leave day(s) have duplicate legacy records".
 *
 * Mirrors the duplicateLegacyDays check in getLeaveReadiness (leave-management.service.ts)
 * and the de-duplication in aggregateTimesheets (timesheet.service.ts), so the output
 * says both why a day is blocked and what payroll would have paid if it were not.
 *
 * READ-ONLY — SELECT queries only, safe on production.
 *
 * Usage:
 *   node scripts/inspect-leave-duplicates.mjs --payroll-run-id <id>
 *   node scripts/inspect-leave-duplicates.mjs --company-id <id> --start 2026-06-26 --end 2026-07-26
 *   ... add --json for machine-readable output
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]?.trim() : undefined;
};
const json = args.includes("--json");

/** Midnight UTC, matching normalizeLeaveDate in leave-availability.service.ts. */
function normalizeLeaveDate(input) {
  const key = typeof input === "string" ? input.slice(0, 10) : input.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`Dates must be YYYY-MM-DD, got: ${key}`);
  }
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

const dateKey = (d) => d.toISOString().slice(0, 10);

/** Leave types the payroll engine treats as something other than ordinary paid leave. */
const UIF_TYPES = new Set(["maternity", "parental", "adoption", "commissioning_parental"]);
function payrollBucket(type) {
  if (type === "unpaid") return "unpaid (reduces salary)";
  if (type === "injury_on_duty") return "IOD";
  if (UIF_TYPES.has(type)) return "UIF-supported (reduces salary)";
  return "paid leave";
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set. Point it at the target Postgres database.");
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    let companyId = flag("--company-id");
    let start = flag("--start");
    let end = flag("--end");
    const payrollRunId = flag("--payroll-run-id");

    if (payrollRunId) {
      const run = await prisma.payrollRun.findUnique({
        where: { id: payrollRunId },
        select: { companyId: true, periodStart: true, periodEnd: true, status: true },
      });
      if (!run) throw new Error(`Payroll run not found: ${payrollRunId}`);
      companyId = run.companyId;
      start = dateKey(run.periodStart);
      end = dateKey(run.periodEnd);
      if (!json) console.log(`Payroll run ${payrollRunId} (${run.status}): ${start} to ${end}\n`);
    }

    if (!companyId || !start || !end) {
      throw new Error(
        "Provide --payroll-run-id <id>, or --company-id <id> --start YYYY-MM-DD --end YYYY-MM-DD"
      );
    }

    const periodStart = normalizeLeaveDate(start);
    const periodEnd = normalizeLeaveDate(end);

    // Same two queries getLeaveReadiness runs.
    const [legacyRows, authoritativeOccurrences] = await Promise.all([
      prisma.leaveRecord.findMany({
        where: { employee: { companyId }, date: { gte: periodStart, lte: periodEnd } },
        select: {
          id: true,
          employeeId: true,
          date: true,
          type: true,
          hours: true,
          createdAt: true,
          employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
        },
        orderBy: [{ employeeId: "asc" }, { date: "asc" }, { id: "asc" }],
      }),
      prisma.leaveOccurrence.findMany({
        where: {
          companyId,
          leaveDate: { gte: periodStart, lte: periodEnd },
          status: { not: "CANCELLED" },
        },
        select: { employeeId: true, leaveDate: true },
      }),
    ]);

    // A day with an authoritative occurrence is never a blocker: the legacy rows are
    // just compatibility records for older screens.
    const authoritativeDayKeys = new Set(
      authoritativeOccurrences.map((o) => `${o.employeeId}:${dateKey(o.leaveDate)}`)
    );

    const byDay = new Map();
    for (const row of legacyRows) {
      const key = `${row.employeeId}:${dateKey(row.date)}`;
      if (authoritativeDayKeys.has(key)) continue;
      byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }

    const blocking = [...byDay.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => {
        const [employeeId, day] = [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)];
        const emp = rows[0].employee;

        // aggregateTimesheets collapses only rows identical in type AND hours.
        // Anything else is summed — which is how a day gets paid twice.
        const distinct = new Map();
        for (const row of rows) {
          distinct.set(`${row.type}:${Number(row.hours).toFixed(2)}`, row);
        }
        const survivingRows = [...distinct.values()];
        const exactDuplicatesOnly = survivingRows.length === 1;
        const hoursIfUnblocked = survivingRows.reduce((sum, r) => sum + Number(r.hours), 0);

        return {
          employeeId,
          employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
          employeeNumber: emp.employeeNumber,
          date: day,
          kind: exactDuplicatesOnly ? "exact-duplicate" : "conflicting-rows",
          recordCount: rows.length,
          records: rows.map((r) => ({
            id: r.id,
            type: r.type,
            hours: Number(r.hours),
            bucket: payrollBucket(r.type),
            createdAt: r.createdAt.toISOString(),
          })),
          hoursPayrollWouldUse: Number(hoursIfUnblocked.toFixed(2)),
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date));

    if (json) {
      console.log(JSON.stringify({ companyId, start, end, blockingDays: blocking }, null, 2));
      return;
    }

    console.log(`Legacy leave rows in period:        ${legacyRows.length}`);
    console.log(`Days with an authoritative record:  ${authoritativeDayKeys.size}`);
    console.log(`Blocking days:                      ${blocking.length}\n`);

    if (blocking.length === 0) {
      console.log("No blocking days. If payroll is still blocked, the cause is unresolved");
      console.log("leave applications or missing verified documents, not duplicates.");
      return;
    }

    for (const day of blocking) {
      const who = day.employeeNumber ? `${day.employeeName} (${day.employeeNumber})` : day.employeeName;
      console.log(`${day.date}  ${who}`);
      console.log(`  employeeId: ${day.employeeId}`);
      console.log(`  ${day.recordCount} legacy rows — ${day.kind}`);
      for (const r of day.records) {
        console.log(`    ${r.id}  ${r.type.padEnd(24)} ${String(r.hours).padStart(6)}h  ${r.bucket}  created ${r.createdAt.slice(0, 10)}`);
      }
      if (day.kind === "exact-duplicate") {
        console.log(`  -> Identical rows. Payroll would pay ${day.hoursPayrollWouldUse}h (it collapses exact copies).`);
        console.log(`  -> Safe fix: keep the oldest row, delete the rest.`);
      } else {
        console.log(`  -> Rows differ, so payroll would SUM them and pay ${day.hoursPayrollWouldUse}h for one day.`);
        console.log(`  -> Needs a decision: which row reflects what the employee actually took?`);
      }
      console.log("");
    }

    const conflicting = blocking.filter((d) => d.kind === "conflicting-rows").length;
    console.log(`Summary: ${blocking.length - conflicting} exact-duplicate day(s), ${conflicting} conflicting day(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
