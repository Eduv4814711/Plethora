#!/usr/bin/env node
/**
 * Reconcile dashboard-style counts against raw database queries.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runDashboardReconciliationAudit(prisma) {
  const findings = [];

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const guardsOnDutyDb = await prisma.shift.count({
      where: {
        companyId: company.id,
        status: { in: ["active", "assigned"] },
        startTime: { lte: now },
        endTime: { gte: now },
      },
    });

    const calculatedPayrollDb = await prisma.payrollRun.count({
      where: { companyId: company.id, status: "calculated" },
    });

    const openAlertsDb = await prisma.operationalAlert.count({
      where: {
        companyId: company.id,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
    });

    const criticalAlertsDb = await prisma.operationalAlert.count({
      where: {
        companyId: company.id,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        priority: "CRITICAL",
      },
    });

    const missedShiftsDb = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS cnt
      FROM "Shift" s
      WHERE s."companyId" = ${company.id}
        AND s.status IN ('assigned', 'created')
        AND s."endTime" < NOW()
        AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."shiftId" = s.id AND a."clockIn" IS NOT NULL)
        AND s."startTime" >= ${monthStart}
        AND s."startTime" <= ${monthEnd}
    `;
    const missedCount = missedShiftsDb[0]?.cnt ?? 0;

    // Informational snapshots — stored for report; flag only anomalies
    if (openAlertsDb > 0 && criticalAlertsDb === openAlertsDb && openAlertsDb > 50) {
      findings.push(
        finding({
          id: `all-alerts-critical-${company.id}`,
          category: "dashboard-reconciliation",
          severity: SEVERITY.LOW,
          message: `"${company.name}": all ${openAlertsDb} open alerts are CRITICAL — verify dedupe/alert generation`,
          count: openAlertsDb,
        })
      );
    }

    if (calculatedPayrollDb > 5) {
      findings.push(
        finding({
          id: `many-pending-payroll-approvals-${company.id}`,
          category: "dashboard-reconciliation",
          severity: SEVERITY.MEDIUM,
          message: `"${company.name}": ${calculatedPayrollDb} payroll runs awaiting approval (dashboard pending_approvals)`,
          count: calculatedPayrollDb,
        })
      );
    }

    // Store reconciliation baseline in finding sample for report generation
    findings.push(
      finding({
        id: `reconciliation-snapshot-${company.id}`,
        category: "dashboard-reconciliation",
        severity: SEVERITY.LOW,
        message: `"${company.name}" dashboard baseline snapshot`,
        sample: [
          {
            guardsOnDuty: guardsOnDutyDb,
            pendingPayrollApprovals: calculatedPayrollDb,
            openAlerts: openAlertsDb,
            criticalAlerts: criticalAlertsDb,
            missedShiftsThisMonth: missedCount,
          },
        ],
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runDashboardReconciliationAudit(prisma);
    console.log("Dashboard reconciliation audit");
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
