import { prisma } from "../lib/prisma.js";

export async function getAcademyComplianceGate(companyId: string): Promise<{ ok: boolean; blockers: string[] }> {
  const profile = await prisma.academyProfile.findUnique({ where: { companyId } });
  const blockers: string[] = [];
  if (!profile) blockers.push("Academy profile is not configured");
  if (!profile?.trainingCentreName?.trim()) blockers.push("Training centre name missing");
  if (!profile?.psiraTrainingProviderNumber?.trim()) blockers.push("PSIRA training provider number missing");
  if (!profile?.psiraBusinessRegistrationNumber?.trim()) blockers.push("PSIRA business registration number missing");
  if (profile?.accreditationStatus !== "active") blockers.push("Accreditation status must be active");
  if (!profile?.reAccreditationDueDate) blockers.push("Re-accreditation due date missing");
  return { ok: blockers.length === 0, blockers };
}

export async function ensureLearnerDocumentGate(
  companyId: string,
  studentId: string,
  requiresDocuments: boolean = true
): Promise<{ ok: boolean; reason?: string }> {
  if (!requiresDocuments) {
    return { ok: true };
  }
  const count = await prisma.studentDocument.count({ where: { companyId, studentId, deletedAt: null } });
  if (count <= 0) return { ok: false, reason: "Learner has no verified documents uploaded" };
  return { ok: true };
}
