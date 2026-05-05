"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  const [requiresTemplate, setRequiresTemplate] = useState(false);
  const [templates, setTemplates] = useState<{ name: string; language: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [contactSearchOpen, setContactSearchOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");

  const fetchContacts = useCallback(async () => {
    if (!token) return;
    setLoadingContacts(true);
    try {
      const { data } = await getWhatsAppContacts(token, { limit: 50 });
      setContacts(data);
    } catch (e) {
      console.error(e);
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }, [token]);

  const fetchMessages = useCallback(async () => {
    if (!token || !selectedContact) return;
    setLoadingMessages(true);
    try {
      const { data } = await getWhatsAppMessages(token, selectedContact.id, { limit: 50 });
      setMessages(data);
    } catch (e) {
      console.error(e);
      setMessages([]);
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

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    const digits = q.replace(/\D/g, "");
    return contacts.filter((c) => {
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      const phone = String(c.phone ?? "").replace(/\D/g, "");
      if (name.includes(q)) return true;
      if (digits.length >= 1 && phone.includes(digits)) return true;
      return false;
    });
  }, [contacts, contactSearch]);

  const showContactSearch = contactSearchOpen;

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
    <div className="module-shell max-w-5xl">
      <div>
        <h1 className="page-title">WhatsApp</h1>
        <p className="mt-2 max-w-2xl text-sm text-black">
          Message team members and view conversation history
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contact list */}
        <div className="md:col-span-1">
          {loadingContacts ? (
            <div className="card-dashboard p-5 animate-pulse">
              <div className="h-6 bg-[var(--bg-nav-hover)] rounded w-24 mb-4" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-[var(--bg-nav-hover)] rounded-security" />
                ))}
              </div>
            </div>
          ) : (
            <div className="card-dashboard p-5 flex flex-col md:h-[calc(100vh-13rem)] overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="section-title mb-0 flex-1 min-w-0">Contacts</h2>
                <button
                  type="button"
                  className={`shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-security border transition-colors focus-ring ${
                    showContactSearch
                      ? "border-security-navy-400 bg-security-navy-50 text-black"
                      : "border-[var(--hairline)] bg-white hover:bg-[var(--bg-nav-hover)] text-black"
                  }`}
                  onClick={() =>
                    setContactSearchOpen((open) => {
                      if (open) setContactSearch("");
                      return !open;
                    })
                  }
                  aria-expanded={showContactSearch}
                  aria-controls="whatsapp-contact-search"
                  title="Search contacts"
                >
                  <span className="sr-only">Search contacts</span>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
              {showContactSearch && (
                <div className="mb-3 shrink-0" id="whatsapp-contact-search">
                  <label htmlFor="whatsapp-contact-query" className="sr-only">
                    Filter contacts by name or phone
                  </label>
                  <input
                    id="whatsapp-contact-query"
                    type="search"
                    autoComplete="off"
                    placeholder="Search by name or number…"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[var(--hairline-strong)] rounded-security bg-white text-black placeholder:text-black/45 focus:outline-none focus:border-security-navy-600 focus:ring-2 focus:ring-security-navy-200"
                  />
                </div>
              )}
              {contacts.length > 0 ? (
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedContact(c)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-security text-left transition-colors focus-ring ${
                        selectedContact?.id === c.id ? "bg-security-navy-50 border border-security-navy-300" : "hover:bg-[var(--bg-nav-hover)] border border-transparent"
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full bg-security-navy-100 border border-security-navy-300 flex items-center justify-center text-black font-bold text-sm shrink-0">
                        {c.firstName?.charAt(0)}{c.lastName?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-black truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-xs text-black truncate">
                          {c.phone ? `+${c.phone}` : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && (
                    <p className="text-sm text-black/70 px-3 py-2">No contacts match your search.</p>
                  )}
                </div>
              ) : (
                <div className="empty-state mt-2">
                  <p className="empty-state-body">
                    No team members with WhatsApp numbers. Add phone numbers in Team.
                  </p>
                </div>
              )}
              <Link
                href="/employees"
                className="link-inline mt-3 text-sm text-center font-semibold"
              >
                Manage Team →
              </Link>
            </div>
          )}
        </div>

        {/* Conversation area */}
        <div className="md:col-span-2 card-dashboard flex flex-col min-h-[400px] md:h-[calc(100vh-13rem)] overflow-hidden">
          {selectedContact ? (
            <>
              <div className="p-4 border-b border-[var(--hairline)] flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-security-navy-100 border border-security-navy-300 flex items-center justify-center text-black font-bold">
                  {selectedContact.firstName?.charAt(0)}{selectedContact.lastName?.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-black">
                    {selectedContact.firstName} {selectedContact.lastName}
                  </p>
                  <p className="text-xs text-black">
                    {selectedContact.phone ? `+${selectedContact.phone}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedContact(null)}
                  className="ml-auto btn-ghost text-sm min-h-9"
                >
                  Close
                </button>
              </div>

              <ConversationView
                messages={messages}
                onRefresh={fetchMessages}
                isLoading={loadingMessages}
              />

              <div className="p-4 border-t border-[var(--hairline)]">
                {error && (
                  <div className="notice-error mb-2 text-xs py-2">{error}</div>
                )}
                {requiresTemplate ? (
                  <div className="space-y-2">
                    <p className="text-sm text-black">
                      Free-form messages require the contact to have messaged recently. Send a template instead:
                    </p>
                    <div className="flex gap-2">
                      <select
                        value={selectedTemplate}
                        onChange={(e) => setSelectedTemplate(e.target.value)}
                        className="input-compact flex-1"
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
                        className="btn-primary text-sm min-h-10 py-2"
                      >
                        {sending ? "Sending..." : "Send Template"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRequiresTemplate(false)}
                      className="link-inline text-xs"
                    >
                      Try free-form again
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder="Type your message..."
                      rows={2}
                      className="flex-1 px-3 py-2 text-sm border border-[var(--hairline-strong)] rounded-security resize-none focus:outline-none focus:border-security-navy-600 focus:ring-2 focus:ring-security-navy-200 bg-white"
                      disabled={sending}
                    />
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim() || sending}
                      className="btn-primary text-sm self-end"
                    >
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-black p-8 text-center">
              <svg
                className="w-16 h-16 mb-4 text-security-navy-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm font-semibold">Select a contact to view conversation</p>
              <p className="text-xs mt-1">Click a contact on the left to start messaging</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
