import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db-connectivity.js", () => ({
  verifyDatabaseReadiness: vi.fn(),
}));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

describe("JSON content-type parser handling empty body", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("handles POST request with application/json and empty body gracefully without FST_ERR_CTP_EMPTY_JSON_BODY", async () => {
    // Register a test route that returns request.body
    app.post("/test-empty-json", async (request) => {
      return { received: request.body };
    });

    const response = await app.inject({
      method: "POST",
      url: "/test-empty-json",
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: {} });
  });

  it("handles POST request with application/json; charset=utf-8 and empty body", async () => {
    app.post("/test-charset-empty", async (request) => {
      return { received: request.body };
    });

    const response = await app.inject({
      method: "POST",
      url: "/test-charset-empty",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: {} });
  });

  it("still parses valid JSON correctly", async () => {
    app.post("/test-valid-json", async (request) => {
      return { received: request.body };
    });

    const response = await app.inject({
      method: "POST",
      url: "/test-valid-json",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({ key: "value" }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: { key: "value" } });
  });

  it("returns 400 for malformed JSON syntax", async () => {
    app.post("/test-invalid-json", async (request) => {
      return { received: request.body };
    });

    const response = await app.inject({
      method: "POST",
      url: "/test-invalid-json",
      headers: {
        "content-type": "application/json",
      },
      payload: "invalid-json-string{",
    });

    expect(response.statusCode).toBe(400);
  });
});
