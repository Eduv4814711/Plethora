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
        <p className="text-sm text-black">Loading…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <p className="text-red-800">{error ?? "Not found"}</p>
        <Link href="/academy/course-runs" className="link mt-2 inline-block">
          Back
        </Link>
      </div>
    );
  }

  const course = run.course as Record<string, unknown> | undefined;

  return (
    <div className="module-shell">
      <div>
        <Link href="/academy/course-runs" className="link-inline text-sm font-semibold">
          ← Course runs
        </Link>
        <p className="label-text mt-1">Catalogue · Course runs</p>
        <h1 className="page-title mt-1 font-mono">{String(run.runCode)}</h1>
        {course && (
          <p className="text-sm text-black">
            {String(course.code)} — {String(course.title)}
          </p>
        )}
      </div>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe flex flex-wrap items-end gap-3 p-4 sm:p-5">
        <div>
          <label className="label py-0 text-xs">Status</label>
          <select className="input-compact min-h-10" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["planned", "open", "in_progress", "completed", "reported", "closed"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-primary text-sm py-2 px-4" onClick={saveStatus}>
          Update status
        </button>
      </div>

      <p className="text-sm text-black">
        Start: {String(run.startDate).slice(0, 10)} · End: {String(run.endDate).slice(0, 10)} · Enrolled:{" "}
        {String(run.enrolledCount)}
        {Number(run.capacity) > 0 ? ` / ${String(run.capacity)}` : ""}
      </p>
    </div>
  );
}
