import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

const processAndSend = vi.fn().mockResolvedValue(undefined);
const processLocationAndSend = vi.fn().mockResolvedValue(undefined);
const sendUnsupportedTypeReply = vi.fn().mockResolvedValue(undefined);
const findEmployeeByPhone = vi.fn().mockResolvedValue(null);

interface MockWebhookEvent {
  id: string;
  metaEventId: string;
  eventType: string;
  phoneNumberId?: string | null;
  payload?: unknown;
  status: "PROCESSING" | "PROCESSED" | "FAILED";
  errorMessage?: string | null;
  receivedAt: Date;
  processedAt?: Date | null;
}

const webhookEvents = new Map<string, MockWebhookEvent>();

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
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    whatsAppWebhookEvent: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { metaEventId: string; eventType: string; phoneNumberId?: string; payload?: unknown; status?: string } }) => {
        if (webhookEvents.has(data.metaEventId)) {
          const err = new Error("Unique constraint failed");
          (err as unknown as { code: string }).code = "P2002";
          throw err;
        }
        const record: MockWebhookEvent = {
          id: "evt_" + data.metaEventId,
          metaEventId: data.metaEventId,
          eventType: data.eventType,
          phoneNumberId: data.phoneNumberId ?? null,
          payload: data.payload,
          status: (data.status as "PROCESSING" | "PROCESSED" | "FAILED") ?? "PROCESSING",
          errorMessage: null,
          receivedAt: new Date(),
          processedAt: null,
        };
        webhookEvents.set(data.metaEventId, record);
        return record;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { metaEventId: string } }) => {
        return webhookEvents.get(where.metaEventId) ?? null;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: { where: { metaEventId: string; status?: string }; data: any }) => {
        const record = webhookEvents.get(where.metaEventId);
        if (!record) return { count: 0 };
        if (where.status && record.status !== where.status) return { count: 0 };
        if (data.status) record.status = data.status;
        if (data.errorMessage !== undefined) record.errorMessage = data.errorMessage;
        if (data.processedAt) record.processedAt = data.processedAt;
        if (data.payload !== undefined) record.payload = data.payload;
        return { count: 1 };
      }),
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

  it("asks Meta to retry a duplicate while the first delivery is still processing", async () => {
    processAndSend.mockReset();
    processAndSend.mockResolvedValue(undefined);
    let finishProcessing!: () => void;
    processAndSend.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishProcessing = resolve; })
    );

    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "123456789" },
        messages: [{
          from: "27821234567",
          id: "wamid.in_flight",
          timestamp: "1710000000",
          type: "text",
          text: { body: "help" },
        }],
      } }] }],
    };

    const first = app.inject({ method: "POST", url: "/webhook", payload });
    await vi.waitFor(() => expect(processAndSend).toHaveBeenCalledTimes(1));

    const concurrent = await app.inject({ method: "POST", url: "/webhook", payload });
    expect(concurrent.statusCode).toBe(503);
    expect(processAndSend).toHaveBeenCalledTimes(1);

    finishProcessing();
    expect((await first).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/webhook", payload })).statusCode).toBe(200);
    expect(processAndSend).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a completed action whose event status could not be stored", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    processAndSend.mockReset();
    processAndSend.mockResolvedValue(undefined);
    vi.mocked(prisma.whatsAppWebhookEvent.updateMany).mockRejectedValueOnce(new Error("DB unavailable"));

    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "123456789" },
        messages: [{
          from: "27821234567",
          id: "wamid.completion_unstored",
          timestamp: "1710000000",
          type: "text",
          text: { body: "help" },
        }],
      } }] }],
    };

    const first = await app.inject({ method: "POST", url: "/webhook", payload });
    expect(first.statusCode).toBe(503);
    expect(webhookEvents.get("wamid.completion_unstored")?.status).toBe("PROCESSING");
    expect(processAndSend).toHaveBeenCalledTimes(1);

    const retry = await app.inject({ method: "POST", url: "/webhook", payload });
    expect(retry.statusCode).toBe(503);
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

  describe("Failed inbound webhook processing and retry path", () => {
    it("marks event as FAILED and returns 500 when handler fails", async () => {
      processAndSend.mockReset();
      processAndSend.mockRejectedValueOnce(new Error("Database connection timeout"));

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
                      id: "wamid.fail_event_1",
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

      const res = await app.inject({
        method: "POST",
        url: "/webhook",
        payload,
      });

      expect(res.statusCode).toBe(500);
      expect(processAndSend).toHaveBeenCalledTimes(1);

      const event = webhookEvents.get("wamid.fail_event_1");
      expect(event).toBeDefined();
      expect(event?.status).toBe("FAILED");
      expect(event?.errorMessage).toContain("Database connection timeout");
    });

    it("allows a failed event to be retried on redelivery and successfully complete", async () => {
      processAndSend.mockReset();
      // First attempt fails
      processAndSend.mockRejectedValueOnce(new Error("Transient downstream error"));

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
                      id: "wamid.retry_success_test",
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

      // 1. Initial attempt fails
      const res1 = await app.inject({ method: "POST", url: "/webhook", payload });
      expect(res1.statusCode).toBe(500);
      expect(processAndSend).toHaveBeenCalledTimes(1);
      expect(webhookEvents.get("wamid.retry_success_test")?.status).toBe("FAILED");

      // 2. Redelivery succeeds
      processAndSend.mockResolvedValueOnce(undefined);
      const res2 = await app.inject({ method: "POST", url: "/webhook", payload });
      expect(res2.statusCode).toBe(200);
      expect(processAndSend).toHaveBeenCalledTimes(2); // Retried!
      expect(webhookEvents.get("wamid.retry_success_test")?.status).toBe("PROCESSED");
    });

    it("proves that a successfully processed event cannot run twice", async () => {
      // Continuation of wamid.retry_success_test which is already PROCESSED:
      // Send a third delivery of the same message:
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
                      id: "wamid.retry_success_test",
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

      const countBefore = processAndSend.mock.calls.length;
      const res3 = await app.inject({ method: "POST", url: "/webhook", payload });
      expect(res3.statusCode).toBe(200);
      // Handler MUST NOT be called again
      expect(processAndSend).toHaveBeenCalledTimes(countBefore);
    });

    it("handles partial failures when one webhook request contains multiple messages", async () => {
      processAndSend.mockReset();
      processAndSend.mockImplementation(async (from: string, text: string) => {
        if (text === "clock out") {
          throw new Error("Attendance service unavailable");
        }
      });

      const multiPayload = {
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
                      id: "wamid.multi_msg_success",
                      timestamp: "1710000000",
                      type: "text",
                      text: { body: "clock in" },
                    },
                    {
                      from: "27821234567",
                      id: "wamid.multi_msg_fail",
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

      // Initial batch delivery: 1 succeeds, 1 fails -> HTTP 500 returned so Meta redelivers
      const res1 = await app.inject({ method: "POST", url: "/webhook", payload: multiPayload });
      expect(res1.statusCode).toBe(500);

      expect(webhookEvents.get("wamid.multi_msg_success")?.status).toBe("PROCESSED");
      expect(webhookEvents.get("wamid.multi_msg_fail")?.status).toBe("FAILED");

      // Now service recovers and handles clock out
      processAndSend.mockReset();
      processAndSend.mockResolvedValue(undefined);

      // Redelivery arrives containing BOTH messages
      const res2 = await app.inject({ method: "POST", url: "/webhook", payload: multiPayload });
      expect(res2.statusCode).toBe(200);

      // Only the failed message was retried! The succeeded message was NOT run twice!
      expect(processAndSend).toHaveBeenCalledTimes(1);
      expect(processAndSend).toHaveBeenCalledWith("27821234567", "clock out");
      expect(webhookEvents.get("wamid.multi_msg_fail")?.status).toBe("PROCESSED");
    });

    it("handles concurrent duplicate deliveries of a failed event safely", async () => {
      processAndSend.mockReset();
      // Initially fail the message
      processAndSend.mockRejectedValueOnce(new Error("Initial failure"));

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
                      id: "wamid.concurrent_failed",
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

      await app.inject({ method: "POST", url: "/webhook", payload });
      expect(webhookEvents.get("wamid.concurrent_failed")?.status).toBe("FAILED");

      // Now simulate 2 concurrent redeliveries arriving at once
      processAndSend.mockReset();
      processAndSend.mockResolvedValue(undefined);

      const [resA, resB] = await Promise.all([
        app.inject({ method: "POST", url: "/webhook", payload }),
        app.inject({ method: "POST", url: "/webhook", payload }),
      ]);

      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      // Exactly one execution occurred across both concurrent redeliveries
      expect(processAndSend).toHaveBeenCalledTimes(1);
    });

    it("retryFailedWebhookEvent programmatically retries failed events but rejects processed events", async () => {
      const { retryFailedWebhookEvent } = await import("../services/webhook-event.service.js");

      // 1. Trying to retry a PROCESSED event
      const handlerMock = vi.fn().mockResolvedValue(undefined);
      const resProcessed = await retryFailedWebhookEvent("wamid.multi_msg_success", handlerMock);
      expect(resProcessed.success).toBe(false);
      expect(resProcessed.status).toBe("PROCESSED");
      expect(resProcessed.error).toContain("cannot run twice");
      expect(handlerMock).not.toHaveBeenCalled();

      // 2. Retrying a FAILED event
      webhookEvents.set("wamid.prog_failed", {
        id: "evt_prog_failed",
        metaEventId: "wamid.prog_failed",
        eventType: "message:text",
        payload: { from: "27821234567", text: { body: "clock in" } },
        status: "FAILED",
        errorMessage: "Old error",
        receivedAt: new Date(),
        processedAt: null,
      });

      const resFailed = await retryFailedWebhookEvent("wamid.prog_failed", handlerMock);
      expect(resFailed.success).toBe(true);
      expect(resFailed.status).toBe("PROCESSED");
      expect(handlerMock).toHaveBeenCalledTimes(1);
      expect(webhookEvents.get("wamid.prog_failed")?.status).toBe("PROCESSED");
    });

    it("does not claim a programmatic retry succeeded when completion storage fails", async () => {
      const { prisma } = await import("../../lib/prisma.js");
      const { retryFailedWebhookEvent } = await import("../services/webhook-event.service.js");
      webhookEvents.set("wamid.prog_completion_unstored", {
        id: "evt_prog_completion_unstored",
        metaEventId: "wamid.prog_completion_unstored",
        eventType: "message:text",
        payload: { from: "27821234567", text: { body: "help" } },
        status: "FAILED",
        receivedAt: new Date(),
      });
      const handler = vi.fn().mockResolvedValue(undefined);
      vi.mocked(prisma.whatsAppWebhookEvent.updateMany)
        .mockImplementationOnce(async ({ where, data }: any) => {
          const event = webhookEvents.get(where.metaEventId)!;
          event.status = data.status;
          return { count: 1 };
        })
        .mockRejectedValueOnce(new Error("DB unavailable"));

      const result = await retryFailedWebhookEvent("wamid.prog_completion_unstored", handler);
      expect(result).toMatchObject({ success: false, status: "PROCESSING" });
      expect(webhookEvents.get("wamid.prog_completion_unstored")?.status).toBe("PROCESSING");
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
