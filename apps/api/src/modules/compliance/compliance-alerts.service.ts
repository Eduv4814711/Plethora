import { prisma } from "../../lib/prisma.js";
import { upsertAlert } from "../alerts/alerts.service.js";

export async function syncComplianceAlerts(companyId: string) {
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let createdCount = 0;
  let scannedCount = 0;

  // 1. Scan obligations expiring or expired
  const obligations = await prisma.complianceObligation.findMany({
    where: {
      companyId,
      status: { notIn: ["COMPLIANT", "NOT_APPLICABLE"] },
    },
  });

  scannedCount += obligations.length;

  for (const ob of obligations) {
    if (ob.expiryDate) {
      if (ob.expiryDate < now) {
        const res = await upsertAlert({
          companyId,
          title: `Compliance Obligation Expired: ${ob.title}`,
          message: `${ob.title} (${ob.type}) expired on ${ob.expiryDate.toISOString().slice(0, 10)}. Immediate action required to avoid operational suspension.`,
          priority: "CRITICAL",
          sourceModule: "COMPLIANCE",
          dedupeKey: `compliance:expired:${ob.id}`,
          sourceId: ob.id,
          assignedToId: ob.ownerUserId,
          metadata: { obligationId: ob.id, type: ob.type, expiryDate: ob.expiryDate },
        });
        if (res.created) createdCount++;
      } else if (ob.expiryDate <= thirtyDaysOut) {
        const daysRemaining = Math.ceil(
          (ob.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
        );
        const res = await upsertAlert({
          companyId,
          title: `Compliance Obligation Expiring: ${ob.title}`,
          message: `${ob.title} will expire in ${daysRemaining} day(s) on ${ob.expiryDate.toISOString().slice(0, 10)}. Renewal documentation is required.`,
          priority: "MEDIUM",
          sourceModule: "COMPLIANCE",
          dedupeKey: `compliance:expiring:${ob.id}`,
          sourceId: ob.id,
          assignedToId: ob.ownerUserId,
          metadata: { obligationId: ob.id, type: ob.type, expiryDate: ob.expiryDate, daysRemaining },
        });
        if (res.created) createdCount++;
      }
    }
  }

  // 2. Scan overdue remediation plan installments
  const overdueRemediations = await prisma.complianceRemediationPlan.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      nextPaymentDate: { lt: now },
    },
  });

  scannedCount += overdueRemediations.length;

  for (const rem of overdueRemediations) {
    const res = await upsertAlert({
      companyId,
      title: `Overdue Remediation Installment: ${rem.title}`,
      message: `Remediation / settlement installment of R${Number(rem.installmentAmount).toLocaleString()} was due on ${rem.nextPaymentDate?.toISOString().slice(0, 10)}.`,
      priority: "MEDIUM",
      sourceModule: "COMPLIANCE",
      dedupeKey: `compliance:remediation-overdue:${rem.id}`,
      sourceId: rem.id,
      assignedToId: rem.ownerUserId,
      metadata: { planId: rem.id, installment: rem.installmentAmount },
    });
    if (res.created) createdCount++;
  }

  return { createdCount, scannedCount };
}
