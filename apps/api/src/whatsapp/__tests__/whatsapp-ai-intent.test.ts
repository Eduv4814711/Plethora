import { describe, expect, it, vi } from "vitest";
import {
  classifyWhatsAppIntent,
  polishIncidentSummary,
} from "../../services/ai/whatsapp-intent.service.js";
import { checkLlmHealth } from "../../services/ai/llm-client.js";

describe("WhatsApp AI intent classifier (Ollama llama3.3:3b)", () => {
  it("parses valid JSON intent classifications", async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: "ROSTER",
        confidence: 0.92,
        reply: "Fetching your upcoming roster.",
      }),
      model: "llama3.3:3b",
      latencyMs: 120,
    }));

    const result = await classifyWhatsAppIntent(
      "When am I working next week?",
      { firstName: "Thabo", employeeType: "security_officer" },
      mockChat
    );

    expect(result).toEqual({
      intent: "ROSTER",
      confidence: 0.92,
      reply: "Fetching your upcoming roster.",
    });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("returns null on malformed JSON or invalid intent", async () => {
    const badJsonChat = vi.fn(async () => ({
      content: "Sure! You work tomorrow.",
      model: "llama3.3:3b",
      latencyMs: 50,
    }));

    const res1 = await classifyWhatsAppIntent(
      "When do I work?",
      { firstName: "Thabo" },
      badJsonChat
    );
    expect(res1).toBeNull();

    const invalidIntentChat = vi.fn(async () => ({
      content: JSON.stringify({ intent: "DELETE_PAYROLL", confidence: 0.99 }),
      model: "llama3.3:3b",
      latencyMs: 50,
    }));

    const res2 = await classifyWhatsAppIntent(
      "Delete payroll",
      { firstName: "Thabo" },
      invalidIntentChat
    );
    expect(res2).toBeNull();
  });

  it("polishes raw incident notes without throwing when LLM is unavailable", async () => {
    const okChat = vi.fn(async () => ({
      content: "Suspected perimeter fence breach reported at North Gate.",
      model: "llama3.3:3b",
      latencyMs: 80,
    }));
    const polished = await polishIncidentSummary("someone cut the fence north gate", okChat);
    expect(polished).toBe("Suspected perimeter fence breach reported at North Gate.");

    const nullChat = vi.fn(async () => null);
    const fallback = await polishIncidentSummary("someone cut the fence", nullChat);
    expect(fallback).toBeNull();
  });

  it("reports disabled state cleanly in checkLlmHealth when AI_ENABLED is false", async () => {
    const health = await checkLlmHealth();
    expect(health.enabled).toBe(false);
    expect(health.configuredModel).toBe("llama3.3:3b");
    expect(health.reachable).toBe(false);
  });
});
