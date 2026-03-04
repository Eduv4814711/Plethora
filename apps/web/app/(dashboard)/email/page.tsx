"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listEmails, sendManualEmail, authFetch, type EmailLogItem } from "@/lib/api";
import { format } from "date-fns";
import { clsx } from "clsx";

type Tab = "sent" | "compose";

export default function EmailPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("sent");
  const [emails, setEmails] = useState<EmailLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || activeTab !== "sent") return;
    setLoading(true);
    listEmails(token, { limit: 50 })
      .then((r) => {
        setEmails(r.data);
        setTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, activeTab]);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title">Email</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
            View sent emails and compose new messages
          </p>
        </div>
        <Link
          href="/settings?tab=email"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configure SMTP
        </Link>
      </div>

      <div className="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-700">
        <button
          onClick={() => setActiveTab("sent")}
          className={clsx(
            "px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors",
            activeTab === "sent"
              ? "bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 border-b-transparent -mb-px"
              : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          )}
        >
          Sent
        </button>
        <button
          onClick={() => setActiveTab("compose")}
          className={clsx(
            "px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors",
            activeTab === "compose"
              ? "bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 border-b-transparent -mb-px"
              : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          )}
        >
          Compose
        </button>
      </div>

      <div className="card-wireframe p-6">
        {activeTab === "sent" && (
          <SentTab
            emails={emails}
            total={total}
            loading={loading}
            expandedId={expandedId}
            onExpand={setExpandedId}
            onRefresh={() => activeTab === "sent" && token && listEmails(token).then((r) => { setEmails(r.data); setTotal(r.total); })}
          />
        )}
        {activeTab === "compose" && token && (
          <ComposeTab
            token={token}
            onSent={() => {
              setActiveTab("sent");
              listEmails(token).then((r) => { setEmails(r.data); setTotal(r.total); });
            }}
          />
        )}
      </div>
    </div>
  );
}

function SentTab({
  emails,
  total,
  loading,
  expandedId,
  onExpand,
  onRefresh,
}: {
  emails: EmailLogItem[];
  total: number;
  loading: boolean;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-10 h-10 rounded-lg bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500 dark:text-neutral-400">No emails sent yet.</p>
        <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
          Use the Compose tab to send your first email. Configure SMTP in Settings if needed.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">{total} email{total !== 1 ? "s" : ""} sent</span>
        <button onClick={onRefresh} className="text-sm text-neutral-600 dark:text-neutral-400 hover:underline">
          Refresh
        </button>
      </div>
      <div className="space-y-2">
        {emails.map((e) => (
          <div
            key={e.id}
            className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden"
          >
            <button
              onClick={() => onExpand(expandedId === e.id ? null : e.id)}
              className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-neutral-900 dark:text-white truncate">{e.subject}</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                  To: {e.to}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                  {format(new Date(e.sentAt), "d MMM yyyy, HH:mm")}
                  {e.sentBy?.name && ` · ${e.sentBy.name}`}
                  <span className={clsx("ml-2", e.status === "sent" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                    {e.status}
                  </span>
                </p>
              </div>
              <svg
                className={clsx("w-5 h-5 text-neutral-400 shrink-0 transition-transform", expandedId === e.id && "rotate-180")}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedId === e.id && (
              <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                <pre className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap font-sans">
                  {e.body}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComposeTab({ token, onSent }: { token: string; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; firstName: string; lastName: string; email: string | null }>>([]);

  useEffect(() => {
    authFetch("/employees?limit=500", token)
      .then((r) => r.json())
      .then((d) => setEmployees(d.data || []))
      .catch(() => setEmployees([]));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = to
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (recipients.length === 0) {
      setError("Enter at least one recipient email");
      return;
    }
    const invalid = recipients.filter((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
    if (invalid.length > 0) {
      setError(`Invalid email: ${invalid[0]}`);
      return;
    }
    if (!subject.trim()) {
      setError("Enter a subject");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendManualEmail(token, {
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: subject.trim(),
        body: body.trim() || "(No content)",
      });
      setTo("");
      setSubject("");
      setBody("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  };

  const addEmployeeEmail = (email: string) => {
    if (!email) return;
    setTo((prev) => (prev ? `${prev}, ${email}` : email));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
          To (comma-separated emails)
        </label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input-modern"
          placeholder="john@example.com, jane@example.com"
        />
        {employees.filter((emp) => emp.email).length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Quick add from team:</p>
            <div className="flex flex-wrap gap-1">
              {employees
                .filter((emp) => emp.email)
                .slice(0, 10)
                .map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => addEmployeeEmail(emp.email!)}
                    className="px-2 py-1 text-xs rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {emp.firstName} {emp.lastName}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="input-modern"
          placeholder="Email subject"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input-modern min-h-[160px]"
          placeholder="Write your message..."
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <button type="submit" disabled={sending} className="btn-primary">
        {sending ? "Sending…" : "Send Email"}
      </button>
    </form>
  );
}
