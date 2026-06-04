"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { canManageSitesModule } from "@/lib/permissions";
import { rosterSiteRulesLines } from "@/lib/roster-site-rules-defaults";
import { buildSiteRosterReadinessHints } from "@/lib/roster-readiness-hints";
import { useConfirmDialog } from "@/components/ui";

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
  day: "Day Shift (06:00 – 18:00)",
  night: "Night Shift (18:00 – 06:00)",
};

interface PostAssignedGuard {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    phone: string | null;
  };
}

interface Post {
  id: string;
  name: string;
  shiftType: string | null;
  assignedGuards: PostAssignedGuard[];
}

interface Site {
  id: string;
  name: string;
  location: string | null;
  physicalAddress: string | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  serviceType: string | null;
  rosterSiteRules?: string | null;
  rosterSheetNotes?: string | null;
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  rosterDayShiftGuardsRequired?: number;
  rosterNightShiftGuardsRequired?: number;
  latitude?: number | string | null;
  longitude?: number | string | null;
  geofenceRadiusMeters?: number | null;
  posts: Post[];
  assignedGuards: { employee: { id: string; firstName: string; lastName: string; status: string; phone: string | null } }[];
}

interface Guard {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  phone: string | null;
}

export default function SiteDetailPage() {
  const params = useParams();
  const { token, user } = useAuth();
  const siteId = params.id as string;
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddPost, setShowAddPost] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [draggedGuard, setDraggedGuard] = useState<{ guard: Guard; source: string } | null>(null);
  const [dragOverPost, setDragOverPost] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canManage = user ? canManageSitesModule(user) : false;

  const refresh = () => {
    if (!token || !siteId) return;
    authFetch(`/sites/${siteId}`, token)
      .then((r) => r.json())
      .then(setSite);
  };

  useEffect(() => {
    if (!token || !siteId) return;
    refresh();
    setLoading(false);
  }, [token, siteId]);

  const getGuardsInPost = (postId: string): Guard[] => {
    const post = site?.posts.find((p) => p.id === postId);
    return post?.assignedGuards?.map((a) => a.employee) ?? [];
  };

  const handleDragStart = (guard: Guard, source: string) => {
    setDraggedGuard({ guard, source });
  };

  const handleDragEnd = () => {
    setDraggedGuard(null);
    setDragOverPost(null);
  };

  const handleDragOver = (e: React.DragEvent, postId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverPost(postId);
  };

  const handleDragLeave = () => {
    setDragOverPost(null);
  };

  const handleDrop = async (e: React.DragEvent, postId: string) => {
    e.preventDefault();
    setDragOverPost(null);
    if (!draggedGuard || !token) return;

    const { guard, source } = draggedGuard;
    setDraggedGuard(null);

    if (source === postId) return;

    await authFetch(`/sites/${siteId}/posts/${source}/guards/${guard.id}`, token, { method: "DELETE" });

    const res = await authFetch(`/sites/${siteId}/posts/${postId}/guards`, token, {
      method: "POST",
      body: JSON.stringify({ employeeId: guard.id }),
    });

    if (res.ok) refresh();
  };

  const handleRemoveFromPost = async (postId: string, employeeId: string) => {
    if (!token) return;
    await authFetch(`/sites/${siteId}/posts/${postId}/guards/${employeeId}`, token, { method: "DELETE" });
    refresh();
  };

  if (loading || !site) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded w-64" />
        <div className="h-96 bg-neutral-200 dark:bg-neutral-700 rounded-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/sites"
            className="p-2.5 rounded-lg border-2 border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all"
            aria-label="Back to sites"
          >
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="page-title">{site.name}</h1>
            <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
              Manage posts — schedule guards on{" "}
              <Link href="/rostering" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
                Rostering
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="card-elevated p-4 space-y-5">
        {((site.physicalAddress || site.location) ||
          site.contactPersonName ||
          site.contactPersonPhone ||
          site.serviceType ||
          (site.geofenceRadiusMeters != null && site.latitude != null && site.longitude != null)) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(site.physicalAddress || site.location) && (
              <span className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
                <svg className="w-4 h-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                {site.physicalAddress || site.location}
              </span>
            )}
            {(site.contactPersonName || site.contactPersonPhone) && (
              <span className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
                <svg className="w-4 h-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {site.contactPersonName}
                {site.contactPersonName && site.contactPersonPhone && " · "}
                {site.contactPersonPhone && (
                  <a href={`tel:${site.contactPersonPhone}`} className="hover:underline">{site.contactPersonPhone}</a>
                )}
              </span>
            )}
            {site.serviceType && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                {SERVICE_TYPE_LABELS[site.serviceType] || site.serviceType}
              </span>
            )}
            {site.geofenceRadiusMeters != null &&
              site.latitude != null &&
              site.longitude != null && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border border-amber-200/80 dark:border-amber-800/50">
                  Geofence {site.geofenceRadiusMeters}m · WhatsApp requires location
                </span>
              )}
          </div>
        )}

        <div
          className={
            (site.physicalAddress || site.location) ||
            site.contactPersonName ||
            site.contactPersonPhone ||
            site.serviceType ||
            (site.geofenceRadiusMeters != null && site.latitude != null && site.longitude != null)
              ? "border-t border-neutral-200 dark:border-neutral-700 pt-5"
              : ""
          }
        >
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Shift roster sheet</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 mb-4 max-w-2xl">
            Text here appears on the shift sheet and PDF for this site (e.g. female-only day shift, male-only night shift). Leave blank to use the default contract lines.
          </p>
          <SiteRosterSheetFields site={site} siteId={siteId} token={token!} canManage={canManage} onSaved={refresh} />
        </div>

        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <SiteGuardsAssignment
            site={site}
            siteId={siteId}
            token={token!}
            canManage={canManage}
            onUpdated={refresh}
          />
        </div>
      </div>

      <div className="space-y-6">
          {deleteError && (
            <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800/50 flex items-center justify-between">
              {deleteError}
              <button onClick={() => setDeleteError(null)} className="ml-2 font-medium hover:underline">Dismiss</button>
            </div>
          )}
          <div className="card-elevated p-6">
            <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-1">Auto-roster readiness</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
              Before generating a roster plan, confirm staffing, posts, and site-assigned guards.
            </p>
            <SiteAutoRosterChecklist site={site} />
          </div>

          <div className="card-elevated p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="section-title text-neutral-900 dark:text-neutral-100">Posts</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Drag guards onto posts to set <strong className="font-medium">preferred posts for auto-roster scoring</strong>{" "}
                  (not a hard lock). Shift assignments are created on{" "}
                  <Link href="/rostering" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
                    Rostering
                  </Link>
                  .
                </p>
              </div>
              {canManage && (
                <button
                  onClick={() => setShowAddPost(!showAddPost)}
                  className="btn-primary flex items-center gap-2 text-sm py-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {showAddPost ? "Cancel" : "Add Post"}
                </button>
              )}
            </div>

            {showAddPost && canManage && (
              <div className="mb-6">
                <AddPostForm siteId={siteId} token={token!} onSuccess={() => { setShowAddPost(false); refresh(); }} />
              </div>
            )}

            <div className="space-y-4">
            {site.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                siteId={siteId}
                token={token!}
                guards={getGuardsInPost(post.id)}
                isDragOver={dragOverPost === post.id}
                canManage={canManage}
                onDragOver={(e) => handleDragOver(e, post.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, post.id)}
                onRemoveGuard={(empId) => handleRemoveFromPost(post.id, empId)}
                onDragStart={(guard) => handleDragStart(guard, post.id)}
                onDragEnd={handleDragEnd}
                onDelete={refresh}
                onError={(msg) => setDeleteError(msg || null)}
                onEdit={canManage ? (nextPost) => setEditingPost(nextPost) : undefined}
              />
            ))}
          </div>

            {site.posts.length === 0 && (
              <div className="card-wireframe text-center py-12 px-6 rounded-lg">
                <div className="w-14 h-14 mx-auto rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <p className="font-semibold text-neutral-700 dark:text-neutral-300">No posts yet</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm mx-auto">
                  Add posts, then schedule guards on{" "}
                  <Link href="/rostering" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
                    Rostering
                  </Link>
                  .
                </p>
                {canManage && (
                  <button onClick={() => setShowAddPost(true)} className="mt-4 btn-primary">Add Post</button>
                )}
              </div>
            )}
          </div>
      </div>

      {editingPost && canManage && (
        <EditPostModal
          post={editingPost}
          siteId={siteId}
          token={token!}
          onClose={() => setEditingPost(null)}
          onSuccess={() => {
            setEditingPost(null);
            refresh();
          }}
        />
      )}

    </div>
  );
}

