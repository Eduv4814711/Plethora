import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const HEADER = "x-request-id";

export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers[HEADER];
    const id =
      typeof incoming === "string" && incoming.trim().length > 0 && incoming.length <= 128
        ? incoming.trim()
        : randomUUID();
    request.requestId = id;
    reply.header(HEADER, id);
  });

  app.addHook("preHandler", async (request) => {
    if (request.requestId) {
      request.log = request.log.child({ requestId: request.requestId });
    }
  });
}

declare module "fastify" {
  interface FastifyRequest {
    requestId?: string;
  }
}
