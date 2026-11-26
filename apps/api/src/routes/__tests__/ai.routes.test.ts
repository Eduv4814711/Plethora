import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkLlmHealthMock = vi.fn();
const chatWithLlmMock = vi.fn();
const polishIncidentSummaryMock = vi.fn();
const getGuardsOnDutyNowMock = vi.fn();
const getPeriodExportReadinessMock = vi.fn();

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: async (request: any) => {
    request.user = {
      id: "user-1",
      companyId: "comp-1",
      role: "admin",
      capabilities: { "/": ["view"], "/incidents": ["view", "create"] },
    };
  },
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: {
      findUnique: vi.fn().mockResolvedValue({
        name: "Quick Bopha Security",
        settings: { timezone: "Africa/Johannesburg" },
      }),
    },
    employee: { count: vi.fn().mockResolvedValueOnce(120).mockResolvedValueOnce(115) },
    site: { count: vi.fn().mockResolvedValueOnce(22).mockResolvedValueOnce(20) },
    sitePost: { count: vi.fn().mockResolvedValue(85) },
    client: { count: vi.fn().mockResolvedValue(12) },
    incident: { count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1) },
    leaveRequest: { count: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(4) },
    siteTimesheetRow: { count: vi.fn().mockResolvedValue(14) },
  },
}));

vi.mock("../../services/ai/llm-client.js", () => ({
  checkLlmHealth: (...args: any[]) => checkLlmHealthMock(...args),
  chatWithLlm: (...args: any[]) => chatWithLlmMock(...args),
}));

vi.mock("../../services/ai/whatsapp-intent.service.js", () => ({
  polishIncidentSummary: (...args: any[]) => polishIncidentSummaryMock(...args),
}));

vi.mock("../../services/dashboard-guards-on-duty.service.js", () => ({
  getGuardsOnDutyNow: (...args: any[]) => getGuardsOnDutyNowMock(...args),
}));

vi.mock("../../modules/attendance-exceptions/exceptions.service.js", () => ({
  getPeriodExportReadiness: (...args: any[]) => getPeriodExportReadinessMock(...args),
}));

import { aiRoutes } from "../ai.routes.js";

describe("AI Routes (/ai/health, /ai/incident-polish, /ai/copilot)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGuardsOnDutyNowMock.mockResolvedValue(96);
    getPeriodExportReadinessMock.mockResolvedValue({
      status: "BLOCKED",
      openExceptions: 2,
    });
  });

  it("GET /ai/health returns LLM provider status", async () => {
    checkLlmHealthMock.mockResolvedValue({
      enabled: true,
      reachable: true,
      provider: "bedrock",
      region: "af-south-1",
      baseUrl: "https://bedrock-runtime.af-south-1.amazonaws.com",
      configuredModel: "global.moonshotai.kimi-k3.1",
      modelLoaded: true,
      availableModels: ["arn:aws:bedrock:af-south-1::foundation-model/moonshotai.kimi-k3.1"],
      latencyMs: 320,
    });

    const app = Fastify();
    await app.register(aiRoutes, { prefix: "/ai" });

    const res = await app.inject({ method: "GET", url: "/ai/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe("bedrock");
    expect(body.modelLoaded).toBe(true);
    expect(body.configuredModel).toBe("global.moonshotai.kimi-k3.1");
  });

  it("POST /ai/incident-polish polishes notes via AI and falls back cleanly", async () => {
    polishIncidentSummaryMock.mockResolvedValueOnce(
      "Perimeter fence breach observed at North Gate at 02:15; supervisor dispatched."
    );

    const app = Fastify();
    await app.register(aiRoutes, { prefix: "/ai" });

    const res = await app.inject({
      method: "POST",
      url: "/ai/incident-polish",
      payload: { rawNotes: "fence cut north gate 2:15am sup called" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      original: "fence cut north gate 2:15am sup called",
      polished: "Perimeter fence breach observed at North Gate at 02:15; supervisor dispatched.",
      aiUsed: true,
    });
  });

  it("POST /ai/copilot supports multi-turn history and returns Bedrock answer + snapshot", async () => {
    chatWithLlmMock.mockResolvedValueOnce({
      content: "Payroll export is currently BLOCKED with 2 open attendance exceptions and 14 unconfirmed shift rows.",
      model: "global.moonshotai.kimi-k3.1",
      latencyMs: 1850,
    });

    const app = Fastify();
    await app.register(aiRoutes, { prefix: "/ai" });

    const res = await app.inject({
      method: "POST",
      url: "/ai/copilot",
      payload: {
        question: "What are our payroll blockers?",
        history: [
          { role: "user", content: "Hi Plethora AI" },
          { role: "assistant", content: "Hello! How can I assist with Quick Bopha Security operations?" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aiUsed).toBe(true);
    expect(body.model).toBe("global.moonshotai.kimi-k3.1");
    expect(body.answer).toContain("BLOCKED");
    expect(body.metrics.companyName).toBe("Quick Bopha Security");
    expect(chatWithLlmMock).toHaveBeenCalledTimes(1);
  });

  it("POST /ai/copilot returns deterministic live metrics answer when LLM returns null", async () => {
    chatWithLlmMock.mockResolvedValueOnce(null);

    const app = Fastify();
    await app.register(aiRoutes, { prefix: "/ai" });

    const res = await app.inject({
      method: "POST",
      url: "/ai/copilot",
      payload: { question: "Check payroll export readiness" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aiUsed).toBe(false);
    expect(body.answer).toContain("Payroll export is currently marked BLOCKED");
  });
});
