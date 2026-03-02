"use client";

// #region agent log
const DEPLOY_VER = "2025-03-02-v2";
// #endregion

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

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
  const [availableGuards, setAvailableGuards] = useState<Guard[]>([]);
  const [showAddPost, setShowAddPost] = useState(false);
  const [draggedGuard, setDraggedGuard] = useState<{ guard: Guard; source: "pool" | string } | null>(null);
  const [dragOverPost, setDragOverPost] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canManage = ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"].includes((user as { role?: string })?.role ?? "");

  const refresh = () => {
    if (!token || !siteId) return;
    Promise.all([
      authFetch(`/sites/${siteId}`, token).then((r) => r.json()),
      authFetch("/employees?limit=200", token).then((r) => r.json()),
    ]).then(([siteData, empData]) => {
      setSite(siteData);
      const guards = (empData.data || []).filter(
        (e: Guard & { employeeType?: string }) =>
          e.employeeType === "security" && ["active", "training", "hired"].includes(e.status)
      );
      setAvailableGuards(guards);
    });
  };

  useEffect(() => {
    if (!token || !siteId) return;
    refresh();
    setLoading(false);
  }, [token, siteId]);

  // #region agent log
  useEffect(() => {
    fetch("http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "0ccf20" },
      body: JSON.stringify({
        sessionId: "0ccf20",
        location: "sites/[id]/page.tsx",
        message: "Site detail mounted",
        data: { deployVer: DEPLOY_VER, siteId, origin: typeof window !== "undefined" ? window.location.origin : "ssr" },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
  }, [siteId]);
  // #endregion

  const getGuardsInPost = (postId: string): Guard[] => {
    const post = site?.posts.find((p) => p.id === postId);
    return post?.assignedGuards?.map((a) => a.employee) ?? [];
  };

  const getUnassignedGuards = (): Guard[] => {
    const assignedIds = new Set(
      site?.posts.flatMap((p) => p.assignedGuards?.map((a) => a.employee.id) ?? []) ?? []
    );
    return availableGuards.filter((g) => !assignedIds.has(g.id));
  };

  const handleDragStart = (guard: Guard, source: "pool" | string) => {
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

    if (source !== "pool") {
      await authFetch(`/sites/${siteId}/posts/${source}/guards/${guard.id}`, token, { method: "DELETE" });
    }

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

  const unassignedGuards = getUnassignedGuards();

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* #region agent log - visible deploy version for verification */}
      <div
        className="fixed bottom-4 right-4 z-50 px-3 py-1.5 rounded-lg bg-amber-500/90 text-amber-950 text-xs font-mono font-bold shadow-lg"
        title="Remove after deploy verification"
      >
        Build: {DEPLOY_VER}
      </div>
      {/* #endregion */}
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
              Manage posts and assign guards
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
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
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
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">Assign guards to posts by dragging from the pool</p>
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
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm mx-auto">Add posts and assign guards to define coverage for this site.</p>
                {canManage && (
                  <button onClick={() => setShowAddPost(true)} className="mt-4 btn-primary">Add Post</button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="card-elevated sticky top-6 p-5">
            <h3 className="section-title text-neutral-900 dark:text-neutral-100 mb-1">
              Available Guards
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
              Drag guards into posts to assign them
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {unassignedGuards.map((g) => (
                <GuardChip
                  key={g.id}
                  guard={g}
                  draggable={canManage}
                  onDragStart={() => handleDragStart(g, "pool")}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedGuard?.guard.id === g.id}
                />
              ))}
              {unassignedGuards.length === 0 && (
                <div className="text-center py-8 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 font-medium">All guards assigned</p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Remove from a post to assign elsewhere</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
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
}) {
  const shiftLabel = post.shiftType ? SHIFT_LABELS[post.shiftType] : "Shift";

  return (
    <div
      onDragOver={canManage ? onDragOver : undefined}
      onDragLeave={canManage ? onDragLeave : undefined}
      onDrop={canManage ? onDrop : undefined}
      className={`p-4 rounded-lg border-2 transition-all duration-200 ${
        isDragOver
          ? "border-neutral-400 dark:border-neutral-500 bg-neutral-50 dark:bg-neutral-800/50 ring-2 ring-neutral-300 dark:ring-neutral-600 ring-offset-2 dark:ring-offset-neutral-900"
          : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-600"
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
            onClick={async () => {
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

      <div className={`min-h-[72px] rounded-lg p-3 transition-colors ${
        isDragOver
          ? "bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-400 dark:border-neutral-500"
          : "bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700"
      }`}>
        {guards.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
            {canManage ? "Drag guards here or drop from the pool" : "No guards assigned"}
          </p>
        ) : (
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
        )}
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
    <form onSubmit={handleSubmit} className="p-5 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white">
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
