import { describe, it, expect, vi, beforeEach } from "vitest";
import { getComplianceSummary } from "../compliance-summary.service.js";
import { recordStatutoryPayment } from "../statutory-reconciliation.service.js";
import { evaluateCashFloor } from "../cash-floor.service.js";
import { listRateConfigs } from "../statutory-rates.service.js";
import {
  listObligations,
  createObligation,
  markObligationCompliant,
} from "../compliance.service.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../services/payroll-reserve.service.js", () => ({
  getPayrollReserveSnapshot: vi.fn().mockResolvedValue({
    companyId: "cmp_test_123",
    capturedAt: new Date().toISOString(),
    historicalRunCount: 3,
    avgGrossTotal: 400000,
    avgNetTotal: 300000,
    avgEmployerStatutory: 50000,
    correctedMonthlyBurden: 350000,
    doubleCountDiscrepancy: 50000,
    oneMonthReserve: 350000,
    suggestedReserveTier: "MODERATE",
    reserveTiers: { low: 350000, moderate: 700000, high: 1050000 },
  }),
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
    statutoryPeriod: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    statutoryPayment: {
      findMany: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    statutoryRateConfig: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    complianceLegalCase: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    complianceRemediationPlan: {
      findMany: vi.fn(),
    },
    cashCommitment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    cashPositionSnapshot: {
      findFirst: vi.fn(),
      create: vi.fn(),
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
    it("computes overall health score, counts obligations and statutory breakdown", async () => {
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
          type: "SARS_EMP201",
          title: "SARS Tax Status",
          status: "ATTENTION_REQUIRED",
          riskLevel: "HIGH",
          dueDate: new Date("2026-10-07"),
          expiryDate: null,
        },
      ];

      vi.mocked(prisma.complianceObligation.findMany).mockResolvedValue(mockObligations as any);
      vi.mocked(prisma.statutoryPeriod.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.complianceRemediationPlan.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.complianceLegalCase.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.cashCommitment.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.cashPositionSnapshot.findFirst).mockResolvedValue({
        id: "snap-1",
        companyId,
        availableCash: 500000,
        capturedAt: new Date(),
      } as any);

      const summary = await getComplianceSummary(companyId);

      expect(summary.obligations.total).toBe(2);
      expect(summary.obligations.compliant).toBe(1);
      expect(summary.obligations.attentionRequired).toBe(1);
      expect(summary.overallHealthScore).toBeGreaterThan(0);
      expect(summary.cashFloor).toBeDefined();
    });
  });

  describe("Statutory Reconciliation & Payments", () => {
    it("records a successful statutory payment and updates outstanding amount", async () => {
      const mockPeriod = {
        id: "period-1",
        companyId,
        periodName: "2026-08 EMP201",
        scheme: "PAYE",
        status: "DECLARED",
        expectedTotal: 50000,
        declaredTotal: 50000,
        successfulPaidTotal: 0,
        outstandingAmount: 50000,
      };

      vi.mocked(prisma.statutoryPeriod.findFirstOrThrow).mockResolvedValue(mockPeriod as any);
      vi.mocked(prisma.statutoryPayment.create).mockResolvedValue({
        id: "pmt-1",
        companyId,
        statutoryPeriodId: "period-1",
        amount: 50000,
        status: "SUCCESS",
        paymentDate: new Date("2026-09-07"),
      } as any);

      vi.mocked(prisma.statutoryPayment.aggregate).mockResolvedValue({
        _sum: { amount: 50000 },
      } as any);

      vi.mocked(prisma.statutoryPeriod.update).mockResolvedValue({
        ...mockPeriod,
        successfulPaidTotal: 50000,
        outstandingAmount: 0,
        status: "PAID",
      } as any);

      const result = await recordStatutoryPayment(
        companyId,
        "period-1",
        {
          amount: 50000,
          paymentDate: new Date("2026-09-07"),
          status: "SUCCESS",
          paymentReference: "SARS-EFT-9912",
        },
        "usr-actor-1"
      );

      expect(result.period.status).toBe("PAID");
      expect(result.period.outstandingAmount).toBe(0);
      expect(result.period.successfulPaidTotal).toBe(50000);
    });

    it("marks period PARTIALLY_PAID if payment is less than total obligation", async () => {
      const mockPeriod = {
        id: "period-2",
        companyId,
        periodName: "2026-08 NBCPSS",
        scheme: "NBCPSS",
        status: "DECLARED",
        expectedTotal: 20000,
        declaredTotal: 20000,
        successfulPaidTotal: 0,
        outstandingAmount: 20000,
      };

      vi.mocked(prisma.statutoryPeriod.findFirstOrThrow).mockResolvedValue(mockPeriod as any);
      vi.mocked(prisma.statutoryPayment.create).mockResolvedValue({
        id: "pmt-2",
        companyId,
        statutoryPeriodId: "period-2",
        amount: 10000,
        status: "SUCCESS",
        paymentDate: new Date("2026-09-10"),
      } as any);

      vi.mocked(prisma.statutoryPayment.aggregate).mockResolvedValue({
        _sum: { amount: 10000 },
      } as any);

      vi.mocked(prisma.statutoryPeriod.update).mockResolvedValue({
        ...mockPeriod,
        successfulPaidTotal: 10000,
        outstandingAmount: 10000,
        status: "PARTIALLY_PAID",
      } as any);

      const result = await recordStatutoryPayment(
        companyId,
        "period-2",
        {
          amount: 10000,
          paymentDate: new Date("2026-09-10"),
          status: "SUCCESS",
        },
        "usr-actor-1"
      );

      expect(result.period.status).toBe("PARTIALLY_PAID");
      expect(result.period.outstandingAmount).toBe(10000);
    });
  });

  describe("Cash Floor Evaluation", () => {
    it("evaluates protected cash floor including payroll reserve and commitments", async () => {
      const mockCommitments = [
        {
          id: "com-1",
          companyId,
          title: "Fuel & Fleet Lease",
          amount: 50000,
          frequency: "MONTHLY",
          protected: true,
          active: true,
        },
      ];

      vi.mocked(prisma.cashCommitment.findMany).mockResolvedValue(mockCommitments as any);
      vi.mocked(prisma.statutoryPeriod.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.complianceRemediationPlan.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.cashPositionSnapshot.findFirst).mockResolvedValue({
        id: "snap-1",
        companyId,
        availableCash: 500000,
        capturedAt: new Date(),
      } as any);

      const evaluation = await evaluateCashFloor(companyId);

      // Payroll reserve = 350000
      // Protected commitments = 50000
      // Floor = 400000
      // Available = 500000 -> buffer = +100000, status = HEALTHY
      expect(evaluation.protectedCashFloor).toBe(400000);
      expect(evaluation.availableCash).toBe(500000);
      expect(evaluation.bufferOrShortfall).toBe(100000);
      expect(evaluation.status).toBe("HEALTHY");
    });
  });

  describe("Statutory Rate Configs", () => {
    it("lists rate configs filtered by scheme", async () => {
      const mockRates = [
        {
          id: "rate-1",
          companyId,
          scheme: "UIF",
          employeeRate: 0.01,
          employerRate: 0.01,
          monthlyCap: 177.12,
          effectiveFrom: new Date("2020-01-01"),
          effectiveTo: null,
        },
      ];

      vi.mocked(prisma.statutoryRateConfig.findMany).mockResolvedValue(mockRates as any);

      const rates = await listRateConfigs(companyId, "UIF");
      expect(rates.length).toBe(1);
      expect(rates[0].scheme).toBe("UIF");
    });
  });
});
