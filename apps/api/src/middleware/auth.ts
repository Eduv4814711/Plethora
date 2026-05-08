import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import type { JWTPayload } from "../lib/types.js";
import { config } from "../lib/config.js";

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    reply.code(401).send({ error: "Unauthorized", message: "Missing or invalid token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as JWTPayload;
    request.user = decoded;
  } catch {
    return reply
      .code(401)
      .send({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}
