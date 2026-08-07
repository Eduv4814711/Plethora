import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import {
  bulkSetStaffAttendanceDaySchema,
  setStaffAttendanceDaySchema,
  staffAttendanceDayQuerySchema,
} from "./staff-attendance.schemas.js";
import {
  bulkSetStaffAttendanceDay,
  getStaffAttendanceDay,
  setStaffAttendanceDay,
} from "./staff-attendance.service.js";

/**
 * Office-staff daily attendance.
 *
 * Registered under its own `/staff-attendance` prefix rather than `/attendance/staff`:
 * the attendance routes already own `GET /attendance/:id`, and a sibling static segment
 * under the same prefix is an avoidable routing collision.
 *
 * It reuses the `/attendance` capability module, so no new catalog entry is needed and
 * existing attendance operators keep working without an access change.
 */
export async function staffAttendanceRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireCrudCapability({ module: "/attendance" })];
  const editProtect = [authMiddleware, requireCapability("/attendance", "edit")];

  app.get("/day", { preHandler: protect }, async (request, reply) => {
    const parsed = staffAttendanceDayQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await getStaffAttendanceDay(request.user!.companyId, parsed.data);
    return reply.send(result);
  });

  app.put("/day", { preHandler: editProtect }, async (request, reply) => {
    const parsed = setStaffAttendanceDaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const { date, ...entry } = parsed.data;
    const result = await setStaffAttendanceDay(request.user!.companyId, date, entry, {
      userId: request.user!.sub,
    });
    if ("error" in result) return reply.code(409).send({ error: result.error, code: result.code });
    return reply.send(result);
  });

  app.post("/day/bulk", { preHandler: editProtect }, async (request, reply) => {
    const parsed = bulkSetStaffAttendanceDaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    // Per-entry outcomes: one rejected person must not discard the rest of the roll call.
    const result = await bulkSetStaffAttendanceDay(
      request.user!.companyId,
      parsed.data.date,
      parsed.data.entries,
      { userId: request.user!.sub }
    );
    return reply.send(result);
  });
}
