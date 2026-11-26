"use client";

import { useEffect, useRef } from "react";
import { format } from "date-fns";
import type { WhatsAppMessage } from "@/lib/api";

interface ConversationViewProps {
  messages: WhatsAppMessage[];
  onRefresh: () => void;
  isLoading?: boolean;
  pollInterval?: number;
}

export function ConversationView({
  messages,
  onRefresh,
  isLoading = false,
  pollInterval = 15000,
}: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (pollInterval <= 0) return;
    const id = setInterval(onRefresh, pollInterval);
    return () => clearInterval(id);
  }, [onRefresh, pollInterval]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-security-navy-500">
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-security-navy-500">
        No messages in this thread yet. Send a message or ask the team member to message your WhatsApp line.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-auto bg-security-navy-50/30 p-4">
      {[...messages].reverse().map((m) => {
        const isOutbound = m.direction === "outbound";
        const isAutomated = isOutbound && !m.sentByUserId;

        return (
          <div
            key={m.id}
            className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[82%] rounded-security-lg px-3.5 py-2.5 shadow-sm ${
                !isOutbound
                  ? "border border-security-navy-100 bg-white text-security-navy-900"
                  : isAutomated
                    ? "border border-security-navy-200 bg-security-navy-50 text-security-navy-900"
                    : "bg-security-navy-900 text-white"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span
                  className={`text-[11px] font-medium ${
                    !isOutbound
                      ? "text-security-navy-500"
                      : isAutomated
                        ? "text-security-navy-600"
                        : "text-security-navy-200"
                  }`}
                >
                  {!isOutbound ? "Employee" : isAutomated ? "Plethora automated" : "Operator"}
                </span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    !isOutbound || isAutomated ? "text-security-navy-400" : "text-security-navy-300"
                  }`}
                >
                  {format(new Date(m.createdAt), "MMM d, HH:mm")}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {m.text ?? ""}
              </p>
              {isOutbound && m.status ? (
                <div className="mt-1 flex justify-end">
                  <span
                    className={`text-[11px] ${
                      isAutomated ? "text-security-navy-500" : "text-security-navy-300"
                    }`}
                  >
                    {m.status}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
