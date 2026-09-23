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

const mockEmployee = {
  id: "emp-1",
  companyId: "company-1",
  phone: "27821234567",
  firstName: "John",
  lastName: "Doe",
};

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; companyId: string } }) => {
        if (where.id === "emp-1" && where.companyId === "company-1") {
          return mockEmployee;
        }
        if (where.id === "emp-no-phone" && where.companyId === "company-1") {
          return { ...mockEmployee, id: "emp-no-phone", phone: null };
        }
        return null;
      }),
    },
    whatsAppMessage: {
      create: vi.fn().mockResolvedValue({ id: "msg-1" }),
    },
  },
}));

describe("POST /whatsapp/send-template", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../../app.js");
    app = await buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("normalizes hello_world language code to en_US when sending template", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.template_hello" }] }),
      } as any;
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/whatsapp/send-template",
        payload: {
          employeeId: "emp-1",
          templateName: "hello_world",
          languageCode: "en", // Client defaulted to "en"
        },
      });

      expect(res.statusCode).toBe(200);
      expect(sentBody).toBeDefined();
      expect(sentBody.type).toBe("template");
      expect(sentBody.template.name).toBe("hello_world");
      expect(sentBody.template.language.code).toBe("en_US"); // Normalized to approved en_US
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects employee_roster_update when 4 body parameters are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/send-template",
      payload: {
        employeeId: "emp-1",
        templateName: "employee_roster_update",
        languageCode: "en",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "John Doe" },
              { type: "text", text: "2026-09-25" },
              // Only 2 parameters provided!
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toContain("requires four body parameters");
  });

  it("successfully sends employee_roster_update in en with four body parameters formatted for Meta", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.template_roster" }] }),
      } as any;
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/whatsapp/send-template",
        payload: {
          employeeId: "emp-1",
          templateName: "employee_roster_update",
          languageCode: "en",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: "John Doe" },
                { type: "text", text: "2026-09-25" },
                { type: "text", text: "Main Gate" },
                { type: "text", text: "Supervisor" },
              ],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(sentBody).toBeDefined();
      expect(sentBody.type).toBe("template");
      expect(sentBody.template.name).toBe("employee_roster_update");
      expect(sentBody.template.language.code).toBe("en");
      expect(sentBody.template.components).toEqual([
        {
          type: "body",
          parameters: [
            { type: "text", text: "John Doe" },
            { type: "text", text: "2026-09-25" },
            { type: "text", text: "Main Gate" },
            { type: "text", text: "Supervisor" },
          ],
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("enforces tenant authorization: returns 404 for employee belonging to another company", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/send-template",
      payload: {
        employeeId: "emp-other-company",
        templateName: "hello_world",
        languageCode: "en_US",
      },
    });

    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Employee not found");
  });

  it("returns 400 when employee has no phone number configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/send-template",
      payload: {
        employeeId: "emp-no-phone",
        templateName: "hello_world",
        languageCode: "en_US",
      },
    });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toContain("Employee has no phone number");
  });
});
