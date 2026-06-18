import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import {
  getCurrentPayPeriod,
  listPayPeriods,
  resolvePayPeriodByKey,
  serializePayPeriod,
  startOfUtcDay,
} from "../services/payroll-period.service.js";

export async function payPeriodsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      anyOfModules: ["/payroll", "/rostering", "/attendance", "/reports", "/settings"],
    }),
  ];

  async function loadCalendar(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    return parsePayrollCalendarSettings(company?.settings);
  }

  app.get("/current", { preHandler: protect }, async (request, reply) => {
    const calendar = await loadCalendar(request.user!.companyId);
    const current = getCurrentPayPeriod(calendar);
    return reply.send(serializePayPeriod(current, true));
  });

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const q = request.query as {
      around?: string;
      before?: string;
      after?: string;
      periodKey?: string;
    };
    const calendar = await loadCalendar(request.user!.companyId);

    if (q.periodKey) {
      const resolved = resolvePayPeriodByKey(calendar, q.periodKey);
      if (!resolved) {
        return reply.code(404).send({ error: "Pay period not found" });
      }
      const current = getCurrentPayPeriod(calendar);
      return reply.send({ data: [serializePayPeriod(resolved, resolved.periodKey === current.periodKey)] });
    }

    const aroundDate = q.around ? startOfUtcDay(new Date(q.around)) : undefined;
    const before = q.before ? parseInt(q.before, 10) : undefined;
    const after = q.after ? parseInt(q.after, 10) : undefined;
    const current = getCurrentPayPeriod(calendar, aroundDate);
    const periods = listPayPeriods(calendar, { aroundDate, before, after });

    return reply.send({
      data: periods.map((p) => serializePayPeriod(p, p.periodKey === current.periodKey)),
    });
  });
}
