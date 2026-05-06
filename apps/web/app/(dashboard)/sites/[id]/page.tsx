"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { canManageSitesModule } from "@/lib/permissions";

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
  rosterShiftGenderPolicy?: { day?: string; night?: string } | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  geofenceRadiusMeters?: number | null;
  posts: Post[];
}

type ShiftGenderSelect = "any" | "male" | "female";

function shiftGenderFromSitePolicy(
  policy: Site["rosterShiftGenderPolicy"],
  which: "day" | "night"
): ShiftGenderSelect {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return "any";
  const v = (policy as Record<string, unknown>)[which];
  return v === "male" || v === "female" ? v : "any";
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
              Manage posts. Assign guards in{" "}
              <Link href="/rostering" className="font-medium text-neutral-700 dark:text-neutral-200 hover:underline">
                roster calendar
              </Link>
              {" "}
              or view the{" "}
              <Link
                href={`/rostering/matrix?siteId=${encodeURIComponent(siteId)}`}
                className="font-medium text-neutral-700 dark:text-neutral-200 hover:underline"
              >
                site shift matrix
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {((site.physicalAddress || site.location) || site.contactPersonName || site.contactPersonPhone || site.serviceType) && (
        <div className="card-elevated p-4">
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
        </div>
      )}

      <SiteRosterRulesSection
        site={site}
        siteId={siteId}
        token={token ?? ""}
        canManage={canManage}
        onSaved={refresh}
      />

      <div className="space-y-6">
          {deleteError && (
            <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800/50 flex items-center justify-between">
              {deleteError}
              <button onClick={() => setDeleteError(null)} className="ml-2 font-medium hover:underline">Dismiss</button>
            </div>
          )}
          <div className="card-elevated p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="section-title text-neutral-900 dark:text-neutral-100">Posts</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Guard assignments are managed in{" "}
                  <Link href="/rostering" className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline">
                    Roster
                  </Link>{" "}
                  or{" "}
                  <Link
                    href={`/rostering/matrix?siteId=${encodeURIComponent(siteId)}`}
                    className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline"
                  >
                    site matrix
                  </Link>
                  . You can remove a guard from a post here if needed.
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
                canManage={canManage}
                onRemoveGuard={(empId) => handleRemoveFromPost(post.id, empId)}
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
                  Add posts to define coverage. Assign guards from{" "}
                  <Link href="/rostering" className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline">
                    Roster
                  </Link>{" "}
                  or view{" "}
                  <Link
                    href={`/rostering/matrix?siteId=${encodeURIComponent(siteId)}`}
                    className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline"
                  >
                    matrix
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

function formatRosterRulesPreview(site: Site): string | null {
  const lines: string[] = [];
  const p = site.rosterShiftGenderPolicy;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    if (p.day === "female") lines.push("Day shift: female guards only.");
    if (p.day === "male") lines.push("Day shift: male guards only.");
    if (p.night === "female") lines.push("Night shift: female guards only.");
    if (p.night === "male") lines.push("Night shift: male guards only.");
  }
  const notes = site.rosterSiteRules?.trim();
  if (notes) {
    if (lines.length) lines.push("");
    lines.push(...notes.split(/\n+/).filter(Boolean));
  }
  return lines.length ? lines.join("\n") : null;
}

