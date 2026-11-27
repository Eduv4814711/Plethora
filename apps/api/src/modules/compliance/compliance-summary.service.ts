import { prisma } from "../../lib/prisma.js";

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

  const now = new Date();
  const isExpiredObligation = (o: { status: string; expiryDate: Date | null }) =>
    o.status !== "NOT_APPLICABLE" && o.expiryDate !== null && o.expiryDate < now;

  const obligationCounts = {
    total: obligations.length,
    compliant: obligations.filter((o) => o.status === "COMPLIANT" && !isExpiredObligation(o)).length,
    attentionRequired: obligations.filter(
      (o) => o.status === "ATTENTION_REQUIRED" && !isExpiredObligation(o)
    ).length,
    nonCompliant: obligations.filter(
      (o) => o.status === "NON_COMPLIANT" || isExpiredObligation(o)
    ).length,
    pendingVerification: obligations.filter(
      (o) => o.status === "PENDING_VERIFICATION" && !isExpiredObligation(o)
    ).length,
    notApplicable: obligations.filter((o) => o.status === "NOT_APPLICABLE").length,
  };

  // 2. Remediation Plans
  const remediationPlans = await prisma.complianceRemediationPlan.findMany({
    where: { companyId },
    select: { id: true, status: true, currentBalance: true, installmentAmount: true },
  });

  const activeRemediations = remediationPlans.filter((r) => r.status === "ACTIVE");
  const totalRemediationDebt = activeRemediations.reduce((sum, r) => sum + Number(r.currentBalance), 0);

  // 3. Legal Cases
  const legalCases = await prisma.complianceLegalCase.findMany({
    where: { companyId },
    select: { id: true, status: true, riskLevel: true },
  });

  const openLegalCases = legalCases.filter((c) => !["CLOSED", "WITHDRAWN", "SETTLED"].includes(c.status));
  const highRiskLegalCases = openLegalCases.filter((c) => ["HIGH", "CRITICAL"].includes(c.riskLevel));

  // 4. Calculate Operational Compliance Health Score (0 to 100)
  // Company Obligations: 60 pts; Legal & Remediation Risk: 40 pts
  const applicableObligations = obligationCounts.total - obligationCounts.notApplicable;
  const obligationScore =
    applicableObligations > 0 ? (obligationCounts.compliant / applicableObligations) * 60 : 60;

  let riskScore = 40;
  if (highRiskLegalCases.length > 0) riskScore -= Math.min(20, highRiskLegalCases.length * 8);
  const defaultedPlans = remediationPlans.filter((r) => r.status === "DEFAULTED").length;
  if (defaultedPlans > 0) riskScore -= Math.min(20, defaultedPlans * 10);
  riskScore = Math.max(0, riskScore);

  const overallHealthScore = Math.round(obligationScore + riskScore);

  return {
    overallHealthScore,
    obligations: obligationCounts,
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
