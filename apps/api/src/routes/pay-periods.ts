import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import {
  getCurrentPayPeriod,
  getCurrentRosterPeriod,
  listPayPeriods,
  listRosterPeriods,
  resolvePayPeriodByKey,
  resolveRosterPeriodByKey,
  serializePayPeriod,
  serializeRosterCalendars,
  startOfUtcDay,
} from "../services/payroll-period.service.js";

export async function payPeriodsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
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
    const q = request.query as { calendarId?: string };
    const calendar = await loadCalendar(request.user!.companyId);
    if (q.calendarId) {
      const current = getCurrentRosterPeriod(calendar, q.calendarId);
      return reply.send(serializePayPeriod(current, true));
    }
    const current = getCurrentPayPeriod(calendar);
    return reply.send(serializePayPeriod(current, true));
  });

  app.get("/roster-calendars", { preHandler: protect }, async (request, reply) => {
    const calendar = await loadCalendar(request.user!.companyId);
    return reply.send(serializeRosterCalendars(calendar));
  });

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const q = request.query as {
      around?: string;
      before?: string;
      after?: string;
      periodKey?: string;
      calendarId?: string;
    };
    const calendar = await loadCalendar(request.user!.companyId);

    if (q.periodKey) {
      const resolved = q.calendarId
        ? resolveRosterPeriodByKey(calendar, q.calendarId, q.periodKey)
        : resolvePayPeriodByKey(calendar, q.periodKey);
      if (!resolved) {
        return reply.code(404).send({ error: "Pay period not found" });
      }
      const current = q.calendarId
        ? getCurrentRosterPeriod(calendar, q.calendarId)
        : getCurrentPayPeriod(calendar);
      return reply.send({ data: [serializePayPeriod(resolved, resolved.periodKey === current.periodKey)] });
    }

    const aroundDate = q.around ? startOfUtcDay(new Date(q.around)) : undefined;
    const before = q.before ? parseInt(q.before, 10) : undefined;
    const after = q.after ? parseInt(q.after, 10) : undefined;
    const current = q.calendarId
      ? getCurrentRosterPeriod(calendar, q.calendarId, aroundDate)
      : getCurrentPayPeriod(calendar, aroundDate);
    const periods = q.calendarId
      ? listRosterPeriods(calendar, q.calendarId, { aroundDate, before, after })
      : listPayPeriods(calendar, { aroundDate, before, after });

    return reply.send({
      data: periods.map((p) => serializePayPeriod(p, p.periodKey === current.periodKey)),
    });
  });
}
