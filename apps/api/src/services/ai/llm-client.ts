import {
  BedrockClient,
  GetFoundationModelCommand,
  GetInferenceProfileCommand,
} from "@aws-sdk/client-bedrock";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { env, type Env } from "../../lib/env.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  messages: LlmMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmChatResult {
  content: string;
  model: string;
  latencyMs: number;
}

export interface LlmHealthResult {
  enabled: boolean;
  reachable: boolean;
  provider: string;
  region: string;
  baseUrl: string;
  configuredModel: string;
  modelLoaded: boolean;
  availableModels: string[];
  latencyMs: number;
  error?: string;
}

export interface LlmClientOverrides {
  aiEnv?: Env["ai"];
  bedrockRuntime?: { send: BedrockRuntimeClient["send"] };
  bedrockControl?: { send: BedrockClient["send"] };
}

export const BEDROCK_REASONING_MIN_TOKENS = 1024;

let cachedBedrockRuntime: { region: string; client: BedrockRuntimeClient } | null = null;
let cachedBedrockControl: { region: string; client: BedrockClient } | null = null;

function getBedrockRuntimeClient(region: string): BedrockRuntimeClient {
  if (!cachedBedrockRuntime || cachedBedrockRuntime.region !== region) {
    cachedBedrockRuntime = { region, client: new BedrockRuntimeClient({ region }) };
  }
  return cachedBedrockRuntime.client;
}

function getBedrockControlClient(region: string): BedrockClient {
  if (!cachedBedrockControl || cachedBedrockControl.region !== region) {
    cachedBedrockControl = { region, client: new BedrockClient({ region }) };
  }
  return cachedBedrockControl.client;
}

export function isBedrockReasoningModel(modelId: string): boolean {
  return /kimi-k3|kimi-k2-thinking/i.test(modelId);
}

export function isInferenceProfileIdentifier(modelId: string): boolean {
  return (
    /^(global|us|eu|ap|apac|ca|sa|af|me)\./i.test(modelId) ||
    modelId.includes(":inference-profile/") ||
    modelId.includes(":application-inference-profile/")
  );
}

export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]!.trim() : trimmed;
}

async function checkBedrockHealth(
  aiConfig: Env["ai"],
  started: number,
  overrides?: LlmClientOverrides
): Promise<LlmHealthResult> {
  const base = {
    enabled: aiConfig.enabled,
    provider: aiConfig.provider,
    region: aiConfig.region,
    baseUrl: aiConfig.baseUrl,
    configuredModel: aiConfig.model,
  };

  try {
    const client = overrides?.bedrockControl ?? getBedrockControlClient(aiConfig.region);
    const abortSignal = AbortSignal.timeout(Math.min(aiConfig.timeoutMs, 5_000));

    if (isInferenceProfileIdentifier(aiConfig.model)) {
      const profile = await client.send(
        new GetInferenceProfileCommand({ inferenceProfileIdentifier: aiConfig.model }),
        { abortSignal }
      );
      const availableModels = (profile.models ?? [])
        .map((m) => m.modelArn)
        .filter((arn): arn is string => Boolean(arn));
      return {
        ...base,
        reachable: true,
        modelLoaded: profile.status === "ACTIVE",
        availableModels,
        latencyMs: Date.now() - started,
      };
    }

    const fm = await client.send(
      new GetFoundationModelCommand({ modelIdentifier: aiConfig.model }),
      { abortSignal }
    );
    const status = fm.modelDetails?.modelLifecycle?.status;
    return {
      ...base,
      reachable: true,
      modelLoaded: status === "ACTIVE",
      availableModels: fm.modelDetails?.modelId ? [fm.modelDetails.modelId] : [],
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      reachable: false,
      modelLoaded: false,
      availableModels: [],
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Bedrock health check failed",
    };
  }
}

