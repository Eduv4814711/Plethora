"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getIncident, reviewIncident, uploadIncidentAttachment, type Incident } from "@/lib/msr-api";
import { AlertBanner, Badge, PageHeader } from "@/components/ui";

export default function IncidentDetailPage() {
  const { token } = useAuth();
  const params = useParams();
  const id = params.id as string;
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !id) return;
    setError("");
    try {
      const data = await getIncident(token, id);
      setIncident(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load incident");
      setIncident(null);
    }
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [token, refresh]);

  const handleReview = async (action: "approve" | "reject" | "query" | "close") => {
    if (!token) return;
    setActing(true);
    setError("");
    try {
      await reviewIncident(token, id, action, note.trim() || undefined);
      setNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse h-48 bg-neutral-200 rounded-lg" />;
  }

  if (!incident) {
    return (
      <div className="max-w-3xl mx-auto">
        <AlertBanner variant="error">{error || "Incident not found"}</AlertBanner>
        <Link href="/incidents" className="btn-secondary mt-4 inline-block">Back to incidents</Link>
      </div>
    );
  }

  const canReview = ["SUBMITTED", "UNDER_REVIEW"].includes(incident.status);

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <Link href="/incidents" className="text-sm text-security-navy-700 hover:underline mb-4 inline-block">
        ← Back to incidents
      </Link>

      <PageHeader
        title={incident.title}
        description={`${incident.incidentNumber} · ${incident.site?.name ?? "Site"}`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant="neutral">{incident.status.replace(/_/g, " ")}</Badge>
        <Badge variant={incident.severity === "CRITICAL" ? "error" : "warning"}>
          {incident.severity}
        </Badge>
        <Badge variant="neutral">{incident.incidentType.replace(/_/g, " ")}</Badge>
      </div>

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      <article className="card-dashboard p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-700">When</h2>
          <p className="text-neutral-900">{new Date(incident.incidentDateTime).toLocaleString()}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-neutral-700">Description</h2>
          <p className="text-neutral-900 whitespace-pre-wrap">{incident.description}</p>
        </div>
        {incident.peopleInvolved && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">People involved</h2>
            <p className="text-neutral-900 whitespace-pre-wrap">{incident.peopleInvolved}</p>
          </div>
        )}
        {incident.witnesses && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">Witnesses</h2>
            <p className="text-neutral-900 whitespace-pre-wrap">{incident.witnesses}</p>
          </div>
        )}
        {incident.reportedBy && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">Reported by</h2>
            <p className="text-neutral-900">{incident.reportedBy.name}</p>
          </div>
        )}
      </article>

      <section className="card-dashboard mt-4 p-4">
        <h2 className="section-title mb-3">Photos & documents</h2>
        {incident.attachments && incident.attachments.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {incident.attachments.map((a) => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-security-navy-800 hover:underline">
                  {a.filename}
                </a>
              </li>
            ))}
          </ul>
        )}
        <label className="btn-secondary text-sm py-1.5 inline-block cursor-pointer">
          Upload file
          <input
            type="file"
            className="sr-only"
            accept="image/*,application/pdf"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!token || !file) return;
              try {
                await uploadIncidentAttachment(token, id, file);
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
      </section>

      {canReview && (
        <section className="card-dashboard mt-4 p-4">
          <h2 className="section-title mb-3">Supervisor review</h2>
          <label htmlFor="review-note" className="label-text block mb-1">Notes (optional)</label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input-modern w-full mb-3"
            rows={3}
            placeholder="Add context for your decision"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-sm py-1.5" disabled={acting} onClick={() => handleReview("approve")}>
              Approve
            </button>
            <button type="button" className="btn-secondary text-sm py-1.5" disabled={acting} onClick={() => handleReview("query")}>
              Raise query
            </button>
            <button type="button" className="btn-destructive text-sm py-1.5" disabled={acting} onClick={() => handleReview("reject")}>
              Reject
            </button>
            <button type="button" className="btn-ghost text-sm py-1.5" disabled={acting} onClick={() => handleReview("close")}>
              Close incident
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