type RosterShiftGenderUi = "" | "male" | "female" | "any";

const ROSTERABLE_GUARD_STATUSES = ["active", "training", "hired", "reliever"] as const;

function guardMatchesSearch(guard: Guard, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const haystack = `${guard.firstName} ${guard.lastName} ${guard.phone ?? ""}`.toLowerCase();
  return haystack.includes(term);
}

function useSecurityGuards(token: string) {
  const [guards, setGuards] = useState<(Guard & { employeeType?: string })[]>([]);
  useEffect(() => {
    if (!token) return;
    authFetch("/employees?limit=500", token)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data || []).filter(
          (e: Guard & { employeeType?: string }) =>
            (e.employeeType ?? "security") === "security" &&
            ROSTERABLE_GUARD_STATUSES.includes(e.status as (typeof ROSTERABLE_GUARD_STATUSES)[number])
        );
        setGuards(
          list.sort((a: Guard, b: Guard) =>
            `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
          )
        );
      })
      .catch(console.error);
  }, [token]);
  return guards;
}

function SiteGuardsAssignment({
  site,
  siteId,
  token,
  canManage,
  onUpdated,
}: {
  site: Site;
  siteId: string;
  token: string;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const allGuards = useSecurityGuards(token);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<"site" | "pool" | "relieverPool" | null>(null);
  const [dragged, setDragged] = useState<{ guard: Guard; source: "site" | "pool" | "relieverPool" } | null>(null);
  const [guardSearch, setGuardSearch] = useState("");
  const [relieverSearch, setRelieverSearch] = useState("");

  const assignedIds = new Set(site.assignedGuards?.map((a) => a.employee.id) ?? []);
  const assignedGuards: Guard[] = (site.assignedGuards ?? []).map((a) => a.employee);
  const assignedRelievers = assignedGuards.filter((g) => g.status === "reliever");
  const assignedRegularGuards = assignedGuards.filter((g) => g.status !== "reliever");
  const availableGuards = allGuards.filter((g) => !assignedIds.has(g.id));
  const availableRegularGuards = availableGuards.filter((g) => g.status !== "reliever");
  const availableRelievers = availableGuards.filter((g) => g.status === "reliever");
  const filteredAvailableGuards = useMemo(
    () => availableRegularGuards.filter((g) => guardMatchesSearch(g, guardSearch)),
    [availableRegularGuards, guardSearch]
  );
  const filteredAvailableRelievers = useMemo(
    () => availableRelievers.filter((g) => guardMatchesSearch(g, relieverSearch)),
    [availableRelievers, relieverSearch]
  );
  const guardSearchActive = guardSearch.trim().length > 0;
  const relieverSearchActive = relieverSearch.trim().length > 0;

  const persistAssignment = async (employeeIds: string[]) => {
    setError(null);
    setSaving(true);
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({ assignedGuardIds: employeeIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.message === "string" ? data.message : data.error || "Failed to update site guards"
        );
      }
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update site guards");
    } finally {
      setSaving(false);
    }
  };

  const addGuard = (guardId: string) => {
    if (assignedIds.has(guardId)) return;
    void persistAssignment([...assignedIds, guardId]);
  };

  const removeGuard = (guardId: string) => {
    void persistAssignment([...assignedIds].filter((id) => id !== guardId));
  };

  const handleDropOnSite = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(null);
    if (!dragged || !canManage) return;
    const { guard, source } = dragged;
    setDragged(null);
    if (source === "site") return;
    addGuard(guard.id);
  };

  const handleDropOnUnassignedPool = (e: React.DragEvent, zone: "pool" | "relieverPool") => {
    e.preventDefault();
    setDragOverZone(null);
    if (!dragged || !canManage) return;
    const { guard, source } = dragged;
    setDragged(null);
    if (source === zone) return;
    if (source === "site") removeGuard(guard.id);
  };

  const rosterReadiness = useMemo(() => buildSiteRosterReadinessHints(site), [site]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Site guards</h3>
        {saving && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Saving…</span>
        )}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 max-w-2xl">
        Drag guards into the site box to assign them here. Assigned guards are used for{" "}
        <Link href="/rostering" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
          auto-rostering
        </Link>{" "}
        on this site. Use the reliever pool for guards with reliever status — they are used as fallback when
        regular guards cannot fill a slot. You can still assign guards to individual posts below.
      </p>
      {rosterReadiness.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs max-w-2xl">
          {rosterReadiness.map((h, i) => (
            <li
              key={`${h.code}-${i}`}
              className={
                h.level === "error"
                  ? "text-red-700 dark:text-red-300"
                  : h.level === "warning"
                    ? "text-amber-800 dark:text-amber-200"
                    : "text-neutral-500 dark:text-neutral-400"
              }
            >
              • {h.message}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      {!canManage ? (
        <div className="min-h-[72px] rounded-lg border border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-3">
          {assignedGuards.length > 0 ? (
            <div className="space-y-3">
              {assignedRegularGuards.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {assignedRegularGuards.map((g) => (
                    <GuardChip key={g.id} guard={g} draggable={false} onDragStart={() => {}} onDragEnd={() => {}} />
                  ))}
                </div>
              )}
              {assignedRelievers.length > 0 && (
                <div>
                  {assignedRegularGuards.length > 0 && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300 mb-2">
                      Relievers
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {assignedRelievers.map((g) => (
                      <GuardChip key={g.id} guard={g} draggable={false} onDragStart={() => {}} onDragEnd={() => {}} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">No guards assigned to this site.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">
                Available guards (
                {guardSearchActive
                  ? `${filteredAvailableGuards.length} of ${availableRegularGuards.length}`
                  : availableRegularGuards.length}
                )
              </p>
              <input
                type="search"
                value={guardSearch}
                onChange={(e) => setGuardSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="input-modern w-full text-sm mb-2"
                aria-label="Search available guards"
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverZone("pool");
                }}
                onDragLeave={() => setDragOverZone(null)}
                onDrop={(e) => handleDropOnUnassignedPool(e, "pool")}
                className={`min-h-[120px] max-h-52 overflow-y-auto rounded-lg p-3 transition-colors ${
                  dragOverZone === "pool"
                    ? "bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-400 dark:border-neutral-500"
                    : "bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700"
                }`}
              >
                {availableRegularGuards.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    All regular rosterable guards are assigned to this site.
                  </p>
                ) : filteredAvailableGuards.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No guards match &quot;{guardSearch.trim()}&quot;.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filteredAvailableGuards.map((g) => (
                      <GuardChip
                        key={g.id}
                        guard={g}
                        draggable
                        isDragging={dragged?.guard.id === g.id}
                        onDragStart={() => setDragged({ guard: g, source: "pool" })}
                        onDragEnd={() => {
                          setDragged(null);
                          setDragOverZone(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">
                Available relievers (
                {relieverSearchActive
                  ? `${filteredAvailableRelievers.length} of ${availableRelievers.length}`
                  : availableRelievers.length}
                )
              </p>
              <input
                type="search"
                value={relieverSearch}
                onChange={(e) => setRelieverSearch(e.target.value)}
                placeholder="Search relievers…"
                className="input-modern w-full text-sm mb-2"
                aria-label="Search available relievers"
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverZone("relieverPool");
                }}
                onDragLeave={() => setDragOverZone(null)}
                onDrop={(e) => handleDropOnUnassignedPool(e, "relieverPool")}
                className={`min-h-[120px] max-h-52 overflow-y-auto rounded-lg p-3 transition-colors ${
                  dragOverZone === "relieverPool"
                    ? "bg-violet-50 dark:bg-violet-950/30 border-2 border-dashed border-violet-400 dark:border-violet-600"
                    : "bg-violet-50/40 dark:bg-violet-950/15 border border-dashed border-violet-200 dark:border-violet-800/60"
                }`}
              >
                {availableRelievers.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No unassigned relievers. Mark guards as reliever on the{" "}
                    <Link href="/employees" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
                      Employees
                    </Link>{" "}
                    page, or all relievers are already on this site.
                  </p>
                ) : filteredAvailableRelievers.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No relievers match &quot;{relieverSearch.trim()}&quot;.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filteredAvailableRelievers.map((g) => (
                      <GuardChip
                        key={g.id}
                        guard={g}
                        draggable
                        isDragging={dragged?.guard.id === g.id}
                        onDragStart={() => setDragged({ guard: g, source: "relieverPool" })}
                        onDragEnd={() => {
                          setDragged(null);
                          setDragOverZone(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="xl:col-span-2">
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">
              Assigned to this site ({assignedGuards.length}
              {assignedRelievers.length > 0
                ? ` · ${assignedRegularGuards.length} regular, ${assignedRelievers.length} reliever${assignedRelievers.length === 1 ? "" : "s"}`
                : ""}
              )
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverZone("site");
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={handleDropOnSite}
              className={`min-h-[280px] rounded-lg p-3 transition-colors ${
                dragOverZone === "site"
                  ? "bg-orange-50 dark:bg-orange-950/30 border-2 border-dashed border-orange-400 dark:border-orange-600"
                  : "bg-orange-50/50 dark:bg-orange-950/20 border border-dashed border-orange-200 dark:border-orange-800/60"
              }`}
            >
              {assignedGuards.length > 0 ? (
                <div className="space-y-4">
                  {assignedRegularGuards.length > 0 && (
                    <div>
                      {assignedRelievers.length > 0 && (
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                          Regular guards
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {assignedRegularGuards.map((g) => (
                          <GuardChip
                            key={g.id}
                            guard={g}
                            draggable
                            isDragging={dragged?.guard.id === g.id}
                            onDragStart={() => setDragged({ guard: g, source: "site" })}
                            onDragEnd={() => {
                              setDragged(null);
                              setDragOverZone(null);
                            }}
                            onRemove={() => removeGuard(g.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {assignedRelievers.length > 0 && (
                    <div>
                      {assignedRegularGuards.length > 0 && (
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300 mb-2">
                          Relievers
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {assignedRelievers.map((g) => (
                          <GuardChip
                            key={g.id}
                            guard={g}
                            draggable
                            isDragging={dragged?.guard.id === g.id}
                            onDragStart={() => setDragged({ guard: g, source: "site" })}
                            onDragEnd={() => {
                              setDragged(null);
                              setDragOverZone(null);
                            }}
                            onRemove={() => removeGuard(g.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Drop guards or relievers here to assign them to this site.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SiteRosterSheetFields({
  site,
  siteId,
  token,
  canManage,
  onSaved,
}: {
  site: Site;
  siteId: string;
  token: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [dayGender, setDayGender] = useState<RosterShiftGenderUi>(
    (site.rosterDayShiftGender as RosterShiftGenderUi) || ""
  );
  const [nightGender, setNightGender] = useState<RosterShiftGenderUi>(
    (site.rosterNightShiftGender as RosterShiftGenderUi) || ""
  );
  const [rules, setRules] = useState(site.rosterSiteRules ?? "");
  const [notes, setNotes] = useState(site.rosterSheetNotes ?? "");
  const [dayGuardsRequired, setDayGuardsRequired] = useState(
    String(site.rosterDayShiftGuardsRequired ?? 1)
  );
  const [nightGuardsRequired, setNightGuardsRequired] = useState(
    String(site.rosterNightShiftGuardsRequired ?? 1)
  );
  const rosterReadiness = useMemo(() => buildSiteRosterReadinessHints(site), [site]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDayGender((site.rosterDayShiftGender as RosterShiftGenderUi) || "");
    setNightGender((site.rosterNightShiftGender as RosterShiftGenderUi) || "");
    setRules(site.rosterSiteRules ?? "");
    setNotes(site.rosterSheetNotes ?? "");
    setDayGuardsRequired(String(site.rosterDayShiftGuardsRequired ?? 1));
    setNightGuardsRequired(String(site.rosterNightShiftGuardsRequired ?? 1));
  }, [
    site.id,
    site.rosterSiteRules,
    site.rosterSheetNotes,
    site.rosterDayShiftGender,
    site.rosterNightShiftGender,
    site.rosterDayShiftGuardsRequired,
    site.rosterNightShiftGuardsRequired,
  ]);

  const save = async () => {
    setError(null);
    setSaving(true);
    const dayCount = parseInt(dayGuardsRequired, 10);
    const nightCount = parseInt(nightGuardsRequired, 10);
    if (
      !Number.isFinite(dayCount) ||
      dayCount < 1 ||
      dayCount > 50 ||
      !Number.isFinite(nightCount) ||
      nightCount < 1 ||
      nightCount > 50
    ) {
      setError("Guards per shift must be a whole number from 1 to 50.");
      setSaving(false);
      return;
    }
    const minRosterable = Math.max(dayCount, nightCount);
    const rosterableCount = site.assignedGuards.filter((a) =>
      ["active", "training", "hired", "reliever"].includes(a.employee.status)
    ).length;
    if (rosterableCount < minRosterable) {
      setError(
        `This site has ${rosterableCount} rosterable guard(s) but staffing requires at least ${minRosterable} per day. Assign more guards to the site first.`
      );
      setSaving(false);
      return;
    }
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          rosterSiteRules: rules,
          rosterSheetNotes: notes,
          rosterDayShiftGender: dayGender === "" ? null : dayGender,
          rosterNightShiftGender: nightGender === "" ? null : nightGender,
          rosterDayShiftGuardsRequired: dayCount,
          rosterNightShiftGuardsRequired: nightCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.message === "string" ? data.message : data.error || "Failed to save"
        );
      }
      onSaved();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    const hasExplicitConfig =
      site.rosterDayShiftGender != null ||
      site.rosterNightShiftGender != null ||
      Boolean(site.rosterSiteRules?.trim()) ||
      Boolean(site.rosterSheetNotes?.trim());
    const effectiveRules = rosterSiteRulesLines(
      site.rosterSiteRules,
      site.rosterDayShiftGender,
      site.rosterNightShiftGender,
      site
    );
    return (
      <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
        {hasExplicitConfig ? (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Site rules (shift roster & PDF)
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {effectiveRules.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
            {site.rosterSheetNotes?.trim() && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                  Roster notes
                </p>
                <p className="whitespace-pre-wrap">{site.rosterSheetNotes}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs">Default roster site rules apply. Only site managers can edit shift staffing and notes.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}
      {savedFlash && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Saved.</p>
      )}
      <div>
        <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">
          Shift staffing (shift roster & PDF)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="roster-day-shift-gender" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
              Day shift
            </label>
            <select
              id="roster-day-shift-gender"
              value={dayGender}
              onChange={(e) => setDayGender(e.target.value as RosterShiftGenderUi)}
              className="input-modern w-full text-sm"
            >
              <option value="">Not specified</option>
              <option value="male">Male guards only</option>
              <option value="female">Female guards only</option>
              <option value="any">No gender restriction</option>
            </select>
          </div>
          <div>
            <label htmlFor="roster-night-shift-gender" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
              Night shift
            </label>
            <select
              id="roster-night-shift-gender"
              value={nightGender}
              onChange={(e) => setNightGender(e.target.value as RosterShiftGenderUi)}
              className="input-modern w-full text-sm"
            >
              <option value="">Not specified</option>
              <option value="male">Male guards only</option>
              <option value="female">Female guards only</option>
              <option value="any">No gender restriction</option>
            </select>
          </div>
        </div>
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5">
          Choose a requirement per shift. &quot;Not specified&quot; skips gender lines on the sheet. Extra rules below are added after these lines.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label
              htmlFor="roster-day-guards-required"
              className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
            >
              Day shift — guards required
            </label>
            <input
              id="roster-day-guards-required"
              type="number"
              min={1}
              max={50}
              value={dayGuardsRequired}
              onChange={(e) => setDayGuardsRequired(e.target.value)}
              className="input-modern w-full text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="roster-night-guards-required"
              className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
            >
              Night shift — guards required
            </label>
            <input
              id="roster-night-guards-required"
              type="number"
              min={1}
              max={50}
              value={nightGuardsRequired}
              onChange={(e) => setNightGuardsRequired(e.target.value)}
              className="input-modern w-full text-sm"
            />
          </div>
        </div>
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5">
          Used when generating the auto-roster plan. Each calendar day must reach these counts (pattern and gender rules still apply).
        </p>
        {rosterReadiness.filter((h) => h.level !== "ok").length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px]">
            {rosterReadiness
              .filter((h) => h.level !== "ok")
              .map((h, i) => (
                <li
                  key={`${h.code}-${i}`}
                  className={
                    h.level === "error"
                      ? "text-red-700 dark:text-red-300"
                      : "text-amber-800 dark:text-amber-200"
                  }
                >
                  • {h.message}
                </li>
              ))}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor="roster-site-rules-extra" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
          Additional site rules (optional)
        </label>
        <textarea
          id="roster-site-rules-extra"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={4}
          maxLength={8000}
          placeholder="One line per rule. Leave empty if the shift options above are enough."
          className="input-modern w-full text-sm min-h-[88px] resize-y"
        />
      </div>
      <div>
        <label htmlFor="roster-sheet-notes" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
          Additional roster notes
        </label>
        <textarea
          id="roster-sheet-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={8000}
          placeholder="Optional — parking, keys, control room contact, etc."
          className="input-modern w-full text-sm min-h-[72px] resize-y"
        />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="btn-primary text-sm py-2 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save roster settings"}
      </button>
    </div>
  );
}

function SiteAutoRosterChecklist({ site }: { site: Site }) {
  const hints = useMemo(() => buildSiteRosterReadinessHints(site), [site]);
  const dayPosts = site.posts.filter((p) => (p.shiftType ?? "day") !== "night");
  const nightPosts = site.posts.filter((p) => p.shiftType === "night");
  const dayStaff = Math.max(1, Math.floor(site.rosterDayShiftGuardsRequired ?? 1));
  const nightStaff = Math.max(1, Math.floor(site.rosterNightShiftGuardsRequired ?? 1));

  return (
    <ul className="space-y-2 text-sm">
      <li className={dayPosts.length > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
        {dayPosts.length > 0 ? "✓" : "✗"} At least one day post ({dayPosts.length})
      </li>
      <li className={nightPosts.length > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
        {nightPosts.length > 0 ? "✓" : "✗"} At least one night post ({nightPosts.length})
      </li>
      <li className="text-neutral-700 dark:text-neutral-300">
        Staffing: {dayStaff} day + {nightStaff} night guard(s) required each calendar day
      </li>
      {hints
        .filter((h) => h.level !== "ok")
        .map((h, i) => (
          <li
            key={`${h.code}-${i}`}
            className={
              h.level === "error"
                ? "text-red-700 dark:text-red-300"
                : "text-amber-800 dark:text-amber-200"
            }
          >
            • {h.message}
          </li>
        ))}
    </ul>
  );
}

function PostCard({
  post,
  siteId,
  token,
  guards,
  isDragOver,
  canManage,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveGuard,
  onDragStart,
  onDragEnd,
  onDelete,
  onError,
  onEdit,
}: {
  post: Post;
  siteId: string;
  token: string;
  guards: Guard[];
  isDragOver: boolean;
  canManage: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRemoveGuard: (empId: string) => void;
  onDragStart: (guard: Guard) => void;
  onDragEnd: () => void;
  onDelete: () => void;
  onError?: (msg: string | null) => void;
  onEdit?: (post: Post) => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const shiftLabel = post.shiftType ? SHIFT_LABELS[post.shiftType] : "Shift";

  return (
    <div
      onDragOver={canManage ? onDragOver : undefined}
      onDragLeave={canManage ? onDragLeave : undefined}
      onDrop={canManage ? onDrop : undefined}
      onClick={canManage && onEdit ? () => onEdit(post) : undefined}
      onKeyDown={
        canManage && onEdit
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEdit(post);
              }
            }
          : undefined
      }
      role={canManage && onEdit ? "button" : undefined}
      tabIndex={canManage && onEdit ? 0 : undefined}
      className={`p-4 rounded-lg border-2 transition-all duration-200 ${
        isDragOver
          ? "border-neutral-400 dark:border-neutral-500 bg-neutral-50 dark:bg-neutral-800/50 ring-2 ring-neutral-300 dark:ring-neutral-600 ring-offset-2 dark:ring-offset-neutral-900"
          : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-600"
      } ${
        canManage && onEdit ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 focus:ring-offset-2 dark:focus:ring-offset-neutral-900" : ""
      }`}
    >
      {confirmDialog}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          post.shiftType === "day"
            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
            : "bg-neutral-800 dark:bg-neutral-700 text-neutral-300"
        }`}>
          {post.shiftType === "day" ? (
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{post.name}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{shiftLabel}</p>
        </div>
        </div>
        {canManage && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const confirmed = await confirm({
                title: "Delete post?",
                message: "This removes the site post if it is not currently in use.",
                confirmLabel: "Delete post",
              });
              if (!confirmed) return;
              onError?.(null);
              try {
                const res = await authFetch(`/sites/${siteId}/posts/${post.id}`, token, { method: "DELETE" });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  onError?.(data.message || data.error || "Failed to delete post");
                  return;
                }
                onDelete();
              } catch {
                onError?.("Failed to delete post");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Delete post"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        )}
      </div>

      {guards.length > 0 && (
        <div
          className={`min-h-[72px] rounded-lg p-3 transition-colors ${
            isDragOver
              ? "bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-400 dark:border-neutral-500"
              : "bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700"
          }`}
        >
          <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-2">
            Preferred for auto-roster when multiple guards qualify
          </p>
          <div className="flex flex-wrap gap-2">
            {guards.map((g) => (
              <GuardChip
                key={g.id}
                guard={g}
                draggable={canManage}
                onDragStart={() => onDragStart(g)}
                onDragEnd={onDragEnd}
                onRemove={canManage ? () => onRemoveGuard(g.id) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditPostModal({
  post,
  siteId,
  token,
  onClose,
  onSuccess,
}: {
  post: Post;
  siteId: string;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(post.name);
  const [shiftType, setShiftType] = useState<"day" | "night">(
    post.shiftType === "night" ? "night" : "day"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(post.name);
    setShiftType(post.shiftType === "night" ? "night" : "day");
    setError("");
  }, [post]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Post name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/sites/${siteId}/posts/${post.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ name: trimmedName, shiftType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Failed to update post");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update post");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="card-wireframe w-full max-w-md shadow-xl">
        <div className="p-6 border-b-2 border-neutral-200 dark:border-neutral-700">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Edit Post</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Update post name and shift type</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
              {error}
            </div>
          )}
          <input
            placeholder="Post name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="input-modern w-full"
          />
          <select
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as "day" | "night")}
            className="input-modern w-full"
          >
            <option value="day">Day Shift (06:00 – 18:00)</option>
            <option value="night">Night Shift (18:00 – 06:00)</option>
          </select>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 btn-primary">
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GuardChip({
  guard,
  draggable,
  onDragStart,
  onDragEnd,
  onRemove,
  isDragging,
}: {
  guard: Guard;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRemove?: () => void;
  isDragging?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (draggable) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", guard.id);
          onDragStart();
        }
      }}
      onDragEnd={onDragEnd}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? "opacity-50 scale-95" : "hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-600"
      } ${draggable ? "" : "cursor-default"}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          guard.status === "active"
            ? "bg-emerald-500"
            : guard.status === "training"
              ? "bg-amber-500"
              : guard.status === "reliever"
                ? "bg-violet-500"
                : "bg-neutral-400"
        }`}
        title={guard.status}
      />
      <span className="text-neutral-700 dark:text-neutral-300">
        {guard.firstName} {guard.lastName}
      </span>
      {guard.status === "reliever" && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          Reliever
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 transition-colors"
          title="Remove from post"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AddPostForm({
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await authFetch(`/sites/${siteId}/posts`, token, {
        method: "POST",
        body: JSON.stringify({ name, shiftType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create post");
      }
      setName("");
      setShiftType("day");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 bg-white dark:bg-neutral-900 rounded-sm border border-neutral-200 dark:border-neutral-600">
      <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4">New Post</h4>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          placeholder="Post name (e.g. Main Gate)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input-modern"
        />
        <select
          value={shiftType}
          onChange={(e) => setShiftType(e.target.value as "day" | "night")}
          className="input-modern"
        >
          <option value="day">Day Shift (06:00 – 18:00)</option>
          <option value="night">Night Shift (18:00 – 06:00)</option>
        </select>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Creating..." : "Create Post"}
        </button>
      </div>
    </form>
  );
}
