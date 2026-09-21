import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

const processAndSend = vi.fn().mockResolvedValue(undefined);
const processLocationAndSend = vi.fn().mockResolvedValue(undefined);
const sendUnsupportedTypeReply = vi.fn().mockResolvedValue(undefined);
const findEmployeeByPhone = vi.fn().mockResolvedValue(null);

const recordedEventIds = new Set<string>();

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>();
  return {
    config: {
      ...actual.config,
      whatsapp: {
        ...actual.config.whatsapp,
        enabled: true,
        phoneNumberId: "123456789",
        wabaId: "1234567890",
        verifyToken: "test-verify-token",
        accessToken: "token",
        appSecret: "",
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
    whatsAppWebhookEvent: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { metaEventId: string } }) => {
        if (recordedEventIds.has(data.metaEventId)) {
          const err = new Error("Unique constraint failed");
          (err as unknown as { code: string }).code = "P2002";
          throw err;
        }
        recordedEventIds.add(data.metaEventId);
        return { id: "evt_" + data.metaEventId, ...data };
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  it("verifies subscriptions even while WhatsApp is disabled", async () => {
    const { config } = await import("../../lib/config.js");
    config.whatsapp.enabled = false;
    try {
      const res = await app.inject({
        method: "GET",
        url: "/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("challenge123");
    } finally {
      config.whatsapp.enabled = true;
    }
  });

  it("rejects webhook verification when verify token does not match", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge123",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects webhook verification when verify token is not configured", async () => {
    const { config } = await import("../../lib/config.js");
    const originalToken = config.whatsapp.verifyToken;
    config.whatsapp.verifyToken = "";
    try {
      const res = await app.inject({
        method: "GET",
        url: "/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123",
      });
      expect(res.statusCode).toBe(403);
    } finally {
      config.whatsapp.verifyToken = originalToken;
    }
  });

  it("acknowledges but does not process webhooks while WhatsApp is disabled", async () => {
    const { config } = await import("../../lib/config.js");
    config.whatsapp.enabled = false;
    config.whatsapp.appSecret = "stale-app-secret";
    processAndSend.mockClear();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/webhook",
        payload: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: "27821234567",
                        id: "wamid.disabled",
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
      expect(processAndSend).not.toHaveBeenCalled();
    } finally {
      config.whatsapp.enabled = true;
      config.whatsapp.appSecret = "";
    }
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
                      id: "wamid.test_unique_1",
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

  it("enforces idempotency: ignores duplicate message deliveries without reprocessing", async () => {
    processAndSend.mockClear();

    const payload = {
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
                    id: "wamid.dedupe_test",
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "clock in" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    // First delivery
    const res1 = await app.inject({
      method: "POST",
      url: "/webhook",
      payload,
    });
    expect(res1.statusCode).toBe(200);
    expect(processAndSend).toHaveBeenCalledTimes(1);
    expect(processAndSend).toHaveBeenCalledWith("27821234567", "clock in");

    // Second duplicate delivery with same message ID
    const res2 = await app.inject({
      method: "POST",
      url: "/webhook",
      payload,
    });
    expect(res2.statusCode).toBe(200);
    // Must NOT call processAndSend again
    expect(processAndSend).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent duplicate webhook deliveries safely", async () => {
    processAndSend.mockClear();

    const payload = {
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
                    id: "wamid.concurrent_test",
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "clock out" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    // Dispatch two concurrent deliveries
    const [res1, res2] = await Promise.all([
      app.inject({ method: "POST", url: "/webhook", payload }),
      app.inject({ method: "POST", url: "/webhook", payload }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(processAndSend).toHaveBeenCalledTimes(1);
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
                      id: "wamid.image_unsupported",
                      timestamp: "1710000000",
                      type: "contacts",
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

  it("rejects POST when app secret is set and signature is invalid", async () => {
    const { config } = await import("../../lib/config.js");
    config.whatsapp.appSecret = "test-app-secret";
    try {
      const payload = {
        object: "whatsapp_business_account",
        entry: [],
      };
      const res = await app.inject({
        method: "POST",
        url: "/webhook",
        headers: {
          "x-hub-signature-256": "sha256=deadbeef",
        },
        payload,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      config.whatsapp.appSecret = "";
    }
  });

  it("accepts POST when signature matches app secret", async () => {
    const { config } = await import("../../lib/config.js");
    config.whatsapp.appSecret = "test-app-secret";
    try {
      processAndSend.mockClear();
      const payload = {
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
                      id: "wamid.signed_unique",
                      timestamp: "1710000000",
                      type: "text",
                      text: { body: "clock in" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", "test-app-secret").update(raw, "utf8").digest("hex")}`;
      const res = await app.inject({
        method: "POST",
        url: "/webhook",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        payload: raw,
      });
      expect(res.statusCode).toBe(200);
      expect(processAndSend).toHaveBeenCalledWith("27821234567", "clock in");
    } finally {
      config.whatsapp.appSecret = "";
    }
  });
});
