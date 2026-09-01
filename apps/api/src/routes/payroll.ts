import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  calculatePayroll,
  canTransitionPayrollStatus,
  revertPayrollToDraft,
} from "../services/payroll.service.js";
import { PayrollServiceError } from "../services/payroll.service.js";
import { validatePayrollFinalisation, validateBankDetailsForItems } from "../services/payroll-validation.service.js";
import { updateSdlTrackingOnPayrollPaid } from "../services/sdl-tracking.service.js";
import { buildEmp201Data, emp201ToCsv } from "../services/emp201.service.js";
import { buildIrp5DataForTaxYear, irp5ToCsv } from "../services/irp5.service.js";
import { fetchPayslipData, buildPayslipTemplateData } from "../services/payslip-data.service.js";
import { generatePayslipPDFFromTemplate } from "../services/payslip-pdf.service.js";
import { createAuditLog } from "../lib/audit.js";
import { assertPayrollNotBlocked } from "../modules/attendance-exceptions/exceptions.service.js";
import {
  auditPayrollApproval,
  auditPayrollCalculation,
  auditPayrollLock,
  auditPayrollRevertToDraft,
} from "../lib/payroll-audit.js";
import { format } from "date-fns";
import { canAccessSensitiveData, omitFields } from "../lib/sensitive-data.js";
import { getLeaveReadiness, postLeaveToPayroll } from "../services/leave-v3.service.js";

function canHandlePayrollPrivateData(user: import("../lib/types.js").AuthenticatedUser) {
  return canAccessSensitiveData(user, "/payroll");
}
function sanitizePayrollRun<T extends Record<string, unknown>>(run: T, user: import("../lib/types.js").AuthenticatedUser) {
  return canHandlePayrollPrivateData(user) ? run : omitFields(run, ["calculationSnapshot"]);
}
function denyPayrollPrivateData(user: import("../lib/types.js").AuthenticatedUser, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (canHandlePayrollPrivateData(user)) return false;
  reply.code(403).send({ error: "Forbidden", message: "Sensitive payroll data is restricted to HR/payroll users" });
  return true;
}

const createPayrollRunSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

const revertToDraftSchema = z.object({
  reason: z.string().trim().min(5, "Reason must be at least 5 characters"),
});

const fnbExportQuerySchema = z.object({
  groupId: z
    .string()
    .trim()
    .min(1, "groupId must be a group ID or 'ungrouped'")
    .optional(),
});

const employeeDeductionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(["fixed", "percentage"]),
    amount: z.number().finite().positive().optional(),
    rate: z.number().finite().positive().max(100).optional(),
    deductionRuleId: z.string().min(1).optional(),
    appliesFrom: z.string().datetime().optional(),
    appliesTo: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "fixed" && data.amount == null) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "A positive amount is required for a fixed deduction" });
    }
    if (data.type === "percentage" && data.rate == null) {
      ctx.addIssue({ code: "custom", path: ["rate"], message: "A percentage rate between 0 and 100 is required" });
    }
    if (
      data.appliesFrom &&
      data.appliesTo &&
      new Date(data.appliesTo) < new Date(data.appliesFrom)
    ) {
      ctx.addIssue({ code: "custom", path: ["appliesTo"], message: "appliesTo must be on or after appliesFrom" });
    }
  });

