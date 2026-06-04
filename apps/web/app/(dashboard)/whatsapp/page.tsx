"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getWhatsAppContacts,
  getWhatsAppMessages,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  getWhatsAppTemplates,
  type WhatsAppContact,
  type WhatsAppMessage,
} from "@/lib/api";
import { ConversationView } from "@/components/whatsapp/conversation-view";
import { AlertBanner, EmptyState, PageHeader } from "@/components/ui";

export default function WhatsAppPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<WhatsAppContact | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [requiresTemplate, setRequiresTemplate] = useState(false);
  const [templates, setTemplates] = useState<{ name: string; language: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const fetchContacts = useCallback(async () => {
    if (!token) return;
    setLoadingContacts(true);
    setFetchError(null);
    try {
      const { data } = await getWhatsAppContacts(token, { limit: 50 });
      setContacts(data);
    } catch (e) {
      console.error(e);
      setContacts([]);
      setFetchError("Unable to load WhatsApp contacts. Check the connection and try again.");
    } finally {
      setLoadingContacts(false);
    }
  }, [token]);

  const fetchMessages = useCallback(async () => {
    if (!token || !selectedContact) return;
    setLoadingMessages(true);
    setFetchError(null);
    try {
      const { data } = await getWhatsAppMessages(token, selectedContact.id, { limit: 50 });
      setMessages(data);
    } catch (e) {
      console.error(e);
      setMessages([]);
      setFetchError("Unable to load this conversation. Try refreshing the messages.");
    } finally {
      setLoadingMessages(false);
    }
  }, [token, selectedContact]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const contactIdFromUrl = searchParams.get("contact");

  useEffect(() => {
    if (!contactIdFromUrl || loadingContacts || contacts.length === 0) return;
    const contact = contacts.find((c) => c.id === contactIdFromUrl);
    if (contact) {
      setSelectedContact(contact);
    }
  }, [contactIdFromUrl, loadingContacts, contacts]);

  useEffect(() => {
    if (selectedContact) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [selectedContact, fetchMessages]);

  useEffect(() => {
    if (requiresTemplate && token) {
      getWhatsAppTemplates(token)
        .then((r) => setTemplates(r.data))
        .catch(() => setTemplates([]));
    }
  }, [requiresTemplate, token]);

  const handleSendMessage = async () => {
    if (!token || !selectedContact || !messageInput.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendWhatsAppMessage(token, selectedContact.id, messageInput.trim());
      if (result.success) {
        setMessageInput("");
        setRequiresTemplate(false);
        fetchMessages();
      } else {
        setError(result.error ?? "Failed to send");
        if (result.requiresTemplate) setRequiresTemplate(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!token || !selectedContact || !selectedTemplate) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendWhatsAppTemplate(token, selectedContact.id, selectedTemplate);
      if (result.success) {
        setRequiresTemplate(false);
        setSelectedTemplate("");
        fetchMessages();
      } else {
        setError(result.error ?? "Failed to send template");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send template");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <PageHeader
        title="WhatsApp"
        description="Message team members and view conversation history."
        className="mb-6"
      />

      {fetchError && <AlertBanner variant="error" className="mb-6">{fetchError}</AlertBanner>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contact list */}
        <div className="md:col-span-1">
          {loadingContacts ? (
            <div className="card-dashboard p-5 animate-pulse">
              <div className="h-6 bg-neutral-200 rounded w-24 mb-4" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-neutral-100 rounded" />
                ))}
              </div>
            </div>
          ) : (
            <div className="card-dashboard p-5 flex flex-col border-neutral-200 md:h-[calc(100dvh-13rem)] overflow-hidden">
              <h2 className="font-semibold text-sm text-black uppercase tracking-wider mb-3">Contacts</h2>
              {contacts.length > 0 ? (
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedContact(c)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-security text-left transition-colors ${
                        selectedContact?.id === c.id ? "bg-neutral-100" : "hover:bg-neutral-50"
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-black font-semibold text-sm shrink-0">
                        {c.firstName?.charAt(0)}{c.lastName?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-black truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-xs text-neutral-500 truncate">
                          {c.phone ? `+${c.phone}` : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No WhatsApp contacts yet"
                  description="Add team member phone numbers to start WhatsApp conversations from Plethora."
                  action={
                    <Link href="/employees" className="btn-primary px-3 py-1.5 text-xs">
                      Manage team
                    </Link>
                  }
                />
              )}
              <Link
                href="/employees"
                className="mt-3 text-sm text-center text-neutral-600 hover:text-black font-medium"
              >
                Manage Team →
              </Link>
            </div>
          )}
        </div>

        {/* Conversation area */}
        <div className="md:col-span-2 card-dashboard border-neutral-200 flex flex-col min-h-[400px] md:h-[calc(100dvh-13rem)] overflow-hidden">
          {selectedContact ? (
            <>
              <div className="p-4 border-b border-neutral-200 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center text-black font-semibold">
                  {selectedContact.firstName?.charAt(0)}{selectedContact.lastName?.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-black">
                    {selectedContact.firstName} {selectedContact.lastName}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {selectedContact.phone ? `+${selectedContact.phone}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedContact(null)}
                  className="ml-auto text-sm text-neutral-500 hover:text-black"
                  aria-label="Close conversation"
                >
                  Close
                </button>
              </div>

              <ConversationView
                messages={messages}
                onRefresh={fetchMessages}
                isLoading={loadingMessages}
              />

              <div className="p-4 border-t border-neutral-200">
                {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
                {requiresTemplate ? (
                  <div className="space-y-2">
                    <p className="text-sm text-neutral-600">
                      Free-form messages require the contact to have messaged recently. Send a template instead:
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={selectedTemplate}
                        onChange={(e) => setSelectedTemplate(e.target.value)}
                        className="input-compact flex-1"
                        aria-label="Template message"
                      >
                        <option value="">Select template</option>
                        {templates.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleSendTemplate}
                        disabled={!selectedTemplate || sending}
                        className="btn-primary px-4 py-2 text-sm"
                      >
                        {sending ? "Sending..." : "Send Template"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRequiresTemplate(false)}
                      className="text-xs text-neutral-500 hover:text-black"
                    >
                      Try free-form again
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder="Type your message..."
                      rows={2}
                      className="input-modern min-h-20 flex-1 resize-none"
                      aria-label="Message"
                      disabled={sending}
                    />
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim() || sending}
                      className="btn-primary self-end px-4 py-2 text-sm"
                    >
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 p-8">
              <svg
                className="w-16 h-16 mb-4 text-neutral-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm font-medium">Select a contact to view conversation</p>
              <p className="text-xs mt-1">Click a contact on the left to start messaging</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
