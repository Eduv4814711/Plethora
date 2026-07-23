"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch, listTaskAssignees } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { buildSiteRosterReadinessHints } from "@/lib/roster-readiness-hints";
import { SiteOperationalActions } from "@/components/site-operational-actions";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  guarding: "Guarding",
  access_control: "Access Control",
  patrols: "Patrols",
  close_protection: "Close Protection",
  reaction: "Reaction / Response",
  control_room: "Control Room",
  monitoring: "Monitoring",
  other: "Other",
};

const SHIFT_LABELS: Record<string, string> = {
  day: "Day (6–18)",
  night: "Night (18–6)",
};

const CONTRACT_AGREEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Select contract type" },
  { value: "Fixed term", label: "Fixed term" },
  { value: "Month-to-month", label: "Month-to-month" },
  { value: "Annual", label: "Annual" },
  { value: "Open-ended", label: "Open-ended" },
  { value: "Per site agreement", label: "Per site agreement" },
  { value: "other", label: "Other" },
];

interface PostAssignedGuard {
  id: string;
  employee: { id: string; firstName: string; lastName: string; status: string; phone: string | null };
}

interface Post {
  id: string;
  name: string;
  shiftType: string | null;
  assignedGuards?: PostAssignedGuard[];
}

interface AssignedGuard {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    phone: string | null;
    gender?: string | null;
  };
}

interface Site {
  id: string;
  name: string;
  location: string | null;
  physicalAddress: string | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  clientContactEmail?: string | null;
  contractOrServiceAgreement: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  serviceType: string | null;
  clientId?: string | null;
  supervisorId?: string | null;
  supervisor?: { id: string; name: string; email: string } | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  siteStatus?: "ACTIVE" | "INACTIVE" | "PENDING" | "SUSPENDED" | null;
  siteInstructions?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  geofenceRadiusMeters?: number | null;
  rosterDayShiftGuardsRequired?: number;
  rosterNightShiftGuardsRequired?: number;
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  posts: Post[];
  assignedGuards: AssignedGuard[];
}

const RISK_LABELS: Record<string, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
  CRITICAL: "Critical risk",
};

const SITE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  PENDING: "Pending",
  SUSPENDED: "Suspended",
};

function contractExpiryHint(endDate: string | null | undefined): { label: string; urgent: boolean } | null {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: "Contract expired", urgent: true };
  if (days <= 60) return { label: `Contract ends in ${days} day${days === 1 ? "" : "s"}`, urgent: days <= 30 };
  return null;
}

interface Guard {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  phone: string | null;
  employeeType?: string;
}

