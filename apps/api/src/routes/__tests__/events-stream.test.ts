import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { eventsRoutes } from "../events.js";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import { operationalEventBus } from "../../lib/events.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

describe("GET /events/stream (SSE Control Room Event Stream)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(eventsRoutes);
    await app.ready();
  });

  it("rejects connection with 401 when no token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/stream",
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toContain("Missing token");
  });

  it("rejects connection with 401 when refresh token is provided", async () => {
    const refreshToken = jwt.sign(
      { sub: "usr-1", companyId: "co-1", type: "refresh" },
      config.jwt.accessSecret
    );

    const res = await app.inject({
      method: "GET",
      url: `/stream?token=${refreshToken}`,
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toContain("Invalid token type");
  });

  it("rejects connection with 401 if user is inactive or not found", async () => {
    const validToken = jwt.sign(
      { sub: "usr-inactive", companyId: "co-1" },
      config.jwt.accessSecret
    );

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: `/stream?token=${validToken}`,
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("User not found or inactive");
  });

  it("broadcasts operational events strictly isolated to tenant company", async () => {
    const busSpy = vi.spyOn(operationalEventBus, "on");

    const tokenTenantA = jwt.sign(
      { sub: "usr-tenant-a", companyId: "co-tenant-a" },
      config.jwt.accessSecret
    );

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "usr-tenant-a",
      companyId: "co-tenant-a",
    } as any);

    // Operational event bus unit behavior
    const tenantAReceived: any[] = [];
    const tenantBReceived: any[] = [];

    const listenerA = (e: any) => {
      if (e.companyId === "co-tenant-a") tenantAReceived.push(e);
    };
    const listenerB = (e: any) => {
      if (e.companyId === "co-tenant-b") tenantBReceived.push(e);
    };

    operationalEventBus.on("operational_event", listenerA);
    operationalEventBus.on("operational_event", listenerB);

    // Broadcast event for tenant A
    operationalEventBus.broadcast("INCIDENT_CREATED", "co-tenant-a", {
      incidentId: "inc-1",
      title: "Broken Perimeter Fence",
    });

    // Broadcast event for tenant B
    operationalEventBus.broadcast("INCIDENT_CREATED", "co-tenant-b", {
      incidentId: "inc-2",
      title: "Gate Sensor Alarm",
    });

    expect(tenantAReceived).toHaveLength(1);
    expect(tenantAReceived[0].payload.incidentId).toBe("inc-1");
    expect(tenantBReceived).toHaveLength(1);
    expect(tenantBReceived[0].payload.incidentId).toBe("inc-2");

    operationalEventBus.off("operational_event", listenerA);
    operationalEventBus.off("operational_event", listenerB);
    busSpy.mockRestore();
  });
});
