"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";

interface Session {
  id: string;
  sessionDate: string;
  recordsCount?: number;
  recordStatusCounts?: Record<string, number>;
  _count?: { records?: number };
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

  const getRecordCount = (session: Session) =>
    session.recordsCount ?? session._count?.records ?? session.records?.length ?? 0;

  const kpi = useMemo(() => {
    let totalRecords = 0;
    let presentLike = 0;
    for (const row of rows) {
      if (row.recordStatusCounts) {
        totalRecords += getRecordCount(row);
        presentLike += (row.recordStatusCounts.present ?? 0) + (row.recordStatusCounts.late ?? 0);
      } else {
        const records = row.records ?? [];
        totalRecords += records.length;
        presentLike += records.filter((r) => r.attendanceStatus === "present" || r.attendanceStatus === "late").length;
      }
    }
    return totalRecords ? (presentLike / totalRecords) * 100 : 0;
  }, [rows]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-security-navy-900">Attendance</h1>
        <p className="mt-1 text-sm text-base-content/70">Track session attendance and maintain compliance thresholds.</p>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-base-300 bg-base-200/50 px-3 py-2 text-sm">
          Read-only: only admins can create sessions, mark attendance, or delete sessions.
        </div>
      )}

      <div className="rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm">
        <p className="text-sm text-base-content/70">Overall attendance rate</p>
        <p className="mt-1 text-2xl font-semibold text-security-navy-900">{kpi.toFixed(1)}%</p>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">Create session</h2>
          <form onSubmit={create} className="mt-3 flex items-end gap-2">
            <label>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">Session date</span>
              <DateInput
                value={date}
                onChange={setDate}
                className="input-modern"
                showToday
                disabled={!canManage || saving}
                ariaLabel="Session date"
              />
            </label>
            <button className="btn btn-primary rounded-xl" disabled={!canManage || saving}>Create</button>
          </form>
        </div>

        <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">Mark attendance</h2>
          <form onSubmit={mark} className="mt-3 grid gap-2 md:grid-cols-2">
            <select
              className="select select-bordered rounded-xl"
              value={markSessionId}
              onChange={(e) => setMarkSessionId(e.target.value)}
              disabled={!canManage || saving}
            >
              <option value="">Select session</option>
              {rows.map((s) => (
                <option key={s.id} value={s.id}>
                  {String(s.sessionDate).slice(0, 10)} ({getRecordCount(s)} records)
                </option>
              ))}
            </select>
            <select
              className="select select-bordered rounded-xl"
              value={markEnrolmentId}
              onChange={(e) => setMarkEnrolmentId(e.target.value)}
              disabled={!canManage || saving}
            >
              <option value="">Select enrolment</option>
              {enrolments.map((en) => (
                <option key={en.id} value={en.id}>
                  {(en.student?.studentNumber ?? "Student")} {(en.student?.firstName ?? "")} {(en.student?.lastName ?? "")} {en.courseRun?.runCode ? `— ${en.courseRun.runCode}` : ""}
                </option>
              ))}
            </select>
            <select className="select select-bordered rounded-xl" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option>
            </select>
            <button className="btn btn-primary rounded-xl" disabled={!canManage || saving}>Mark</button>
          </form>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-sm">
        <div className="border-b border-base-200/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">All sessions</h2></div>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-base-content/60"><th>Date</th><th>Records</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm text-base-content/60">Loading sessions...</td>
                </tr>
              ) : rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{String(r.sessionDate).slice(0,10)}</td><td>{getRecordCount(r)}</td><td className="text-right">{canManage && <button className="btn btn-xs btn-error" onClick={() => remove(r.id)} disabled={saving}>Delete</button>}</td></tr>)}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm text-base-content/60">No sessions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
