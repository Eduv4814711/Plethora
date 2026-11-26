"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { listApprovals, reviewApproval, approvalEntityHref, type ApprovalRequest } from "@/lib/msr-api";
import Link from "next/link";
import {
  AlertBanner,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  PageShell,
  SkeletonBlock,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";

const TYPE_LABELS: Record<string, string> = {
  ATTENDANCE_EXCEPTION: "Attendance exception",
  MISSED_CLOCK_IN: "Missed clock-in",
  MISSED_CLOCK_OUT: "Missed clock-out",
  OVERTIME: "Overtime",
  LEAVE: "Leave",
  SICK_NOTE: "Sick note",
  SITE_TIMESHEET: "Site timesheet",
  INCIDENT: "Incident",
  DOCUMENT_REVIEW: "Document review",
};

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
  }, [token, canApprove, statusFilter]);

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
      <PageShell width="narrow" className="animate-fade-in">
        <SkeletonBlock className="h-9 w-48" />
        <SkeletonBlock className="h-24 w-full" />
        <SkeletonBlock className="h-24 w-full" />
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow" className="animate-fade-in">
      <PageHeader
        title="Approvals"
        description="Review and respond to pending approval requests from your team."
      />

      <Tabs
        ariaLabel="Filter approvals by status"
        variant="segmented"
        value={statusFilter}
        onChange={setStatusFilter}
        items={[
          { value: "PENDING", label: "Pending", count: pendingCount },
          { value: "all", label: "All" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "QUERY_RAISED", label: "Query raised" },
        ]}
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id} variant="dashboard" className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold text-security-navy-900">
                  {TYPE_LABELS[item.approvalType] ?? item.approvalType.replace(/_/g, " ")}
                </h2>
                <p className="mt-1 text-sm text-security-navy-600">
                  Requested by {item.requestedBy.name}
                  {item.approver ? ` · Assigned to ${item.approver.name}` : ""}
                </p>
                {item.comment && (
                  <p className="mt-2 text-sm text-security-navy-700">{item.comment}</p>
                )}
                <p className="mt-1 text-xs tabular-nums text-security-navy-500">
                  {new Date(item.requestedAt).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </div>

            {canApprove && item.status === "PENDING" && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-security-navy-100 pt-3">
                {approvalEntityHref(item) && (
                  <Link href={approvalEntityHref(item)!} className="btn-secondary py-1.5 text-sm no-underline">
                    View record
                  </Link>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  loading={actingId === item.id}
                  onClick={() => handleReview(item.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={actingId === item.id}
                  onClick={() => setQueryId(queryId === item.id ? null : item.id)}
                >
                  Raise query
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={actingId === item.id}
                  onClick={() => handleReview(item.id, "reject")}
                >
                  Reject
                </Button>
              </div>
            )}

            {queryId === item.id && (
              <div className="mt-3 space-y-2 border-t border-security-navy-100 pt-3">
                <Field label="Your question" id={`query-${item.id}`}>
                  <Textarea
                    value={queryComment}
                    onChange={(e) => setQueryComment(e.target.value)}
                    rows={2}
                    placeholder="What do you need clarified?"
                  />
                </Field>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={actingId === item.id || !queryComment.trim()}
                  onClick={() => handleReview(item.id, "query", queryComment.trim())}
                >
                  Send query
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {items.length === 0 && (
        <EmptyState
          title={statusFilter === "PENDING" ? "No pending approvals" : "No approvals found"}
          description={
            statusFilter === "PENDING"
              ? "When team members submit items for review, they will appear here."
              : "Try a different status filter."
          }
        />
      )}
    </PageShell>
  );
}
