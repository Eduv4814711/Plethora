#!/usr/bin/env node
/**
 * Verify SiteTimesheet and PayrollRun period bounds match company 26–25 (or configured) cycle.
 */
import { createPrisma, finding, parsePayPeriodDays, printFindings, SEVERITY, expectedSpanDays } from "./shared.mjs";

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runRosterPeriodsAudit(prisma) {
  const findings = [];

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, settings: true },
  });

  for (const company of companies) {
    const { startDay, endDay } = parsePayPeriodDays(company.settings);
    const span = expectedSpanDays(startDay, endDay);

    const badTimesheets = await prisma.$queryRaw`
      SELECT st.id, st."periodStart", st."periodEnd",
        (st."periodEnd"::date - st."periodStart"::date + 1)::int AS span_days
      FROM "SiteTimesheet" st
      WHERE st."companyId" = ${company.id}
        AND (
          EXTRACT(DAY FROM st."periodStart")::int != ${startDay}
          OR EXTRACT(DAY FROM st."periodEnd")::int != ${endDay}
          OR (st."periodEnd"::date - st."periodStart"::date + 1)::int NOT BETWEEN ${span - 2} AND ${span + 2}
        )
      LIMIT 100
    `;

    if (badTimesheets.length > 0) {
      findings.push(
        finding({
          id: `site-timesheet-period-mismatch-${company.id}`,
          category: "roster-periods",
          severity: SEVERITY.MEDIUM,
          message: `SiteTimesheet periods not aligned to company pay cycle (${startDay}–${endDay}) for "${company.name}"`,
          count: badTimesheets.length,
          sample: badTimesheets.slice(0, 3),
        })
      );
    }

    const badPayrollRuns = await prisma.$queryRaw`
      SELECT pr.id, pr."periodStart", pr."periodEnd"
      FROM "PayrollRun" pr
      WHERE pr."companyId" = ${company.id}
        AND pr.status != 'draft'
        AND (
          EXTRACT(DAY FROM pr."periodStart")::int NOT BETWEEN 1 AND 31
        )
      LIMIT 50
    `;
    // PayrollRun uses DateTime — flag runs whose period span is wildly off expected
    const badPayrollSpan = await prisma.$queryRaw`
      SELECT pr.id, pr."periodStart", pr."periodEnd",
        (pr."periodEnd"::date - pr."periodStart"::date + 1)::int AS span_days
      FROM "PayrollRun" pr
      WHERE pr."companyId" = ${company.id}
        AND (pr."periodEnd"::date - pr."periodStart"::date + 1)::int NOT BETWEEN ${span - 2} AND ${span + 2}
      LIMIT 100
    `;

    if (badPayrollSpan.length > 0) {
      findings.push(
        finding({
          id: `payroll-run-span-mismatch-${company.id}`,
          category: "roster-periods",
          severity: SEVERITY.MEDIUM,
          message: `PayrollRun period span does not match expected ${span}-day pay cycle for "${company.name}"`,
          count: badPayrollSpan.length,
          sample: badPayrollSpan.slice(0, 3),
        })
      );
    }
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runRosterPeriodsAudit(prisma);
    console.log("Roster/pay period alignment audit");
    printFindings(findings, { json });
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
