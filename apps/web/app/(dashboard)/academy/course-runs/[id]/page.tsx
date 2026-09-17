"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import type { AcademyCourseRun, AcademyEnrolment } from "@/lib/academy-types";
import { hasCapability } from "@/lib/permissions";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  SkeletonBlock,
  TableEmptyRow,
  TableLoadingRow,
} from "@/components/ui";

export default function AcademyCourseRunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { token, user } = useAuth();
  const canEdit = Boolean(user && hasCapability(user, "/academy", "edit"));

  const [run, setRun] = useState<AcademyCourseRun | null>(null);
  const [enrolments, setEnrolments] = useState<AcademyEnrolment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEnrolments, setLoadingEnrolments] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("planned");

  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);

    academyApi
      .getCourseRun(token, id)
      .then((d) => {
        const cr = d.courseRun as AcademyCourseRun;
        setRun(cr);
        setStatus(String(cr.status ?? "planned"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load course run"))
      .finally(() => setLoading(false));

    setLoadingEnrolments(true);
    academyApi
      .listEnrolments(token, { courseRunId: id })
      .then((res) => {
        setEnrolments((res.enrolments as AcademyEnrolment[]) ?? []);
      })
      .catch(() => {
        // Enrolment roster failure should not crash detail view
      })
      .finally(() => setLoadingEnrolments(false));
  }, [token, id]);

  const saveStatus = async () => {
    if (!token || !id || !canEdit) return;
    setError(null);
    setSavingStatus(true);
    try {
      const { courseRun } = await academyApi.updateCourseRun(token, id, { status });
      const updated = courseRun as AcademyCourseRun;
      setRun(updated);
      setStatus(String(updated.status ?? status));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingStatus(false);
    }
  };

  const statusVariant = (st: string): "success" | "warning" | "error" | "neutral" => {
    switch (st) {
      case "open":
      case "completed":
        return "success";
      case "in_progress":
        return "warning";
      case "closed":
        return "error";
      case "planned":
      case "reported":
      default:
        return "neutral";
    }
  };

  if (loading && !run) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
        </div>
        <SkeletonBlock className="h-64 w-full" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <AlertBanner variant="error">{error ?? "Course run not found"}</AlertBanner>
        <Link
          href="/academy/course-runs"
          className="mt-4 inline-block text-sm font-semibold text-security-navy-700 hover:underline"
        >
          ← Back to course runs
        </Link>
      </div>
    );
  }

  const course = run.course;
  const instructor = run.instructorEmployee;
  const classroomOrVenue = run.classroom?.classroomName || run.venueText || "Not assigned";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy/course-runs" className="text-sm text-security-navy-700 hover:underline">
          ← Course runs
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-security-navy-900">
            {run.runCode}
          </h1>
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        </div>
        {course && (
          <p className="mt-1 text-sm text-security-navy-600">
            {course.code} — {course.title}
          </p>
        )}
      </div>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Details Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-security-navy-500">Schedule</p>
          <p className="mt-1 font-medium text-security-navy-900">
            {String(run.startDate).slice(0, 10)} to {String(run.endDate).slice(0, 10)}
          </p>
          {run.intakeName && (
            <p className="mt-1 text-xs text-security-navy-500">Intake: {run.intakeName}</p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-security-navy-500">Branch & Venue</p>
          <p className="mt-1 font-medium text-security-navy-900">{run.branch?.name ?? "General"}</p>
          <p className="mt-1 text-xs text-security-navy-500">Venue: {classroomOrVenue}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-security-navy-500">Instructor</p>
          <p className="mt-1 font-medium text-security-navy-900">
            {instructor ? `${instructor.firstName} ${instructor.lastName}` : "Unassigned"}
          </p>
          {instructor?.employeeNumber && (
            <p className="mt-1 text-xs text-security-navy-500">Emp: {instructor.employeeNumber}</p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-security-navy-500">Enrolment</p>
          <p className="mt-1 font-medium text-security-navy-900">
            {run.enrolledCount} enrolled
            {Number(run.capacity) > 0 ? ` / ${run.capacity} max` : " (no cap)"}
          </p>
          <p className="mt-1 text-xs text-security-navy-500">
            {Number(run.capacity) > 0
              ? `${Math.max(0, Number(run.capacity) - run.enrolledCount)} seats remaining`
              : "Open intake"}
          </p>
        </Card>
      </div>

      {/* Status Transition Control for Editors */}
      {canEdit ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label-text mb-1 block" htmlFor="run-status-select">
              Update status
            </label>
            <select
              id="run-status-select"
              className="input-compact"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={savingStatus}
            >
              {["planned", "open", "in_progress", "completed", "reported", "closed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={saveStatus} loading={savingStatus}>
            Update status
          </Button>
        </Card>
      ) : (
        <div className="rounded-lg border border-security-navy-200 bg-security-navy-50/50 px-3 py-2 text-xs text-security-navy-600">
          Read-only view: you have permission to review this course run and enrolled roster.
        </div>
      )}

      {/* Enrolled Student Roster */}
      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="flex items-center justify-between border-b border-security-navy-100/80 px-5 py-4">
          <h2 className="text-base font-semibold text-security-navy-900">Enrolled Student Roster</h2>
          <span className="rounded-full bg-security-navy-100 px-2.5 py-0.5 text-xs font-semibold text-security-navy-700">
            {enrolments.length} learners
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loadingEnrolments}>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-security-navy-500">
                <th scope="col" className="px-4 py-3 text-left">Student #</th>
                <th scope="col" className="px-4 py-3 text-left">Name</th>
                <th scope="col" className="px-4 py-3 text-left">Enrolled</th>
                <th scope="col" className="px-4 py-3 text-left">Finance</th>
                <th scope="col" className="px-4 py-3 text-left">Attendance</th>
                <th scope="col" className="px-4 py-3 text-left">Completion</th>
                <th scope="col" className="px-4 py-3 text-right">Profile</th>
              </tr>
            </thead>
            <tbody>
              {loadingEnrolments ? (
                <TableLoadingRow colSpan={7} label="Loading student roster..." />
              ) : enrolments.length === 0 ? (
                <TableEmptyRow
                  colSpan={7}
                  message="No students enrolled in this course run yet. Use the Intake wizard or Enrolments page to add learners."
                />
              ) : (
                enrolments.map((e) => (
                  <tr key={e.id} className="hover:bg-security-navy-50/40">
                    <td className="px-4 py-3 font-mono text-xs text-security-navy-700">
                      {e.student?.studentNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-security-navy-900">
                      {e.student ? `${e.student.firstName} ${e.student.lastName}` : "Student"}
                    </td>
                    <td className="px-4 py-3 text-security-navy-600">
                      {String(e.enrolmentDate).slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          e.financialStatus === "paid"
                            ? "success"
                            : e.financialStatus === "partial"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {e.financialStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          e.attendanceStatus === "compliant"
                            ? "success"
                            : e.attendanceStatus === "in_progress"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {e.attendanceStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          e.completionStatus === "completed"
                            ? "success"
                            : e.completionStatus === "failed"
                              ? "error"
                              : "neutral"
                        }
                      >
                        {e.completionStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/academy/students/${e.studentId}`}
                        className="font-medium text-security-navy-700 hover:underline"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
