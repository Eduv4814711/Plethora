#!/usr/bin/env node
/**
 * Verify SiteTimesheet and PayrollExportBatch period bounds match company 26–25 (or configured) cycle.
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

    const badExportSpan = await prisma.$queryRaw`
      SELECT pb.id, pb."periodStart", pb."periodEnd",
        (pb."periodEnd"::date - pb."periodStart"::date + 1)::int AS span_days
      FROM "PayrollExportBatch" pb
      WHERE pb."companyId" = ${company.id}
        AND pb.status != 'VOIDED'
        AND (pb."periodEnd"::date - pb."periodStart"::date + 1)::int NOT BETWEEN ${span - 2} AND ${span + 2}
      LIMIT 100
    `;

    if (badExportSpan.length > 0) {
      findings.push(
        finding({
          id: `payroll-export-span-mismatch-${company.id}`,
          category: "roster-periods",
          severity: SEVERITY.MEDIUM,
          message: `PayrollExportBatch period span does not match expected ${span}-day pay cycle for "${company.name}"`,
          count: badExportSpan.length,
          sample: badExportSpan.slice(0, 3),
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
