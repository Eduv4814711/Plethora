import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>();
  return {
    config: {
      ...actual.config,
      whatsapp: {
        enabled: true,
        phoneNumberId: "phone-123",
        wabaId: "waba-456",
        accessToken: "super-secret-access-token",
        verifyToken: "super-secret-verify-token",
        appSecret: "super-secret-app-secret",
        apiVersion: "v26.0",
      },
    },
  };
});

// Mock authMiddleware to pass through with a test user having whatsapp capability
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: async (request: any) => {
    request.user = {
      sub: "user-1",
      companyId: "company-1",
      capabilities: [{ module: "/whatsapp", create: true, read: true, update: true, delete: true }],
    };
  },
}));

vi.mock("../../middleware/authorization.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middleware/authorization.js")>();
  return {
    ...actual,
    requireCrudCapability: () => async () => {},
    requireCapability: () => async () => {},
    requireAnyCapability: () => async () => {},
  };
});

describe("WhatsApp Health, WABA Subscription & Templates Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../../app.js");
    app = await buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe("GET /whatsapp/health", () => {
    it("returns safe configuration health status without leaking secrets", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/whatsapp/health",
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);

      expect(data.enabled).toBe(true);
      expect(data.configured).toBe(true);
      expect(data.phoneNumberConfigured).toBe(true);
      expect(data.wabaConfigured).toBe(true);
      expect(data.accessTokenConfigured).toBe(true);
      expect(data.appSecretConfigured).toBe(true);
      expect(data.verifyTokenConfigured).toBe(true);
      expect(data.apiVersion).toBe("v26.0");

      // Critical Security Check: Ensure NO secrets are returned in the response
      expect(res.body).not.toContain("super-secret-access-token");
      expect(res.body).not.toContain("super-secret-verify-token");
      expect(res.body).not.toContain("super-secret-app-secret");
    });
  });

  describe("GET /whatsapp/templates", () => {
    it("returns approved templates from Meta when available", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { name: "shift_alert", language: "en_US", status: "APPROVED" },
            { name: "pending_template", language: "en_US", status: "PENDING" },
            { name: "rejected_template", language: "en_US", status: "REJECTED" },
          ],
        }),
      } as any);

      try {
        const res = await app.inject({
          method: "GET",
          url: "/whatsapp/templates",
        });

        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json.data).toEqual([
          { name: "shift_alert", language: "en_US", status: "APPROVED" },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("falls back to default templates on Meta API failure without crashing or leaking secrets", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Meta network timeout"));

      try {
        const res = await app.inject({
          method: "GET",
          url: "/whatsapp/templates",
        });

        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json.data).toEqual([
          { name: "hello_world", language: "en", status: "APPROVED" },
        ]);
        expect(res.body).not.toContain("super-secret-access-token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("WABA Subscription Routes", () => {
    it("POST /whatsapp/subscription calls Meta subscribed_apps endpoint", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      } as any);

      try {
        const res = await app.inject({
          method: "POST",
          url: "/whatsapp/subscription",
        });

        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json.success).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "https://graph.facebook.com/v26.0/waba-456/subscribed_apps",
          expect.objectContaining({
            method: "POST",
            headers: {
              Authorization: "Bearer super-secret-access-token",
            },
          })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("GET /whatsapp/subscription returns currently subscribed apps", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ data: [{ whatsapp_business_api_data: { id: "app-123" } }] }),
      } as any);

      try {
        const res = await app.inject({
          method: "GET",
          url: "/whatsapp/subscription",
        });

        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json.success).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
