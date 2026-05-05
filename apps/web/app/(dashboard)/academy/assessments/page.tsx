"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface StudentOption {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}

interface CourseOption {
  id: string;
  code: string;
  title: string;
}

interface Row {
  id: string;
  assessmentType: string;
  result?: string | null;
  assessmentDate: string;
  learnerId: string;
  learner?: { firstName: string; lastName: string };
}

export default function AcademyAssessmentsPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Row[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [assessmentType, setAssessmentType] = useState("Final");
  const [assessmentDate, setAssessmentDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listAssessments(token)
      .then((r) => setRows((r.assessments as Row[]) ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!token) return;
    Promise.all([academyApi.listStudents(token, undefined, 200), academyApi.listCourses(token)])
      .then(([studentsRes, coursesRes]) => {
        const learnerOptions = (studentsRes.students as StudentOption[]) ?? [];
        const courseOptions = (coursesRes.courses as CourseOption[]) ?? [];
        setStudents(learnerOptions);
        setCourses(courseOptions);
        if (!learnerId && learnerOptions.length > 0) setLearnerId(learnerOptions[0].id);
        if (!courseId && courseOptions.length > 0) setCourseId(courseOptions[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load options"));
    load();
  }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !learnerId || !courseId || !assessmentDate || !canManage) return;
    setSaving(true);
    try {
      await academyApi.createAssessment(token, { learnerId, courseId, assessmentType, assessmentDate });
      setLearnerId(""); setCourseId(""); setAssessmentDate("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    if (!confirm("Delete this assessment record?")) return;
    setSaving(true);
    try {
      await academyApi.deleteAssessment(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-shell">
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Assessments</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Capture assessment outcomes, attempts, and result statuses.
        </p>
      </header>

      {!canManage && (
        <div className="notice-info" role="status">
          Read-only: only admins can add or delete assessments.
        </div>
      )}

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">New assessment</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-5">
          <select
            className="input-modern"
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            disabled={!canManage || saving}
          >
            <option value="">Select learner</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentNumber} — {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
          <select
            className="input-modern"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            disabled={!canManage || saving}
          >
            <option value="">Select course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <input
            className="input-modern"
            placeholder="Type"
            value={assessmentType}
            onChange={(e) => setAssessmentType(e.target.value)}
            disabled={!canManage || saving}
          />
          <input
            className="input-modern"
            type="date"
            value={assessmentDate}
            onChange={(e) => setAssessmentDate(e.target.value)}
            disabled={!canManage || saving}
          />
          <button type="submit" className="btn-primary text-sm" disabled={!canManage || saving}>
            Add
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">Assessment register</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Type</th>
                <th>Date</th>
                <th>Result</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-black">
                    Loading assessments…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-black">
                    No assessments yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-sm font-medium text-black">
                      {r.learner ? `${r.learner.firstName} ${r.learner.lastName}` : r.learnerId}
                    </td>
                    <td>{r.assessmentType}</td>
                    <td className="text-xs">{String(r.assessmentDate).slice(0, 10)}</td>
                    <td>
                      <span
                        className={
                          r.result === "pass" || r.result === "competent"
                            ? "badge-success"
                            : r.result
                              ? "badge-warning"
                              : "badge-neutral"
                        }
                      >
                        {r.result ?? "pending"}
                      </span>
                    </td>
                    <td className="text-right">
                      {canManage && (
                        <button
                          type="button"
                          className="btn-danger-soft text-xs"
                          onClick={() => remove(r.id)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
