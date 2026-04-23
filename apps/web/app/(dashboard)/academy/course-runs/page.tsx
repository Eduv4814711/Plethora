"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Course {
  id: string;
  code: string;
  title: string;
}

interface Branch {
  id: string;
  name: string;
}

interface CourseRun {
  id: string;
  runCode: string;
  intakeName?: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  enrolledCount: number;
  status: string;
  course: { code: string; title: string };
  branch: { name: string };
}

export default function AcademyCourseRunsPage() {
  const { token } = useAuth();
  const [runs, setRuns] = useState<CourseRun[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [runCode, setRunCode] = useState("");
  const [courseId, setCourseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([academyApi.listCourseRuns(token), academyApi.listCourses(token), academyApi.listBranches(token)])
      .then(([r, c, b]) => {
        setRuns((r.courseRuns as CourseRun[]) ?? []);
        setCourses((c.courses as Course[]) ?? []);
        setBranches((b.branches as Branch[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (courses.length && !courseId) setCourseId(courses[0].id);
    if (branches.length && !branchId) setBranchId(branches[0].id);
  }, [courses, branches, courseId, branchId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !runCode.trim() || !courseId || !branchId || !startDate || !endDate) return;
    setError(null);
    try {
      await academyApi.createCourseRun(token, {
        courseId,
        runCode: runCode.trim(),
        academyBranchId: branchId,
        startDate,
        endDate,
        capacity: Number(capacity) || 0,
      });
      setRunCode("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy" className="text-sm text-primary hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Course runs</h1>
      </div>

      {error && (
        <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>
      )}

      <form onSubmit={create} className="grid gap-3 rounded-lg border border-base-300 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label py-0 text-xs">Run code</label>
          <input className="input input-bordered input-sm w-full" value={runCode} onChange={(e) => setRunCode(e.target.value)} />
        </div>
        <div>
          <label className="label py-0 text-xs">Course</label>
          <select className="select select-bordered select-sm w-full" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label py-0 text-xs">Branch</label>
          <select className="select select-bordered select-sm w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label py-0 text-xs">Start date</label>
          <input type="date" className="input input-bordered input-sm w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label py-0 text-xs">End date</label>
          <input type="date" className="input input-bordered input-sm w-full" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="label py-0 text-xs">Capacity (0 = unlimited)</label>
          <input className="input input-bordered input-sm w-full" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!runCode.trim() || !courses.length || !branches.length}>
            Create run
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-base-content/60">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-base-content/60">No course runs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Run</th>
                <th>Course</th>
                <th>Branch</th>
                <th>Dates</th>
                <th>Enrolled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.runCode}</td>
                  <td>
                    {r.course.code} — {r.course.title}
                  </td>
                  <td>{r.branch.name}</td>
                  <td className="whitespace-nowrap text-xs">
                    {r.startDate?.toString().slice(0, 10)} → {r.endDate?.toString().slice(0, 10)}
                  </td>
                  <td>
                    {r.enrolledCount}
                    {r.capacity > 0 ? ` / ${r.capacity}` : ""}
                  </td>
                  <td>
                    <Link href={`/academy/course-runs/${r.id}`} className="link link-primary text-xs">
                      View
                    </Link>
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
