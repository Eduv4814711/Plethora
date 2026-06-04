"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

export default function AcademyCourseRunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { token } = useAuth();
  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("planned");

  useEffect(() => {
    if (!token || !id) return;
    academyApi
      .getCourseRun(token, id)
      .then((d) => {
        const cr = d.courseRun as Record<string, unknown>;
        setRun(cr);
        setStatus(String(cr.status ?? "planned"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [token, id]);

  const saveStatus = async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const { courseRun } = await academyApi.updateCourseRun(token, id, { status });
      setRun(courseRun as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (loading && !run) {
    return (
      <div className="p-6">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <p className="text-red-700">{error ?? "Not found"}</p>
        <Link href="/academy/course-runs" className="mt-2 inline-block font-semibold text-security-navy-700 hover:underline">
          Back
        </Link>
      </div>
    );
  }

  const course = run.course as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy/course-runs" className="text-sm text-security-navy-700 hover:underline">
          ← Course runs
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-semibold">{String(run.runCode)}</h1>
        {course && (
          <p className="text-sm text-neutral-600">
            {String(course.code)} — {String(course.title)}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-300 p-4">
        <div>
          <label className="label-text mb-1 block">Status</label>
          <select className="input-compact" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["planned", "open", "in_progress", "completed", "reported", "closed"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={saveStatus}>
          Update status
        </button>
      </div>

      <p className="text-sm text-neutral-500">
        Start: {String(run.startDate).slice(0, 10)} · End: {String(run.endDate).slice(0, 10)} · Enrolled:{" "}
        {String(run.enrolledCount)}
        {Number(run.capacity) > 0 ? ` / ${String(run.capacity)}` : ""}
      </p>
    </div>
  );
}
