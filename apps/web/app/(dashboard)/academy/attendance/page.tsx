"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Session {
  id: string;
  sessionDate: string;
  records?: Array<{ attendanceStatus: string }>;
}

interface EnrolmentOption {
  id: string;
  student?: { studentNumber?: string; firstName?: string; lastName?: string };
  courseRun?: { runCode?: string };
}

export default function AcademyAttendancePage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Session[]>([]);
  const [enrolments, setEnrolments] = useState<EnrolmentOption[]>([]);
  const [date, setDate] = useState("");
  const [markSessionId, setMarkSessionId] = useState("");
  const [markEnrolmentId, setMarkEnrolmentId] = useState("");
  const [status, setStatus] = useState("present");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      academyApi.listAttendanceSessions(token),
      academyApi.listEnrolments(token),
    ])
      .then(([sessionsRes, enrolmentsRes]) => {
        const sessions = (sessionsRes.sessions as Session[]) ?? [];
        const enrolRows = (enrolmentsRes.enrolments as EnrolmentOption[]) ?? [];
        setRows(sessions);
        setEnrolments(enrolRows);
        if (!markSessionId && sessions.length > 0) setMarkSessionId(sessions[0].id);
        if (!markEnrolmentId && enrolRows.length > 0) setMarkEnrolmentId(enrolRows[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !date || !canManage) return;
    setSaving(true);
    try {
      await academyApi.createAttendanceSession(token, { sessionDate: date });
      setDate("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const mark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !markSessionId || !markEnrolmentId || !canManage) return;
    setSaving(true);
    try {
      await academyApi.markAttendance(token, { sessionId: markSessionId, enrolmentId: markEnrolmentId, attendanceStatus: status });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mark failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    if (!confirm("Delete this session and its attendance records?")) return;
    setSaving(true);
    try {
      await academyApi.deleteAttendanceSession(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const kpi = useMemo(() => {
    const records = rows.flatMap((r) => r.records ?? []);
    const presentLike = records.filter((r) => r.attendanceStatus === "present" || r.attendanceStatus === "late").length;
    return records.length ? (presentLike / records.length) * 100 : 0;
  }, [rows]);

  return (
    <div className="module-shell">
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Attendance</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Track session attendance and maintain compliance thresholds.
        </p>
      </header>

      {!canManage && (
        <div className="notice-info" role="status">
          Read-only: only admins can create sessions, mark attendance, or delete sessions.
        </div>
      )}

      <div className="kpi-tile max-w-md">
        <p className="kpi-label">Overall attendance rate</p>
        <p className="kpi-value mt-1 tabular-nums">{kpi.toFixed(1)}%</p>
      </div>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-wireframe p-4 sm:p-5">
          <h2 className="section-title">Create session</h2>
          <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="label-text mb-1 block">Session date</span>
              <input
                className="input-modern w-full"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!canManage || saving}
              />
            </label>
            <button type="submit" className="btn-primary text-sm" disabled={!canManage || saving}>
              Create
            </button>
          </form>
        </div>

        <div className="card-wireframe p-4 sm:p-5">
          <h2 className="section-title">Mark attendance</h2>
          <form onSubmit={mark} className="mt-3 grid gap-2 md:grid-cols-2">
            <select
              className="input-modern"
              value={markSessionId}
              onChange={(e) => setMarkSessionId(e.target.value)}
              disabled={!canManage || saving}
            >
              <option value="">Select session</option>
              {rows.map((s) => (
                <option key={s.id} value={s.id}>
                  {String(s.sessionDate).slice(0, 10)} ({s.records?.length ?? 0} records)
                </option>
              ))}
            </select>
            <select
              className="input-modern"
              value={markEnrolmentId}
              onChange={(e) => setMarkEnrolmentId(e.target.value)}
              disabled={!canManage || saving}
            >
              <option value="">Select enrolment</option>
              {enrolments.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.student?.studentNumber ?? "Student"} {en.student?.firstName ?? ""}{" "}
                  {en.student?.lastName ?? ""}
                  {en.courseRun?.runCode ? ` — ${en.courseRun.runCode}` : ""}
                </option>
              ))}
            </select>
            <select className="input-modern" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="excused">Excused</option>
            </select>
            <button type="submit" className="btn-primary text-sm" disabled={!canManage || saving}>
              Mark
            </button>
          </form>
        </div>
      </div>

      <section aria-labelledby="attendance-sessions-heading" className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 id="attendance-sessions-heading" className="section-title normal-case text-base font-semibold tracking-tight">
            All sessions
          </h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead>
              <tr>
                <th>Date</th>
                <th>Records</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm text-black">
                    Loading sessions…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm text-black">
                    No sessions yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-sm font-medium text-black">{String(r.sessionDate).slice(0, 10)}</td>
                    <td className="tabular-nums">{r.records?.length ?? 0}</td>
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
