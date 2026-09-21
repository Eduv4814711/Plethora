import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { Prisma } from "@prisma/client";
import type {
  createClientSchema,
  updateClientSchema,
  createContactSchema,
  updateContactSchema,
  createRelatedPartySchema,
  updateRelatedPartySchema,
  createContractSchema,
  updateContractSchema,
  updateDataProcessingProfileSchema,
} from "./clients.schemas.js";
import type { z } from "zod";

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type CreateRelatedPartyInput = z.infer<typeof createRelatedPartySchema>;
export type UpdateRelatedPartyInput = z.infer<typeof updateRelatedPartySchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type UpdateDataProcessingInput = z.infer<typeof updateDataProcessingProfileSchema>;

// ——— Clients ———

export async function listClientsService(
  companyId: string,
  query?: {
    search?: string;
    entityType?: string;
    onboardingStatus?: string;
    isActive?: boolean;
  }
) {
  const where: Prisma.ClientWhereInput = {
    companyId,
    ...(query?.entityType ? { entityType: query.entityType as never } : {}),
    ...(query?.onboardingStatus ? { onboardingStatus: query.onboardingStatus as never } : {}),
    ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query?.search?.trim()
      ? {
          OR: [
            { name: { contains: query.search.trim(), mode: "insensitive" } },
            { legalName: { contains: query.search.trim(), mode: "insensitive" } },
            { tradingName: { contains: query.search.trim(), mode: "insensitive" } },
            { registrationNumber: { contains: query.search.trim(), mode: "insensitive" } },
            { vatNumber: { contains: query.search.trim(), mode: "insensitive" } },
            { email: { contains: query.search.trim(), mode: "insensitive" } },
            { contactPersonName: { contains: query.search.trim(), mode: "insensitive" } },
            {
              contacts: {
                some: {
                  OR: [
                    { firstName: { contains: query.search.trim(), mode: "insensitive" } },
                    { lastName: { contains: query.search.trim(), mode: "insensitive" } },
                    { email: { contains: query.search.trim(), mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const clients = await prisma.client.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      contacts: {
        where: { isActive: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 3,
      },
      contracts: {
        where: { status: "ACTIVE" },
        select: { id: true, contractNumber: true, title: true, status: true, effectiveTo: true },
      },
      _count: {
        select: {
          sites: true,
          contracts: true,
          contacts: true,
          managedDocuments: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return clients;
}

export async function getClientByIdService(companyId: string, id: string) {
  const client = await prisma.client.findFirst({
    where: { id, companyId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      sites: {
        select: {
          id: true,
          name: true,
          siteStatus: true,
          physicalAddress: true,
          serviceType: true,
          contractStartDate: true,
          contractEndDate: true,
          contactPersonName: true,
        },
        orderBy: { name: "asc" },
      },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
      },
      relatedParties: {
        orderBy: { createdAt: "asc" },
      },
      contracts: {
        include: {
          sites: {
            include: {
              site: { select: { id: true, name: true, siteStatus: true } },
            },
          },
          documents: {
            select: { id: true, title: true, fileName: true, verificationStatus: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      dataProcessingProfile: true,
      _count: {
        select: {
          sites: true,
          quotes: true,
          invoices: true,
          managedDocuments: true,
        },
      },
    },
  });

  return client;
}

export async function createClientService(
  companyId: string,
  userId: string,
  data: CreateClientInput
) {
  const client = await prisma.client.create({
    data: {
      companyId,
      name: data.name.trim(),
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      userId: data.userId || null,
      isActive: data.isActive ?? true,
      legalName: data.legalName?.trim() || null,
      tradingName: data.tradingName?.trim() || null,
      entityType: data.entityType || null,
      taxNumber: data.taxNumber?.trim() || null,
      registeredAddress: data.registeredAddress?.trim() || null,
      onboardingStatus: data.onboardingStatus || "DRAFT",
      onboardingCompletedAt: data.onboardingCompletedAt ? new Date(data.onboardingCompletedAt) : null,
      billingEmail: data.billingEmail?.trim() || null,
      billingAddress: data.billingAddress?.trim() || null,
      vatNumber: data.vatNumber?.trim() || null,
      registrationNumber: data.registrationNumber?.trim() || null,
      paymentTermsDays: data.paymentTermsDays ?? 30,
      contactPersonName: data.contactPersonName?.trim() || null,
      contactPersonRole: data.contactPersonRole?.trim() || null,
      contactPersonMobile: data.contactPersonMobile?.trim() || null,
      physicalAddress: data.physicalAddress?.trim() || null,
      notes: data.notes?.trim() || null,
      reportRecipients: data.reportRecipients || [],
    },
  });

  // If primary contact fields were passed, automatically create a primary ClientContact record
  if (data.contactPersonName?.trim()) {
    const parts = data.contactPersonName.trim().split(/\s+/);
    const firstName = parts[0] || "Primary";
    const lastName = parts.slice(1).join(" ") || null;
    await prisma.clientContact.create({
      data: {
        companyId,
        clientId: client.id,
        firstName,
        lastName,
        jobTitle: data.contactPersonRole?.trim() || null,
        mobile: data.contactPersonMobile?.trim() || null,
        email: data.email?.trim() || null,
        contactType: "PRIMARY",
        isPrimary: true,
        isActive: true,
      },
    });
  }

  await createAuditLog({
    userId,
    companyId,
    action: "client.create",
    entityType: "Client",
    entityId: client.id,
    metadata: { name: client.name, entityType: client.entityType },
  });

  return client;
}

export async function updateClientService(
  companyId: string,
  clientId: string,
  userId: string,
  data: UpdateClientInput
) {
  const existing = await prisma.client.findFirst({
    where: { id: clientId, companyId },
  });
  if (!existing) return null;

  const updateData: Prisma.ClientUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.email !== undefined) updateData.email = data.email?.trim() || null;
  if (data.phone !== undefined) updateData.phone = data.phone?.trim() || null;
  if (data.userId !== undefined) updateData.user = data.userId ? { connect: { id: data.userId } } : { disconnect: true };
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.legalName !== undefined) updateData.legalName = data.legalName?.trim() || null;
  if (data.tradingName !== undefined) updateData.tradingName = data.tradingName?.trim() || null;
  if (data.entityType !== undefined) updateData.entityType = data.entityType || null;
  if (data.taxNumber !== undefined) updateData.taxNumber = data.taxNumber?.trim() || null;
  if (data.registeredAddress !== undefined) updateData.registeredAddress = data.registeredAddress?.trim() || null;
  if (data.onboardingStatus !== undefined) updateData.onboardingStatus = data.onboardingStatus;
  if (data.onboardingCompletedAt !== undefined) {
    updateData.onboardingCompletedAt = data.onboardingCompletedAt ? new Date(data.onboardingCompletedAt) : null;
  }
  if (data.billingEmail !== undefined) updateData.billingEmail = data.billingEmail?.trim() || null;
  if (data.billingAddress !== undefined) updateData.billingAddress = data.billingAddress?.trim() || null;
  if (data.vatNumber !== undefined) updateData.vatNumber = data.vatNumber?.trim() || null;
  if (data.registrationNumber !== undefined) updateData.registrationNumber = data.registrationNumber?.trim() || null;
  if (data.paymentTermsDays !== undefined) updateData.paymentTermsDays = data.paymentTermsDays;
  if (data.contactPersonName !== undefined) updateData.contactPersonName = data.contactPersonName?.trim() || null;
  if (data.contactPersonRole !== undefined) updateData.contactPersonRole = data.contactPersonRole?.trim() || null;
  if (data.contactPersonMobile !== undefined) updateData.contactPersonMobile = data.contactPersonMobile?.trim() || null;
  if (data.physicalAddress !== undefined) updateData.physicalAddress = data.physicalAddress?.trim() || null;
  if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null;
  if (data.reportRecipients !== undefined) updateData.reportRecipients = data.reportRecipients;

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: updateData,
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.update",
    entityType: "Client",
    entityId: clientId,
  });

  return updated;
}

// ——— Contacts ———

export async function listClientContactsService(companyId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: {
      id: true,
      contactPersonName: true,
      contactPersonRole: true,
      contactPersonMobile: true,
      email: true,
    },
  });
  if (!client) return null;

  const contacts = await prisma.clientContact.findMany({
    where: { clientId, companyId },
    orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
  });

  // Backwards compatibility fallback: if no ClientContact records exist yet,
  // synthesize a fallback representation from legacy fields so UI and consumers remain seamless.
  if (contacts.length === 0 && client.contactPersonName?.trim()) {
    const parts = client.contactPersonName.trim().split(/\s+/);
    const fallbackContact = {
      id: `legacy-${client.id}`,
      companyId,
      clientId: client.id,
      firstName: parts[0] || client.contactPersonName,
      lastName: parts.slice(1).join(" ") || null,
      jobTitle: client.contactPersonRole || "Primary Contact",
      department: null,
      email: client.email || null,
      mobile: client.contactPersonMobile || null,
      contactType: "PRIMARY" as const,
      isPrimary: true,
      isActive: true,
      notes: "Auto-generated from legacy contact fields",
      createdAt: new Date(),
      updatedAt: new Date(),
      isLegacyFallback: true,
    };
    return [fallbackContact];
  }

  return contacts;
}

export async function createClientContactService(
  companyId: string,
  clientId: string,
  userId: string,
  data: CreateContactInput
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  const count = await prisma.clientContact.count({ where: { clientId, companyId } });
  const isPrimary = data.isPrimary !== undefined ? Boolean(data.isPrimary) : count === 0;

  if (isPrimary) {
    // Unset primary from existing contacts
    await prisma.clientContact.updateMany({
      where: { clientId, companyId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const contact = await prisma.clientContact.create({
    data: {
      companyId,
      clientId,
      firstName: data.firstName.trim(),
      lastName: data.lastName?.trim() || null,
      jobTitle: data.jobTitle?.trim() || null,
      department: data.department?.trim() || null,
      email: data.email?.trim() || null,
      mobile: data.mobile?.trim() || null,
      contactType: data.contactType || "OTHER",
      isPrimary,
      isActive: data.isActive ?? true,
      notes: data.notes?.trim() || null,
    },
  });

  // If primary, sync to legacy fields for backward compatibility
  if (isPrimary) {
    const fullName = `${data.firstName} ${data.lastName || ""}`.trim();
    await prisma.client.update({
      where: { id: clientId },
      data: {
        contactPersonName: fullName,
        contactPersonRole: data.jobTitle?.trim() || null,
        contactPersonMobile: data.mobile?.trim() || null,
      },
    });
  }

  await createAuditLog({
    userId,
    companyId,
    action: "client.contact.create",
    entityType: "ClientContact",
    entityId: contact.id,
    metadata: { clientId, name: `${data.firstName} ${data.lastName || ""}`.trim() },
  });

  return contact;
}

export async function updateClientContactService(
  companyId: string,
  clientId: string,
  contactId: string,
  userId: string,
  data: UpdateContactInput
) {
  const existing = await prisma.clientContact.findFirst({
    where: { id: contactId, clientId, companyId },
  });
  if (!existing) return null;

  if (data.isPrimary) {
    await prisma.clientContact.updateMany({
      where: { clientId, companyId, isPrimary: true, id: { not: contactId } },
      data: { isPrimary: false },
    });
  }

  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName?.trim() || null } : {}),
      ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle?.trim() || null } : {}),
      ...(data.department !== undefined ? { department: data.department?.trim() || null } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
      ...(data.mobile !== undefined ? { mobile: data.mobile?.trim() || null } : {}),
      ...(data.contactType !== undefined ? { contactType: data.contactType } : {}),
      ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
  });

  if (updated.isPrimary) {
    const fullName = `${updated.firstName} ${updated.lastName || ""}`.trim();
    await prisma.client.update({
      where: { id: clientId },
      data: {
        contactPersonName: fullName,
        contactPersonRole: updated.jobTitle || null,
        contactPersonMobile: updated.mobile || null,
      },
    });
  }

  await createAuditLog({
    userId,
    companyId,
    action: "client.contact.update",
    entityType: "ClientContact",
    entityId: contactId,
  });

  return updated;
}

export async function deleteClientContactService(
  companyId: string,
  clientId: string,
  contactId: string,
  userId: string
) {
  const existing = await prisma.clientContact.findFirst({
    where: { id: contactId, clientId, companyId },
  });
  if (!existing) return null;

  await prisma.clientContact.delete({ where: { id: contactId } });

  await createAuditLog({
    userId,
    companyId,
    action: "client.contact.delete",
    entityType: "ClientContact",
    entityId: contactId,
    metadata: { clientId },
  });

  return true;
}

// ——— Related Parties ———

export async function listClientRelatedPartiesService(companyId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  return prisma.clientRelatedParty.findMany({
    where: { clientId, companyId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createClientRelatedPartyService(
  companyId: string,
  clientId: string,
  userId: string,
  data: CreateRelatedPartyInput
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  const party = await prisma.clientRelatedParty.create({
    data: {
      companyId,
      clientId,
      fullName: data.fullName.trim(),
      relationshipType: data.relationshipType,
      ownershipPercent: data.ownershipPercent != null ? new Prisma.Decimal(data.ownershipPercent) : null,
      isAuthorisedSignatory: Boolean(data.isAuthorisedSignatory),
      authorityReference: data.authorityReference?.trim() || null,
      notes: data.notes?.trim() || null,
      isActive: data.isActive ?? true,
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.relatedParty.create",
    entityType: "ClientRelatedParty",
    entityId: party.id,
    metadata: { clientId, relationshipType: party.relationshipType },
  });

  return party;
}

export async function updateClientRelatedPartyService(
  companyId: string,
  clientId: string,
  partyId: string,
  userId: string,
  data: UpdateRelatedPartyInput
) {
  const existing = await prisma.clientRelatedParty.findFirst({
    where: { id: partyId, clientId, companyId },
  });
  if (!existing) return null;

  const updated = await prisma.clientRelatedParty.update({
    where: { id: partyId },
    data: {
      ...(data.fullName !== undefined ? { fullName: data.fullName.trim() } : {}),
      ...(data.relationshipType !== undefined ? { relationshipType: data.relationshipType } : {}),
      ...(data.ownershipPercent !== undefined
        ? { ownershipPercent: data.ownershipPercent != null ? new Prisma.Decimal(data.ownershipPercent) : null }
        : {}),
      ...(data.isAuthorisedSignatory !== undefined ? { isAuthorisedSignatory: data.isAuthorisedSignatory } : {}),
      ...(data.authorityReference !== undefined ? { authorityReference: data.authorityReference?.trim() || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.relatedParty.update",
    entityType: "ClientRelatedParty",
    entityId: partyId,
  });

  return updated;
}

export async function deleteClientRelatedPartyService(
  companyId: string,
  clientId: string,
  partyId: string,
  userId: string
) {
  const existing = await prisma.clientRelatedParty.findFirst({
    where: { id: partyId, clientId, companyId },
  });
  if (!existing) return null;

  await prisma.clientRelatedParty.delete({ where: { id: partyId } });

  await createAuditLog({
    userId,
    companyId,
    action: "client.relatedParty.delete",
    entityType: "ClientRelatedParty",
    entityId: partyId,
    metadata: { clientId },
  });

  return true;
}

// ——— Contracts ———

export async function listClientContractsService(companyId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  return prisma.clientContract.findMany({
    where: { clientId, companyId },
    include: {
      sites: {
        include: {
          site: { select: { id: true, name: true, siteStatus: true } },
        },
      },
      documents: {
        select: { id: true, title: true, fileName: true, verificationStatus: true, expiryDate: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getClientContractService(
  companyId: string,
  clientId: string,
  contractId: string
) {
  return prisma.clientContract.findFirst({
    where: { id: contractId, clientId, companyId },
    include: {
      sites: {
        include: {
          site: { select: { id: true, name: true, siteStatus: true, physicalAddress: true } },
        },
      },
      documents: {
        select: { id: true, title: true, fileName: true, verificationStatus: true, expiryDate: true },
      },
    },
  });
}

export async function createClientContractService(
  companyId: string,
  clientId: string,
  userId: string,
  data: CreateContractInput
): Promise<{ ok: true; data: any } | { ok: false; error: string; statusCode: number }> {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return { ok: false, error: "Client not found", statusCode: 404 };

  const existingNumber = await prisma.clientContract.findFirst({
    where: { companyId, contractNumber: data.contractNumber.trim() },
  });
  if (existingNumber) {
    return { ok: false, error: "Contract number already in use", statusCode: 409 };
  }

  // Validate sites if provided
  if (data.siteIds && data.siteIds.length > 0) {
    const validSites = await prisma.site.findMany({
      where: { id: { in: data.siteIds }, companyId, clientId },
      select: { id: true },
    });
    if (validSites.length !== data.siteIds.length) {
      return {
        ok: false,
        error: "One or more sites do not belong to this client and company",
        statusCode: 400,
      };
    }
  }

  const contract = await prisma.clientContract.create({
    data: {
      companyId,
      clientId,
      contractNumber: data.contractNumber.trim(),
      title: data.title.trim(),
      status: data.status || "ACTIVE",
      signedDate: data.signedDate ? new Date(data.signedDate) : null,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      noticePeriodDays: data.noticePeriodDays ?? 30,
      renewalType: data.renewalType || "FIXED_TERM",
      autoRenew: Boolean(data.autoRenew),
      scopeSummary: data.scopeSummary?.trim() || null,
      serviceTypes: data.serviceTypes || [],
      notes: data.notes?.trim() || null,
      ...(data.siteIds?.length
        ? {
            sites: {
              create: data.siteIds.map((siteId) => ({
                companyId,
                siteId,
              })),
            },
          }
        : {}),
    },
    include: {
      sites: {
        include: {
          site: { select: { id: true, name: true } },
        },
      },
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.contract.create",
    entityType: "ClientContract",
    entityId: contract.id,
    metadata: { clientId, contractNumber: contract.contractNumber },
  });

  return { ok: true, data: contract };
}

export async function updateClientContractService(
  companyId: string,
  clientId: string,
  contractId: string,
  userId: string,
  data: UpdateContractInput
): Promise<{ ok: true; data: any } | { ok: false; error: string; statusCode: number }> {
  const existing = await prisma.clientContract.findFirst({
    where: { id: contractId, clientId, companyId },
  });
  if (!existing) return { ok: false, error: "Contract not found", statusCode: 404 };

  if (data.contractNumber && data.contractNumber.trim() !== existing.contractNumber) {
    const dup = await prisma.clientContract.findFirst({
      where: { companyId, contractNumber: data.contractNumber.trim(), id: { not: contractId } },
    });
    if (dup) {
      return { ok: false, error: "Contract number already in use", statusCode: 409 };
    }
  }

  const updated = await prisma.clientContract.update({
    where: { id: contractId },
    data: {
      ...(data.contractNumber !== undefined ? { contractNumber: data.contractNumber.trim() } : {}),
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.signedDate !== undefined ? { signedDate: data.signedDate ? new Date(data.signedDate) : null } : {}),
      ...(data.effectiveFrom !== undefined ? { effectiveFrom: new Date(data.effectiveFrom) } : {}),
      ...(data.effectiveTo !== undefined ? { effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null } : {}),
      ...(data.noticePeriodDays !== undefined ? { noticePeriodDays: data.noticePeriodDays } : {}),
      ...(data.renewalType !== undefined ? { renewalType: data.renewalType } : {}),
      ...(data.autoRenew !== undefined ? { autoRenew: data.autoRenew } : {}),
      ...(data.scopeSummary !== undefined ? { scopeSummary: data.scopeSummary?.trim() || null } : {}),
      ...(data.serviceTypes !== undefined ? { serviceTypes: data.serviceTypes } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.contract.update",
    entityType: "ClientContract",
    entityId: contractId,
  });

  return { ok: true, data: updated };
}

export async function linkContractSitesService(
  companyId: string,
  clientId: string,
  contractId: string,
  userId: string,
  siteIds: string[]
): Promise<{ ok: true; data: any } | { ok: false; error: string; statusCode: number }> {
  const contract = await prisma.clientContract.findFirst({
    where: { id: contractId, clientId, companyId },
  });
  if (!contract) return { ok: false, error: "Contract not found", statusCode: 404 };

  const validSites = await prisma.site.findMany({
    where: { id: { in: siteIds }, companyId, clientId },
    select: { id: true },
  });
  if (validSites.length !== siteIds.length) {
    return {
      ok: false,
      error: "One or more sites do not belong to this client and company",
      statusCode: 400,
    };
  }

  for (const siteId of siteIds) {
    await prisma.clientContractSite.upsert({
      where: { contractId_siteId: { contractId, siteId } },
      update: {},
      create: { companyId, contractId, siteId },
    });
  }

  await createAuditLog({
    userId,
    companyId,
    action: "client.contract.sites.link",
    entityType: "ClientContract",
    entityId: contractId,
    metadata: { siteIds },
  });

  const links = await prisma.clientContractSite.findMany({
    where: { contractId, companyId },
    include: { site: { select: { id: true, name: true, siteStatus: true } } },
  });

  return { ok: true, data: links };
}

export async function unlinkContractSiteService(
  companyId: string,
  clientId: string,
  contractId: string,
  userId: string,
  siteId: string
): Promise<{ ok: true } | { ok: false; error: string; statusCode: number }> {
  const link = await prisma.clientContractSite.findFirst({
    where: { contractId, siteId, companyId },
  });
  if (!link) return { ok: false, error: "Site is not linked to this contract", statusCode: 404 };

  await prisma.clientContractSite.delete({
    where: { id: link.id },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.contract.sites.unlink",
    entityType: "ClientContract",
    entityId: contractId,
    metadata: { siteId },
  });

  return { ok: true };
}

// ——— POPIA / Data Processing Profile ———

export async function getClientDataProcessingProfileService(companyId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  return prisma.clientDataProcessingProfile.findFirst({
    where: { clientId, companyId },
  });
}

export async function upsertClientDataProcessingProfileService(
  companyId: string,
  clientId: string,
  userId: string,
  data: UpdateDataProcessingInput
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
  if (!client) return null;

  const profile = await prisma.clientDataProcessingProfile.upsert({
    where: { clientId },
    update: {
      ...(data.responsiblePartyName !== undefined ? { responsiblePartyName: data.responsiblePartyName?.trim() || null } : {}),
      ...(data.informationOfficerName !== undefined ? { informationOfficerName: data.informationOfficerName?.trim() || null } : {}),
      ...(data.informationOfficerEmail !== undefined ? { informationOfficerEmail: data.informationOfficerEmail?.trim() || null } : {}),
      ...(data.informationOfficerPhone !== undefined ? { informationOfficerPhone: data.informationOfficerPhone?.trim() || null } : {}),
      ...(data.processingPurposes !== undefined ? { processingPurposes: data.processingPurposes } : {}),
      ...(data.dataCategories !== undefined ? { dataCategories: data.dataCategories } : {}),
      ...(data.hasCrossBorderTransfer !== undefined ? { hasCrossBorderTransfer: data.hasCrossBorderTransfer } : {}),
      ...(data.crossBorderDetails !== undefined ? { crossBorderDetails: data.crossBorderDetails?.trim() || null } : {}),
      ...(data.operatorAgreementStatus !== undefined ? { operatorAgreementStatus: data.operatorAgreementStatus } : {}),
      ...(data.operatorAgreementSignedDate !== undefined
        ? { operatorAgreementSignedDate: data.operatorAgreementSignedDate ? new Date(data.operatorAgreementSignedDate) : null }
        : {}),
      ...(data.operatorAgreementDocumentId !== undefined ? { operatorAgreementDocumentId: data.operatorAgreementDocumentId } : {}),
      ...(data.privacyNoticeProvided !== undefined ? { privacyNoticeProvided: data.privacyNoticeProvided } : {}),
      ...(data.privacyNoticeDate !== undefined ? { privacyNoticeDate: data.privacyNoticeDate ? new Date(data.privacyNoticeDate) : null } : {}),
      ...(data.retentionPolicyNotes !== undefined ? { retentionPolicyNotes: data.retentionPolicyNotes?.trim() || null } : {}),
      ...(data.securityMeasuresNotes !== undefined ? { securityMeasuresNotes: data.securityMeasuresNotes?.trim() || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
    create: {
      companyId,
      clientId,
      responsiblePartyName: data.responsiblePartyName?.trim() || null,
      informationOfficerName: data.informationOfficerName?.trim() || null,
      informationOfficerEmail: data.informationOfficerEmail?.trim() || null,
      informationOfficerPhone: data.informationOfficerPhone?.trim() || null,
      processingPurposes: data.processingPurposes || [],
      dataCategories: data.dataCategories || [],
      hasCrossBorderTransfer: Boolean(data.hasCrossBorderTransfer),
      crossBorderDetails: data.crossBorderDetails?.trim() || null,
      operatorAgreementStatus: data.operatorAgreementStatus || "REQUIRED",
      operatorAgreementSignedDate: data.operatorAgreementSignedDate ? new Date(data.operatorAgreementSignedDate) : null,
      operatorAgreementDocumentId: data.operatorAgreementDocumentId || null,
      privacyNoticeProvided: Boolean(data.privacyNoticeProvided),
      privacyNoticeDate: data.privacyNoticeDate ? new Date(data.privacyNoticeDate) : null,
      retentionPolicyNotes: data.retentionPolicyNotes?.trim() || null,
      securityMeasuresNotes: data.securityMeasuresNotes?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "client.dataProcessing.update",
    entityType: "ClientDataProcessingProfile",
    entityId: profile.id,
    metadata: { clientId },
  });

  return profile;
}
