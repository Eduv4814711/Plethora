import { prisma } from "../../lib/prisma.js";
import { evaluateCashFloor } from "./cash-floor.service.js";
import type { StatutoryScheme } from "@prisma/client";

export async function getComplianceSummary(companyId: string) {
  // 1. Obligations breakdown
  const obligations = await prisma.complianceObligation.findMany({
    where: { companyId },
    select: {
      id: true,
      type: true,
      title: true,
      status: true,
      riskLevel: true,
      dueDate: true,
      expiryDate: true,
    },
  });

  const obligationCounts = {
    total: obligations.length,
    compliant: obligations.filter((o) => o.status === "COMPLIANT").length,
    attentionRequired: obligations.filter((o) => o.status === "ATTENTION_REQUIRED").length,
    nonCompliant: obligations.filter((o) => o.status === "NON_COMPLIANT").length,
    pendingVerification: obligations.filter((o) => o.status === "PENDING_VERIFICATION").length,
    notApplicable: obligations.filter((o) => o.status === "NOT_APPLICABLE").length,
  };

  // 2. Statutory Schemes snapshot
  const schemes: StatutoryScheme[] = ["PAYE", "UIF", "SDL", "PSSPF", "NBCPSS", "COIDA"];
  const statutoryPeriods = await prisma.statutoryPeriod.findMany({
    where: { companyId },
    orderBy: { periodEnd: "desc" },
    take: 30,
  });

  const schemeStatuses = schemes.map((scheme) => {
    const latest = statutoryPeriods.find((p) => p.scheme === scheme);
    return {
      scheme,
      latestPeriodEnd: latest?.periodEnd ?? null,
      status: latest?.status ?? "NO_RECORDS",
      expectedTotal: latest ? Number(latest.expectedTotal) : 0,
      successfulPaidTotal: latest ? Number(latest.successfulPaidTotal) : 0,
      outstandingAmount: latest ? Number(latest.outstandingAmount) : 0,
      dueDate: latest?.dueDate ?? null,
    };
  });

  const totalOutstandingStatutory = statutoryPeriods
    .filter((p) => ["CALCULATED", "DECLARED", "PARTIALLY_PAID", "OVERDUE", "FAILED"].includes(p.status))
    .reduce((sum, p) => sum + Number(p.outstandingAmount), 0);

  // 3. Cash Floor evaluation
  const cashFloor = await evaluateCashFloor(companyId);

  // 4. Remediation Plans
  const remediationPlans = await prisma.complianceRemediationPlan.findMany({
    where: { companyId },
    select: { id: true, status: true, currentBalance: true, installmentAmount: true },
  });

  const activeRemediations = remediationPlans.filter((r) => r.status === "ACTIVE");
  const totalRemediationDebt = activeRemediations.reduce((sum, r) => sum + Number(r.currentBalance), 0);

  // 5. Legal Cases
  const legalCases = await prisma.complianceLegalCase.findMany({
    where: { companyId },
    select: { id: true, status: true, riskLevel: true },
  });

  const openLegalCases = legalCases.filter((c) => !["CLOSED", "WITHDRAWN", "SETTLED"].includes(c.status));
  const highRiskLegalCases = openLegalCases.filter((c) => ["HIGH", "CRITICAL"].includes(c.riskLevel));

  // 6. Calculate Weighted Compliance Score (0 to 100)
  // Obligations (40 pts)
  const applicableObligations = obligationCounts.total - obligationCounts.notApplicable;
  const obligationScore = applicableObligations > 0
    ? (obligationCounts.compliant / applicableObligations) * 40
    : 40;

  // Statutory timeliness (30 pts)
  const nonOverdueStatutory = statutoryPeriods.filter((p) => p.status !== "OVERDUE" && p.status !== "FAILED").length;
  const statutoryScore = statutoryPeriods.length > 0
    ? (nonOverdueStatutory / statutoryPeriods.length) * 30
    : 30;

  // Cash floor health (20 pts)
  let cashFloorScore = 20;
  if (cashFloor.status === "CRITICAL_BREACH") cashFloorScore = 0;
  else if (cashFloor.status === "TIGHT") cashFloorScore = 10;

  // Legal & Remediation (10 pts)
  let riskScore = 10;
  if (highRiskLegalCases.length > 0) riskScore -= Math.min(5, highRiskLegalCases.length * 2);
  const defaultedPlans = remediationPlans.filter((r) => r.status === "DEFAULTED").length;
  if (defaultedPlans > 0) riskScore -= Math.min(5, defaultedPlans * 2.5);
  riskScore = Math.max(0, riskScore);

  const overallHealthScore = Math.round(obligationScore + statutoryScore + cashFloorScore + riskScore);

  return {
    overallHealthScore,
    obligations: obligationCounts,
    statutorySchemes: schemeStatuses,
    totalOutstandingStatutory: Number(totalOutstandingStatutory.toFixed(2)),
    cashFloor,
    remediations: {
      activeCount: activeRemediations.length,
      totalDebt: Number(totalRemediationDebt.toFixed(2)),
    },
    legalCases: {
      openCount: openLegalCases.length,
      highRiskCount: highRiskLegalCases.length,
    },
  };
}
