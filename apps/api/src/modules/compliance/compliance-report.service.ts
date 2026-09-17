import { prisma } from "../../lib/prisma.js";
import { getComplianceSummary } from "./compliance-summary.service.js";

export async function generateTenderCompliancePack(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true },
  });

  const [summary, obligations] = await Promise.all([
    getComplianceSummary(companyId),
    prisma.complianceObligation.findMany({
      where: { companyId },
      include: {
        verifiedBy: { select: { name: true } },
      },
      orderBy: { type: "asc" },
    }),
  ]);

  const keyTenderChecklist = [
    { type: "PSIRA_COMPANY", title: "PSiRA Company Registration" },
    { type: "SARS_TAX_CLEARANCE", title: "SARS Tax Clearance Certificate" },
    { type: "COIDA", title: "COIDA Letter of Good Standing" },
    { type: "NBCPSS", title: "NBCPSS Compliance Levy & Good Standing" },
    { type: "PSSPF", title: "PSSPF Clearance / Contribution Compliance" },
    { type: "UIF", title: "UIF Compliance / Declaration" },
    { type: "PUBLIC_LIABILITY", title: "Public Liability & Broad-Form Insurance" },
  ];

  const tenderItems = keyTenderChecklist.map((item) => {
    const ob = obligations.find((o) => o.type === item.type);
    return {
      type: item.type,
      requiredTitle: item.title,
      currentStatus: ob?.status ?? "NOT_CAPTURED",
      referenceNumber: ob?.referenceNumber ?? null,
      expiryDate: ob?.expiryDate ?? null,
      isCompliant: ob?.status === "COMPLIANT",
      lastVerifiedAt: ob?.lastVerifiedAt ?? null,
    };
  });

  const totalMandatory = tenderItems.length;
  const compliantCount = tenderItems.filter((i) => i.isCompliant).length;
  const tenderReadinessPercentage = Math.round((compliantCount / totalMandatory) * 100);

  return {
    generatedAt: new Date(),
    company,
    overallHealthScore: summary.overallHealthScore,
    tenderReadinessPercentage,
    checklist: tenderItems,
  };
}

export async function generateExecutiveRiskReport(companyId: string) {
  const summary = await getComplianceSummary(companyId);

  const [highRiskObligations, criticalLegalCases, overdueStatutory] = await Promise.all([
    prisma.complianceObligation.findMany({
      where: {
        companyId,
        riskLevel: { in: ["HIGH", "CRITICAL"] },
        status: { not: "COMPLIANT" },
      },
    }),
    prisma.complianceLegalCase.findMany({
      where: {
        companyId,
        riskLevel: { in: ["HIGH", "CRITICAL"] },
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    }),
    prisma.statutoryPeriod.findMany({
      where: {
        companyId,
        status: { in: ["OVERDUE", "FAILED", "PARTIALLY_PAID"] },
        outstandingAmount: { gt: 0 },
      },
    }),
  ]);

  return {
    generatedAt: new Date(),
    summary,
    criticalRisks: {
      obligations: highRiskObligations,
      legalCases: criticalLegalCases,
      statutoryOverdue: overdueStatutory,
    },
  };
}
