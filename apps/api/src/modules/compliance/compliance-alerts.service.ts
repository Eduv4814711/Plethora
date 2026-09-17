import { prisma } from "../../lib/prisma.js";
import { upsertAlert } from "../alerts/alerts.service.js";
import { evaluateCashFloor } from "./cash-floor.service.js";

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
        // Expired!
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
        // Expiring within 30 days
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

  // 2. Scan overdue statutory periods
  const overduePeriods = await prisma.statutoryPeriod.findMany({
    where: {
      companyId,
      dueDate: { lt: now },
      status: { in: ["CALCULATED", "DECLARED", "PARTIALLY_PAID", "OVERDUE", "FAILED"] },
      outstandingAmount: { gt: 0 },
    },
  });

  scannedCount += overduePeriods.length;

  for (const p of overduePeriods) {
    const res = await upsertAlert({
      companyId,
      title: `Overdue Statutory Filing/Payment: ${p.scheme}`,
      message: `${p.scheme} period ending ${p.periodEnd.toISOString().slice(0, 10)} was due on ${p.dueDate.toISOString().slice(0, 10)}. Outstanding balance: R${Number(p.outstandingAmount).toLocaleString()}.`,
      priority: "CRITICAL",
      sourceModule: "COMPLIANCE",
      dedupeKey: `compliance:statutory-overdue:${p.id}`,
      sourceId: p.id,
      metadata: { periodId: p.id, scheme: p.scheme, outstanding: p.outstandingAmount },
    });
    if (res.created) createdCount++;
  }

  // 3. Scan overdue remediation plan installments
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
      message: `AOD / settlement installment of R${Number(rem.installmentAmount).toLocaleString()} was due on ${rem.nextPaymentDate?.toISOString().slice(0, 10)}.`,
      priority: "MEDIUM",
      sourceModule: "COMPLIANCE",
      dedupeKey: `compliance:remediation-overdue:${rem.id}`,
      sourceId: rem.id,
      assignedToId: rem.ownerUserId,
      metadata: { planId: rem.id, installment: rem.installmentAmount },
    });
    if (res.created) createdCount++;
  }

  // 4. Check protected cash floor
  const floorEval = await evaluateCashFloor(companyId);
  scannedCount++;

  if (floorEval.status === "CRITICAL_BREACH") {
    const res = await upsertAlert({
      companyId,
      title: "Protected Cash Floor Breached",
      message: `Available cash (R${floorEval.availableCash.toLocaleString()}) is below the protected 30-day floor (R${floorEval.protectedCashFloor.toLocaleString()}) by R${Math.abs(floorEval.bufferOrShortfall).toLocaleString()}. Critical risk to upcoming payroll and statutory liabilities.`,
      priority: "CRITICAL",
      sourceModule: "COMPLIANCE",
      dedupeKey: `compliance:cash-floor-breach:${now.toISOString().slice(0, 7)}`,
      metadata: {
        availableCash: floorEval.availableCash,
        floor: floorEval.protectedCashFloor,
        shortfall: floorEval.bufferOrShortfall,
      },
    });
    if (res.created) createdCount++;
  }

  return { createdCount, scannedCount };
}
