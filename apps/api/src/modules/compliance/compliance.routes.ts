import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireAnyCapability } from "../../middleware/authorization.js";
import {
  listObligations,
  getObligation,
  createObligation,
  updateObligation,
  markObligationCompliant,
  managementOverrideObligation,
  deleteObligation,
  listEmploymentExits,
  getEmploymentExit,
  createEmploymentExit,
  updateEmploymentExit,
  deleteEmploymentExit,
} from "./compliance.service.js";
import {
  listStatutoryPeriods,
  getStatutoryPeriod,
  createStatutoryPeriod,
  advancePeriodStatus,
  recordStatutoryPayment,
} from "./statutory-reconciliation.service.js";
import {
  listRateConfigs,
  createRateConfig,
  verifyRateConfig,
} from "./statutory-rates.service.js";
import {
  listContributions,
  getFundSummary,
  captureContributionsFromRun,
} from "./fund-contributions.service.js";
import {
  listCommitments,
  createCommitment,
  updateCommitment,
  deleteCommitment,
  recordCashSnapshot,
  evaluateCashFloor,
} from "./cash-floor.service.js";
import {
  listLegalCases,
  getLegalCase,
  createLegalCase,
  updateLegalCase,
  closeLegalCase,
  listRemediationPlans,
  createRemediationPlan,
  updateRemediationPlan,
} from "./legal-cases.service.js";
import { syncComplianceAlerts } from "./compliance-alerts.service.js";
import { getComplianceSummary } from "./compliance-summary.service.js";
import {
  generateTenderCompliancePack,
  generateExecutiveRiskReport,
} from "./compliance-report.service.js";
import {
  listObligationsQuerySchema,
  createObligationSchema,
  updateObligationSchema,
  markCompliantSchema,
  managementOverrideSchema,
  listStatutoryPeriodsQuerySchema,
  createStatutoryPeriodSchema,
  advancePeriodStatusSchema,
  recordStatutoryPaymentSchema,
  createCashCommitmentSchema,
  updateCashCommitmentSchema,
  createCashSnapshotSchema,
  listLegalCasesQuerySchema,
  createLegalCaseSchema,
  updateLegalCaseSchema,
  listRemediationPlansQuerySchema,
  createRemediationPlanSchema,
  updateRemediationPlanSchema,
  createStatutoryRateConfigSchema,
  listEmploymentExitsQuerySchema,
  createEmploymentExitSchema,
  updateEmploymentExitSchema,
} from "./compliance.schemas.js";

const COMPLIANCE = "/compliance";
const STATUTORY = "/compliance/statutory";
const FUNDS = "/compliance/funds";
const LEGAL = "/compliance/legal";
const CASH = "/compliance/cash-control";
const COMPANY = "/compliance/company";
const REPORTS = "/compliance/reports";