export async function checkLlmHealth(overrides?: LlmClientOverrides): Promise<LlmHealthResult> {
  const started = Date.now();
  const aiConfig = overrides?.aiEnv ?? env.ai;
  const base: Omit<LlmHealthResult, "reachable" | "modelLoaded" | "availableModels" | "latencyMs"> = {
    enabled: aiConfig.enabled,
    provider: aiConfig.provider,
    region: aiConfig.region,
    baseUrl: aiConfig.baseUrl,
    configuredModel: aiConfig.model,
  };

  if (!aiConfig.enabled) {
    return {
      ...base,
      reachable: false,
      modelLoaded: false,
      availableModels: [],
      latencyMs: Date.now() - started,
      error: "AI_ENABLED is false",
    };
  }

  if (aiConfig.provider === "bedrock") {
    return checkBedrockHealth(aiConfig, started, overrides);
  }

  try {
    const res = await fetch(`${aiConfig.baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.min(aiConfig.timeoutMs, 5_000)),
    });
    if (!res.ok) {
      return {
        ...base,
        reachable: false,
        modelLoaded: false,
        availableModels: [],
        latencyMs: Date.now() - started,
        error: `HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as { models?: Array<{ name?: string }> };
    const availableModels = (payload.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name));
    const modelLoaded = availableModels.some(
      (name) => name === aiConfig.model || name.startsWith(`${aiConfig.model}:`)
    );

    return {
      ...base,
      reachable: true,
      modelLoaded,
      availableModels,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      reachable: false,
      modelLoaded: false,
      availableModels: [],
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export function normalizeBedrockMessages(rawMessages: LlmMessage[]): {
  systemBlocks: SystemContentBlock[];
  converseMessages: Message[];
} {
  const systemBlocks: SystemContentBlock[] = [];
  const filtered: Array<{ role: "user" | "assistant"; text: string }> = [];

  for (const msg of rawMessages) {
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    if (msg.role === "system") {
      systemBlocks.push({ text: trimmed });
    } else {
      filtered.push({ role: msg.role, text: trimmed });
    }
  }

  // Bedrock Converse requires the conversation to begin with a "user" turn
  // and strictly alternate user/assistant turns.
  while (filtered.length > 0 && filtered[0]!.role === "assistant") {
    filtered.shift();
  }

  const converseMessages: Message[] = [];
  for (const turn of filtered) {
    const prev = converseMessages[converseMessages.length - 1];
    if (prev && prev.role === turn.role) {
      const prevText =
        prev.content
          ?.map((b) => ("text" in b && b.text ? b.text : ""))
          .filter(Boolean)
          .join("\n") ?? "";
      prev.content = [{ text: prevText ? `${prevText}\n\n${turn.text}` : turn.text }];
    } else {
      converseMessages.push({
        role: turn.role,
        content: [{ text: turn.text }],
      });
    }
  }

  if (converseMessages.length === 0 && systemBlocks.length > 0) {
    const combinedSystem = systemBlocks
      .map((b) => ("text" in b && b.text ? b.text : ""))
      .filter(Boolean)
      .join("\n");
    converseMessages.push({
      role: "user",
      content: [{ text: combinedSystem }],
    });
    systemBlocks.length = 0;
  }

  return { systemBlocks, converseMessages };
}

async function chatWithBedrock(
  options: LlmChatOptions,
  aiConfig: Env["ai"],
  started: number,
  timeoutMs: number,
  overrides?: LlmClientOverrides
): Promise<LlmChatResult | null> {
  try {
    const { systemBlocks, converseMessages } = normalizeBedrockMessages(options.messages);

    if (converseMessages.length === 0) return null;

    const reasoningModel = isBedrockReasoningModel(aiConfig.model);
    const requestedTokens = options.maxTokens ?? 512;
    const maxTokens = reasoningModel
      ? Math.max(requestedTokens, BEDROCK_REASONING_MIN_TOKENS)
      : requestedTokens;

    const client = overrides?.bedrockRuntime ?? getBedrockRuntimeClient(aiConfig.region);
    const response = await client.send(
      new ConverseCommand({
        modelId: aiConfig.model,
        ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
        messages: converseMessages,
        inferenceConfig: reasoningModel
          ? { maxTokens }
          : {
              maxTokens,
              temperature: options.temperature ?? 0.1,
            },
      }),
      { abortSignal: AbortSignal.timeout(timeoutMs) }
    );

    const contentBlocks = response.output?.message?.content ?? [];
    const textParts: string[] = [];
    for (const block of contentBlocks) {
      if ("text" in block && typeof block.text === "string" && block.text.trim().length > 0) {
        textParts.push(block.text);
      }
    }

    const rawText = textParts.join("\n").trim();
    if (!rawText) return null;

    const content = options.jsonMode ? stripJsonCodeFence(rawText) : rawText;
    if (!content) return null;

    return {
      content,
      model: aiConfig.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    console.warn("[AI] Bedrock Converse request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function chatWithLlm(
  options: LlmChatOptions,
  overrides?: LlmClientOverrides
): Promise<LlmChatResult | null> {
  const aiConfig = overrides?.aiEnv ?? env.ai;
  if (!aiConfig.enabled) return null;

  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? aiConfig.timeoutMs;

  if (aiConfig.provider === "bedrock") {
    return chatWithBedrock(options, aiConfig, started, timeoutMs, overrides);
  }

  try {
    const res = await fetch(`${aiConfig.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: aiConfig.model,
        messages: options.messages,
        stream: false,
        ...(options.jsonMode ? { format: "json" } : {}),
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 256,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[AI] Ollama returned HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      model?: string;
      message?: { content?: string };
    };
    const content = data.message?.content?.trim();
    if (!content) return null;

    return {
      content,
      model: data.model ?? aiConfig.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    console.warn("[AI] LLM request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
