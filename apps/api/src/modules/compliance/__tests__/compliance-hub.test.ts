import { describe, it, expect, vi, beforeEach } from "vitest";
import { getComplianceSummary } from "../compliance-summary.service.js";
import {
  listObligations,
  createObligation,
  markObligationCompliant,
} from "../compliance.service.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    complianceObligation: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    complianceLegalCase: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    complianceRemediationPlan: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      return cb(prisma);
    }),
  },
}));

describe("Compliance Hub Module Services", () => {
  const companyId = "cmp_test_123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Compliance Obligations", () => {
    it("lists obligations with pagination and filters", async () => {
      const mockObligations = [
        {
          id: "ob-1",
          companyId,
          type: "PSIRA_COMPANY",
          title: "PSIRA Security Firm License",
          authority: "PSIRA",
          status: "COMPLIANT",
          riskLevel: "CRITICAL",
          dueDate: new Date("2026-12-31"),
          expiryDate: new Date("2026-12-31"),
        },
      ];

      vi.mocked(prisma.complianceObligation.findMany).mockResolvedValue(mockObligations as any);
      vi.mocked(prisma.complianceObligation.count).mockResolvedValue(1);

      const result = await listObligations(companyId, { limit: 10, offset: 0 });

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe("PSIRA Security Firm License");
    });

    it("creates a new compliance obligation with audit logging", async () => {
      const createdRecord = {
        id: "ob-new",
        companyId,
        type: "COIDA_ROE",
        title: "COIDA Return of Earnings 2026",
        authority: "Compensation Fund",
        status: "ATTENTION_REQUIRED",
        riskLevel: "HIGH",
        dueDate: new Date("2026-05-31"),
      };

      vi.mocked(prisma.complianceObligation.create).mockResolvedValue(createdRecord as any);

      const result = await createObligation(
        companyId,
        {
          type: "COIDA_ROE",
          title: "COIDA Return of Earnings 2026",
          authority: "Compensation Fund",
          status: "ATTENTION_REQUIRED",
          riskLevel: "HIGH",
          dueDate: new Date("2026-05-31"),
        },
        "usr-actor-1"
      );

      expect(result.id).toBe("ob-new");
      expect(prisma.complianceObligation.create).toHaveBeenCalled();
    });

    it("marks obligation compliant and updates verification timestamp", async () => {
      const existing = {
        id: "ob-verify",
        companyId,
        status: "PENDING_VERIFICATION",
      };

      vi.mocked(prisma.complianceObligation.findFirstOrThrow).mockResolvedValue(existing as any);
      vi.mocked(prisma.complianceObligation.update).mockResolvedValue({
        ...existing,
        status: "COMPLIANT",
        lastVerifiedAt: new Date(),
      } as any);

      const updated = await markObligationCompliant(
        companyId,
        "ob-verify",
        { verifiedNotes: "Certificate checked online" },
        "usr-actor-1"
      );

      expect(updated.status).toBe("COMPLIANT");
      expect(prisma.complianceObligation.update).toHaveBeenCalled();
    });
  });

  describe("Compliance Summary Calculation", () => {
    it("computes overall health score, counts obligations, remediations, and legal cases", async () => {
      const mockObligations = [
        {
          id: "ob-1",
          type: "PSIRA_COMPANY",
          title: "PSIRA Firm",
          status: "COMPLIANT",
          riskLevel: "CRITICAL",
          dueDate: new Date("2026-12-31"),
          expiryDate: new Date("2026-12-31"),
        },
        {
          id: "ob-2",
          type: "COIDA_LETTER",
          title: "COIDA Letter of Good Standing",
          status: "ATTENTION_REQUIRED",
          riskLevel: "HIGH",
          dueDate: new Date("2026-10-07"),
          expiryDate: null,
        },
      ];

      vi.mocked(prisma.complianceObligation.findMany).mockResolvedValue(mockObligations as any);
      vi.mocked(prisma.complianceRemediationPlan.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.complianceLegalCase.findMany).mockResolvedValue([] as any);

      const summary = await getComplianceSummary(companyId);

      expect(summary.obligations.total).toBe(2);
      expect(summary.obligations.compliant).toBe(1);
      expect(summary.obligations.attentionRequired).toBe(1);
      expect(summary.overallHealthScore).toBeGreaterThan(0);
      expect(summary.remediations).toBeDefined();
      expect(summary.legalCases).toBeDefined();
    });
  });
});