export async function complianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ---------------------------------------------------------------------------
  // Summary & Sync
  // ---------------------------------------------------------------------------

  app.get(
    "/summary",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const summary = await getComplianceSummary(req.user!.companyId);
      return reply.send(summary);
    }
  );

  app.post(
    "/sync-alerts",
    { preHandler: requireCapability(COMPLIANCE, "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const result = await syncComplianceAlerts(req.user!.companyId);
      return reply.send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // Company Obligations Register
  // ---------------------------------------------------------------------------

  app.get(
    "/obligations",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listObligationsQuerySchema.parse(req.query);
      const res = await listObligations(req.user!.companyId, query);
      return reply.send(res);
    }
  );

  app.post(
    "/obligations",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createObligationSchema.parse(req.body);
      const obligation = await createObligation(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(obligation);
    }
  );

  app.get(
    "/obligations/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const obligation = await getObligation(req.user!.companyId, id);
      if (!obligation) return reply.code(404).send({ error: "Obligation not found" });
      return reply.send(obligation);
    }
  );

  app.patch(
    "/obligations/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "edit") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = updateObligationSchema.parse(req.body);
      const obligation = await updateObligation(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(obligation);
    }
  );

  app.post(
    "/obligations/:id/mark-compliant",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = markCompliantSchema.parse(req.body);
      const obligation = await markObligationCompliant(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(obligation);
    }
  );

  app.post(
    "/obligations/:id/management-override",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = managementOverrideSchema.parse(req.body);
      const obligation = await managementOverrideObligation(
        req.user!.companyId,
        id,
        body.targetStatus,
        body.reason,
        req.user!.sub
      );
      return reply.send(obligation);
    }
  );

  app.delete(
    "/obligations/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, COMPANY], "delete") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const deleted = await deleteObligation(req.user!.companyId, id, req.user!.sub);
      return reply.send({ ok: true, deletedId: deleted.id });
    }
  );

  // ---------------------------------------------------------------------------
  // Statutory Reconciliation & Payments
  // ---------------------------------------------------------------------------

  app.get(
    "/statutory-periods",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listStatutoryPeriodsQuerySchema.parse(req.query);
      const res = await listStatutoryPeriods(req.user!.companyId, query);
      return reply.send(res);
    }
  );

  app.post(
    "/statutory-periods",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createStatutoryPeriodSchema.parse(req.body);
      const period = await createStatutoryPeriod(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(period);
    }
  );

  app.get(
    "/statutory-periods/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const period = await getStatutoryPeriod(req.user!.companyId, id);
      if (!period) return reply.code(404).send({ error: "Statutory period not found" });
      return reply.send(period);
    }
  );

  app.post(
    "/statutory-periods/:id/advance-status",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = advancePeriodStatusSchema.parse(req.body);
      const period = await advancePeriodStatus(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(period);
    }
  );

  app.post(
    "/statutory-periods/:id/payments",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = recordStatutoryPaymentSchema.parse(req.body);
      const result = await recordStatutoryPayment(req.user!.companyId, id, body, req.user!.sub);
      return reply.code(201).send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // Statutory Rates
  // ---------------------------------------------------------------------------

  app.get(
    "/statutory-rates",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const scheme = (req.query as { scheme?: any }).scheme;
      const rates = await listRateConfigs(req.user!.companyId, scheme);
      return reply.send(rates);
    }
  );

  app.post(
    "/statutory-rates",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createStatutoryRateConfigSchema.parse(req.body);
      const config = await createRateConfig(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(config);
    }
  );

  app.post(
    "/statutory-rates/:id/verify",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const config = await verifyRateConfig(req.user!.companyId, id, req.user!.sub);
      return reply.send(config);
    }
  );

  // ---------------------------------------------------------------------------
  // Funds & Contributions
  // ---------------------------------------------------------------------------

  app.get(
    "/statutory-periods/:id/contributions",
    { preHandler: requireAnyCapability([COMPLIANCE, FUNDS], "view_sensitive") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const query = req.query as { scheme?: any; employeeId?: string; limit?: string; offset?: string };
      const res = await listContributions(req.user!.companyId, id, {
        scheme: query.scheme,
        employeeId: query.employeeId,
        limit: query.limit ? parseInt(query.limit, 10) : 100,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.send(res);
    }
  );

  app.get(
    "/statutory-periods/:id/fund-summary",
    { preHandler: requireAnyCapability([COMPLIANCE, FUNDS], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const summary = await getFundSummary(req.user!.companyId, id);
      return reply.send(summary);
    }
  );

  app.post(
    "/statutory-periods/:id/capture-contributions",
    { preHandler: requireAnyCapability([COMPLIANCE, FUNDS], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { payrollRunId: string; scheme?: any };
      if (!body?.payrollRunId) return reply.code(400).send({ error: "payrollRunId is required" });
      const result = await captureContributionsFromRun(
        req.user!.companyId,
        id,
        body.payrollRunId,
        body.scheme ?? "PSSPF"
      );
      return reply.send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // Cash Floor & Commitments
  // ---------------------------------------------------------------------------

  app.get(
    "/cash-floor",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const evaluation = await evaluateCashFloor(req.user!.companyId);
      return reply.send(evaluation);
    }
  );

  app.get(
    "/cash-commitments",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const commitments = await listCommitments(req.user!.companyId);
      return reply.send(commitments);
    }
  );

  app.post(
    "/cash-commitments",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createCashCommitmentSchema.parse(req.body);
      const commitment = await createCommitment(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(commitment);
    }
  );

  app.patch(
    "/cash-commitments/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "edit") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = updateCashCommitmentSchema.parse(req.body);
      const commitment = await updateCommitment(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(commitment);
    }
  );

  app.delete(
    "/cash-commitments/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "delete") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const deleted = await deleteCommitment(req.user!.companyId, id, req.user!.sub);
      return reply.send({ ok: true, deletedId: deleted.id });
    }
  );

  app.post(
    "/cash-snapshots",
    { preHandler: requireAnyCapability([COMPLIANCE, CASH], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createCashSnapshotSchema.parse(req.body);
      const snapshot = await recordCashSnapshot(
        req.user!.companyId,
        body.availableCash,
        body.notes,
        req.user!.sub
      );
      return reply.code(201).send(snapshot);
    }
  );

  // ---------------------------------------------------------------------------
  // Legal Cases & Remediation Plans
  // ---------------------------------------------------------------------------

  app.get(
    "/legal-cases",
    { preHandler: requireAnyCapability([COMPLIANCE, LEGAL], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listLegalCasesQuerySchema.parse(req.query);
      const res = await listLegalCases(req.user!.companyId, query);
      return reply.send(res);
    }
  );

  app.post(
    "/legal-cases",
    { preHandler: requireAnyCapability([COMPLIANCE, LEGAL], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createLegalCaseSchema.parse(req.body);
      const legalCase = await createLegalCase(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(legalCase);
    }
  );

  app.get(
    "/legal-cases/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, LEGAL], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const legalCase = await getLegalCase(req.user!.companyId, id);
      if (!legalCase) return reply.code(404).send({ error: "Legal case not found" });
      return reply.send(legalCase);
    }
  );

  app.patch(
    "/legal-cases/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, LEGAL], "edit") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = updateLegalCaseSchema.parse(req.body);
      const legalCase = await updateLegalCase(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(legalCase);
    }
  );

  app.post(
    "/legal-cases/:id/close",
    { preHandler: requireAnyCapability([COMPLIANCE, LEGAL], "approve") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { outcome: string };
      if (!body?.outcome) return reply.code(400).send({ error: "outcome is required to close case" });
      const legalCase = await closeLegalCase(req.user!.companyId, id, body.outcome, req.user!.sub);
      return reply.send(legalCase);
    }
  );

  app.get(
    "/remediation-plans",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listRemediationPlansQuerySchema.parse(req.query);
      const res = await listRemediationPlans(req.user!.companyId, query);
      return reply.send(res);
    }
  );

  app.post(
    "/remediation-plans",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createRemediationPlanSchema.parse(req.body);
      const plan = await createRemediationPlan(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(plan);
    }
  );

  app.patch(
    "/remediation-plans/:id",
    { preHandler: requireAnyCapability([COMPLIANCE, STATUTORY], "edit") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = updateRemediationPlanSchema.parse(req.body);
      const plan = await updateRemediationPlan(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(plan);
    }
  );

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  app.get(
    "/reports/tender-pack",
    { preHandler: requireAnyCapability([COMPLIANCE, REPORTS], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const pack = await generateTenderCompliancePack(req.user!.companyId);
      return reply.send(pack);
    }
  );

  app.get(
    "/reports/executive-risk",
    { preHandler: requireAnyCapability([COMPLIANCE, REPORTS], "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const report = await generateExecutiveRiskReport(req.user!.companyId);
      return reply.send(report);
    }
  );

  // ---------------------------------------------------------------------------
  // Employment Exits
  // ---------------------------------------------------------------------------

  app.get(
    "/employment-exits",
    { preHandler: requireCapability(COMPLIANCE, "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listEmploymentExitsQuerySchema.parse(req.query);
      const res = await listEmploymentExits(req.user!.companyId, query);
      return reply.send(res);
    }
  );

  app.post(
    "/employment-exits",
    { preHandler: requireCapability(COMPLIANCE, "create") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createEmploymentExitSchema.parse(req.body);
      const exit = await createEmploymentExit(req.user!.companyId, body, req.user!.sub);
      return reply.code(201).send(exit);
    }
  );

  app.get(
    "/employment-exits/:id",
    { preHandler: requireCapability(COMPLIANCE, "view") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const exit = await getEmploymentExit(req.user!.companyId, id);
      if (!exit) return reply.code(404).send({ error: "Employment exit not found" });
      return reply.send(exit);
    }
  );

  app.patch(
    "/employment-exits/:id",
    { preHandler: requireCapability(COMPLIANCE, "edit") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = updateEmploymentExitSchema.parse(req.body);
      const exit = await updateEmploymentExit(req.user!.companyId, id, body, req.user!.sub);
      return reply.send(exit);
    }
  );

  app.delete(
    "/employment-exits/:id",
    { preHandler: requireCapability(COMPLIANCE, "delete") },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const exit = await deleteEmploymentExit(req.user!.companyId, id, req.user!.sub);
      return reply.send({ ok: true, deletedId: exit.id });
    }
  );
}
