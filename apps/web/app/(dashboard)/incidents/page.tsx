"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { createIncident, listIncidents, type Incident } from "@/lib/msr-api";
import { AlertBanner, Badge, EmptyState, PageHeader } from "@/components/ui";

const INCIDENT_TYPES = [
  { value: "THEFT", label: "Theft" },
  { value: "BREAK_IN", label: "Break-in" },
  { value: "ASSAULT", label: "Assault" },
  { value: "GUARD_MISCONDUCT", label: "Guard misconduct" },
  { value: "CLIENT_COMPLAINT", label: "Client complaint" },
  { value: "EQUIPMENT_DAMAGE", label: "Equipment damage" },
  { value: "SITE_EMERGENCY", label: "Site emergency" },
  { value: "SAFETY_RISK", label: "Safety risk" },
  { value: "ABSENTEEISM", label: "Absenteeism" },
  { value: "TRESPASSING", label: "Trespassing" },
  { value: "FIRE", label: "Fire" },
  { value: "MEDICAL_EMERGENCY", label: "Medical emergency" },
  { value: "OTHER", label: "Other" },
];

function severityBadge(severity: string) {
  const v = severity.toLowerCase();
  if (v === "critical") return <Badge variant="error">Critical</Badge>;
  if (v === "high") return <Badge variant="warning">High</Badge>;
  if (v === "medium") return <Badge variant="warning">Medium</Badge>;
  return <Badge variant="neutral">Low</Badge>;
}

export default function IncidentsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/incidents", "create"));
  const [items, setItems] = useState<Incident[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formSiteId, setFormSiteId] = useState("");
  const [formType, setFormType] = useState("OTHER");
  const [formSeverity, setFormSeverity] = useState("MEDIUM");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDateTime, setFormDateTime] = useState("");
  const [formClientVisible, setFormClientVisible] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const result = await listIncidents(token, {
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        limit: 100,
      });
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load incidents");
      setItems([]);
    }
  }, [token, statusFilter, severityFilter]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      refresh(),
      authFetch("/sites?limit=100", token)
        .then((r) => r.json())
        .then((d) => setSites(d.data ?? []))
        .catch(() => setSites([])),
    ]).finally(() => setLoading(false));
  }, [token, refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canCreate || !formSiteId || !formTitle.trim() || !formDescription.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await createIncident(token, {
        siteId: formSiteId,
        incidentType: formType,
        severity: formSeverity,
        title: formTitle.trim(),
        description: formDescription.trim(),
        incidentDateTime: formDateTime || new Date().toISOString(),
        clientVisible: formClientVisible,
        submit: true,
      });
      setShowForm(false);
      setFormTitle("");
      setFormDescription("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to report incident");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-security-navy-100 rounded-lg" />
        <div className="h-32 bg-security-navy-100 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Incidents"
        description="Report and track security incidents across your sites."
        actions={canCreate ? (
          <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
            Report incident
          </button>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-compact w-auto"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="APPROVED">Approved</option>
          <option value="CLOSED">Closed</option>
          <option value="DRAFT">Draft</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="input-compact w-auto"
          aria-label="Filter by severity"
        >
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      {showForm && canCreate && (
        <div className="card-dashboard mb-6 p-4">
          <h2 className="section-title mb-3">Report incident</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="inc-site" className="label-text block mb-1">Site *</label>
                <select
                  id="inc-site"
                  value={formSiteId}
                  onChange={(e) => setFormSiteId(e.target.value)}
                  className="input-modern w-full"
                  required
                >
                  <option value="">Select site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="inc-datetime" className="label-text block mb-1">Date & time</label>
                <input
                  id="inc-datetime"
                  type="datetime-local"
                  value={formDateTime}
                  onChange={(e) => setFormDateTime(e.target.value)}
                  className="input-modern w-full"
                />
              </div>
              <div>
                <label htmlFor="inc-type" className="label-text block mb-1">Type</label>
                <select id="inc-type" value={formType} onChange={(e) => setFormType(e.target.value)} className="input-modern w-full">
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="inc-severity" className="label-text block mb-1">Severity</label>
                <select id="inc-severity" value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)} className="input-modern w-full">
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="inc-title" className="label-text block mb-1">Title *</label>
              <input id="inc-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="input-modern w-full" required />
            </div>
            <div>
              <label htmlFor="inc-desc" className="label-text block mb-1">What happened? *</label>
              <textarea id="inc-desc" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="input-modern w-full" rows={4} required />
            </div>
            <label className="flex items-center gap-2 text-sm text-security-navy-700 cursor-pointer">
              <input type="checkbox" checked={formClientVisible} onChange={(e) => setFormClientVisible(e.target.checked)} className="rounded" />
              Visible to client in portal
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit report"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/incidents/${item.id}`}
            className="card-dashboard block p-4 hover:border-security-navy-200 transition-colors"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-mono text-security-navy-500">{item.incidentNumber}</p>
                <h2 className="font-semibold text-security-navy-900 truncate">{item.title}</h2>
                <p className="mt-1 text-sm text-security-navy-600">
                  {item.site?.name ?? "Unknown site"} · {new Date(item.incidentDateTime).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {severityBadge(item.severity)}
                <Badge variant="neutral">{item.status.replace(/_/g, " ")}</Badge>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {items.length === 0 && (
        <EmptyState
          className="mt-6"
          title="No incidents recorded"
          description="Report incidents to keep a clear record and notify supervisors."
          action={canCreate ? (
            <button type="button" className="btn-primary text-sm py-1.5" onClick={() => setShowForm(true)}>
              Report incident
            </button>
          ) : undefined}
        />
      )}
    </div>
  );
}