function SiteRosterRulesSection({
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
  const [dayGenderPolicy, setDayGenderPolicy] = useState<ShiftGenderSelect>(() =>
    shiftGenderFromSitePolicy(site.rosterShiftGenderPolicy, "day")
  );
  const [nightGenderPolicy, setNightGenderPolicy] = useState<ShiftGenderSelect>(() =>
    shiftGenderFromSitePolicy(site.rosterShiftGenderPolicy, "night")
  );
  const [rosterSiteRules, setRosterSiteRules] = useState(site.rosterSiteRules ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDayGenderPolicy(shiftGenderFromSitePolicy(site.rosterShiftGenderPolicy, "day"));
    setNightGenderPolicy(shiftGenderFromSitePolicy(site.rosterShiftGenderPolicy, "night"));
    setRosterSiteRules(site.rosterSiteRules ?? "");
    setError(null);
  }, [site.id, site.rosterShiftGenderPolicy, site.rosterSiteRules]);

  const preview = formatRosterRulesPreview(site);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          rosterSiteRules: rosterSiteRules.trim() || null,
          rosterShiftGenderPolicy:
            dayGenderPolicy === "any" && nightGenderPolicy === "any"
              ? null
              : {
                  ...(dayGenderPolicy !== "any" ? { day: dayGenderPolicy } : {}),
                  ...(nightGenderPolicy !== "any" ? { night: nightGenderPolicy } : {}),
                },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.message === "string" ? data.message : "Failed to save roster rules");
      }
      setSavedAt(Date.now());
      onSaved();
    } catch (err) {
      setSavedAt(null);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-elevated p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
        <div>
          <h2 className="section-title text-neutral-900 dark:text-neutral-100">Site roster rules</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            Enforced when assigning shifts to this site. Shown on the{" "}
            <Link
              href={`/rostering/matrix?siteId=${encodeURIComponent(siteId)}`}
              className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline"
            >
              site shift matrix
            </Link>
            .
          </p>
        </div>
      </div>

      {canManage ? (
        <form onSubmit={handleSave} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/25 rounded-lg border border-red-200 dark:border-red-800/50">
              {error}
            </div>
          )}
          {savedAt && !error && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
          )}
          <div className="border border-neutral-200 dark:border-neutral-700 rounded-security-lg p-4 bg-neutral-50/80 dark:bg-neutral-900/40">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Roster enforcement</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              Assignments are blocked if the guard does not match the rule (by post day/night type and gender on file).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Day shift
                </label>
                <select
                  value={dayGenderPolicy}
                  onChange={(e) => {
                    setDayGenderPolicy(e.target.value as ShiftGenderSelect);
                    setSavedAt(null);
                  }}
                  className="input-modern w-full"
                >
                  <option value="any">Any</option>
                  <option value="male">Male only</option>
                  <option value="female">Female only</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                  Night shift
                </label>
                <select
                  value={nightGenderPolicy}
                  onChange={(e) => {
                    setNightGenderPolicy(e.target.value as ShiftGenderSelect);
                    setSavedAt(null);
                  }}
                  className="input-modern w-full"
                >
                  <option value="any">Any</option>
                  <option value="male">Male only</option>
                  <option value="female">Female only</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                Additional notes (matrix only, not enforced)
              </label>
              <textarea
                value={rosterSiteRules}
                onChange={(e) => {
                  setRosterSiteRules(e.target.value);
                  setSavedAt(null);
                }}
                placeholder="e.g. client preferences, exceptions process"
                rows={3}
                className="input-modern w-full font-normal normal-case tracking-normal"
              />
            </div>
          </div>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Saving…" : "Save roster rules"}
          </button>
        </form>
      ) : (
        <div className="text-sm">
          {preview ? (
            <div className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/40 p-4">
              {preview}
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 italic">No roster rules defined for this site.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  siteId,
  token,
  guards,
  canManage,
  onRemoveGuard,
  onDelete,
  onError,
  onEdit,
}: {
  post: Post;
  siteId: string;
  token: string;
  guards: Guard[];
  canManage: boolean;
  onRemoveGuard: (empId: string) => void;
  onDelete: () => void;
  onError?: (msg: string | null) => void;
  onEdit?: (post: Post) => void;
}) {
  const shiftLabel = post.shiftType ? SHIFT_LABELS[post.shiftType] : "Shift";

  return (
    <div
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
      className={`p-4 rounded-lg border-2 transition-all duration-200 border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-600 ${
        canManage && onEdit ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 focus:ring-offset-2 dark:focus:ring-offset-neutral-900" : ""
      }`}
    >
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
              if (!confirm("Delete this post?")) return;
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

      <div className="min-h-[72px] rounded-lg p-3 bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700">
        {guards.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
            {canManage ? (
              <>
                No guards on this post. Assign in{" "}
                <Link href="/rostering" className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline">
                  Roster
                </Link>{" "}
                or{" "}
                <Link
                  href={`/rostering/matrix?siteId=${encodeURIComponent(siteId)}`}
                  className="font-medium text-neutral-600 dark:text-neutral-300 hover:underline"
                >
                  matrix
                </Link>
                .
              </>
            ) : (
              "No guards assigned"
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            {guards.map((g) => (
              <GuardChip
                key={g.id}
                guard={g}
                onRemove={canManage ? () => onRemoveGuard(g.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
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
  onRemove,
}: {
  guard: Guard;
  onRemove?: () => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm select-none transition-all hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-600"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${guard.status === "active" ? "bg-emerald-500" : guard.status === "training" ? "bg-amber-500" : "bg-neutral-400"}`} title={guard.status} />
      <span className="text-neutral-700 dark:text-neutral-300">
        {guard.firstName} {guard.lastName}
      </span>
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
