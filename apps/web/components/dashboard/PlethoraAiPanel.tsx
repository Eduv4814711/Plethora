"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { askAiCopilot, getAiHealth, type AiHealthStatus } from "@/lib/ai-api";
import { Drawer } from "@/components/ui";
import type { TodayWorkItem } from "@/lib/today-work-list-utils";

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

interface PlethoraAiPanelProps {
  companyName: string;
  workItems: TodayWorkItem[];
  rosterAttentionCount: number;
  pendingTimesheetsCount: number;
  openExceptionsCount: number;
  guardsOnDuty: number;
  activeSitesCount: number;
}

const QUICK_PROMPTS = [
  "Summarize risks",
  "Payroll blockers",
  "Attendance status",
  "Leave & staffing",
];

function formatProviderLabel(health: AiHealthStatus | null): string {
  if (!health) return "Amazon Bedrock";
  if (health.provider === "bedrock") return "Amazon Bedrock";
  if (health.provider === "ollama") return "Local Ollama";
  return health.provider;
}

function formatModelLabel(health: AiHealthStatus | null): string {
  if (!health?.configuredModel) return "Kimi K3.1";
  if (/kimi-k3\.1/i.test(health.configuredModel)) return "Kimi K3.1";
  return health.configuredModel;
}

export function PlethoraAiPanel({
  companyName,
  workItems,
  rosterAttentionCount,
  pendingTimesheetsCount,
  openExceptionsCount,
  guardsOnDuty,
  activeSitesCount,
}: PlethoraAiPanelProps) {
  const { token } = useAuth();
  const [mode, setMode] = useState<"insights" | "chat">("insights");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [health, setHealth] = useState<AiHealthStatus | null>(null);

  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inlineThreadEndRef = useRef<HTMLDivElement>(null);
  const drawerThreadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    getAiHealth(token)
      .then(setHealth)
      .catch(() => {
        /* keep default badge cleanly */
      });
  }, [token]);

  useEffect(() => {
    inlineThreadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    drawerThreadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, drawerOpen, mode]);

  const insightRows = useMemo(() => {
    const rows: { id: string; title: string; subtitle: string; href: string; tone: "amber" | "red" | "emerald" }[] = [];

    if (rosterAttentionCount > 0) {
      rows.push({
        id: "roster",
        title: `${rosterAttentionCount} roster${rosterAttentionCount === 1 ? "" : "s"} need attention`,
        subtitle: "Sites have coverage gaps.",
        href: "/rostering",
        tone: "amber",
      });
    }

    if (pendingTimesheetsCount > 0) {
      rows.push({
        id: "attendance",
        title: `${pendingTimesheetsCount.toLocaleString()} attendance record${pendingTimesheetsCount === 1 ? "" : "s"} unconfirmed`,
        subtitle: "Review and approve shifts.",
        href: "/attendance",
        tone: "amber",
      });
    } else if (openExceptionsCount > 0) {
      rows.push({
        id: "exceptions",
        title: `${openExceptionsCount} open exception${openExceptionsCount === 1 ? "" : "s"}`,
        subtitle: "Resolve before payroll export.",
        href: "/attendance/exceptions?status=OPEN",
        tone: "red",
      });
    }

    for (const item of workItems) {
      if (rows.length >= 3) break;
      const alreadyCoversRostering = item.sourceModule === "ROSTERING" && rosterAttentionCount > 0;
      const alreadyCoversAttendance = item.sourceModule === "ATTENDANCE" && pendingTimesheetsCount > 0;
      if (alreadyCoversRostering || alreadyCoversAttendance) continue;
      rows.push({
        id: item.id,
        title: item.focalCount ?? item.title,
        subtitle: item.description ?? item.title,
        href: item.href,
        tone: item.priority === "CRITICAL" ? "red" : "amber",
      });
    }

    if (rows.length === 0) {
      rows.push({
        id: "all-clear",
        title: `${guardsOnDuty} on duty across ${activeSitesCount} site${activeSitesCount === 1 ? "" : "s"}`,
        subtitle: "All operational gates clear today.",
        href: "/overview",
        tone: "emerald",
      });
    }

    return rows.slice(0, 3);
  }, [
    rosterAttentionCount,
    pendingTimesheetsCount,
    openExceptionsCount,
    workItems,
    guardsOnDuty,
    activeSitesCount,
  ]);

  const sendQuestion = async (questionText: string, openInlineChat = true) => {
    const trimmed = questionText.trim();
    if (!trimmed || !token || sending) return;

    setError(null);
    if (openInlineChat) setMode("chat");
    setDraft("");

    const userMsg: ChatEntry = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    const nextHistory = [...messages, userMsg].slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const res = await askAiCopilot(token, {
        question: trimmed,
        history: nextHistory.slice(0, -1),
      });
      const reply: ChatEntry = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: res.answer,
        meta: res.aiUsed
          ? `${formatProviderLabel(health)}${res.model ? ` · ${res.model.split(".").pop()}` : ""}`
          : "Live metrics summary",
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach Plethora AI");
    } finally {
      setSending(false);
    }
  };

  const renderChatMessages = (endRef: React.RefObject<HTMLDivElement | null>, darkTheme: boolean) => (
    <div
      className={clsx(
        "flex-1 space-y-2.5 overflow-y-auto overscroll-contain pr-1",
        darkTheme ? "min-h-[160px] max-h-[245px]" : "min-h-[260px]"
      )}
    >
      {messages.length === 0 ? (
        <div
          className={clsx(
            "rounded-xl border p-3 text-xs",
            darkTheme
              ? "border-white/10 bg-white/[0.04] text-white/75"
              : "border-security-navy-100 bg-security-navy-50/70 text-security-navy-600"
          )}
        >
          Ask anything about today&apos;s shift coverage, unconfirmed timesheets, incidents, leave, or payroll export readiness for {companyName}.
        </div>
      ) : (
        messages.map((m) => (
          <div
            key={m.id}
            className={clsx(
              "rounded-xl px-3 py-2 text-xs leading-relaxed",
              m.role === "user"
                ? darkTheme
                  ? "ml-6 bg-security-amber-500/20 text-white border border-security-amber-400/25"
                  : "ml-8 bg-security-navy-900 text-white"
                : darkTheme
                  ? "mr-3 bg-white/[0.07] text-white/90 border border-white/10"
                  : "mr-4 bg-security-navy-50 text-security-navy-900 border border-security-navy-100"
            )}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.meta && (
              <p
                className={clsx(
                  "mt-1 text-[10px]",
                  darkTheme ? "text-white/45" : "text-security-navy-400"
                )}
              >
                {m.meta}
              </p>
            )}
          </div>
        ))
      )}
      {sending && (
        <div
          className={clsx(
            "mr-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
            darkTheme
              ? "border-white/10 bg-white/[0.05] text-white/75"
              : "border-security-navy-100 bg-security-navy-50 text-security-navy-600"
          )}
        >
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-security-amber-500 border-t-transparent" />
          <span>Analyzing live metrics…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  return (
    <>
      <aside
        aria-label="Plethora AI Operations Assistant"
        className="ai-panel-surface flex h-full w-full flex-col justify-between rounded-2xl border border-[#232938] p-4 text-white shadow-security-elevated"
      >
        <div>
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-security-amber-400" aria-hidden="true">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.1 6.2L20 10l-5.9 1.8L12 18l-2.1-6.2L4 10l5.9-1.8L12 2zm7 12l1.1 3.1L23 18l-2.9.9L19 22l-1.1-3.1L15 18l2.9-.9L19 14z" />
                </svg>
              </span>
              <h2 className="font-display text-base font-bold tracking-tight text-white">
                Plethora AI
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-right leading-tight">
                <p className="text-[10px] font-medium text-white/70">
                  {formatProviderLabel(health)}
                </p>
                <p className="text-[10px] font-semibold text-white/90">
                  {formatModelLabel(health)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                title="Open expanded AI Copilot"
                aria-label="Open expanded Plethora AI drawer"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/75 transition-colors hover:bg-white/15 hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-white/65">
              Operational insights for {companyName}
            </p>
            <div className="inline-flex shrink-0 rounded-lg border border-white/10 bg-white/[0.05] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("insights")}
                className={clsx(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  mode === "insights" ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
                )}
              >
                Insights
              </button>
              <button
                type="button"
                onClick={() => setMode("chat")}
                className={clsx(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  mode === "chat" ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
                )}
              >
                Chat{messages.length > 0 ? ` (${messages.length})` : ""}
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="my-3.5 flex flex-1 flex-col justify-between gap-2.5">
          {mode === "insights" ? (
            <div className="space-y-2">
              {insightRows.map((row) => (
                <Link
                  key={row.id}
                  href={row.href}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 no-underline transition-colors hover:border-security-amber-400/40 hover:bg-white/[0.1]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={clsx(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                        row.tone === "emerald"
                          ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                          : row.tone === "red"
                            ? "border-red-400/30 bg-red-500/15 text-red-300"
                            : "border-security-amber-400/30 bg-security-amber-500/15 text-security-amber-300"
                      )}
                      aria-hidden="true"
                    >
                      {row.tone === "emerald" ? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : row.tone === "red" ? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{row.title}</p>
                      <p className="truncate text-[11px] text-white/60">{row.subtitle}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-white/50 transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            renderChatMessages(inlineThreadEndRef, true)
          )}
        </div>

        {/* Footer Ask Prompt */}
        <div className="space-y-2 border-t border-white/10 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.slice(0, 2).map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => void sendQuestion(prompt, true)}
                className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-white/80 transition-colors hover:border-security-amber-400/50 hover:bg-white/15 hover:text-white disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-[11px] text-red-300" role="alert">
              {error}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendQuestion(draft, true);
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Plethora AI..."
              aria-label="Ask Plethora AI"
              disabled={sending}
              className="h-9 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.08] px-3 text-xs text-white placeholder:text-white/45 outline-none transition-colors focus:border-security-amber-400 focus:bg-white/[0.12]"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              aria-label="Send message to Plethora AI"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-security-amber-500 text-security-navy-950 transition-colors hover:bg-security-amber-400 disabled:opacity-45"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      </aside>

      {/* Expanded AI Copilot Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Plethora AI Copilot"
        description={`${formatProviderLabel(health)} (${formatModelLabel(health)}) · Live metrics for ${companyName}`}
        side="right"
      >
        <div className="flex h-full flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendQuestion(prompt, false)}
                  className="rounded-full border border-security-navy-200 bg-security-navy-50 px-2.5 py-1 text-xs font-medium text-security-navy-700 transition-colors hover:border-security-amber-300 hover:bg-security-amber-50 hover:text-security-navy-900 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="text-xs font-medium text-security-navy-500 hover:text-security-navy-900 hover:underline"
              >
                Clear chat
              </button>
            )}
          </div>

          {error && (
            <p className="rounded-security border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}

          {renderChatMessages(drawerThreadEndRef, false)}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendQuestion(draft, false);
            }}
            className="flex items-center gap-2 border-t border-security-navy-100 pt-3"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about coverage gaps, exceptions, payroll or leave..."
              aria-label="Ask Plethora AI Copilot"
              disabled={sending}
              className="input-modern flex-1"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="btn-amber shrink-0"
            >
              {sending ? "Sending…" : "Ask"}
            </button>
          </form>
        </div>
      </Drawer>
    </>
  );
}
