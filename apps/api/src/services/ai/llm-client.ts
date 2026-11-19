import { env } from "../../lib/env.js";

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
  baseUrl: string;
  configuredModel: string;
  modelLoaded: boolean;
  availableModels: string[];
  latencyMs: number;
  error?: string;
}

export async function checkLlmHealth(): Promise<LlmHealthResult> {
  const started = Date.now();
  const base: Omit<LlmHealthResult, "reachable" | "modelLoaded" | "availableModels" | "latencyMs"> = {
    enabled: env.ai.enabled,
    provider: env.ai.provider,
    baseUrl: env.ai.baseUrl,
    configuredModel: env.ai.model,
  };

  if (!env.ai.enabled) {
    return {
      ...base,
      reachable: false,
      modelLoaded: false,
      availableModels: [],
      latencyMs: Date.now() - started,
      error: "AI_ENABLED is false",
    };
  }

  try {
    const res = await fetch(`${env.ai.baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.min(env.ai.timeoutMs, 5_000)),
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
      (name) => name === env.ai.model || name.startsWith(`${env.ai.model}:`)
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

export async function chatWithLlm(options: LlmChatOptions): Promise<LlmChatResult | null> {
  if (!env.ai.enabled) return null;

  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? env.ai.timeoutMs;

  try {
    const res = await fetch(`${env.ai.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: env.ai.model,
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
      model: data.model ?? env.ai.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    console.warn("[AI] LLM request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
