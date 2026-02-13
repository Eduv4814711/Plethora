"use client";

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
  const canManage = ["admin", "operations_manager", "hr_payroll", "supervisor"].includes((user as { role?: string })?.role ?? "");

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
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-64" />
        <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
      </div>
    );
  }

  const unassignedGuards = getUnassignedGuards();

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/sites"
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{site.name}</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-sm">
              Manage posts and assign guards — drag guards into posts
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {deleteError && (
            <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl">
              {deleteError}
              <button onClick={() => setDeleteError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Posts</h2>
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
            <AddPostForm siteId={siteId} token={token!} onSuccess={() => { setShowAddPost(false); refresh(); }} />
          )}

          <div className="space-y-5">
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
            <div className="text-center py-12 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
              <p className="font-medium text-slate-600 dark:text-slate-400">No posts yet</p>
              <p className="text-sm text-slate-500 mt-1">Add a Day or Night shift post to get started</p>
              {canManage && (
                <button onClick={() => setShowAddPost(true)} className="mt-4 btn-primary">Add Post</button>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6 p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
              Available Guards
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
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
                <p className="text-sm text-slate-500 py-4">All guards assigned</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Site info</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {(site.physicalAddress || site.location) && (
            <p className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Address:</span> {site.physicalAddress || site.location}
            </p>
          )}
          {(site.contactPersonName || site.contactPersonPhone) && (
            <p className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Contact:</span> {site.contactPersonName}
              {site.contactPersonPhone && ` • ${site.contactPersonPhone}`}
            </p>
          )}
          {site.serviceType && (
            <p className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Service:</span> {SERVICE_TYPE_LABELS[site.serviceType] || site.serviceType}
            </p>
          )}
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
      className={`p-5 rounded-2xl border-2 transition-all duration-200 ${
        isDragOver
          ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30"
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          post.shiftType === "day"
            ? "bg-amber-100 dark:bg-amber-900/30"
            : "bg-slate-800 dark:bg-slate-700"
        }`}>
          {post.shiftType === "day" ? (
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{post.name}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{shiftLabel}</p>
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Delete post"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        )}
      </div>

      <div className="min-h-[80px] rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-200 dark:border-slate-700 p-3">
        {guards.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
            {canManage ? "Drag guards here" : "No guards assigned"}
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
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-50 scale-95" : "hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700"
      } ${draggable ? "" : "cursor-default"}`}
    >
      <span className="w-2 h-2 rounded-full bg-emerald-500" />
      <span className="text-slate-700 dark:text-slate-300">
        {guard.firstName} {guard.lastName}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-600 transition-colors"
          title="Remove"
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
    <form onSubmit={handleSubmit} className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
      <h4 className="font-semibold text-slate-900 dark:text-white mb-4">New Post</h4>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl">
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
