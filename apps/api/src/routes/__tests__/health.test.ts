import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db-connectivity.js", () => ({
  verifyDatabaseReadiness: vi.fn(),
}));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { verifyDatabaseReadiness } from "../../lib/db-connectivity.js";

describe("health endpoints", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.mocked(verifyDatabaseReadiness).mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps liveness independent from database readiness", async () => {
    vi.mocked(verifyDatabaseReadiness).mockRejectedValue(new Error("private database detail"));
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("returns ready only for a compatible schema and hides failure details", async () => {
    vi.mocked(verifyDatabaseReadiness).mockResolvedValue();
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready" });

    vi.mocked(verifyDatabaseReadiness).mockRejectedValue(new Error("relation User.accountType missing"));
    const unavailable = await app.inject({ method: "GET", url: "/health/ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("accountType");
    expect(unavailable.json()).toMatchObject({ status: "unavailable" });
  });
});
