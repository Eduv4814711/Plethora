import { authFetch } from "./api";

export interface AiHealthStatus {
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

export interface AiCopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCopilotResponse {
  answer: string;
  metrics: Record<string, unknown>;
  aiUsed: boolean;
  model?: string | null;
  provider?: string;
  latencyMs?: number | null;
}

export async function getAiHealth(token: string): Promise<AiHealthStatus> {
  const res = await authFetch("/ai/health", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to load AI health");
  }
  return res.json();
}

export interface AiIncidentPolishResponse {
  original: string;
  polished: string;
  aiUsed: boolean;
}

export async function askAiCopilot(
  token: string,
  payload: { question: string; history?: AiCopilotMessage[] }
): Promise<AiCopilotResponse> {
  const res = await authFetch("/ai/copilot", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Plethora AI request failed");
  }
  return res.json();
}

export async function polishIncidentNotes(
  token: string,
  rawNotes: string
): Promise<AiIncidentPolishResponse> {
  const res = await authFetch("/ai/incident-polish", token, {
    method: "POST",
    body: JSON.stringify({ rawNotes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to polish incident notes");
  }
  return res.json();
}
