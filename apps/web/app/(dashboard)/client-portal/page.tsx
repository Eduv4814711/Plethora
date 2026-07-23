"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getClientAttendanceSummary,
  getClientPortalDashboard,
  getClientPortalIncidents,
  listClients,
  type Incident,
} from "@/lib/msr-api";
import { hasCapability } from "@/lib/permissions";
import { AlertBanner, Badge, PageHeader } from "@/components/ui";

interface ClientSite {
  id: string;
  name: string;
  siteStatus?: string;
  riskLevel?: string;
  physicalAddress?: string | null;
}

export default function ClientPortalPage() {
  const { token, user } = useAuth();
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [sites, setSites] = useState<ClientSite[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [attendance, setAttendance] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adminClients, setAdminClients] = useState<{ id: string; name: string }[]>([]);
  const [previewClientId, setPreviewClientId] = useState("");

  const loadPortal = useCallback(async (clientId?: string) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [dash, inc, att] = await Promise.all([
        getClientPortalDashboard(token, clientId),
        getClientPortalIncidents(token, clientId),
        getClientAttendanceSummary(token, clientId ? { clientId } : undefined),
      ]);
      setDashboard(dash);
      setSites((dash.sites as ClientSite[]) ?? []);
      setIncidents(inc);
      setAttendance(att);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load client portal");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    if (user.accountType === "staff" && hasCapability(user, "/client-portal", "view")) {
      listClients(token)
        .then((list) => {
          setAdminClients(list.map((c) => ({ id: c.id, name: c.name })));
          if (list[0]) setPreviewClientId(list[0].id);
        })
        .catch(() => setAdminClients([]));
    } else {
      loadPortal();
    }
  }, [token, user, loadPortal]);

  useEffect(() => {
    if (!token || !user || user.accountType !== "staff" || !hasCapability(user, "/client-portal", "view") || !previewClientId) return;
    loadPortal(previewClientId);
  }, [token, user, previewClientId, loadPortal]);

  if (loading) {
    return <div className="animate-pulse h-48 bg-neutral-200 rounded-lg" />;
  }

  const client = dashboard?.client as { name?: string } | undefined;
  const sitesCount = (dashboard?.sitesCount as number) ?? 0;
  const guardsDeployed = (dashboard?.guardsDeployed as number) ?? 0;
  const openIncidents = (dashboard?.openIncidents as number) ?? 0;

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Client portal"
        description={
          user?.accountType === "client"
            ? "Your sites, attendance summary, and incident updates."
            : "Preview of what clients see in their portal."
        }
      />

      {user && user.accountType === "staff" && hasCapability(user, "/client-portal", "view") && adminClients.length > 0 && (
        <div className="mb-4">
          <label className="label-text block mb-1">Preview as client</label>
          <select
            className="input-modern max-w-md"
            value={previewClientId}
            onChange={(e) => setPreviewClientId(e.target.value)}
          >
            {adminClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      {client && (
        <p className="text-lg font-semibold text-neutral-900 mb-4">{client.name}</p>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card-dashboard p-3">
          <p className="text-xs text-neutral-500 uppercase font-semibold">Sites</p>
          <p className="text-2xl font-bold tabular-nums">{sitesCount}</p>
        </div>
        <div className="card-dashboard p-3">
          <p className="text-xs text-neutral-500 uppercase font-semibold">Guards deployed</p>
          <p className="text-2xl font-bold tabular-nums">{guardsDeployed}</p>
        </div>
        <div className="card-dashboard p-3">
          <p className="text-xs text-neutral-500 uppercase font-semibold">Open incidents</p>
          <p className="text-2xl font-bold tabular-nums">{openIncidents}</p>
        </div>
        <div className="card-dashboard p-3">
          <p className="text-xs text-neutral-500 uppercase font-semibold">Attendance completion</p>
          <p className="text-2xl font-bold tabular-nums">
            {(attendance?.completionRate as number) ?? "—"}%
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="section-title mb-3">Your sites</h2>
        <div className="space-y-3">
          {sites.map((site) => (
            <article key={site.id} className="card-dashboard p-4">
              <h3 className="font-semibold text-neutral-900">{site.name}</h3>
              {site.physicalAddress && (
                <p className="text-sm text-neutral-600 mt-1">{site.physicalAddress}</p>
              )}
              <div className="mt-2 flex gap-2">
                {site.siteStatus && <Badge variant="neutral">{site.siteStatus}</Badge>}
                {site.riskLevel && (
                  <Badge variant={site.riskLevel === "CRITICAL" ? "error" : "neutral"}>
                    Risk: {site.riskLevel}
                  </Badge>
                )}
              </div>
            </article>
          ))}
          {sites.length === 0 && (
            <p className="text-sm text-neutral-600">No sites linked to this client account.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">Recent incidents</h2>
        <div className="space-y-3">
          {incidents.slice(0, 10).map((inc) => (
            <article key={inc.id} className="card-dashboard p-4">
              <p className="text-xs font-mono text-neutral-500">{inc.incidentNumber}</p>
              <h3 className="font-semibold text-neutral-900">{inc.title}</h3>
              <p className="text-sm text-neutral-600 mt-1">
                {inc.site?.name} · {new Date(inc.incidentDateTime).toLocaleDateString()}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge variant="neutral">{inc.status.replace(/_/g, " ")}</Badge>
                <Badge variant={inc.severity === "CRITICAL" ? "error" : "warning"}>{inc.severity}</Badge>
              </div>
            </article>
          ))}
          {incidents.length === 0 && (
            <p className="text-sm text-neutral-600">No incidents shared with this client.</p>
          )}
        </div>
      </section>
    </div>
  );
}
