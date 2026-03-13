"use client";

import { useState } from "react";
import Link from "next/link";
import type { WhatsAppContact } from "@/lib/api";

interface WhatsAppWidgetProps {
  contacts: WhatsAppContact[];
  onSend: (employeeId: string, message: string) => Promise<{ success: boolean; error?: string; requiresTemplate?: boolean }>;
  compact?: boolean;
}

export function WhatsAppWidget({ contacts, onSend, compact = true }: WhatsAppWidgetProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (employeeId: string) => {
    if (!message.trim()) return;
    setSending(employeeId);
    setError(null);
    const result = await onSend(employeeId, message.trim());
    setSending(null);
    if (result.success) {
      setMessage("");
      setExpandedId(null);
    } else {
      setError(result.error ?? "Failed to send");
    }
  };

  const displayContacts = compact ? contacts.slice(0, 5) : contacts;

  return (
    <div className="card-dashboard w-full p-5 flex flex-col border-neutral-200 overflow-hidden max-h-[min(420px,50vh)]">
      <h2 className="font-semibold text-sm text-black uppercase tracking-wider mb-3 flex items-center gap-2 shrink-0">
        <span className="w-1 h-4 bg-black rounded-full" />
        WhatsApp
      </h2>
      <p className="text-xs text-neutral-500 mb-3 shrink-0">Message team members directly</p>
      <div className="space-y-2 overflow-y-auto min-h-0 flex-1">
        {displayContacts.length > 0 ? (
          displayContacts.map((contact) => (
            <div key={contact.id} className="rounded-security border border-neutral-200 bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-black font-semibold text-sm shrink-0">
                  {contact.firstName?.charAt(0) ?? ""}{contact.lastName?.charAt(0) ?? ""}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-black truncate">
                    {contact.firstName} {contact.lastName}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">
                    {contact.phone ? `+${contact.phone}` : "No phone"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId((id) => (id === contact.id ? null : contact.id));
                      setMessage("");
                      setError(null);
                    }}
                    className="p-1.5 rounded-security text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors"
                    title="Send message"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </button>
                  {contact.whatsappUrl && (
                    <a
                      href={contact.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-security text-neutral-500 hover:bg-neutral-100 hover:text-green-600 transition-colors"
                      title="Open in WhatsApp"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
              {expandedId === contact.id && (
                <div className="px-3 pb-3 pt-0 border-t border-neutral-100">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your message..."
                    rows={2}
                    className="w-full mt-2 px-3 py-2 text-sm border border-neutral-300 rounded-security resize-none focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    disabled={!!sending}
                  />
                  {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
                  <button
                    type="button"
                    onClick={() => handleSend(contact.id)}
                    disabled={!message.trim() || !!sending}
                    className="mt-2 w-full py-2 text-sm font-medium rounded-security bg-black text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {sending === contact.id ? "Sending..." : "Send"}
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-center text-sm text-neutral-500 border border-dashed border-neutral-200 rounded-security">
            No team members with WhatsApp numbers yet. Add phone numbers in Team.
          </div>
        )}
      </div>
      {compact && contacts.length > 5 && (
        <Link
          href="/whatsapp"
          className="mt-2 text-sm text-neutral-600 hover:text-black font-medium shrink-0"
        >
          View all ({contacts.length}) →
        </Link>
      )}
      <Link
        href="/whatsapp"
        className="mt-3 flex items-center justify-center gap-1 w-full px-5 py-2.5 font-medium rounded-security border-2 border-neutral-300 bg-white text-black hover:bg-neutral-50 text-sm transition-colors shrink-0"
      >
        WhatsApp
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </Link>
    </div>
  );
}
