#!/usr/bin/env node
/**
 * Orchestrator for Plethora read-only data accuracy audits.
 *
 * Usage:
 *   node scripts/data-audit/run-all.mjs
 *   node scripts/data-audit/run-all.mjs --json
 *   node scripts/data-audit/run-all.mjs --category orphans
 *
 * Exit code 1 if any CRITICAL findings exist.
 * Requires DATABASE_URL (any Postgres with Plethora schema).
 */
import { createPrisma, exitCodeFromFindings, printFindings, SEVERITY } from "./shared.mjs";
import { runOrphansAudit } from "./orphans.mjs";
import { runDuplicatesAudit } from "./duplicates.mjs";
import { runRelationshipsAudit } from "./relationships.mjs";
import { runDateRangesAudit } from "./date-ranges.mjs";
import { runRosterPeriodsAudit } from "./roster-periods.mjs";
import { runAttendancePayrollAudit } from "./attendance-payroll.mjs";
import { runDashboardReconciliationAudit } from "./dashboard-reconciliation.mjs";
import { runStatusConsistencyAudit } from "./status-consistency.mjs";

const AUDITS = [
  { category: "orphans", label: "Orphan references", run: runOrphansAudit },
  { category: "duplicates", label: "Duplicate records", run: runDuplicatesAudit },
  { category: "relationships", label: "Relationship integrity", run: runRelationshipsAudit },
  { category: "date-ranges", label: "Date ranges & overlaps", run: runDateRangesAudit },
  { category: "roster-periods", label: "Roster/pay period alignment", run: runRosterPeriodsAudit },
  { category: "attendance-payroll", label: "Attendance → payroll chain", run: runAttendancePayrollAudit },
  { category: "dashboard-reconciliation", label: "Dashboard reconciliation", run: runDashboardReconciliationAudit },
  { category: "status-consistency", label: "Status consistency", run: runStatusConsistencyAudit },
];

function parseCategoryArg() {
  const idx = process.argv.indexOf("--category");
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const json = process.argv.includes("--json");
  const categoryFilter = parseCategoryArg();
  const prisma = createPrisma();

  console.log("Plethora data accuracy audit (read-only)\n");

  const allFindings = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("Cannot connect to database:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  try {
    for (const audit of AUDITS) {
      if (categoryFilter && audit.category !== categoryFilter) continue;

      console.log(`=== ${audit.label} (${audit.category}) ===`);
      const findings = await audit.run(prisma);
      allFindings.push(...findings);
      printFindings(findings, { json, category: audit.category });
      console.log("");
    }

    const critical = allFindings.filter((f) => f.severity === SEVERITY.CRITICAL);
    const high = allFindings.filter((f) => f.severity === SEVERITY.HIGH);
    const medium = allFindings.filter((f) => f.severity === SEVERITY.MEDIUM);
    const low = allFindings.filter((f) => f.severity === SEVERITY.LOW);

    console.log("=== Summary ===");
    console.log(`  Total findings: ${allFindings.length}`);
    console.log(`  Critical: ${critical.length}`);
    console.log(`  High: ${high.length}`);
    console.log(`  Medium: ${medium.length}`);
    console.log(`  Low: ${low.length}`);

    if (json) {
      console.log(JSON.stringify({ summary: { total: allFindings.length, critical: critical.length, high: high.length, medium: medium.length, low: low.length }, findings: allFindings }, null, 2));
    }

    process.exit(exitCodeFromFindings(allFindings));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
