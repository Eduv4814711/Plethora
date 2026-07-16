import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const processAndSend = vi.fn().mockResolvedValue(undefined);
const processLocationAndSend = vi.fn().mockResolvedValue(undefined);
const sendUnsupportedTypeReply = vi.fn().mockResolvedValue(undefined);
const findEmployeeByPhone = vi.fn().mockResolvedValue(null);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>();
  return {
    config: {
      ...actual.config,
      whatsapp: {
        ...actual.config.whatsapp,
        enabled: true,
        phoneNumberId: "123456789",
        verifyToken: "test-verify-token",
        accessToken: "token",
      },
    },
  };
});

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    whatsAppMessage: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("../services/handler.service.js", () => ({
  processAndSend,
  processLocationAndSend,
  sendUnsupportedTypeReply,
  findEmployeeByPhone,
}));

describe("WhatsApp webhook", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../../app.js");
    app = await buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("verifies webhook subscription with matching token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("challenge123");
  });

  it("processes inbound text messages before returning 200", async () => {
    processAndSend.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      payload: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: "123456789" },
                  messages: [
                    {
                      from: "27821234567",
                      id: "wamid.test",
                      timestamp: "1710000000",
                      type: "text",
                      text: { body: "help" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(processAndSend).toHaveBeenCalledWith("27821234567", "help");
  });

  it("replies to unsupported message types", async () => {
    sendUnsupportedTypeReply.mockClear();
    processAndSend.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      payload: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: "123456789" },
                  messages: [
                    {
                      from: "27821234567",
                      id: "wamid.image",
                      timestamp: "1710000000",
                      type: "image",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sendUnsupportedTypeReply).toHaveBeenCalledWith("27821234567");
    expect(processAndSend).not.toHaveBeenCalled();
  });
});
