"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { rosterSiteRulesLines } from "@/lib/roster-site-rules-defaults";
import { buildSiteRosterReadinessHints } from "@/lib/roster-readiness-hints";
import {
  ALL_WEEK_DAYS,
  DAY_LABELS,
  DISPLAY_DAY_ORDER,
  coverageDaysOrAllWeek,
  describeCoverageDays,
  shiftRuns,
  toggleCoverageDay,
} from "@/lib/site-coverage-days";
import { useConfirmDialog } from "@/components/ui";
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
  rosterDayShiftDays?: number[] | null;
  rosterNightShiftDays?: number[] | null;
  autoRosterEnabled?: boolean;
  autoRosterMinCoveragePercent?: number;
  autoRosterLastRunAt?: string | null;
  autoRosterLastStatus?: string | null;
  rosterContinuityState?: "not_setup" | "running" | "needs_attention" | "paused";
  rosterMaintainedThrough?: string | null;
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

const ROSTERABLE_GUARD_STATUSES = ["active", "training", "hired", "reliever"] as const;

function validateSiteShiftStaffing(
  dayGuardsRequired: string,
  nightGuardsRequired: string,
  rosterableCount: number,
  coverage: { dayDays: number[]; nightDays: number[] } = {
    dayDays: ALL_WEEK_DAYS,
    nightDays: ALL_WEEK_DAYS,
  }
): { error: string } | { dayCount: number; nightCount: number } {
  const dayCount = parseInt(dayGuardsRequired, 10);
  const nightCount = parseInt(nightGuardsRequired, 10);
  if (
    !Number.isFinite(dayCount) ||
    dayCount < 0 ||
    dayCount > 50 ||
    !Number.isFinite(nightCount) ||
    nightCount < 0 ||
    nightCount > 50
  ) {
    return { error: "Guards per shift must be a whole number from 0 to 50." };
  }
  const dayRuns = shiftRuns(dayCount, coverage.dayDays);
  const nightRuns = shiftRuns(nightCount, coverage.nightDays);
  if (!dayRuns && !nightRuns) {
    return {
      error: "At least one shift must require at least 1 guard on at least one day of the week.",
    };
  }
  // Only shifts that actually run set the floor: a Mon–Fri day shift and no night shift
  // needs the day headcount, not the sum.
  const minRosterable = Math.max(dayRuns ? dayCount : 0, nightRuns ? nightCount : 0);
  if (rosterableCount < minRosterable) {
    return {
      error: `This site has ${rosterableCount} rosterable guard(s) but staffing requires at least ${minRosterable} per day. Assign more guards to the site first.`,
    };
  }
  return { dayCount, nightCount };
}

