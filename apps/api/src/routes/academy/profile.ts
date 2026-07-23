import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";
import { hasCapability } from "../../lib/capabilities.js";

const profileSchema = z
  .object({
    trainingCentreName: z.string().min(1).max(200),
    tradingName: z.string().optional().nullable(),
    psiraTrainingProviderNumber: z.string().optional().nullable(),
    psiraBusinessRegistrationNumber: z.string().optional().nullable(),
    accreditationStatus: z.enum(["active", "pending", "suspended", "expired"]).optional(),
    accreditationIssueDate: z.string().optional().nullable(),
    reAccreditationDueDate: z.string().optional().nullable(),
    province: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    physicalAddress: z.string().optional().nullable(),
    postalAddress: z.string().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    phoneNumber: z.string().optional().nullable(),
    landline: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    verificationReference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.accreditationStatus === "active") {
      if (!d.psiraTrainingProviderNumber?.trim()) {
        ctx.addIssue({ code: "custom", path: ["psiraTrainingProviderNumber"], message: "PSIRA training provider number is required when accreditation is active" });
      }
      if (!d.psiraBusinessRegistrationNumber?.trim()) {
        ctx.addIssue({ code: "custom", path: ["psiraBusinessRegistrationNumber"], message: "PSIRA business registration number is required when accreditation is active" });
      }
      if (!d.reAccreditationDueDate) {
        ctx.addIssue({ code: "custom", path: ["reAccreditationDueDate"], message: "Re-accreditation due date is required when accreditation is active" });
      }
    }
  });

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function profileReadiness(profile: {
  psiraTrainingProviderNumber?: string | null;
  psiraBusinessRegistrationNumber?: string | null;
  accreditationStatus: string;
  reAccreditationDueDate?: Date | null;
  trainingCentreName?: string | null;
  contactPerson?: string | null;
  email?: string | null;
}) {
  const blockers: string[] = [];
  if (!profile.trainingCentreName?.trim()) blockers.push("Training centre name missing");
  if (!profile.psiraTrainingProviderNumber?.trim()) blockers.push("PSIRA training provider number missing");
  if (!profile.psiraBusinessRegistrationNumber?.trim()) blockers.push("PSIRA business registration number missing");
  if (profile.accreditationStatus !== "active") blockers.push("Accreditation status is not active");
  if (!profile.reAccreditationDueDate) blockers.push("Re-accreditation due date missing");
  if (!profile.contactPerson?.trim()) blockers.push("Contact person missing");
  if (!profile.email?.trim()) blockers.push("Contact email missing");
  return { compliant: blockers.length === 0, blockers };
}

export async function academyProfileRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const profile = await prisma.academyProfile.findUnique({ where: { companyId } });
    return {
      profile,
      readiness: profile
        ? profileReadiness({
            psiraTrainingProviderNumber: profile.psiraTrainingProviderNumber,
            psiraBusinessRegistrationNumber: profile.psiraBusinessRegistrationNumber,
            accreditationStatus: profile.accreditationStatus,
            reAccreditationDueDate: profile.reAccreditationDueDate,
            trainingCentreName: profile.trainingCentreName,
            contactPerson: profile.contactPerson,
            email: profile.email,
          })
        : { compliant: false, blockers: ["Academy profile not configured"] },
    };
  });

  app.patch("/", { preHandler: academyProtect }, async (request, reply) => {
    if (!hasCapability(request.user!, "/academy", "edit")) {
      return reply.code(403).send({ error: "Forbidden", message: "Academy edit access is required" });
    }
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });

    const d = parsed.data;
    const profile = await prisma.academyProfile.upsert({
      where: { companyId },
      update: {
        ...d,
        accreditationIssueDate: parseDate(d.accreditationIssueDate ?? null),
        reAccreditationDueDate: parseDate(d.reAccreditationDueDate ?? null),
      },
      create: {
        companyId,
        trainingCentreName: d.trainingCentreName,
        tradingName: d.tradingName,
        psiraTrainingProviderNumber: d.psiraTrainingProviderNumber,
        psiraBusinessRegistrationNumber: d.psiraBusinessRegistrationNumber,
        accreditationStatus: d.accreditationStatus ?? "pending",
        accreditationIssueDate: parseDate(d.accreditationIssueDate ?? null),
        reAccreditationDueDate: parseDate(d.reAccreditationDueDate ?? null),
        province: d.province,
        city: d.city,
        physicalAddress: d.physicalAddress,
        postalAddress: d.postalAddress,
        contactPerson: d.contactPerson,
        phoneNumber: d.phoneNumber,
        landline: d.landline,
        email: d.email,
        verificationReference: d.verificationReference,
        notes: d.notes,
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.profile.update",
      entityType: "AcademyProfile",
      entityId: profile.id,
      metadata: { accreditationStatus: profile.accreditationStatus },
    });

    return {
      profile,
      readiness: profileReadiness({
        psiraTrainingProviderNumber: profile.psiraTrainingProviderNumber,
        psiraBusinessRegistrationNumber: profile.psiraBusinessRegistrationNumber,
        accreditationStatus: profile.accreditationStatus,
        reAccreditationDueDate: profile.reAccreditationDueDate,
        trainingCentreName: profile.trainingCentreName,
        contactPerson: profile.contactPerson,
        email: profile.email,
      }),
    };
  });
}
