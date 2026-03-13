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
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm p-4">
        No messages yet. Send a message to start the conversation.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-3">
      {[...messages].reverse().map((m) => (
        <div
          key={m.id}
          className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-security px-3 py-2 ${
              m.direction === "outbound"
                ? "bg-black text-white"
                : "bg-neutral-100 text-black"
            }`}
          >
            <p className="text-sm whitespace-pre-wrap break-words">{m.text ?? ""}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs opacity-75">
                {format(new Date(m.createdAt), "MMM d, HH:mm")}
              </span>
              {m.direction === "outbound" && m.status && (
                <span className="text-xs opacity-75">• {m.status}</span>
              )}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
