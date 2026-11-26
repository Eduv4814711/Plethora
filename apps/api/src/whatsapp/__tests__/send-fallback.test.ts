import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config.js", () => ({
  config: {
    whatsapp: {
      enabled: true,
      phoneNumberId: "phone-123",
      wabaId: "waba-456",
      accessToken: "test-token",
      verifyToken: "test-verify-token",
      appSecret: "test-app-secret",
      apiVersion: "v26.0",
    },
  },
}));

import { sendTextWithTemplateFallback, templateBodyParameters } from "../services/send.service.js";

describe("sendTextWithTemplateFallback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("keeps the rich text message when the customer-service window is open", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.text" }] }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await sendTextWithTemplateFallback("27821234567", "Control room update", {
      name: "plethora_notification",
      components: templateBodyParameters(["Control room", "Update"]),
    });

    expect(result).toEqual({ success: true, messageId: "wamid.text" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe("text");
  });

  it("sends the approved template when Meta reports a closed customer-service window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.template" }] }),
      });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await sendTextWithTemplateFallback("27821234567", "Control room update", {
      name: "plethora_notification",
      components: templateBodyParameters(["Control room", "Update"]),
    });

    expect(result).toEqual({ success: true, messageId: "wamid.template", usedTemplate: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const templateRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(templateRequest.type).toBe("template");
    expect(templateRequest.template.name).toBe("plethora_notification");
    expect(templateRequest.template.components).toEqual(templateBodyParameters(["Control room", "Update"]));
  });
});
