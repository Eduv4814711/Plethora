"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface StudentOpt {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  adminFeeStatus?: string;
}

interface RunOpt {
  id: string;
  runCode: string;
  status: string;
  capacity: number;
  enrolledCount: number;
  course: { code: string; title: string };
}

interface EnrolRow {
  id: string;
  financialStatus: string;
  student: StudentOpt;
  courseRun: RunOpt;
}

export default function AcademyEnrolmentsPage() {
  const { token } = useAuth();
  const [enrolments, setEnrolments] = useState<EnrolRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [runs, setRuns] = useState<RunOpt[]>([]);
  const [feePlans, setFeePlans] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState("");
  const [courseRunId, setCourseRunId] = useState("");
  const [feePlanId, setFeePlanId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      academyApi.listEnrolments(token),
      academyApi.listStudents(token, undefined, 200),
      academyApi.listCourseRuns(token, undefined, { enrollable: true }),
      academyApi.listFeePlans(token),
    ])
      .then(([e, s, r, f]) => {
        setEnrolments((e.enrolments as EnrolRow[]) ?? []);
        setStudents((s.students as StudentOpt[]) ?? []);
        setRuns((r.courseRuns as RunOpt[]) ?? []);
        setFeePlans((f.feePlans as { id: string; name: string }[]) ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (students.length && !studentId) setStudentId(students[0].id);
    if (runs.length && !courseRunId) setCourseRunId(runs[0].id);
  }, [students, runs, studentId, courseRunId]);

  const selectedStudent = students.find((s) => s.id === studentId);
  const adminFeeOk = selectedStudent?.adminFeeStatus === "paid" || selectedStudent?.adminFeeStatus === "waived";

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentId || !courseRunId) return;
    if (!adminFeeOk) {
      setError("Record or waive the admin fee on this student before enrolling.");
      return;
    }
    setError(null);
    try {
      await academyApi.createEnrolment(token, {
        studentId,
        courseRunId,
        feePlanId: feePlanId || null,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const remove = async (enrolId: string) => {
    if (!token || !confirm("Remove this enrolment?")) return;
    setError(null);
    try {
      await academyApi.deleteEnrolment(token, enrolId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="module-shell">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/academy" className="text-sm font-semibold text-security-navy-800 hover:underline lg:hidden">
            ← Academy
          </Link>
          <h1 className="page-title mt-1">Enrolments</h1>
          <p className="mt-1 text-sm text-black">
            Course runs below are limited to intakes that still accept enrolments and have capacity.
          </p>
        </div>
        <Link href="/academy/intake" className="btn-secondary text-sm py-2 px-4">
          Guided intake
        </Link>
      </div>

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form onSubmit={create} className="grid gap-3 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label py-0 text-xs">Student</label>
          <select className="input-compact min-h-10 w-full" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentNumber} — {s.firstName} {s.lastName}
                {s.adminFeeStatus === "unpaid" || !s.adminFeeStatus ? " (admin fee unpaid)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label py-0 text-xs">Course run</label>
          <select className="input-compact min-h-10 w-full" value={courseRunId} onChange={(e) => setCourseRunId(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.runCode} — {r.course.code} {r.course.title} ({r.status}
                {r.capacity > 0 ? ` · ${r.capacity - r.enrolledCount} seats` : ""})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label py-0 text-xs">Fee plan (optional)</label>
          <select className="input-compact min-h-10 w-full" value={feePlanId} onChange={(e) => setFeePlanId(e.target.value)}>
            <option value="">—</option>
            {feePlans.map((fp) => (
              <option key={fp.id} value={fp.id}>
                {fp.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-4 flex flex-col gap-2">
          {!adminFeeOk && students.length > 0 && studentId ? (
            <p className="text-xs text-amber-800">
              Selected student must have admin fee <strong>paid</strong> or <strong>waived</strong> before enrolment. Use{" "}
              <Link href={`/academy/students/${studentId}`} className="link">
                student profile
              </Link>{" "}
              or{" "}
              <Link href="/academy/intake" className="link">
                guided intake
              </Link>
              .
            </p>
          ) : null}
          <button
            type="submit"
            className="btn-primary text-sm py-2 px-4 w-fit"
            disabled={!students.length || !runs.length || !adminFeeOk}
          >
            Enrol
          </button>
        </div>
      </form>

      {!students.length || !runs.length ? (
        <p className="text-sm text-amber-700">
          Create at least one student (with admin fee cleared), branch, course, and an enrolable course run before
          enrolling.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-black">Loading…</p>
      ) : enrolments.length === 0 ? (
        <p className="text-sm text-black">No enrolments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="table-module">
            <thead>
              <tr>
                <th>Student</th>
                <th>Run</th>
                <th>Finance</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {enrolments.map((en) => (
                <tr key={en.id}>
                  <td>
                    <Link href={`/academy/students/${en.student.id}`} className="link">
                      {en.student.firstName} {en.student.lastName}
                    </Link>
                    <div className="font-mono text-xs text-sm text-black">{en.student.studentNumber}</div>
                  </td>
                  <td>
                    <span className="font-mono text-xs">{en.courseRun.runCode}</span>{" "}
                    <span className="text-xs text-sm text-black">
                      {en.courseRun.course.code} — {en.courseRun.course.title}
                    </span>
                  </td>
                  <td>{en.financialStatus}</td>
                  <td>
                    <button type="button" className="btn-ghost text-xs py-1 px-2 min-h-8 text-red-800" onClick={() => remove(en.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
