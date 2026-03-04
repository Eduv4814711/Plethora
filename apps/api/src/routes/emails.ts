import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail, fetchInboxEmails } from "../services/email.service.js";

const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  body: z.string(),
});

export async function emailsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll"])];

  app.get("/inbox", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);

    try {
      const emails = await fetchInboxEmails(user.companyId, limit);
      return reply.send({ data: emails });
    } catch (err) {
      request.log.error(err, "Inbox fetch failed");
      return reply.code(500).send({
        error: "Inbox fetch failed",
        message: err instanceof Error ? err.message : "Could not fetch inbox. Check IMAP settings in Settings > Email.",
      });
    }
  });

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const [emails, total] = await Promise.all([
      prisma.emailLog.findMany({
        where: { companyId: user.companyId },
        orderBy: { sentAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          sentBy: { select: { name: true } },
        },
      }),
      prisma.emailLog.count({ where: { companyId: user.companyId } }),
    ]);

    return reply.send({ data: emails, total, limit, offset });
  });

  app.post("/send", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const parsed = sendEmailSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const { to, subject, body } = parsed.data;
    const toList = Array.isArray(to) ? to : [to];
    const toStr = toList.join(", ");

    const ok = await sendEmail(user.companyId, {
      to: toList,
      subject,
      body,
    });

    await prisma.emailLog.create({
      data: {
        companyId: user.companyId,
        sentById: user.sub,
        to: toStr,
        subject,
        body,
        status: ok ? "sent" : "failed",
      },
    });

    if (!ok) {
      return reply.code(500).send({
        error: "Send failed",
        message: "Could not send email. Check your SMTP configuration in Settings > Email.",
      });
    }

    return reply.send({ success: true, message: "Email sent" });
  });
}
