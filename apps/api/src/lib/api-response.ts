import type { FastifyReply } from "fastify";

export function ok<T>(reply: FastifyReply, body: T) {
  return reply.send(body);
}

export function created<T>(reply: FastifyReply, body: T) {
  return reply.code(201).send(body);
}

export function badRequest(reply: FastifyReply, message: string, error = "Validation error") {
  return reply.code(400).send({ error, message });
}

export function unauthorized(reply: FastifyReply, message = "Authentication required") {
  return reply.code(401).send({ error: "Unauthorized", message });
}

export function forbidden(reply: FastifyReply, message = "Insufficient permissions") {
  return reply.code(403).send({ error: "Forbidden", message });
}

export function notFound(reply: FastifyReply, message = "Resource not found") {
  return reply.code(404).send({ error: "Not found", message });
}

export function serverError(reply: FastifyReply, message = "An unexpected error occurred") {
  return reply.code(500).send({ error: "Internal server error", message });
}
