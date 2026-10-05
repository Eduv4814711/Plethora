import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { operationalEventBus, type OperationalEvent } from "../lib/events.js";
import type { AccessTokenPayload } from "../lib/types.js";

interface EventsQuery {
  token?: string;
}

export async function eventsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: EventsQuery }>(
    "/stream",
    async (request: FastifyRequest<{ Querystring: EventsQuery }>, reply: FastifyReply) => {
      // 1. Resolve token from Authorization header or query param or cookie
      const authHeader = request.headers.authorization;
      const headerToken = authHeader?.replace(/^Bearer\s+/i, "");
      const queryToken = request.query?.token;
      const cookieToken = request.cookies?.accessToken;
      const token = headerToken || queryToken || cookieToken;

      if (!token) {
        return reply.code(401).send({ error: "Unauthorized", message: "Missing token for SSE stream" });
      }

      let companyId: string;
      let userId: string;

      try {
        const decoded = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload & { type?: string };
        if (decoded.type === "refresh") {
          return reply.code(401).send({ error: "Unauthorized", message: "Invalid token type" });
        }
        const user = await prisma.user.findFirst({
          where: { id: decoded.sub, companyId: decoded.companyId, isActive: true },
          select: { id: true, companyId: true },
        });
        if (!user) {
          return reply.code(401).send({ error: "Unauthorized", message: "User not found or inactive" });
        }
        companyId = user.companyId;
        userId = user.id;
      } catch (err) {
        return reply.code(401).send({ error: "Unauthorized", message: "Invalid or expired token" });
      }

      // 2. Set SSE HTTP Headers on raw response
      const rawRes = reply.raw;
      rawRes.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering if proxied
        "Access-Control-Allow-Origin": request.headers.origin || "*",
        "Access-Control-Allow-Credentials": "true",
      });

      // 3. Send initial connected comment
      rawRes.write(`: connected (user:${userId})\n\n`);

      // 4. Heartbeat interval to prevent client/proxy timeouts
      const heartbeatTimer = setInterval(() => {
        if (!rawRes.writableEnded) {
          rawRes.write(`: ping ${Date.now()}\n\n`);
        }
      }, 25_000);

      // 5. Listener for operational events scoped by companyId
      const onEvent = (event: OperationalEvent) => {
        if (event.companyId === companyId && !rawRes.writableEnded) {
          rawRes.write(`event: ${event.type}\n`);
          rawRes.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      operationalEventBus.on("operational_event", onEvent);

      // 6. Cleanup on client disconnect
      request.raw.on("close", () => {
        clearInterval(heartbeatTimer);
        operationalEventBus.off("operational_event", onEvent);
      });
    }
  );
}