/** Mon–Sun toggle row for one shift type's weekday cover. */
function CoverageDaysPicker({
  label,
  days,
  onChange,
  canManage,
  disabled,
}: {
  label: string;
  days: number[];
  onChange: (next: number[]) => void;
  canManage: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400 w-24 shrink-0">
        {label}
      </span>
      {canManage ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`${label} days covered`}>
          {DISPLAY_DAY_ORDER.map((d) => {
            const active = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onChange(toggleCoverageDay(days, d))}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 ${
                  active
                    ? "border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-500 dark:bg-orange-900/30 dark:text-orange-300"
                    : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400 dark:hover:border-neutral-600"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {describeCoverageDays(days)}
        </span>
      )}
      {canManage && (
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          {describeCoverageDays(days)}
        </span>
      )}
    </div>
  );
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
  const [dayGuardsRequired, setDayGuardsRequired] = useState("1");
  const [nightGuardsRequired, setNightGuardsRequired] = useState("1");
  const [dayCoverDays, setDayCoverDays] = useState<number[]>(ALL_WEEK_DAYS);
  const [nightCoverDays, setNightCoverDays] = useState<number[]>(ALL_WEEK_DAYS);
  const [staffingSaving, setStaffingSaving] = useState(false);
  const [staffingError, setStaffingError] = useState<string | null>(null);
  const [staffingSavedFlash, setStaffingSavedFlash] = useState(false);
  const canCreate = user ? hasCapability(user, "/sites", "create") : false;
  const canEdit = user ? hasCapability(user, "/sites", "edit") : false;
  const canDelete = user ? hasCapability(user, "/sites", "delete") : false;
  const canMovePostGuards = canCreate && canDelete;

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

  useEffect(() => {
    if (!site) return;
    setDayGuardsRequired(String(site.rosterDayShiftGuardsRequired ?? 1));
    setNightGuardsRequired(String(site.rosterNightShiftGuardsRequired ?? 1));
    setDayCoverDays(coverageDaysOrAllWeek(site.rosterDayShiftDays));
    setNightCoverDays(coverageDaysOrAllWeek(site.rosterNightShiftDays));
  }, [site?.id, site?.rosterDayShiftGuardsRequired, site?.rosterNightShiftGuardsRequired]);

  const staffingReadinessHints = useMemo(
    () => (site ? buildSiteRosterReadinessHints(site).filter((h) => h.level !== "ok") : []),
    [site]
  );

  const hasDayPost = site?.posts.some((p) => (p.shiftType ?? "day") !== "night") ?? false;
  const hasNightPost = site?.posts.some((p) => p.shiftType === "night") ?? false;

  const saveSiteShiftStaffing = async () => {
    if (!token || !site || !canEdit) return;
    setStaffingError(null);
    const rosterableCount = site.assignedGuards.filter((a) =>
      ROSTERABLE_GUARD_STATUSES.includes(a.employee.status as (typeof ROSTERABLE_GUARD_STATUSES)[number])
    ).length;
    const validated = validateSiteShiftStaffing(
      dayGuardsRequired,
      nightGuardsRequired,
      rosterableCount,
      { dayDays: dayCoverDays, nightDays: nightCoverDays }
    );
    if ("error" in validated) {
      setStaffingError(validated.error);
      return;
    }
    const { dayCount, nightCount } = validated;
    setStaffingSaving(true);
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          rosterDayShiftGuardsRequired: dayCount,
          rosterNightShiftGuardsRequired: nightCount,
          rosterDayShiftDays: dayCoverDays,
          rosterNightShiftDays: nightCoverDays,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.message === "string" ? data.message : data.error || "Failed to save staffing"
        );
      }
      refresh();
      setStaffingSavedFlash(true);
      setTimeout(() => setStaffingSavedFlash(false), 2000);
    } catch (e) {
      setStaffingError(e instanceof Error ? e.message : "Failed to save staffing");
    } finally {
      setStaffingSaving(false);
    }
  };

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
    if (!draggedGuard || !token || !canMovePostGuards) return;

    const { guard, source } = draggedGuard;
    setDraggedGuard(null);

    if (source === postId) return;

    const del = await authFetch(`/sites/${siteId}/posts/${source}/guards/${guard.id}`, token, {
      method: "DELETE",
    });
    if (!del.ok) {
      const body = await del.json().catch(() => ({}));
      setDeleteError(
        (body as { message?: string; error?: string }).message ||
          (body as { error?: string }).error ||
          "Failed to move guard from the previous post"
      );
      return;
    }

    const res = await authFetch(`/sites/${siteId}/posts/${postId}/guards`, token, {
      method: "POST",
      body: JSON.stringify({ employeeId: guard.id }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(
        (body as { message?: string; error?: string }).message ||
          (body as { error?: string }).error ||
          "Failed to assign guard to the new post"
      );
      return;
    }

    setDeleteError(null);
    refresh();
  };

  const handleRemoveFromPost = async (postId: string, employeeId: string) => {
    if (!token || !canDelete) return;
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href="/sites"
            className="p-2.5 rounded-lg border-2 border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all shrink-0"
            aria-label="Back to sites"
          >
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="page-title truncate">{site.name}</h1>
            <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
              Assign guards to posts, then use the shortcuts below for rostering and attendance.
            </p>
          </div>
        </div>
        <SiteOperationalActions siteId={siteId} layout="stack" className="shrink-0" />
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
          <SiteRosterSheetFields site={site} siteId={siteId} token={token!} canManage={canEdit} onSaved={refresh} />
        </div>

        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <SiteGuardsAssignment
            site={site}
            siteId={siteId}
            token={token!}
            canManage={canEdit}
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
            <SiteAutoRosterSettings
              site={site}
              siteId={siteId}
              token={token!}
              canManage={canEdit}
              onSaved={refresh}
            />
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
              {canCreate && (
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

            {showAddPost && canCreate && (
              <div className="mb-6">
                <AddPostForm
                  siteId={siteId}
                  token={token!}
                  site={site}
                  dayGuardsRequired={dayGuardsRequired}
                  nightGuardsRequired={nightGuardsRequired}
                  onSuccess={() => {
                    setShowAddPost(false);
                    refresh();
                  }}
                />
              </div>
            )}

            <div className="space-y-4">
            {!hasDayPost && (
              <ShiftStaffingFallbackCard
                shiftType="day"
                guardsRequired={dayGuardsRequired}
                onGuardsRequiredChange={setDayGuardsRequired}
                canManage={canEdit}
                readOnlyValue={site.rosterDayShiftGuardsRequired ?? 1}
              />
            )}
            {site.posts.map((post) => {
              const staffingEditor = (post.shiftType ?? "day") === "night" ? "night" : "day";
              return (
              <PostCard
                key={post.id}
                post={post}
                siteId={siteId}
                token={token!}
                guards={getGuardsInPost(post.id)}
                isDragOver={dragOverPost === post.id}
                canEdit={canEdit}
                canDelete={canDelete}
                canAssignGuards={canMovePostGuards}
                staffingEditor={staffingEditor}
                guardsRequired={staffingEditor === "day" ? dayGuardsRequired : nightGuardsRequired}
                onGuardsRequiredChange={
                  staffingEditor === "day" ? setDayGuardsRequired : setNightGuardsRequired
                }
                staffingReadOnly={
                  staffingEditor === "day"
                    ? site.rosterDayShiftGuardsRequired ?? 1
                    : site.rosterNightShiftGuardsRequired ?? 1
                }
                onDragOver={(e) => handleDragOver(e, post.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, post.id)}
                onRemoveGuard={(empId) => handleRemoveFromPost(post.id, empId)}
                onDragStart={(guard) => handleDragStart(guard, post.id)}
                onDragEnd={handleDragEnd}
                onDelete={refresh}
                onError={(msg) => setDeleteError(msg || null)}
                onEdit={canEdit ? (nextPost) => setEditingPost(nextPost) : undefined}
              />
            );
            })}
            {!hasNightPost && (
              <ShiftStaffingFallbackCard
                shiftType="night"
                guardsRequired={nightGuardsRequired}
                onGuardsRequiredChange={setNightGuardsRequired}
                canManage={canEdit}
                readOnlyValue={site.rosterNightShiftGuardsRequired ?? 1}
              />
            )}
          </div>

            {(canEdit || site.posts.length > 0 || !hasDayPost || !hasNightPost) && (
              <div className="mt-5 space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-5">
                <div className="space-y-2.5">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                      Days covered
                    </h3>
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                      Days left off are not rostered and raise no coverage-gap alerts.
                    </p>
                  </div>
                  <CoverageDaysPicker
                    label="Day shift"
                    days={dayCoverDays}
                    onChange={setDayCoverDays}
                    canManage={canEdit}
                    disabled={staffingSaving}
                  />
                  <CoverageDaysPicker
                    label="Night shift"
                    days={nightCoverDays}
                    onChange={setNightCoverDays}
                    canManage={canEdit}
                    disabled={staffingSaving}
                  />
                </div>
                {staffingError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                    {staffingError}
                  </div>
                )}
                {staffingSavedFlash && (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Staffing saved.</p>
                )}
                {staffingReadinessHints.length > 0 && (
                  <ul className="space-y-1 text-[11px]">
                    {staffingReadinessHints.map((h, i) => (
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
                {canEdit && (
                  <>
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      Set guards required per shift on each post. Use 0 for day-only or night-only sites.
                    </p>
                    <button
                      type="button"
                      onClick={saveSiteShiftStaffing}
                      disabled={staffingSaving}
                      className="btn-primary text-sm py-2 disabled:opacity-60"
                    >
                      {staffingSaving ? "Saving…" : "Save staffing"}
                    </button>
                  </>
                )}
              </div>
            )}

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
                {canCreate && (
                  <button onClick={() => setShowAddPost(true)} className="mt-4 btn-primary">Add Post</button>
                )}
              </div>
            )}
          </div>
      </div>

      {editingPost && canEdit && (
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
            (e.employeeType ?? "security_officer") === "security_officer" &&
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDayGender((site.rosterDayShiftGender as RosterShiftGenderUi) || "");
    setNightGender((site.rosterNightShiftGender as RosterShiftGenderUi) || "");
    setRules(site.rosterSiteRules ?? "");
    setNotes(site.rosterSheetNotes ?? "");
  }, [
    site.id,
    site.rosterSiteRules,
    site.rosterSheetNotes,
    site.rosterDayShiftGender,
    site.rosterNightShiftGender,
  ]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          rosterSiteRules: rules,
          rosterSheetNotes: notes,
          rosterDayShiftGender: dayGender === "" ? null : dayGender,
          rosterNightShiftGender: nightGender === "" ? null : nightGender,
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
          Shift gender rules (shift roster & PDF)
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
          Choose a requirement per shift. &quot;Not specified&quot; skips gender lines on the sheet. Guards required per shift are configured on Posts below.
        </p>
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

function siteAutoRosterReady(site: Site): boolean {
  const hints = buildSiteRosterReadinessHints(site);
  const hasDay = site.posts.some((p) => (p.shiftType ?? "day") !== "night");
  const hasNight = site.posts.some((p) => p.shiftType === "night");
  return hasDay && hasNight && !hints.some((h) => h.level === "error");
}

function SiteAutoRosterSettings({
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
  const [enabled, setEnabled] = useState(Boolean(site.autoRosterEnabled));
  const [minCoverage, setMinCoverage] = useState(String(site.autoRosterMinCoveragePercent ?? 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const ready = useMemo(() => siteAutoRosterReady(site), [site]);

  useEffect(() => {
    setEnabled(Boolean(site.autoRosterEnabled));
    setMinCoverage(String(site.autoRosterMinCoveragePercent ?? 100));
  }, [
    site.id,
    site.autoRosterEnabled,
    site.autoRosterMinCoveragePercent,
  ]);

  const save = async () => {
    setError(null);
    const coverage = parseInt(minCoverage, 10);
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
      setError("Coverage threshold must be 0–100.");
      return;
    }
    if (enabled && !ready) {
      setError("Complete the readiness checklist before enabling auto-roster.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          autoRosterEnabled: enabled,
          autoRosterMinCoveragePercent: coverage,
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
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const lastRunLabel =
    site.autoRosterLastRunAt && site.autoRosterLastStatus
      ? `${site.autoRosterLastStatus.replace(/_/g, " ")} · ${new Date(site.autoRosterLastRunAt).toLocaleString()}`
      : null;

  if (site.rosterContinuityState) {
    const labels = {
      not_setup: "Not set up",
      running: "Running",
      needs_attention: "Needs attention",
      paused: "Paused",
    } as const;
    return (
      <div className="space-y-4">
        <div>
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-1">Ongoing rostering</h2>
          <p className="max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
            Plethora can repeat the approved site schedule and keep the next two roster periods ready automatically.
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900/50">
          <p className="font-medium text-neutral-900 dark:text-neutral-100">
            Status: {labels[site.rosterContinuityState]}
          </p>
          {site.rosterMaintainedThrough && (
            <p className="mt-1 text-xs text-neutral-500">
              Roster maintained through {new Date(site.rosterMaintainedThrough).toLocaleDateString()}.
            </p>
          )}
        </div>
        <Link href={`/rostering?siteId=${siteId}`} className="btn-primary inline-flex">
          {site.rosterContinuityState === "not_setup" ? "Set up ongoing roster" : "Manage ongoing roster"}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-1">Automatic rostering</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-2xl">
          When enabled, a daily job maintains shifts through your company payroll horizon. Plans meeting the
          coverage threshold apply automatically; others queue for review on{" "}
          <Link href="/rostering" className="font-medium text-orange-600 dark:text-orange-400 hover:underline">
            Rostering
          </Link>
          .
        </p>
      </div>
      {lastRunLabel && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Last run: {lastRunLabel}</p>
      )}
      {!canManage ? (
        <div className="text-sm text-neutral-600 dark:text-neutral-400 space-y-2">
          <p>
            Auto-roster:{" "}
            <span className="font-medium">{site.autoRosterEnabled ? "Enabled" : "Disabled"}</span>
          </p>
          {site.autoRosterEnabled && (
            <p>
              Coverage threshold: {site.autoRosterMinCoveragePercent ?? 100}%
            </p>
          )}
          <SiteAutoRosterChecklist site={site} />
        </div>
      ) : (
        <>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {savedFlash && (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Saved. Auto-roster will run for the current payroll horizon.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            Enable automatic rostering for this site
          </label>
          {enabled && (
            <div className="space-y-4 pl-0 sm:pl-6 border-l-0 sm:border-l-2 border-orange-200 dark:border-orange-800/60">
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Auto-apply when coverage ≥
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minCoverage}
                    onChange={(e) => setMinCoverage(e.target.value)}
                    className="input-modern w-24 text-sm"
                  />
                  <span className="text-sm text-neutral-500">%</span>
                </div>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Default 100%. Lower values auto-apply partial coverage; otherwise plans queue for roster approval review.
                </p>
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
              Readiness checklist
            </p>
            <SiteAutoRosterChecklist site={site} />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm py-2 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save auto-roster settings"}
          </button>
        </>
      )}
    </div>
  );
}

function SiteAutoRosterChecklist({ site }: { site: Site }) {
  const hints = useMemo(() => buildSiteRosterReadinessHints(site), [site]);
  const dayPosts = site.posts.filter((p) => (p.shiftType ?? "day") !== "night");
  const nightPosts = site.posts.filter((p) => p.shiftType === "night");
  const dayStaff = Math.min(50, Math.max(0, Math.floor(site.rosterDayShiftGuardsRequired ?? 1)));
  const nightStaff = Math.min(50, Math.max(0, Math.floor(site.rosterNightShiftGuardsRequired ?? 1)));

  return (
    <ul className="space-y-2 text-sm">
      <li
        className={
          dayPosts.length > 0 || dayStaff === 0
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-red-700 dark:text-red-300"
        }
      >
        {dayPosts.length > 0 || dayStaff === 0 ? "✓" : "✗"} At least one day post ({dayPosts.length})
        {dayStaff === 0 ? " — day shift not staffed" : ""}
      </li>
      <li
        className={
          nightPosts.length > 0 || nightStaff === 0
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-red-700 dark:text-red-300"
        }
      >
        {nightPosts.length > 0 || nightStaff === 0 ? "✓" : "✗"} At least one night post ({nightPosts.length})
        {nightStaff === 0 ? " — night shift not staffed" : ""}
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

function ShiftStaffingFallbackCard({
  shiftType,
  guardsRequired,
  onGuardsRequiredChange,
  canManage,
  readOnlyValue,
}: {
  shiftType: "day" | "night";
  guardsRequired: string;
  onGuardsRequiredChange: (v: string) => void;
  canManage: boolean;
  readOnlyValue: number;
}) {
  const label = shiftType === "day" ? "Day shift" : "Night shift";
  const inputId = shiftType === "day" ? "roster-day-guards-required-fallback" : "roster-night-guards-required-fallback";

  return (
    <div className="p-4 rounded-lg border-2 border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-900/40">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="font-medium text-sm text-neutral-800 dark:text-neutral-200">{label} — no post yet</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Configure staffing here, or add a {label.toLowerCase()} post.
          </p>
        </div>
        <ShiftStaffingField
          inputId={inputId}
          value={guardsRequired}
          onChange={onGuardsRequiredChange}
          canManage={canManage}
          readOnlyValue={readOnlyValue}
          shiftType={shiftType}
        />
      </div>
    </div>
  );
}

function shiftStaffingLabel(shiftType: "day" | "night"): string {
  return shiftType === "night" ? "Guards required per Night" : "Guards required per day";
}

function shiftStaffingReadOnlyText(count: number, shiftType: "day" | "night"): string {
  if (count === 0) return "Not staffed (0)";
  const period = shiftType === "night" ? "night" : "day";
  return `${count} guard(s) required per ${period}`;
}

function ShiftStaffingField({
  inputId,
  value,
  onChange,
  canManage,
  readOnlyValue,
  shiftType,
}: {
  inputId: string;
  value: string;
  onChange?: (v: string) => void;
  canManage: boolean;
  readOnlyValue?: number;
  shiftType: "day" | "night";
}) {
  if (!canManage) {
    const count = readOnlyValue ?? parseInt(value, 10);
    return (
      <p className="text-xs text-neutral-600 dark:text-neutral-400 shrink-0">
        {shiftStaffingReadOnlyText(count, shiftType)}
      </p>
    );
  }

  return (
    <div className="flex w-fit max-w-full items-center gap-2">
      <label htmlFor={inputId} className="text-xs font-medium text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
        {shiftStaffingLabel(shiftType)}
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        max={50}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="input-modern !w-[4.5rem] shrink-0 px-2.5 py-1.5 text-sm text-center tabular-nums [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

function PostCard({
  post,
  siteId,
  token,
  guards,
  isDragOver,
  canEdit,
  canDelete,
  canAssignGuards,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveGuard,
  onDragStart,
  onDragEnd,
  onDelete,
  onError,
  onEdit,
  staffingEditor,
  guardsRequired,
  onGuardsRequiredChange,
  staffingReadOnly,
}: {
  post: Post;
  siteId: string;
  token: string;
  guards: Guard[];
  isDragOver: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAssignGuards: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRemoveGuard: (empId: string) => void;
  onDragStart: (guard: Guard) => void;
  onDragEnd: () => void;
  onDelete: () => void;
  onError?: (msg: string | null) => void;
  onEdit?: (post: Post) => void;
  staffingEditor: "day" | "night";
  guardsRequired: string;
  onGuardsRequiredChange: (v: string) => void;
  staffingReadOnly?: number;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const shiftLabel = post.shiftType ? SHIFT_LABELS[post.shiftType] : "Shift";
  const staffingInputId =
    staffingEditor === "day" ? "roster-day-guards-required" : "roster-night-guards-required";

  return (
    <div
      onDragOver={canAssignGuards ? onDragOver : undefined}
      onDragLeave={canAssignGuards ? onDragLeave : undefined}
      onDrop={canAssignGuards ? onDrop : undefined}
      onClick={canEdit && onEdit ? () => onEdit(post) : undefined}
      onKeyDown={
        canEdit && onEdit
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEdit(post);
              }
            }
          : undefined
      }
      role={canEdit && onEdit ? "button" : undefined}
      tabIndex={canEdit && onEdit ? 0 : undefined}
      className={`p-4 rounded-lg border-2 transition-all duration-200 ${
        isDragOver
          ? "border-neutral-400 dark:border-neutral-500 bg-neutral-50 dark:bg-neutral-800/50 ring-2 ring-neutral-300 dark:ring-neutral-600 ring-offset-2 dark:ring-offset-neutral-900"
          : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-600"
      } ${
        canEdit && onEdit ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 focus:ring-offset-2 dark:focus:ring-offset-neutral-900" : ""
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
        {canDelete && (
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

      {staffingEditor && (
        <div
          className="mb-4 pb-4 border-b border-neutral-100 dark:border-neutral-800"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <ShiftStaffingField
            inputId={`${staffingInputId}-${post.id}`}
            value={guardsRequired}
            onChange={onGuardsRequiredChange}
            canManage={canEdit}
            readOnlyValue={staffingReadOnly}
            shiftType={staffingEditor}
          />
        </div>
      )}

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
                draggable={canAssignGuards}
                onDragStart={() => onDragStart(g)}
                onDragEnd={onDragEnd}
                onRemove={canDelete ? () => onRemoveGuard(g.id) : undefined}
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
  site,
  dayGuardsRequired,
  nightGuardsRequired,
  onSuccess,
}: {
  siteId: string;
  token: string;
  site: Site;
  dayGuardsRequired: string;
  nightGuardsRequired: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [shiftType, setShiftType] = useState<"day" | "night">("day");
  const [guardsRequired, setGuardsRequired] = useState(dayGuardsRequired);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setGuardsRequired(shiftType === "night" ? nightGuardsRequired : dayGuardsRequired);
  }, [shiftType, dayGuardsRequired, nightGuardsRequired]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Post name is required.");
      return;
    }

    const nextDay = shiftType === "day" ? guardsRequired : dayGuardsRequired;
    const nextNight = shiftType === "night" ? guardsRequired : nightGuardsRequired;
    const rosterableCount = site.assignedGuards.filter((a) =>
      ROSTERABLE_GUARD_STATUSES.includes(a.employee.status as (typeof ROSTERABLE_GUARD_STATUSES)[number])
    ).length;
    const validated = validateSiteShiftStaffing(nextDay, nextNight, rosterableCount, {
      dayDays: coverageDaysOrAllWeek(site.rosterDayShiftDays),
      nightDays: coverageDaysOrAllWeek(site.rosterNightShiftDays),
    });
    if ("error" in validated) {
      setError(validated.error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch(`/sites/${siteId}/posts`, token, {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, shiftType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create post");
      }

      const staffingRes = await authFetch(`/sites/${siteId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          rosterDayShiftGuardsRequired: validated.dayCount,
          rosterNightShiftGuardsRequired: validated.nightCount,
        }),
      });
      if (!staffingRes.ok) {
        const data = await staffingRes.json().catch(() => ({}));
        throw new Error(
          typeof data.message === "string" ? data.message : data.error || "Post created but staffing failed to save"
        );
      }

      setName("");
      setShiftType("day");
      setGuardsRequired(dayGuardsRequired);
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
      <div className="mt-4">
        <ShiftStaffingField
          inputId="add-post-guards-required"
          value={guardsRequired}
          onChange={setGuardsRequired}
          canManage
          shiftType={shiftType}
        />
      </div>
      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Creating..." : "Create Post"}
        </button>
      </div>
    </form>
  );
}
