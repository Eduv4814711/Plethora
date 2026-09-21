import { prisma } from "../../lib/prisma.js";

export type ComplianceCheckStatus = "COMPLETE" | "ATTENTION" | "MISSING" | "NOT_APPLICABLE";
export type ComplianceRequirementType = "STATUTORY" | "CONTRACTUAL" | "RECOMMENDED" | "OPTIONAL";

export interface ClientComplianceCheck {
  key: string;
  title: string;
  status: ComplianceCheckStatus;
  requirementType: ComplianceRequirementType;
  message: string;
  details?: string | null;
}

export interface ClientComplianceEvaluation {
  clientId: string;
  overallStatus: "COMPLETE" | "ATTENTION" | "MISSING";
  summary: {
    total: number;
    complete: number;
    attention: number;
    missing: number;
  };
  checks: ClientComplianceCheck[];
  evaluatedAt: string;
}

export async function evaluateClientCompliance(
  companyId: string,
  clientId: string
): Promise<ClientComplianceEvaluation | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    include: {
      contacts: { where: { isActive: true } },
      relatedParties: { where: { isActive: true } },
      contracts: {
        where: { status: { in: ["ACTIVE", "PENDING_RENEWAL", "EXPIRED"] } },
        include: { sites: true, documents: true },
      },
      sites: {
        where: { siteStatus: "ACTIVE" },
        select: { id: true, name: true, contractEndDate: true },
      },
      managedDocuments: {
        where: { status: { in: ["ACTIVE", "PENDING_REVIEW", "EXPIRED"] } },
        select: {
          id: true,
          title: true,
          documentType: true,
          category: true,
          documentCategory: true,
          verificationStatus: true,
          status: true,
          expiryDate: true,
        },
      },
      dataProcessingProfile: true,
    },
  });

  if (!client) return null;

  const checks: ClientComplianceCheck[] = [];
  const entityType = client.entityType || "OTHER";
  const now = new Date();

  // 1. Legal Identity & Registration Check
  const hasRegNumber = Boolean(client.registrationNumber?.trim());
  const hasTaxNumber = Boolean(client.taxNumber?.trim());
  const hasLegalName = Boolean(client.legalName?.trim() || client.name?.trim());
  const hasRegisteredAddress = Boolean(client.registeredAddress?.trim() || client.physicalAddress?.trim());

  if (["PRIVATE_COMPANY", "CLOSE_CORPORATION"].includes(entityType)) {
    if (hasRegNumber && hasTaxNumber && hasLegalName && hasRegisteredAddress) {
      checks.push({
        key: "legal_identity",
        title: "Corporate Legal Identity",
        status: "COMPLETE",
        requirementType: "STATUTORY",
        message: "CIPC registration number, tax number and address are on record",
      });
    } else {
      const missingParts: string[] = [];
      if (!hasRegNumber) missingParts.push("registration number");
      if (!hasTaxNumber) missingParts.push("tax number");
      if (!hasRegisteredAddress) missingParts.push("registered address");
      checks.push({
        key: "legal_identity",
        title: "Corporate Legal Identity",
        status: "ATTENTION",
        requirementType: "STATUTORY",
        message: `Missing corporate records: ${missingParts.join(", ")}`,
      });
    }
  } else if (entityType === "TRUST") {
    if (hasRegNumber && hasLegalName) {
      checks.push({
        key: "legal_identity",
        title: "Trust Registration",
        status: "COMPLETE",
        requirementType: "STATUTORY",
        message: "Master's reference / trust registration number recorded",
      });
    } else {
      checks.push({
        key: "legal_identity",
        title: "Trust Registration",
        status: "ATTENTION",
        requirementType: "STATUTORY",
        message: "Missing Master of the High Court trust reference number",
      });
    }
  } else {
    checks.push({
      key: "legal_identity",
      title: "Commercial Identity",
      status: hasLegalName ? "COMPLETE" : "ATTENTION",
      requirementType: "RECOMMENDED",
      message: hasLegalName
        ? "Entity name and contact information established"
        : "Client requires verified trading or legal name",
    });
  }

  // 2. Primary Contact Check
  const hasDedicatedPrimary = client.contacts.some((c) => c.isPrimary && c.isActive);
  const hasLegacyFallback = Boolean(client.contactPersonName?.trim() && (client.email || client.contactPersonMobile));

  if (hasDedicatedPrimary) {
    checks.push({
      key: "primary_contact",
      title: "Primary Operational Contact",
      status: "COMPLETE",
      requirementType: "CONTRACTUAL",
      message: "Dedicated primary contact person is assigned",
    });
  } else if (hasLegacyFallback) {
    checks.push({
      key: "primary_contact",
      title: "Primary Operational Contact",
      status: "COMPLETE",
      requirementType: "CONTRACTUAL",
      message: `Active contact: ${client.contactPersonName} (legacy record)`,
    });
  } else {
    checks.push({
      key: "primary_contact",
      title: "Primary Operational Contact",
      status: "MISSING",
      requirementType: "CONTRACTUAL",
      message: "No primary contact person recorded for operational coordination",
    });
  }

  // 3. Related Parties / Authorised Signatories Check
  const signatories = client.relatedParties.filter((p) => p.isAuthorisedSignatory && p.isActive);
  const directors = client.relatedParties.filter((p) => ["DIRECTOR", "MEMBER", "TRUSTEE", "PARTNER"].includes(p.relationshipType) && p.isActive);

  if (["PRIVATE_COMPANY", "CLOSE_CORPORATION", "TRUST", "PARTNERSHIP"].includes(entityType)) {
    if (signatories.length > 0 || directors.length > 0) {
      checks.push({
        key: "authorised_signatory",
        title: "Authorised Representative",
        status: "COMPLETE",
        requirementType: "STATUTORY",
        message: `${signatories.length || directors.length} authorised representative(s) registered`,
      });
    } else {
      checks.push({
        key: "authorised_signatory",
        title: "Authorised Representative",
        status: "ATTENTION",
        requirementType: "RECOMMENDED",
        message: "No director, trustee, or authorised signatory recorded",
      });
    }
  } else {
    checks.push({
      key: "authorised_signatory",
      title: "Authorised Representative",
      status: signatories.length > 0 ? "COMPLETE" : "NOT_APPLICABLE",
      requirementType: "OPTIONAL",
      message: signatories.length > 0
        ? "Authorised representative registered"
        : "Optional for sole proprietor or informal entities",
    });
  }

  // 4. Contract Coverage Check
  const activeContracts = client.contracts.filter((c) => c.status === "ACTIVE");
  const expiringContracts = activeContracts.filter((c) => {
    if (!c.effectiveTo) return false;
    const diffDays = Math.ceil((c.effectiveTo.getTime() - now.getTime()) / (24 * 3600_000));
    return diffDays > 0 && diffDays <= 60;
  });
  const expiredContracts = client.contracts.filter((c) => {
    if (c.status === "EXPIRED") return true;
    if (!c.effectiveTo) return false;
    return c.effectiveTo.getTime() < now.getTime();
  });

  if (activeContracts.length > 0) {
    if (expiringContracts.length > 0) {
      checks.push({
        key: "service_contract",
        title: "Governing Security Contract",
        status: "ATTENTION",
        requirementType: "CONTRACTUAL",
        message: `Contract ${expiringContracts[0]?.contractNumber} expires within 60 days`,
      });
    } else {
      checks.push({
        key: "service_contract",
        title: "Governing Security Contract",
        status: "COMPLETE",
        requirementType: "CONTRACTUAL",
        message: `${activeContracts.length} active service agreement(s) in place`,
      });
    }
  } else if (expiredContracts.length > 0) {
    checks.push({
      key: "service_contract",
      title: "Governing Security Contract",
      status: "MISSING",
      requirementType: "CONTRACTUAL",
      message: "Service contract has expired and requires renewal",
    });
  } else {
    // Check fallback site-level contracts
    const sitesWithLegacyContract = client.sites.filter((s) => s.contractEndDate && s.contractEndDate > now);
    if (sitesWithLegacyContract.length > 0) {
      checks.push({
        key: "service_contract",
        title: "Governing Security Contract",
        status: "ATTENTION",
        requirementType: "CONTRACTUAL",
        message: "Relying on legacy site-level agreements. Formalise master contract.",
      });
    } else {
      checks.push({
        key: "service_contract",
        title: "Governing Security Contract",
        status: "MISSING",
        requirementType: "CONTRACTUAL",
        message: "No active written contract recorded",
      });
    }
  }

  // 5. Active Sites Contract Coverage
  if (client.sites.length > 0) {
    const coveredSiteIds = new Set<string>();
    for (const contract of activeContracts) {
      for (const cs of contract.sites) {
        coveredSiteIds.add(cs.siteId);
      }
    }
    const uncoveredSites = client.sites.filter((s) => !coveredSiteIds.has(s.id));
    if (uncoveredSites.length === 0) {
      checks.push({
        key: "site_contract_coverage",
        title: "Site Contract Assignment",
        status: "COMPLETE",
        requirementType: "CONTRACTUAL",
        message: `All ${client.sites.length} active operational sites are covered by contracts`,
      });
    } else {
      checks.push({
        key: "site_contract_coverage",
        title: "Site Contract Assignment",
        status: "ATTENTION",
        requirementType: "CONTRACTUAL",
        message: `${uncoveredSites.length} active site(s) are not explicitly linked to an active contract`,
        details: uncoveredSites.map((s) => s.name).join(", "),
      });
    }
  }

  // 6. POPIA / Privacy & Operator Agreement Check
  const popiaProfile = client.dataProcessingProfile;
  const operatorDoc = client.managedDocuments.find(
    (d) => d.documentType === "popia_operator_agreement" && d.verificationStatus === "VERIFIED"
  );

  if (popiaProfile?.operatorAgreementStatus === "SIGNED" || operatorDoc) {
    checks.push({
      key: "popia_compliance",
      title: "POPIA Operator Agreement",
      status: "COMPLETE",
      requirementType: "STATUTORY",
      message: "Section 21 POPIA operator agreement is executed",
    });
  } else if (popiaProfile?.operatorAgreementStatus === "NOT_APPLICABLE") {
    checks.push({
      key: "popia_compliance",
      title: "POPIA Operator Agreement",
      status: "NOT_APPLICABLE",
      requirementType: "OPTIONAL",
      message: "Data processing operator agreement marked not applicable",
    });
  } else {
    checks.push({
      key: "popia_compliance",
      title: "POPIA Operator Agreement",
      status: "ATTENTION",
      requirementType: "STATUTORY",
      message: "POPIA Section 21 Operator Agreement is pending signature or verification",
    });
  }

  // 7. Client Document Verification & Expiries
  const pendingDocs = client.managedDocuments.filter((d) => d.verificationStatus === "PENDING_VERIFICATION");
  const expiredDocs = client.managedDocuments.filter((d) => d.status === "EXPIRED" || (d.expiryDate && d.expiryDate < now));

  if (expiredDocs.length > 0) {
    checks.push({
      key: "document_verifications",
      title: "Document Expiry & Verification",
      status: "ATTENTION",
      requirementType: "RECOMMENDED",
      message: `${expiredDocs.length} client document(s) have expired`,
    });
  } else if (pendingDocs.length > 0) {
    checks.push({
      key: "document_verifications",
      title: "Document Expiry & Verification",
      status: "ATTENTION",
      requirementType: "RECOMMENDED",
      message: `${pendingDocs.length} uploaded document(s) await verification`,
    });
  } else if (client.managedDocuments.length > 0) {
    checks.push({
      key: "document_verifications",
      title: "Document Expiry & Verification",
      status: "COMPLETE",
      requirementType: "RECOMMENDED",
      message: "All uploaded client documents are verified and current",
    });
  } else {
    checks.push({
      key: "document_verifications",
      title: "Supporting Documentation",
      status: "ATTENTION",
      requirementType: "RECOMMENDED",
      message: "No corporate or compliance documents uploaded yet",
    });
  }

  // Overall status calculation
  const missingCount = checks.filter((c) => c.status === "MISSING").length;
  const attentionCount = checks.filter((c) => c.status === "ATTENTION").length;
  const completeCount = checks.filter((c) => c.status === "COMPLETE").length;

  let overallStatus: "COMPLETE" | "ATTENTION" | "MISSING" = "COMPLETE";
  if (missingCount > 0) {
    overallStatus = "MISSING";
  } else if (attentionCount > 0) {
    overallStatus = "ATTENTION";
  }

  return {
    clientId,
    overallStatus,
    summary: {
      total: checks.length,
      complete: completeCount,
      attention: attentionCount,
      missing: missingCount,
    },
    checks,
    evaluatedAt: now.toISOString(),
  };
}