export default function SitesPage() {
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [deletingSite, setDeletingSite] = useState<Site | null>(null);
  const canCreateSites = Boolean(user && hasCapability(user, "/sites", "create"));
  const canEditSites = Boolean(user && hasCapability(user, "/sites", "edit"));
  const canDeleteSites = Boolean(user && hasCapability(user, "/sites", "delete"));

  const refresh = () => {
    if (!token) return;
    authFetch("/sites", token)
      .then((r) => r.json())
      .then((d) => setSites(d.data || []))
      .catch(console.error);
  };

  useEffect(() => {
    if (!token) return;
    authFetch("/sites", token)
      .then((r) => r.json())
      .then((d) => setSites(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="flex justify-between items-center">
          <div className="h-9 bg-white border-2 border-neutral-200 rounded-[10px] w-48" />
          <div className="h-10 bg-white border-2 border-neutral-200 rounded-[10px] w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 bg-white border-2 border-neutral-200 rounded-[10px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Sites</h1>
          <p className="text-neutral-600 mt-1 text-sm">
            Add the locations you protect, keep contacts up to date, and assign guards to each site.
          </p>
        </div>
        {canCreateSites && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className={`${showCreateForm ? "btn-secondary" : "btn-primary"} flex items-center gap-2 shrink-0`}
          >
            {!showCreateForm && (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            {showCreateForm ? "Cancel" : "Add site"}
          </button>
        )}
      </div>

      {showCreateForm && canCreateSites && (
        <SiteForm
          token={token!}
          onSuccess={() => {
            setShowCreateForm(false);
            refresh();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            token={token!}
            canEditSites={canEditSites}
            canDeleteSites={canDeleteSites}
            onEdit={() => setEditingSite(site)}
            onDelete={() => setDeletingSite(site)}
            onRefresh={refresh}
          />
        ))}
      </div>

      {sites.length === 0 && (
        <div className="card-wireframe text-center py-16 px-6">
          <div className="w-16 h-16 mx-auto rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <p className="font-semibold text-neutral-700 dark:text-neutral-300">No sites added yet</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm mx-auto">
            Add your first site to start assigning guards, building rosters, and tracking attendance.
          </p>
          {canCreateSites && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-6 btn-primary"
            >
              Add your first site
            </button>
          )}
        </div>
      )}

      {editingSite && canEditSites && (
        <EditSiteModal
          site={editingSite}
          token={token!}
          onClose={() => setEditingSite(null)}
          onSuccess={() => {
            setEditingSite(null);
            refresh();
          }}
        />
      )}

      {deletingSite && canDeleteSites && (
        <DeleteConfirmModal
          site={deletingSite}
          token={token!}
          onClose={() => setDeletingSite(null)}
          onSuccess={() => {
            setDeletingSite(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SiteCard({
  site,
  token,
  canEditSites,
  canDeleteSites,
  onEdit,
  onDelete,
  onRefresh,
}: {
  site: Site;
  token: string;
  canEditSites: boolean;
  canDeleteSites: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const address = site.physicalAddress || site.location;
  const [expanded, setExpanded] = useState(false);

  const dayRequired = site.rosterDayShiftGuardsRequired ?? 1;
  const nightRequired = site.rosterNightShiftGuardsRequired ?? 1;
  const rosterableCount = site.assignedGuards.filter((a) =>
    ["active", "training", "hired", "reliever"].includes(a.employee.status)
  ).length;
  const minRequired = Math.max(dayRequired, nightRequired);
  const hints = buildSiteRosterReadinessHints(site);
  const hasError = hints.some((h) => h.level === "error");
  const hasWarning = hints.some((h) => h.level === "warning");
  const coverageReady = !hasError && rosterableCount > 0;

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className="card-elevated group p-6 cursor-pointer"
      role="button"
      aria-expanded={expanded}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {site.name}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {site.serviceType && (
                  <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-100 dark:bg-neutral-900/40 text-neutral-700 dark:text-neutral-300">
                    {SERVICE_TYPE_LABELS[site.serviceType] || site.serviceType}
                  </span>
                )}
                {site.riskLevel && (
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-medium ${
                      site.riskLevel === "CRITICAL" || site.riskLevel === "HIGH"
                        ? "bg-red-100 text-red-700"
                        : site.riskLevel === "MEDIUM"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {RISK_LABELS[site.riskLevel] ?? site.riskLevel}
                  </span>
                )}
                {site.siteStatus && (
                  <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-medium bg-security-navy-50 text-security-navy-800">
                    {SITE_STATUS_LABELS[site.siteStatus] ?? site.siteStatus}
                  </span>
                )}
                {site.supervisor?.name && (
                  <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700" title="Site supervisor">
                    Supervisor: {site.supervisor.name}
                  </span>
                )}
                {(() => {
                  const hint = contractExpiryHint(site.contractEndDate);
                  if (!hint) return null;
                  return (
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-medium ${
                        hint.urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {hint.label}
                    </span>
                  );
                })()}
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium ${
                    hasError
                      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                      : hasWarning
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  }`}
                  title={`Day requires ${dayRequired}, night requires ${nightRequired}`}
                >
                  {rosterableCount}/{minRequired} guards
                  {hasError ? " · short" : hasWarning ? " · check" : " · ready"}
                </span>
              </div>
            </div>
          </div>

          {expanded && (
            <>
              {address && (
                <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400 flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{address}</span>
                </p>
              )}

              {(site.contactPersonName || site.contactPersonPhone) && (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>
                    {site.contactPersonName}
                    {site.contactPersonName && site.contactPersonPhone && " • "}
                    {site.contactPersonPhone && (
                      <a href={`tel:${site.contactPersonPhone}`} onClick={(e) => e.stopPropagation()} className="text-neutral-600 dark:text-neutral-400 hover:underline">
                        {site.contactPersonPhone}
                      </a>
                    )}
                  </span>
                </p>
              )}

              {site.contractOrServiceAgreement && (
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-500 truncate" title={site.contractOrServiceAgreement}>
                  Contract: {site.contractOrServiceAgreement}
                </p>
              )}
            </>
          )}
        </div>

        {(canEditSites || canDeleteSites) && (
          <div
            className="flex items-center gap-1 shrink-0 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {canEditSites && <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-2 rounded-lg text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900/20 transition-colors"
              title="Edit site"
              aria-label={`Edit ${site.name}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>}
            {canDeleteSites && <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-2 rounded-lg text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-neutral-900/20 transition-colors"
              title="Delete site"
              aria-label={`Delete ${site.name}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>}
          </div>
        )}
      </div>
      {expanded && (
        <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700 space-y-3" onClick={(e) => e.stopPropagation()}>
          {hints.filter((h) => h.level !== "ok").length > 0 && (
            <ul className="space-y-1">
              {hints
                .filter((h) => h.level !== "ok")
                .map((h) => (
                  <li
                    key={h.code + h.message}
                    className={`text-xs ${h.level === "error" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}
                  >
                    {h.level === "error" ? "✕ " : "! "}
                    {h.message}
                  </li>
                ))}
            </ul>
          )}

          {coverageReady ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              <p>Guards assigned. Next: build the roster, then record attendance when shifts are done.</p>
              <SiteOperationalActions siteId={site.id} layout="stack" />
            </div>
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Assign enough active guards to this site before building a roster.
            </p>
          )}

          <button
            type="button"
            onClick={() => router.push(`/sites/${site.id}`)}
            className="text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 underline"
          >
            Open full site details
          </button>
        </div>
      )}
    </div>
  );
}

function useGuards(token: string) {
  const [guards, setGuards] = useState<Guard[]>([]);
  useEffect(() => {
    if (!token) return;
    authFetch("/employees?limit=200", token)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data || []).filter(
          (e: Guard) =>
            e.employeeType === "security" &&
            ["active", "training", "hired", "reliever"].includes(e.status)
        );
        setGuards(list);
      })
      .catch(console.error);
  }, [token]);
  return guards;
}

function useSupervisorUsers(token: string) {
  const [users, setUsers] = useState<{ id: string; displayName: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    listTaskAssignees(token)
      .then((r) => setUsers(r.users.map((u) => ({ id: u.id, displayName: u.displayName }))))
      .catch(() => setUsers([]));
  }, [token]);
  return users;
}

function useClients(token: string) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    import("@/lib/msr-api")
      .then(({ listClients }) => listClients(token))
      .then((list) => setClients(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
  }, [token]);
  return clients;
}

function SiteMoreDetailsFields({
  clientId,
  setClientId,
  clients,
  clientContactEmail,
  setClientContactEmail,
  contractStartDate,
  setContractStartDate,
  contractEndDate,
  setContractEndDate,
  supervisorId,
  setSupervisorId,
  riskLevel,
  setRiskLevel,
  siteStatus,
  setSiteStatus,
  siteInstructions,
  setSiteInstructions,
  supervisorUsers,
}: {
  clientId: string;
  setClientId: (v: string) => void;
  clients: { id: string; name: string }[];
  clientContactEmail: string;
  setClientContactEmail: (v: string) => void;
  contractStartDate: string;
  setContractStartDate: (v: string) => void;
  contractEndDate: string;
  setContractEndDate: (v: string) => void;
  supervisorId: string;
  setSupervisorId: (v: string) => void;
  riskLevel: string;
  setRiskLevel: (v: string) => void;
  siteStatus: string;
  setSiteStatus: (v: string) => void;
  siteInstructions: string;
  setSiteInstructions: (v: string) => void;
  supervisorUsers: { id: string; displayName: string }[];
}) {
  return (
    <div className="md:col-span-2 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2 space-y-4">
      <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">More details</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="input-modern">
            <option value="">No client linked</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Client contact email</label>
          <input type="email" value={clientContactEmail} onChange={(e) => setClientContactEmail(e.target.value)} className="input-modern" placeholder="client@example.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Site supervisor</label>
          <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="input-modern">
            <option value="">No supervisor assigned</option>
            {supervisorUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contract start</label>
          <input type="date" value={contractStartDate} onChange={(e) => setContractStartDate(e.target.value)} className="input-modern" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contract end</label>
          <input type="date" value={contractEndDate} onChange={(e) => setContractEndDate(e.target.value)} className="input-modern" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Risk level</label>
          <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="input-modern">
            <option value="">Not set</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Site status</label>
          <select value={siteStatus} onChange={(e) => setSiteStatus(e.target.value)} className="input-modern">
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Site instructions</label>
          <textarea value={siteInstructions} onChange={(e) => setSiteInstructions(e.target.value)} className="input-modern w-full" rows={3} placeholder="Special instructions for guards at this site" />
        </div>
      </div>
    </div>
  );
}

function SiteForm({
  token,
  onSuccess,
  onCancel,
}: {
  token: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const guards = useGuards(token);
  const supervisorUsers = useSupervisorUsers(token);
  const clients = useClients(token);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactPersonPhone, setContactPersonPhone] = useState("");
  const [contractAgreementType, setContractAgreementType] = useState("");
  const [contractAgreementCustom, setContractAgreementCustom] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [assignedGuardIds, setAssignedGuardIds] = useState<string[]>([]);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientContactEmail, setClientContactEmail] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractEndDate, setContractEndDate] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [riskLevel, setRiskLevel] = useState<string>("");
  const [siteStatus, setSiteStatus] = useState<string>("ACTIVE");
  const [siteInstructions, setSiteInstructions] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleGuard = (id: string) => {
    setAssignedGuardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const latStr = latitude.trim();
      const lngStr = longitude.trim();
      const radStr = geofenceRadiusMeters.trim();
      const hasAny = latStr || lngStr || radStr;
      let geoBody: Record<string, number> = {};
      if (hasAny) {
        const latN = Number(latStr);
        const lngN = Number(lngStr);
        const radN = Number(radStr);
        if (!Number.isFinite(latN) || !Number.isFinite(lngN) || !Number.isFinite(radN) || radN <= 0) {
          throw new Error("Geofence: enter valid latitude, longitude, and a positive radius (meters), or leave all three empty.");
        }
        geoBody = { latitude: latN, longitude: lngN, geofenceRadiusMeters: Math.round(radN) };
      }

      const res = await authFetch("/sites", token, {
        method: "POST",
        body: JSON.stringify({
          name,
          location: location || undefined,
          physicalAddress: physicalAddress || undefined,
          contactPersonName: contactPersonName || undefined,
          contactPersonPhone: contactPersonPhone || undefined,
          contractOrServiceAgreement: contractAgreementType === "other" ? (contractAgreementCustom || undefined) : (contractAgreementType || undefined),
          serviceType: serviceType || undefined,
          assignedGuardIds: assignedGuardIds.length ? assignedGuardIds : undefined,
          clientContactEmail: clientContactEmail || undefined,
          clientId: clientId || undefined,
          contractStartDate: contractStartDate || undefined,
          contractEndDate: contractEndDate || undefined,
          supervisorId: supervisorId || undefined,
          riskLevel: riskLevel || undefined,
          siteStatus: siteStatus || undefined,
          siteInstructions: siteInstructions || undefined,
          ...geoBody,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create site");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create site");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="card-wireframe p-6 shadow-lg"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add a new site
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          Only the site name is required. You can add contacts, guards, and other details later.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-security" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Site name *</label>
          <input
            placeholder="e.g. Head Office Building"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Type of service</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="input-modern"
          >
            <option value="">Select service type</option>
            {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Physical address</label>
          <input
            placeholder="Full street address, suburb, city"
            value={physicalAddress}
            onChange={(e) => setPhysicalAddress(e.target.value)}
            className="input-modern"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Short location (optional)</label>
          <input
            placeholder="e.g. Sandton"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="input-modern"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contact person</label>
          <input
            placeholder="Name"
            value={contactPersonName}
            onChange={(e) => setContactPersonName(e.target.value)}
            className="input-modern"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contact phone</label>
          <input
            placeholder="e.g. 082 123 4567"
            value={contactPersonPhone}
            onChange={(e) => setContactPersonPhone(e.target.value)}
            className="input-modern"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contract / service agreement</label>
          <select
            value={contractAgreementType}
            onChange={(e) => setContractAgreementType(e.target.value)}
            className="input-modern"
          >
            {CONTRACT_AGREEMENT_OPTIONS.map((opt) => (
              <option key={opt.value || "empty"} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {contractAgreementType === "other" && (
            <input
              placeholder="Enter contract reference or description"
              value={contractAgreementCustom}
              onChange={(e) => setContractAgreementCustom(e.target.value)}
              className="input-modern mt-2"
            />
          )}
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => setShowMoreDetails((v) => !v)}
            className="text-sm font-medium text-security-navy-700 hover:underline"
          >
            {showMoreDetails ? "Hide more details" : "More details (contract, supervisor, risk)"}
          </button>
        </div>

        {showMoreDetails && (
          <SiteMoreDetailsFields
            clientId={clientId}
            setClientId={setClientId}
            clients={clients}
            clientContactEmail={clientContactEmail}
            setClientContactEmail={setClientContactEmail}
            contractStartDate={contractStartDate}
            setContractStartDate={setContractStartDate}
            contractEndDate={contractEndDate}
            setContractEndDate={setContractEndDate}
            supervisorId={supervisorId}
            setSupervisorId={setSupervisorId}
            riskLevel={riskLevel}
            setRiskLevel={setRiskLevel}
            siteStatus={siteStatus}
            setSiteStatus={setSiteStatus}
            siteInstructions={siteInstructions}
            setSiteInstructions={setSiteInstructions}
            supervisorUsers={supervisorUsers}
          />
        )}

        <div className="md:col-span-2 border-t border-neutral-200 dark:border-neutral-700 pt-4 mt-2">
          <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">Clock-in geofence (optional)</h4>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
            Set a center point (WGS84) and radius in meters. When all three are filled, guards on WhatsApp must share their location to complete clock-in/out for shifts at this site. Dashboard clock-in is unchanged.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Latitude</label>
              <input
                placeholder="-26.1076"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="input-modern"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Longitude</label>
              <input
                placeholder="28.0567"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="input-modern"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Radius (m)</label>
              <input
                placeholder="e.g. 150"
                value={geofenceRadiusMeters}
                onChange={(e) => setGeofenceRadiusMeters(e.target.value)}
                className="input-modern"
                inputMode="numeric"
              />
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
            Assigned guards
          </label>
          <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 bg-neutral-50/50 dark:bg-neutral-800/30 max-h-40 overflow-y-auto">
            {guards.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No guards to assign yet. Add guards on the Team page first — you can also assign them later.
              </p>
            ) : (
              <div className="space-y-2">
                {guards.map((g) => (
                  <label key={g.id} className="flex items-center gap-3 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50 rounded-lg p-2 -mx-2">
                    <input
                      type="checkbox"
                      checked={assignedGuardIds.includes(g.id)}
                      onChange={() => toggleGuard(g.id)}
                      className="w-4 h-4 rounded border-neutral-200 dark:border-neutral-600 text-neutral-600 focus:ring-neutral-500"
                    />
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                      {g.firstName} {g.lastName}
                    </span>
                    <span className="text-xs text-neutral-500">{g.status}</span>
                    {g.phone && <span className="text-xs text-neutral-400">{g.phone}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Saving..." : "Save site"}
        </button>
      </div>
    </form>
  );
}

function EditSiteModal({
  site,
  token,
  onClose,
  onSuccess,
}: {
  site: Site;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const guards = useGuards(token);
  const supervisorUsers = useSupervisorUsers(token);
  const clients = useClients(token);
  const [name, setName] = useState(site.name);
  const [location, setLocation] = useState(site.location ?? "");
  const [physicalAddress, setPhysicalAddress] = useState(site.physicalAddress ?? "");
  const [contactPersonName, setContactPersonName] = useState(site.contactPersonName ?? "");
  const [contactPersonPhone, setContactPersonPhone] = useState(site.contactPersonPhone ?? "");
  const existingContract = site.contractOrServiceAgreement ?? "";
  const isContractInOptions = CONTRACT_AGREEMENT_OPTIONS.some((o) => o.value && o.value !== "other" && o.value === existingContract);
  const [contractAgreementType, setContractAgreementType] = useState(isContractInOptions ? existingContract : (existingContract ? "other" : ""));
  const [contractAgreementCustom, setContractAgreementCustom] = useState(existingContract && !isContractInOptions ? existingContract : "");
  const [serviceType, setServiceType] = useState(site.serviceType ?? "");
  const [assignedGuardIds, setAssignedGuardIds] = useState<string[]>(
    site.assignedGuards?.map((a) => a.employee.id) ?? []
  );
  const [latitude, setLatitude] = useState(
    site.latitude != null && site.latitude !== "" ? String(site.latitude) : ""
  );
  const [longitude, setLongitude] = useState(
    site.longitude != null && site.longitude !== "" ? String(site.longitude) : ""
  );
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(
    site.geofenceRadiusMeters != null ? String(site.geofenceRadiusMeters) : ""
  );
  const [clientId, setClientId] = useState(site.clientId ?? "");
  const [clientContactEmail, setClientContactEmail] = useState(site.clientContactEmail ?? "");
  const [contractStartDate, setContractStartDate] = useState(
    site.contractStartDate ? site.contractStartDate.slice(0, 10) : ""
  );
  const [contractEndDate, setContractEndDate] = useState(
    site.contractEndDate ? site.contractEndDate.slice(0, 10) : ""
  );
  const [supervisorId, setSupervisorId] = useState(site.supervisorId ?? site.supervisor?.id ?? "");
  const [riskLevel, setRiskLevel] = useState<string>(site.riskLevel ?? "");
  const [siteStatus, setSiteStatus] = useState<string>(site.siteStatus ?? "ACTIVE");
  const [siteInstructions, setSiteInstructions] = useState(site.siteInstructions ?? "");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [clearGeofence, setClearGeofence] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleGuard = (id: string) => {
    setAssignedGuardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let geoPayload: Record<string, number | null> = {};
      if (clearGeofence) {
        geoPayload = { latitude: null, longitude: null, geofenceRadiusMeters: null };
      } else {
        const latStr = latitude.trim();
        const lngStr = longitude.trim();
        const radStr = geofenceRadiusMeters.trim();
        const hasAny = latStr || lngStr || radStr;
        if (hasAny) {
          const latN = Number(latStr);
          const lngN = Number(lngStr);
          const radN = Number(radStr);
          if (!Number.isFinite(latN) || !Number.isFinite(lngN) || !Number.isFinite(radN) || radN <= 0) {
            throw new Error("Geofence: enter valid latitude, longitude, and a positive radius (meters), or clear the geofence.");
          }
          geoPayload = {
            latitude: latN,
            longitude: lngN,
            geofenceRadiusMeters: Math.round(radN),
          };
        }
      }

      const res = await authFetch(`/sites/${site.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          name,
          location: location || undefined,
          physicalAddress: physicalAddress || undefined,
          contactPersonName: contactPersonName || undefined,
          contactPersonPhone: contactPersonPhone || undefined,
          contractOrServiceAgreement: contractAgreementType === "other" ? (contractAgreementCustom || undefined) : (contractAgreementType || undefined),
          serviceType: serviceType || undefined,
          assignedGuardIds,
          clientContactEmail: clientContactEmail || null,
          clientId: clientId || null,
          contractStartDate: contractStartDate || null,
          contractEndDate: contractEndDate || null,
          supervisorId: supervisorId || null,
          riskLevel: riskLevel || undefined,
          siteStatus: siteStatus || undefined,
          siteInstructions: siteInstructions || undefined,
          ...geoPayload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to update site");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update site");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="card-wireframe w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        <div className="p-6 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Edit site</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{site.name}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-security" role="alert">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Site name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className="input-modern" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Type of service</label>
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="input-modern">
                <option value="">Select service type</option>
                {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Physical address</label>
              <input value={physicalAddress} onChange={(e) => setPhysicalAddress(e.target.value)} className="input-modern" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Short location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="input-modern" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contact person</label>
              <input value={contactPersonName} onChange={(e) => setContactPersonName(e.target.value)} className="input-modern" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contact phone</label>
              <input value={contactPersonPhone} onChange={(e) => setContactPersonPhone(e.target.value)} className="input-modern" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Contract / service agreement</label>
              <select value={contractAgreementType} onChange={(e) => setContractAgreementType(e.target.value)} className="input-modern">
                {CONTRACT_AGREEMENT_OPTIONS.map((opt) => (
                  <option key={opt.value || "empty"} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {contractAgreementType === "other" && (
                <input
                  placeholder="Enter contract reference or description"
                  value={contractAgreementCustom}
                  onChange={(e) => setContractAgreementCustom(e.target.value)}
                  className="input-modern mt-2"
                />
              )}
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => setShowMoreDetails((v) => !v)}
                className="text-sm font-medium text-security-navy-700 hover:underline"
              >
                {showMoreDetails ? "Hide more details" : "More details (contract, supervisor, risk)"}
              </button>
            </div>

            {showMoreDetails && (
              <SiteMoreDetailsFields
                clientId={clientId}
                setClientId={setClientId}
                clients={clients}
                clientContactEmail={clientContactEmail}
                setClientContactEmail={setClientContactEmail}
                contractStartDate={contractStartDate}
                setContractStartDate={setContractStartDate}
                contractEndDate={contractEndDate}
                setContractEndDate={setContractEndDate}
                supervisorId={supervisorId}
                setSupervisorId={setSupervisorId}
                riskLevel={riskLevel}
                setRiskLevel={setRiskLevel}
                siteStatus={siteStatus}
                setSiteStatus={setSiteStatus}
                siteInstructions={siteInstructions}
                setSiteInstructions={setSiteInstructions}
                supervisorUsers={supervisorUsers}
              />
            )}

            <div className="md:col-span-2 border-t border-neutral-200 dark:border-neutral-700 pt-4">
              <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">Clock-in geofence</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
                All three values required to enforce location on WhatsApp. Supervisors can still clock guards in here without GPS.
              </p>
              <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearGeofence}
                  onChange={(e) => {
                    setClearGeofence(e.target.checked);
                    if (e.target.checked) {
                      setLatitude("");
                      setLongitude("");
                      setGeofenceRadiusMeters("");
                    }
                  }}
                  className="w-4 h-4 rounded border-neutral-300"
                />
                Remove geofence (disable location check for this site)
              </label>
              {!clearGeofence && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Latitude</label>
                    <input
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      className="input-modern"
                      inputMode="decimal"
                      disabled={clearGeofence}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Longitude</label>
                    <input
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      className="input-modern"
                      inputMode="decimal"
                      disabled={clearGeofence}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Radius (m)</label>
                    <input
                      value={geofenceRadiusMeters}
                      onChange={(e) => setGeofenceRadiusMeters(e.target.value)}
                      className="input-modern"
                      inputMode="numeric"
                      disabled={clearGeofence}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Assigned guards</label>
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 bg-neutral-50/50 dark:bg-neutral-800/30 max-h-40 overflow-y-auto">
                {guards.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No guards to assign yet. Add guards on the Team page first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {guards.map((g) => (
                      <label key={g.id} className="flex items-center gap-3 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50 rounded-lg p-2 -mx-2">
                        <input
                          type="checkbox"
                          checked={assignedGuardIds.includes(g.id)}
                          onChange={() => toggleGuard(g.id)}
                          className="w-4 h-4 rounded border-neutral-200 dark:border-neutral-600 text-neutral-600 focus:ring-neutral-500"
                        />
                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                          {g.firstName} {g.lastName}
                        </span>
                        <span className="text-xs text-neutral-500">{g.status}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 btn-primary">
              {submitting ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  site,
  token,
  onClose,
  onSuccess,
}: {
  site: Site;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setError("");
    setDeleting(true);
    try {
      const res = await authFetch(`/sites/${site.id}`, token, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete site");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="card-wireframe w-full max-w-md shadow-xl">
        <div className="p-6">
          <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Delete site?</h3>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            You are about to delete <strong>{site.name}</strong>. All its posts and guard assignments will be removed. This cannot be undone.
          </p>
          {error && (
            <div className="mt-4 p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-security" role="alert">
              {error}
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 btn-destructive"
            >
              {deleting ? "Deleting..." : "Delete site"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostRow({
  post,
  siteId,
  token,
  canManage,
  onSuccess,
}: {
  post: Post;
  siteId: string;
  token: string;
  canManage: boolean;
  onSuccess: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(post.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === post.name) {
      setEditing(false);
      setName(post.name);
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/sites/${siteId}/posts/${post.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditing(false);
      onSuccess();
    } catch {
      setSaving(false);
    }
  };

  return (
    <li
      className="text-sm text-neutral-700 dark:text-neutral-300 flex items-center gap-2 group/post"
      onClick={(e) => editing && e.stopPropagation()}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
      {editing ? (
        <div className="flex items-center gap-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
            className="input-modern py-1.5 text-sm flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-2 py-1 text-xs font-medium bg-neutral-600 text-white rounded hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setName(post.name); }}
            disabled={saving}
            className="px-2 py-1 text-xs font-medium border border-neutral-300 dark:border-neutral-600 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 min-w-0">{post.name}</span>
          {post.shiftType && (
            <span className="text-neutral-500 text-xs shrink-0">
              ({SHIFT_LABELS[post.shiftType] ?? post.shiftType})
            </span>
          )}
          {post.assignedGuards?.length ? (
            <span className="text-xs text-neutral-600 dark:text-neutral-400 shrink-0">
              {post.assignedGuards.length} guard{post.assignedGuards.length !== 1 ? "s" : ""}
            </span>
          ) : null}
          {canManage && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="p-1 rounded text-neutral-500 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 opacity-0 group-hover/post:opacity-100 transition-opacity shrink-0"
              title="Edit post name"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </>
      )}
    </li>
  );
}

function PostForm({
  siteId,
  token,
  onSuccess,
}: {
  siteId: string;
  token: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [shiftType, setShiftType] = useState<"day" | "night">("day");
  const [show, setShow] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await authFetch(`/sites/${siteId}/posts`, token, {
      method: "POST",
      body: JSON.stringify({ name, shiftType }),
    });
    setName("");
    setShiftType("day");
    setShow(false);
    onSuccess();
  };

  return (
    <div className="mt-3">
      {show ? (
        <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
          <input
            placeholder="Post name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="input-modern flex-1 min-w-[120px] py-2"
          />
          <select
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as "day" | "night")}
            className="input-modern flex-1 min-w-[120px] py-2"
          >
            <option value="day">Day (6–18)</option>
            <option value="night">Night (18–6)</option>
          </select>
          <button type="submit" className="px-4 py-2 text-sm font-semibold bg-neutral-600 text-neutral-100 rounded-sm hover:bg-neutral-700 transition-colors">
            Add
          </button>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="px-4 py-2 text-sm font-medium border border-neutral-200 dark:border-neutral-600 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShow(true)}
          className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add post
        </button>
      )}
    </div>
  );
}
