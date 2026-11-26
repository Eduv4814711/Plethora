"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  getWhatsAppContacts,
  getWhatsAppMessages,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  getWhatsAppTemplates,
  suggestWhatsAppReplies,
  polishWhatsAppDraft,
  type WhatsAppContact,
  type WhatsAppMessage,
  type WhatsAppTemplate,
  type WhatsAppAiSuggestResponse,
} from "@/lib/api";
import { ConversationView } from "@/components/whatsapp/conversation-view";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

function focusComposerInput() {
  if (typeof document !== "undefined") {
    const el = document.getElementById("whatsapp-composer-input");
    if (el instanceof HTMLTextAreaElement) el.focus();
  }
}

export default function WhatsAppPage() {
  const { token, user } = useAuth();
  const canSend = Boolean(user && hasCapability(user, "/whatsapp", "create"));
  const searchParams = useSearchParams();

  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<WhatsAppContact | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [requiresTemplate, setRequiresTemplate] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [templateParams, setTemplateParams] = useState<Record<number, string>>({});

  const [aiAssist, setAiAssist] = useState<WhatsAppAiSuggestResponse | null>(null);
  const [loadingAiSuggest, setLoadingAiSuggest] = useState(false);
  const [polishingDraft, setPolishingDraft] = useState(false);

  const selectedTemplate = templates.find(
    (t) => `${t.name}::${t.language}` === selectedTemplateKey
  );

  const getTemplateBodyInfo = useCallback((template?: WhatsAppTemplate) => {
    if (!template) return { bodyText: "", paramCount: 0, examples: [] as string[] };
    const bodyComponent = template.components?.find(
      (c) => String(c.type).toUpperCase() === "BODY"
    );
    const bodyText = bodyComponent?.text ?? "";
    const examples = bodyComponent?.example?.body_text?.[0] ?? [];
    const matches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g));
    let paramCount = matches.length > 0 ? Math.max(...matches.map((m) => parseInt(m[1], 10))) : 0;
    if (paramCount === 0 && template.name === "employee_roster_update") {
      paramCount = 4;
    }
    return { bodyText, paramCount, examples };
  }, []);

  const bodyInfo = getTemplateBodyInfo(selectedTemplate);

  const fetchContacts = useCallback(async () => {
    if (!token) return;
    setLoadingContacts(true);
    setFetchError(null);
    try {
      const { data } = await getWhatsAppContacts(token, { limit: 100 });
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
      const { data } = await getWhatsAppMessages(token, selectedContact.id, { limit: 60 });
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
    setAiAssist(null);
    setError(null);
    if (selectedContact) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [selectedContact, fetchMessages]);

  useEffect(() => {
    if (requiresTemplate && token) {
      setLoadingTemplates(true);
      setTemplateLoadError(null);
      getWhatsAppTemplates(token)
        .then((r) => {
          setTemplates(r.data);
          if (r.data.length === 0) {
            setTemplateLoadError("No approved WhatsApp templates found in your Meta account.");
          }
        })
        .catch((e) => {
          setTemplates([]);
          setTemplateLoadError(
            e instanceof Error ? e.message : "Failed to load approved templates from Meta."
          );
        })
        .finally(() => {
          setLoadingTemplates(false);
        });
    }
  }, [requiresTemplate, token]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.jobRole ?? "").toLowerCase().includes(q)
      );
    });
  }, [contacts, contactSearch]);

  const handleRequestAiSuggestions = async () => {
    if (!token || !selectedContact) return;
    setLoadingAiSuggest(true);
    setError(null);
    try {
      const res = await suggestWhatsAppReplies(token, selectedContact.id);
      setAiAssist(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate AI suggestions");
    } finally {
      setLoadingAiSuggest(false);
    }
  };

  const handlePolishDraft = async () => {
    if (!token || !selectedContact || messageInput.trim().length < 2) return;
    setPolishingDraft(true);
    setError(null);
    try {
      const res = await polishWhatsAppDraft(token, selectedContact.id, messageInput.trim());
      setMessageInput(res.polished);
      focusComposerInput();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to polish draft");
    } finally {
      setPolishingDraft(false);
    }
  };

  const handleSendMessage = async () => {
    if (!token || !canSend || !selectedContact || !messageInput.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendWhatsAppMessage(token, selectedContact.id, messageInput.trim());
      if (result.success) {
        setMessageInput("");
        setRequiresTemplate(false);
        fetchMessages();
        fetchContacts();
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
    if (!token || !canSend || !selectedContact || !selectedTemplate) return;

    const { paramCount } = bodyInfo;
    if (paramCount > 0) {
      for (let i = 1; i <= paramCount; i++) {
        if (!templateParams[i]?.trim()) {
          setError(`Please fill in parameter ${i} for this template.`);
          return;
        }
      }
    }

    setSending(true);
    setError(null);
    try {
      const components =
        paramCount > 0
          ? [
              {
                type: "body",
                parameters: Array.from({ length: paramCount }, (_, idx) => ({
                  type: "text",
                  text: templateParams[idx + 1]!.trim(),
                })),
              },
            ]
          : undefined;

      const result = await sendWhatsAppTemplate(token, selectedContact.id, selectedTemplate.name, {
        languageCode: selectedTemplate.language,
        components,
      });

      if (result.success) {
        setRequiresTemplate(false);
        setSelectedTemplateKey("");
        setTemplateParams({});
        fetchMessages();
        fetchContacts();
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
    <div className="mx-auto max-w-[1440px] space-y-6 animate-fade-in">
      <PageHeader
        title="WhatsApp operations"
        description="Coordinate guards and office staff, review automated field conversations, and draft replies with Kimi K3.1."
        actions={
          <Link href="/employees" className="btn-secondary px-3 py-2 text-xs">
            Manage team numbers
          </Link>
        }
      />

      {fetchError ? <AlertBanner variant="error">{fetchError}</AlertBanner> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* Contact directory & recent threads */}
        <div className="md:col-span-4">
          {loadingContacts ? (
            <Card className="p-5 animate-pulse">
              <div className="mb-4 h-8 w-full rounded bg-security-navy-100" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-16 rounded bg-security-navy-50" />
                ))}
              </div>
            </Card>
          ) : (
            <Card className="flex flex-col overflow-hidden border-security-navy-100 p-4 md:h-[calc(100dvh-13.5rem)]">
              <div className="mb-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-security-navy-900">
                    Team threads
                  </h2>
                  <span className="font-mono text-xs tabular-nums text-security-navy-500">
                    {filteredContacts.length}
                  </span>
                </div>
                <Input
                  density="compact"
                  type="search"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search name, role, or phone..."
                  aria-label="Search WhatsApp contacts"
                />
              </div>

              {filteredContacts.length > 0 ? (
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                  {filteredContacts.map((c) => {
                    const isSelected = selectedContact?.id === c.id;
                    const roleLabel =
                      c.jobRole ||
                      (c.employeeType === "general" ? "Office staff" : "Security officer");
                    const timeAgo = c.lastMessageAt
                      ? formatDistanceToNowStrict(new Date(c.lastMessageAt), { addSuffix: true })
                      : null;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedContact(c)}
                        className={`flex w-full items-start gap-3 rounded-security px-3 py-2.5 text-left transition-colors ${
                          isSelected
                            ? "border border-security-navy-200 bg-security-navy-50"
                            : "border border-transparent hover:bg-security-navy-50/70"
                        }`}
                      >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-security-navy-900 text-xs font-semibold text-white">
                          {c.firstName?.charAt(0)}
                          {c.lastName?.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-security-navy-900">
                              {c.firstName} {c.lastName}
                            </p>
                            {timeAgo ? (
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-security-navy-400">
                                {timeAgo}
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-security-navy-500">
                            {roleLabel} {c.phone ? `• +${c.phone}` : ""}
                          </p>
                          {c.lastMessageText ? (
                            <p className="mt-0.5 truncate text-xs text-security-navy-600">
                              {c.lastMessageDirection === "outbound" ? "Sent: " : ""}
                              {c.lastMessageText}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title={contactSearch ? "No matching contacts" : "No WhatsApp contacts yet"}
                  description={
                    contactSearch
                      ? "Try clearing the search filter."
                      : "Add active employee phone numbers in Team to enable WhatsApp communication."
                  }
                  action={
                    contactSearch ? (
                      <Button variant="secondary" size="sm" onClick={() => setContactSearch("")}>
                        Clear filter
                      </Button>
                    ) : (
                      <Link href="/employees" className="btn-primary px-3 py-1.5 text-xs">
                        Manage team
                      </Link>
                    )
                  }
                />
              )}
            </Card>
          )}
        </div>

        {/* Conversation & AI Co-Pilot area */}
        <Card className="flex min-h-[460px] flex-col overflow-hidden border-security-navy-100 md:col-span-8 md:h-[calc(100dvh-13.5rem)]">
          {selectedContact ? (
            <>
              {/* Conversation Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-security-navy-100 px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-security-navy-100 font-semibold text-security-navy-900">
                    {selectedContact.firstName?.charAt(0)}
                    {selectedContact.lastName?.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-display text-sm font-semibold text-security-navy-900">
                        {selectedContact.firstName} {selectedContact.lastName}
                      </p>
                      <Badge variant="neutral">
                        {selectedContact.jobRole ||
                          (selectedContact.employeeType === "general"
                            ? "Office staff"
                            : "Security officer")}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs tabular-nums text-security-navy-500">
                      {selectedContact.phone ? `+${selectedContact.phone}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {canSend ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={loadingAiSuggest}
                      onClick={handleRequestAiSuggestions}
                    >
                      AI assist
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={fetchMessages}>
                    Refresh
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedContact(null)}>
                    Close
                  </Button>
                </div>
              </div>

              {/* Collapsible AI Co-Pilot Context & Smart Reply Bar */}
              {aiAssist ? (
                <div className="border-b border-security-navy-100 bg-security-navy-50/70 px-4 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-security-navy-900">
                        Control room brief
                      </span>
                      <Badge
                        variant={
                          aiAssist.operationalSnapshot.activeDuty.clockedIn ? "success" : "neutral"
                        }
                      >
                        {aiAssist.operationalSnapshot.activeDuty.clockedIn
                          ? `On duty: ${aiAssist.operationalSnapshot.activeDuty.siteName ?? "Site"}`
                          : "Off duty"}
                      </Badge>
                      {aiAssist.operationalSnapshot.nextShift ? (
                        <span className="text-security-navy-600">
                          Next: {aiAssist.operationalSnapshot.nextShift.date} (
                          {aiAssist.operationalSnapshot.nextShift.startTime}–
                          {aiAssist.operationalSnapshot.nextShift.endTime}) at{" "}
                          {aiAssist.operationalSnapshot.nextShift.site}
                        </span>
                      ) : null}
                      {aiAssist.operationalSnapshot.compliance.psiraGrade ? (
                        <span className="font-mono text-[11px] text-security-navy-500">
                          PSIRA {aiAssist.operationalSnapshot.compliance.psiraGrade}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAiAssist(null)}
                      className="text-xs text-security-navy-500 hover:text-security-navy-900"
                    >
                      Dismiss
                    </button>
                  </div>

                  <p className="text-xs leading-relaxed text-security-navy-700">
                    {aiAssist.summary}
                  </p>

                  {aiAssist.suggestions.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-security-navy-500">
                        Click a suggested reply to insert into your draft:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAssist.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setMessageInput(suggestion);
                              setRequiresTemplate(false);
                              focusComposerInput();
                            }}
                            className="rounded-security border border-security-navy-200 bg-white px-2.5 py-1.5 text-left text-xs text-security-navy-800 transition-colors hover:border-security-navy-400 hover:bg-security-navy-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <ConversationView
                messages={messages}
                onRefresh={fetchMessages}
                isLoading={loadingMessages}
              />

              {canSend ? (
                <div className="border-t border-security-navy-100 bg-white p-4">
                  {error ? <p className="mb-2 text-xs font-medium text-red-700">{error}</p> : null}

                  {requiresTemplate ? (
                    <div className="space-y-3">
                      <p className="text-sm text-security-navy-600">
                        Free-form messages require the contact to have messaged within the last 24
                        hours. Send an approved template message:
                      </p>

                      {templateLoadError ? (
                        <AlertBanner variant="error">{templateLoadError}</AlertBanner>
                      ) : null}

                      {loadingTemplates ? (
                        <p className="animate-pulse text-xs text-security-navy-500">
                          Loading approved templates from Meta...
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Select
                              density="compact"
                              value={selectedTemplateKey}
                              onChange={(e) => {
                                setSelectedTemplateKey(e.target.value);
                                setTemplateParams({});
                                setError(null);
                              }}
                              className="flex-1"
                              aria-label="Template message"
                              disabled={sending || templates.length === 0}
                            >
                              <option value="">
                                {templates.length === 0
                                  ? "No approved templates available"
                                  : "Select approved template"}
                              </option>
                              {templates.map((t) => (
                                <option
                                  key={`${t.name}::${t.language}`}
                                  value={`${t.name}::${t.language}`}
                                >
                                  {t.name} ({t.language})
                                </option>
                              ))}
                            </Select>
                          </div>

                          {selectedTemplate ? (
                            <div className="space-y-3 rounded-security border border-security-navy-100 bg-security-navy-50 p-3 text-xs">
                              {bodyInfo.bodyText ? (
                                <div>
                                  <span className="mb-1 block font-semibold text-security-navy-700">
                                    Template preview
                                  </span>
                                  <p className="rounded border border-security-navy-100 bg-white p-2 italic text-security-navy-600">
                                    {bodyInfo.bodyText}
                                  </p>
                                </div>
                              ) : null}

                              {bodyInfo.paramCount > 0 ? (
                                <div className="space-y-2">
                                  <span className="block font-semibold text-security-navy-700">
                                    Required parameters ({bodyInfo.paramCount})
                                  </span>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {Array.from({ length: bodyInfo.paramCount }, (_, idx) => {
                                      const paramNum = idx + 1;
                                      const placeholder =
                                        bodyInfo.examples[idx] ||
                                        (selectedTemplate.name === "employee_roster_update"
                                          ? [
                                              "Employee Name",
                                              "Shift Date",
                                              "Site / Post",
                                              "Supervisor / Contact",
                                            ][idx]
                                          : `Parameter {{${paramNum}}}`);
                                      return (
                                        <div key={paramNum} className="space-y-1">
                                          <label className="font-medium text-security-navy-600">
                                            Parameter {paramNum} {`{{${paramNum}}}`}
                                          </label>
                                          <Input
                                            density="compact"
                                            type="text"
                                            value={templateParams[paramNum] ?? ""}
                                            onChange={(e) =>
                                              setTemplateParams((prev) => ({
                                                ...prev,
                                                [paramNum]: e.target.value,
                                              }))
                                            }
                                            placeholder={placeholder}
                                            disabled={sending}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-security-navy-500">
                                  This template requires no parameters.
                                </p>
                              )}

                              <div className="flex justify-end pt-1">
                                <Button
                                  variant="signal"
                                  size="sm"
                                  loading={sending}
                                  onClick={handleSendTemplate}
                                >
                                  Send template
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRequiresTemplate(false);
                          setError(null);
                        }}
                      >
                        Try free-form message instead
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Textarea
                        id="whatsapp-composer-input"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder={`Message ${selectedContact.firstName}...`}
                        rows={2}
                        className="min-h-20 resize-none"
                        aria-label="Message"
                        disabled={sending}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-security-navy-500">
                          Automated bot & AI replies appear directly in this thread.
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={polishingDraft}
                            disabled={messageInput.trim().length < 4 || sending}
                            onClick={handlePolishDraft}
                          >
                            Polish with AI
                          </Button>
                          <Button
                            variant="signal"
                            size="sm"
                            loading={sending}
                            disabled={!messageInput.trim()}
                            onClick={handleSendMessage}
                          >
                            Send message
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="border-t border-security-navy-100 p-4 text-sm text-security-navy-500">
                  You have view-only access to WhatsApp.
                </div>
              )}
            </>
          ) : (
            <EmptyState
              className="m-auto max-w-md"
              title="Select a conversation"
              description="Choose a team member on the left to view two-way WhatsApp history, inspect live duty status, and generate AI-assisted replies."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
