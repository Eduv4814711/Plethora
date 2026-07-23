"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { listApprovals, reviewApproval, approvalEntityHref, type ApprovalRequest } from "@/lib/msr-api";
import Link from "next/link";
import { AlertBanner, Badge, EmptyState, PageHeader } from "@/components/ui";

const TYPE_LABELS: Record<string, string> = {
  ATTENDANCE_EXCEPTION: "Attendance exception",
  MISSED_CLOCK_IN: "Missed clock-in",
  MISSED_CLOCK_OUT: "Missed clock-out",
  OVERTIME: "Overtime",
  LEAVE: "Leave",
  SICK_NOTE: "Sick note",
  SITE_TIMESHEET: "Site timesheet",
  INCIDENT: "Incident",
  TASK_COMPLETION: "Task completion",
  PAYROLL_READINESS: "Payroll readiness",
  DOCUMENT_REVIEW: "Document review",
};

function statusBadge(status: string) {
  if (status === "PENDING") return <Badge variant="warning">Pending</Badge>;
  if (status === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="error">Rejected</Badge>;
  if (status === "QUERY_RAISED") return <Badge variant="neutral">Query raised</Badge>;
  return <Badge variant="neutral">{status}</Badge>;
}

export default function ApprovalsPage() {
  const { token, user } = useAuth();
  const canApprove = Boolean(user && hasCapability(user, "/approvals", "approve"));
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [actingId, setActingId] = useState<string | null>(null);
  const [queryComment, setQueryComment] = useState("");
  const [queryId, setQueryId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !canApprove) return;
    setError("");
    try {
      const result = await listApprovals(token, {
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setItems(result.items);
      setPendingCount(result.pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load approvals");
      setItems([]);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [token, refresh]);

  const handleReview = async (id: string, action: "approve" | "reject" | "query", comment?: string) => {
    if (!token) return;
    setActingId(id);
    setError("");
    try {
      await reviewApproval(token, id, action, comment);
      setQueryId(null);
      setQueryComment("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-neutral-200 rounded-lg" />
        <div className="h-24 bg-neutral-200 rounded-lg" />
        <div className="h-24 bg-neutral-200 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Approvals"
        description="Review and respond to pending approval requests from your team."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="approval-status" className="sr-only">Filter by status</label>
        <select
          id="approval-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-compact w-auto"
        >
          <option value="PENDING">Pending ({pendingCount})</option>
          <option value="all">All</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="QUERY_RAISED">Query raised</option>
        </select>
      </div>

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="card-dashboard p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold text-neutral-900">
                  {TYPE_LABELS[item.approvalType] ?? item.approvalType.replace(/_/g, " ")}
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Requested by {item.requestedBy.name}
                  {item.approver ? ` · Assigned to ${item.approver.name}` : ""}
                </p>
                {item.comment && (
                  <p className="mt-2 text-sm text-neutral-700">{item.comment}</p>
                )}
                <p className="mt-1 text-xs text-neutral-500">
                  {new Date(item.requestedAt).toLocaleString()}
                </p>
              </div>
              {statusBadge(item.status)}
            </div>

            {canApprove && item.status === "PENDING" && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                {approvalEntityHref(item) && (
                  <Link href={approvalEntityHref(item)!} className="btn-secondary text-sm py-1.5">
                    View record
                  </Link>
                )}
                <button
                  type="button"
                  className="btn-primary text-sm py-1.5"
                  disabled={actingId === item.id}
                  onClick={() => handleReview(item.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm py-1.5"
                  disabled={actingId === item.id}
                  onClick={() => setQueryId(queryId === item.id ? null : item.id)}
                >
                  Raise query
                </button>
                <button
                  type="button"
                  className="btn-destructive text-sm py-1.5"
                  disabled={actingId === item.id}
                  onClick={() => handleReview(item.id, "reject")}
                >
                  Reject
                </button>
              </div>
            )}

            {queryId === item.id && (
              <div className="mt-3 space-y-2">
                <label htmlFor={`query-${item.id}`} className="label-text block">Your question</label>
                <textarea
                  id={`query-${item.id}`}
                  value={queryComment}
                  onChange={(e) => setQueryComment(e.target.value)}
                  className="input-modern w-full"
                  rows={2}
                  placeholder="What do you need clarified?"
                />
                <button
                  type="button"
                  className="btn-primary text-sm py-1.5"
                  disabled={actingId === item.id || !queryComment.trim()}
                  onClick={() => handleReview(item.id, "query", queryComment.trim())}
                >
                  Send query
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {items.length === 0 && (
        <EmptyState
          className="mt-6"
          title={statusFilter === "PENDING" ? "No pending approvals" : "No approvals found"}
          description={
            statusFilter === "PENDING"
              ? "When team members submit items for review, they will appear here."
              : "Try a different status filter."
          }
        />
      )}
    </div>
  );
}
