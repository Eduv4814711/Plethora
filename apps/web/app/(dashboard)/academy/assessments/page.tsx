"use client";

import { useEffect, useState } from "react";
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
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-security-navy-900">Assessments</h1>
        <p className="mt-1 text-sm text-base-content/70">Capture assessment outcomes, attempts, and result statuses.</p>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-base-300 bg-base-200/50 px-3 py-2 text-sm">
          Read-only: only admins can add or delete assessments.
        </div>
      )}

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">New assessment</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-5">
          <select
            className="select select-bordered rounded-xl"
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
            className="select select-bordered rounded-xl"
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
            className="input input-bordered rounded-xl"
            placeholder="Type"
            value={assessmentType}
            onChange={(e) => setAssessmentType(e.target.value)}
            disabled={!canManage || saving}
          />
          <input
            className="input input-bordered rounded-xl"
            type="date"
            value={assessmentDate}
            onChange={(e) => setAssessmentDate(e.target.value)}
            disabled={!canManage || saving}
          />
          <button className="btn btn-primary rounded-xl" disabled={!canManage || saving}>Add</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-sm">
        <div className="border-b border-base-200/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Assessment register</h2></div>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-base-content/60"><th>Learner</th><th>Type</th><th>Date</th><th>Result</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-base-content/60">Loading assessments...</td>
                </tr>
              ) : rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.learner ? `${r.learner.firstName} ${r.learner.lastName}` : r.learnerId}</td><td>{r.assessmentType}</td><td>{String(r.assessmentDate).slice(0,10)}</td><td><span className={`badge badge-sm ${r.result === "pass" || r.result === "competent" ? "badge-success" : r.result ? "badge-warning" : "badge-ghost border border-base-300"}`}>{r.result ?? "pending"}</span></td><td className="text-right">{canManage && <button className="btn btn-xs btn-error" onClick={() => remove(r.id)} disabled={saving}>Delete</button>}</td></tr>)}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-base-content/60">No assessments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