export async function payrollRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ module: "/payroll" }),
  ];
  const exportProtect = [
    authMiddleware,
    requireCapability("/payroll", "export"),
  ];
  const editProtect = [
    authMiddleware,
    requireCapability("/payroll", "edit"),
  ];

  app.get("/runs", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where: { companyId: user.companyId },
        orderBy: { periodStart: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.payrollRun.count({ where: { companyId: user.companyId } }),
    ]);

    return reply.send({ data: runs.map((run) => sanitizePayrollRun(run, user)), total, limit, offset });
  });

  app.post("/runs", { preHandler: protect }, async (request, reply) => {
    const parsed = createPayrollRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const periodStart = new Date(parsed.data.periodStart);
    const periodEnd = new Date(parsed.data.periodEnd);

    if (periodStart >= periodEnd) {
      return reply.code(400).send({
        error: "Validation error",
        message: "periodEnd must be after periodStart",
      });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const configuredPeriod =
      (company?.settings as { payrollPeriod?: unknown } | null)?.payrollPeriod;
    const payPeriod =
      configuredPeriod === "weekly" ||
      configuredPeriod === "biweekly" ||
      configuredPeriod === "monthly"
        ? configuredPeriod
        : "monthly";

    const createResult = await prisma.$transaction(async (tx) => {
      // Serialize run creation per tenant so two requests cannot pass the
      // overlap check concurrently.
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"payroll:" + companyId})) IS NULL AS acquired
      `;
      const overlapping = await tx.payrollRun.findFirst({
        where: {
          companyId,
          payPeriod,
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
        },
        select: { id: true, periodStart: true, periodEnd: true, status: true },
      });
      if (overlapping) return { overlapping };
      const run = await tx.payrollRun.create({
        data: {
          companyId,
          periodStart,
          periodEnd,
          payPeriod,
          status: "draft",
        },
      });
      return { run };
    });

    if ("overlapping" in createResult) {
      return reply.code(409).send({
        error: "Payroll period overlap",
        message: `A ${payPeriod} payroll run already covers part of this period.`,
        conflictingRun: createResult.overlapping,
      });
    }
    const run = createResult.run;

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "payroll_run.create",
      entityType: "payroll_run",
      entityId: run.id,
    });

    return reply.code(201).send(sanitizePayrollRun(run, request.user!));
  });

  app.get("/runs/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    return reply.send(sanitizePayrollRun(run, user));
  });

  app.get("/runs/:id/items", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            group: { select: { id: true, name: true, sortOrder: true } },
          },
        },
      },
      orderBy: [
        { employee: { group: { sortOrder: "asc" } } },
        { employee: { lastName: "asc" } },
      ],
    });

    return reply.send({ data: items });
  });

  app.post("/runs/:id/calculate", { preHandler: editProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const runBefore = await prisma.payrollRun.findFirst({
      where: { id, companyId },
    });
    if (!runBefore) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const readiness = await assertPayrollNotBlocked(
      companyId,
      runBefore.periodStart,
      runBefore.periodEnd
    );
    if (readiness.blocked) {
      return reply.code(400).send({
        error: "Payroll blocked",
        message: readiness.message,
        payrollReadiness: readiness,
      });
    }
    const leaveReadiness = await getLeaveReadiness(companyId, runBefore.periodStart, runBefore.periodEnd);
    if (leaveReadiness.blocked) {
      return reply.code(400).send({
        error: "Payroll blocked by leave",
        message: leaveReadiness.message,
        leaveReadiness,
      });
    }

    let calcResult;
    try {
      calcResult = await calculatePayroll(id, companyId);
    } catch (err) {
      if (err instanceof PayrollServiceError) {
        return reply.code(400).send({
          error: "Calculation failed",
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    await auditPayrollCalculation({
      userId: request.user!.sub,
      companyId,
      payrollRunId: id,
      snapshot: calcResult.snapshot,
    });

    return reply.send(sanitizePayrollRun(run, request.user!));
  });

  app.post(
    "/runs/:id/approve",
    { preHandler: [authMiddleware, requireCapability("/payroll", "approve")] },
    async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    if (!canTransitionPayrollStatus(run.status, "approved")) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: `Cannot approve payroll in status ${run.status}. Must be calculated first.`,
      });
    }

    const readiness = await assertPayrollNotBlocked(
      user.companyId,
      run.periodStart,
      run.periodEnd
    );
    if (readiness.blocked) {
      return reply.code(400).send({
        error: "Payroll blocked",
        message: readiness.message,
        payrollReadiness: readiness,
      });
    }
    const leaveReadiness = await getLeaveReadiness(user.companyId, run.periodStart, run.periodEnd);
    if (leaveReadiness.blocked) {
      return reply.code(400).send({
        error: "Approval blocked by leave",
        message: leaveReadiness.message,
        leaveReadiness,
      });
    }

    const validation = await validatePayrollFinalisation(id, user.companyId);
    if (!validation.canApprove) {
      return reply.code(400).send({
        error: "Approval blocked",
        message: "Critical validation errors must be resolved before approving this payroll run.",
        validation,
      });
    }

    const lockTime = new Date();
    const updatedCount = await prisma.$transaction(async (tx) => {
      const changed = await tx.payrollRun.updateMany({
        where: { id, companyId: user.companyId, status: "calculated" },
        data: { status: "approved", lockedAt: lockTime },
      });
      if (changed.count > 0) {
        await postLeaveToPayroll(user.companyId, id, run.periodStart, run.periodEnd, tx);
      }
      return changed;
    });
    if (updatedCount.count === 0) {
      return reply.code(409).send({
        error: "Payroll status changed",
        message: "Payroll was already approved or changed by another request. Refresh and try again.",
      });
    }

    const updated = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    const lockedAtIso = lockTime.toISOString();

    await auditPayrollApproval({
      userId: user.sub,
      companyId: user.companyId,
      payrollRunId: id,
      lockedAt: lockedAtIso,
      previousStatus: run.status,
    });
    await auditPayrollLock({
      userId: user.sub,
      companyId: user.companyId,
      payrollRunId: id,
      lockedAt: lockedAtIso,
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "payroll_run.approve",
      entityType: "payroll_run",
      entityId: id,
      metadata: { lockedAt: lockedAtIso },
    });

    return reply.send(sanitizePayrollRun(updated ?? {}, user));
    }
  );

  app.post(
    "/runs/:id/revert-to-draft",
    { preHandler: [authMiddleware, requireCapability("/payroll", "approve")] },
    async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const parsed = revertToDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    if (!canTransitionPayrollStatus(run.status, "draft")) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: `Cannot revert payroll in status ${run.status}.`,
      });
    }

    try {
      await revertPayrollToDraft(id, user.companyId, parsed.data.reason);
    } catch (err) {
      if (err instanceof PayrollServiceError) {
        return reply.code(400).send({ error: "Revert failed", message: err.message });
      }
      throw err;
    }

    await auditPayrollRevertToDraft({
      userId: user.sub,
      companyId: user.companyId,
      payrollRunId: id,
      previousStatus: run.status,
      reason: parsed.data.reason,
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "payroll_run.revert_to_draft",
      entityType: "payroll_run",
      entityId: id,
      metadata: { previousStatus: run.status, reason: parsed.data.reason },
    });

    const updated = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    return reply.send(sanitizePayrollRun(updated ?? {}, user));
    }
  );

  app.get("/runs/:id/validation", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const validation = await validatePayrollFinalisation(id, user.companyId);
    return reply.send({ payrollRunId: id, status: run.status, ...validation });
  });

  app.get("/runs/:id/calculation-snapshot", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        id: true,
        status: true,
        calculatedAt: true,
        calculationSnapshot: true,
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    if (!run.calculationSnapshot) {
      return reply.code(404).send({
        error: "No snapshot",
        message: "Payroll has not been calculated yet.",
      });
    }

    return reply.send({
      payrollRunId: run.id,
      status: run.status,
      calculatedAt: run.calculatedAt,
      snapshot: run.calculationSnapshot,
    });
  });

  app.post(
    "/runs/:id/mark-paid",
    { preHandler: [authMiddleware, requireCapability("/payroll", "approve")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;

      const run = await prisma.payrollRun.findFirst({
        where: { id, companyId: user.companyId },
      });

      if (!run) {
        return reply.code(404).send({ error: "Payroll run not found" });
      }

      if (!canTransitionPayrollStatus(run.status, "paid")) {
        return reply.code(400).send({
          error: "Invalid transition",
          message: `Cannot mark as paid. Payroll must be approved first. Current status: ${run.status}`,
        });
      }

      const transition = await prisma.$transaction(async (tx) => {
        // SDL totals are stored as a JSON object on Company. Serialize paid
        // transitions per tenant so concurrent payroll runs cannot overwrite
        // each other's read-modify-write update.
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${"payroll-sdl:" + user.companyId})) IS NULL AS acquired
        `;

        const updatedCount = await tx.payrollRun.updateMany({
          where: {
            id,
            companyId: user.companyId,
            status: "approved",
            lockedAt: { not: null },
          },
          data: { status: "paid" },
        });
        if (updatedCount.count === 0) return null;

        // Passing the transaction client makes the status change and the SDL
        // tracking update one atomic operation. A tracking failure rolls the
        // run back to approved.
        await updateSdlTrackingOnPayrollPaid(user.companyId, id, tx);
        return tx.payrollRun.findFirst({
          where: { id, companyId: user.companyId },
        });
      });

      if (!transition) {
        return reply.code(409).send({
          error: "Payroll status changed",
          message: "Payroll is no longer in the approved state. Refresh and try again.",
        });
      }

      await createAuditLog({
        userId: user.sub,
        companyId: user.companyId,
        action: "payroll_run.mark_paid",
        entityType: "payroll_run",
        entityId: id,
      });

      return reply.send(sanitizePayrollRun(transition, user));
    }
  );

  app.get("/runs/:id/items/:itemId/payslip", { preHandler: protect }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!run) return reply.code(404).send({ error: "Payroll run not found" });

    const item = await prisma.payrollItem.findFirst({
      where: { id: itemId, payrollRunId: id },
      include: { employee: true, payslip: true },
    });
    if (!item) return reply.code(404).send({ error: "Payroll item not found" });

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    });
    return reply.send({
      payrollItem: item,
      companyName: company?.name ?? "Company",
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
    });
  });

  app.get("/runs/:id/items/:itemId/payslip/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const payslipInput = await fetchPayslipData(id, itemId, user.companyId);
    if (!payslipInput) {
      return reply.code(404).send({ error: "Payroll item not found", message: "The payroll item does not exist or does not belong to this payroll run." });
    }

    try {
      const templateData = buildPayslipTemplateData(payslipInput);
      const pdfBuffer = await generatePayslipPDFFromTemplate(templateData);
      const emp = payslipInput.payrollItem.employee;
      const filename = `payslip-${emp.firstName}-${emp.lastName}-${format(payslipInput.periodStart, "yyyy-MM")}.pdf`;
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (err) {
      request.log.error({ err }, "Payslip PDF generation failed");
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(500).send({
        error: "PDF generation failed",
        message: message.includes("puppeteer") || message.includes("Chrome") || message.includes("Chromium")
          ? "PDF generation requires a browser (Puppeteer/Chrome). Check server configuration."
          : `Could not generate payslip PDF: ${message}`,
      });
    }
  });

  app.get("/runs/:id/export/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        items: {
          include: { employee: true, payslip: true },
          orderBy: { employee: { lastName: "asc" } },
        },
      },
    });
    if (!run) return reply.code(404).send({ error: "Payroll run not found" });

    const { PDFDocument } = await import("pdf-lib");
    const mergedPdf = await PDFDocument.create();

    for (const item of run.items) {
      const payslipInput = await fetchPayslipData(id, item.id, user.companyId);
      if (!payslipInput) continue;
      const templateData = buildPayslipTemplateData(payslipInput);
      const pdfBuffer = await generatePayslipPDFFromTemplate(templateData);
      const donorPdf = await PDFDocument.load(pdfBuffer);
      const pages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
      for (const page of pages) {
        mergedPdf.addPage(page);
      }
    }

    const outBuffer = Buffer.from(await mergedPdf.save());
    const filename = `payroll-${format(run.periodStart, "yyyy-MM")}.pdf`;
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(outBuffer);
  });

  app.get("/runs/:id/export/excel", { preHandler: exportProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        items: {
          include: { employee: true },
          orderBy: { employee: { lastName: "asc" } },
        },
      },
    });
    if (!run) return reply.code(404).send({ error: "Payroll run not found" });

    const rows: string[][] = [
      ["Employee", "Employee #", "Hours", "OT Hours", "Base Pay", "OT Pay", "Sunday Pay", "PH Pay", "Gross Pay", "Deductions", "Net Pay"],
    ];
    for (const item of run.items) {
      rows.push([
        `${item.employee.firstName} ${item.employee.lastName}`,
        item.employee.employeeNumber ?? "",
        String(item.hoursWorked),
        String(item.overtimeHours),
        String(item.basePay),
        String(item.overtimePay ?? 0),
        String(item.sundayPay ?? 0),
        String(item.publicHolidayPay ?? 0),
        String(item.grossPay),
        String(item.deductions),
        String(item.netPay),
      ]);
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const filename = `payroll-${format(run.periodStart, "yyyy-MM")}.csv`;
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.get("/runs/:id/export/fnb", { preHandler: exportProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;
    const parsedQuery = fnbExportQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Invalid group",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid groupId",
      });
    }
    const groupId = parsedQuery.data.groupId;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        items: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                employeeNumber: true,
                bankAccountNumber: true,
                bankBranchCode: true,
                groupId: true,
              },
            },
          },
          orderBy: { employee: { lastName: "asc" } },
        },
      },
    });
    if (!run) return reply.code(404).send({ error: "Payroll run not found" });
    if (run.status !== "approved" && run.status !== "paid") {
      return reply.code(409).send({
        error: "Bank export unavailable",
        message: "FNB payment files can only be generated for approved or paid payroll runs.",
      });
    }

    if (groupId && groupId !== "ungrouped") {
      const group = await prisma.employeeGroup.findFirst({
        where: { id: groupId, companyId: user.companyId },
        select: { id: true },
      });
      if (!group) {
        return reply.code(404).send({
          error: "Employee group not found",
          message: "The selected employee group does not belong to this company.",
        });
      }
    }

    const items =
      groupId === "ungrouped"
        ? run.items.filter((item) => item.employee.groupId == null)
        : groupId
          ? run.items.filter((item) => item.employee.groupId === groupId)
          : run.items;

    if (items.length === 0) {
      return reply.code(409).send({
        error: "Bank export unavailable",
        message: groupId
          ? "The selected employee group has no payroll items in this run."
          : "This payroll run has no payment items to export.",
      });
    }

    const bankValidation = validateBankDetailsForItems(
      items.map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        netPay: item.netPay,
        employee: item.employee,
      }))
    );

    if (!bankValidation.valid) {
      return reply.code(400).send({
        error: "Bank export validation failed",
        message: "One or more employees are missing required bank details. No employees were skipped.",
        validation: bankValidation,
      });
    }

    const payableItems = items.filter((item) => Number(item.netPay) > 0);
    if (payableItems.length === 0) {
      return reply.code(409).send({
        error: "Bank export unavailable",
        message: "The selected payroll items do not contain any positive net payments.",
      });
    }

    const periodLabel = format(run.periodStart, "yyyy-MM");
    const ownRef = `Payroll ${periodLabel}`.slice(0, 15);

    const rows: string[][] = [
      ["Recipient Name", "Recipient Account", "Account Type", "Branch Code", "Amount", "Own Reference", "Recipient Reference"],
    ];

    for (const item of payableItems) {
      const acc = item.employee.bankAccountNumber?.trim();
      if (!acc) {
        return reply.code(400).send({
          error: "Bank export validation failed",
          message: `${item.employee.firstName} ${item.employee.lastName} is missing a bank account number.`,
        });
      }

      const recipientName = `${item.employee.firstName} ${item.employee.lastName}`.trim();
      const recipientAccount = acc.slice(0, 20);
      const accountType = "1";
      const branchCode = (item.employee.bankBranchCode?.trim() || "632005").slice(0, 6);
      const amount = Number(item.netPay).toFixed(2);
      const recipientRef = (item.employee.employeeNumber || "Salary").slice(0, 20);

      rows.push([recipientName, recipientAccount, accountType, branchCode, amount, ownRef, recipientRef]);
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const filename = `payroll-fnb-${periodLabel}.csv`;
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.get("/emp201-export", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;
    const q = request.query as { period?: string };
    const period = q.period ?? format(new Date(), "yyyy-MM");
    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr ?? "0", 10);
    const month = parseInt(monthStr ?? "0", 10);
    if (!year || !month || month < 1 || month > 12) {
      return reply.code(400).send({
        error: "Invalid period",
        message: "Use period=YYYY-MM (e.g. 2025-03)",
      });
    }

    const data = await buildEmp201Data(user.companyId, year, month);
    if (!data) {
      return reply.code(404).send({ error: "Company not found" });
    }

    const csv = emp201ToCsv(data);
    const filename = `EMP201-${period}.csv`;
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.get("/irp5-export", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;
    const q = request.query as { taxYear?: string };
    const taxYear = parseInt(q.taxYear ?? String(new Date().getFullYear()), 10);
    if (!taxYear || taxYear < 2020 || taxYear > 2030) {
      return reply.code(400).send({
        error: "Invalid tax year",
        message: "Use taxYear=YYYY (e.g. 2025 for 2024/2025 tax year)",
      });
    }

    const data = await buildIrp5DataForTaxYear(user.companyId, taxYear);
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { payeReference: true, sdlReference: true, uifReference: true },
    });

    const csv = irp5ToCsv(
      data,
      company?.payeReference ?? null,
      company?.sdlReference ?? null,
      company?.uifReference ?? null
    );
    const filename = `IRP5-${taxYear}.csv`;
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.get("/employees/:employeeId/deductions", { preHandler: protect }, async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string };
    const user = request.user!;
    if (denyPayrollPrivateData(user, reply)) return;

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId: user.companyId },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });

    const deductions = await prisma.employeeDeduction.findMany({
      where: { employeeId },
      include: { deductionRule: { select: { name: true } } },
      orderBy: { appliesFrom: "desc" },
    });
    return reply.send({ data: deductions });
  });

  app.post("/employees/:employeeId/deductions", { preHandler: protect }, async (request, reply) => {
    if (denyPayrollPrivateData(request.user!, reply)) return;
    const { employeeId } = request.params as { employeeId: string };
    const parsed = employeeDeductionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId: request.user!.companyId },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });

    if (body.deductionRuleId) {
      const rule = await prisma.deductionRule.findFirst({
        where: {
          id: body.deductionRuleId,
          companyId: request.user!.companyId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!rule) {
        return reply.code(400).send({
          error: "Validation error",
          message: { deductionRuleId: ["Deduction rule not found for this company"] },
        });
      }
    }

    const deduction = await prisma.employeeDeduction.create({
      data: {
        employeeId,
        deductionRuleId: body.deductionRuleId ?? null,
        name: body.name,
        type: body.type,
        amount: body.type === "fixed" ? body.amount! : 0,
        rate: body.type === "percentage" ? body.rate! : null,
        appliesFrom: body.appliesFrom ? new Date(body.appliesFrom) : undefined,
        appliesTo: body.appliesTo ? new Date(body.appliesTo) : null,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: request.user!.companyId,
      action: "employee_deduction.create",
      entityType: "employee_deduction",
      entityId: deduction.id,
      metadata: { employeeId },
    });

    return reply.code(201).send(deduction);
  });
}
