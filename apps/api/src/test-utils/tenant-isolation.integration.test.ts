import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTenantFixture,
  type TenantFixture,
} from "./tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("tenant isolation (integration)", () => {
  let app: FastifyInstance;
  let fx: TenantFixture;
  let employeeWriterToken: string;

  beforeAll(async () => {
    app = await buildApp();
    fx = await provisionTenantFixture();
    employeeWriterToken = fx.tenantA.accessToken;
  }, 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await app?.close();
  }, 30_000);

  describe("employees", () => {
    it("reads own employee", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/employees/${fx.tenantA.employeeId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fx.tenantA.employeeId);
    });

    it("does not read other tenant employee", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/employees/${fx.tenantB.employeeId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not update other tenant employee", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/employees/${fx.tenantB.employeeId}`,
        // Pass the private-data permission gate so this assertion exercises
        // tenant scoping rather than stopping at authorization.
        headers: { ...authHeader(employeeWriterToken), "content-type": "application/json" },
        payload: { firstName: "CrossTenant" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not delete other tenant employee", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/employees/${fx.tenantB.employeeId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("sites", () => {
    it("reads own site", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/sites/${fx.tenantA.siteId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fx.tenantA.siteId);
    });

    it("does not read other tenant site", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/sites/${fx.tenantB.siteId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not update other tenant site", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/sites/${fx.tenantB.siteId}`,
        headers: { ...authHeader(fx.tenantA.accessToken), "content-type": "application/json" },
        payload: { name: "Hijacked Site" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not delete other tenant site", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/sites/${fx.tenantB.siteId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("shifts", () => {
    it("reads own shift", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/shifts/${fx.tenantA.shiftId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fx.tenantA.shiftId);
    });

    it("does not read other tenant shift", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/shifts/${fx.tenantB.shiftId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not update other tenant shift", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/shifts/${fx.tenantB.shiftId}`,
        headers: { ...authHeader(fx.tenantA.accessToken), "content-type": "application/json" },
        payload: { startTime: "2026-09-01T06:00:00.000Z" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not delete other tenant shift", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/shifts/${fx.tenantB.shiftId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("attendance", () => {
    it("reads own attendance", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/attendance/${fx.tenantA.attendanceId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fx.tenantA.attendanceId);
    });

    it("does not read other tenant attendance", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/attendance/${fx.tenantB.attendanceId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not update other tenant attendance", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/attendance/${fx.tenantB.attendanceId}`,
        headers: { ...authHeader(fx.tenantA.accessToken), "content-type": "application/json" },
        payload: { clockIn: "2026-08-02T08:00:00.000Z" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("payroll exports", () => {
    it("reads own payroll export batch", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/payroll-exports/batches/${fx.tenantA.exportBatchId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fx.tenantA.exportBatchId);
    });

    it("does not read other tenant payroll export batch", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/payroll-exports/batches/${fx.tenantB.exportBatchId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not lock other tenant payroll export batch", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/payroll-exports/batches/${fx.tenantB.exportBatchId}/lock`,
        headers: authHeader(fx.tenantA.accessToken),
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("payroll export profiles", () => {
    it("does not update other tenant payroll export profile", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/payroll-exports/profiles/${fx.tenantB.exportProfileId}`,
        headers: { ...authHeader(fx.tenantA.accessToken), "content-type": "application/json" },
        payload: { name: "Stolen profile" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("does not delete other tenant payroll export profile", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/payroll-exports/profiles/${fx.tenantB.exportProfileId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("WhatsApp messages", () => {
    it("reads messages for own employee", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/whatsapp/messages?employeeId=${fx.tenantA.employeeId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { id: string }[] };
      expect(body.data.some((m) => m.id === fx.tenantA.whatsAppMessageId)).toBe(true);
    });

    it("does not read messages for other tenant employee", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/whatsapp/messages?employeeId=${fx.tenantB.employeeId}`,
        headers: authHeader(fx.tenantA.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
