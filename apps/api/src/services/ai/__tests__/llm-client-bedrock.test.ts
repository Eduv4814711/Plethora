import { describe, expect, it, vi } from "vitest";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetInferenceProfileCommand } from "@aws-sdk/client-bedrock";
import {
  BEDROCK_REASONING_MIN_TOKENS,
  chatWithLlm,
  checkLlmHealth,
  isBedrockReasoningModel,
  stripJsonCodeFence,
} from "../llm-client.js";
import type { Env } from "../../../lib/env.js";

const bedrockKimiEnv: Env["ai"] = {
  enabled: true,
  provider: "bedrock",
  region: "af-south-1",
  baseUrl: "https://bedrock-runtime.af-south-1.amazonaws.com",
  model: "global.moonshotai.kimi-k3.1",
  timeoutMs: 15_000,
};

describe("Amazon Bedrock Kimi K3.1 LLM client", () => {
  it("identifies Kimi K3.1 as a reasoning model and strips markdown fences", () => {
    expect(isBedrockReasoningModel("global.moonshotai.kimi-k3.1")).toBe(true);
    expect(isBedrockReasoningModel("moonshotai.kimi-k3.1")).toBe(true);
    expect(isBedrockReasoningModel("anthropic.claude-3-haiku-20240307-v1:0")).toBe(false);

    expect(stripJsonCodeFence('```json\n{"intent":"ROSTER","confidence":0.96}\n```')).toBe(
      '{"intent":"ROSTER","confidence":0.96}'
    );
  });

  it("omits temperature, enforces maxTokens floor, separates system blocks, and skips reasoningContent", async () => {
    const sendSpy = vi.fn(async (cmd: unknown) => {
      expect(cmd).toBeInstanceOf(ConverseCommand);
      const input = (cmd as ConverseCommand).input;
      expect(input.modelId).toBe("global.moonshotai.kimi-k3.1");
      expect(input.system).toEqual([{ text: "Classify intent strictly as JSON." }]);
      expect(input.messages).toEqual([
        { role: "user", content: [{ text: "When am I working tomorrow?" }] },
      ]);
      expect(input.inferenceConfig).toEqual({
        maxTokens: BEDROCK_REASONING_MIN_TOKENS,
      });
      expect("temperature" in (input.inferenceConfig ?? {})).toBe(false);

      return {
        output: {
          message: {
            role: "assistant",
            content: [
              {
                reasoningContent: {
                  reasoningText: { text: "Employee asks about upcoming work schedule -> ROSTER." },
                },
              },
              {
                text: '```json\n{"intent":"ROSTER","confidence":0.95}\n```',
              },
            ],
          },
        },
        stopReason: "end_turn",
      };
    });

    const result = await chatWithLlm(
      {
        jsonMode: true,
        temperature: 0.05,
        maxTokens: 160,
        messages: [
          { role: "system", content: "Classify intent strictly as JSON." },
          { role: "user", content: "When am I working tomorrow?" },
        ],
      },
      {
        aiEnv: bedrockKimiEnv,
        bedrockRuntime: { send: sendSpy as never },
      }
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result?.content).toBe('{"intent":"ROSTER","confidence":0.95}');
    expect(result?.model).toBe("global.moonshotai.kimi-k3.1");
  });

  it("returns null gracefully when Bedrock throws an error", async () => {
    const failingSend = vi.fn(async () => {
      throw new Error("ThrottlingException: Too many requests");
    });

    const result = await chatWithLlm(
      {
        messages: [{ role: "user", content: "Hello" }],
      },
      {
        aiEnv: bedrockKimiEnv,
        bedrockRuntime: { send: failingSend as never },
      }
    );

    expect(result).toBeNull();
  });

  it("checks inference profile ACTIVE status via GetInferenceProfileCommand with zero token usage", async () => {
    const controlSend = vi.fn(async (cmd: unknown) => {
      expect(cmd).toBeInstanceOf(GetInferenceProfileCommand);
      const input = (cmd as GetInferenceProfileCommand).input;
      expect(input.inferenceProfileIdentifier).toBe("global.moonshotai.kimi-k3.1");
      return {
        inferenceProfileId: "global.moonshotai.kimi-k3.1",
        status: "ACTIVE",
        models: [
          { modelArn: "arn:aws:bedrock:::foundation-model/moonshotai.kimi-k3.1" },
          { modelArn: "arn:aws:bedrock:af-south-1::foundation-model/moonshotai.kimi-k3.1" },
        ],
      };
    });

    const health = await checkLlmHealth({
      aiEnv: bedrockKimiEnv,
      bedrockControl: { send: controlSend as never },
    });

    expect(controlSend).toHaveBeenCalledTimes(1);
    expect(health.enabled).toBe(true);
    expect(health.reachable).toBe(true);
    expect(health.provider).toBe("bedrock");
    expect(health.region).toBe("af-south-1");
    expect(health.configuredModel).toBe("global.moonshotai.kimi-k3.1");
    expect(health.modelLoaded).toBe(true);
    expect(health.availableModels).toContain(
      "arn:aws:bedrock:af-south-1::foundation-model/moonshotai.kimi-k3.1"
    );
  });
});
