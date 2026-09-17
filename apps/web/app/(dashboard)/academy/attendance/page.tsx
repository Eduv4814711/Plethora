"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import type {
  AcademyAttendanceRecord,
  AcademyAttendanceSession,
  AcademyAttendanceStatus,
  AcademyClassroom,
  AcademyCourseRun,
  AcademyEnrolment,
  AcademyInstructor,
} from "@/lib/academy-types";
import { hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  PageHeader,
  TableEmptyRow,
  TableLoadingRow,
  useConfirmDialog,
} from "@/components/ui";

export default function AcademyAttendancePage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));

  // Main data state
  const [sessions, setSessions] = useState<AcademyAttendanceSession[]>([]);
  const [courseRuns, setCourseRuns] = useState<AcademyCourseRun[]>([]);
  const [classrooms, setClassrooms] = useState<AcademyClassroom[]>([]);
  const [instructors, setInstructors] = useState<AcademyInstructor[]>([]);

  // Session creation form state
  const [date, setDate] = useState("");
  const [courseRunId, setCourseRunId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [instructorId, setInstructorId] = useState("");

  // Daily session register view state
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<AcademyAttendanceSession | null>(null);
  const [registerEnrolments, setRegisterEnrolments] = useState<AcademyEnrolment[]>([]);
  const [sessionRecords, setSessionRecords] = useState<Record<string, AcademyAttendanceStatus>>({});
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);

  const [loading, setLoading] = useState(true);
  const [savingSession, setSavingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = () => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listAttendanceSessions(token)
      .then((res) => {
        const list = (res.sessions as AcademyAttendanceSession[]) ?? [];
        setSessions(list);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load sessions"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    loadSessions();

    Promise.all([
      academyApi.listCourseRuns(token),
      academyApi.listClassrooms(token),
      academyApi.listInstructors(token).catch(() => ({ instructors: [] })),
    ])
      .then(([runsRes, classroomsRes, instructorsRes]) => {
        setCourseRuns((runsRes.courseRuns as AcademyCourseRun[]) ?? []);
        setClassrooms((classroomsRes.classrooms as AcademyClassroom[]) ?? []);
        setInstructors((instructorsRes.instructors as AcademyInstructor[]) ?? []);
      })
      .catch(() => {
        // Option loads should not crash
      });
  }, [token]);

  // Load daily register when a session is selected
  useEffect(() => {
    if (!token || !selectedSessionId) {
      setSelectedSession(null);
      setRegisterEnrolments([]);
      setSessionRecords({});
      return;
    }

    setLoadingRegister(true);
    setError(null);

    academyApi
      .getAttendanceSession(token, selectedSessionId)
      .then(async (res) => {
        const sess = res.session as AcademyAttendanceSession;
        setSelectedSession(sess);

        // Map existing records by enrolmentId
        const recordMap: Record<string, AcademyAttendanceStatus> = {};
        if (sess.records) {
          for (const rec of sess.records) {
            recordMap[rec.enrolmentId] = rec.attendanceStatus;
          }
        }
        setSessionRecords(recordMap);

        // If session is linked to a courseRunId, fetch all enrolled learners in that run
        if (sess.courseRunId) {
          const enrolRes = await academyApi.listEnrolments(token, { courseRunId: sess.courseRunId });
          setRegisterEnrolments((enrolRes.enrolments as AcademyEnrolment[]) ?? []);
        } else {
          // If unlinked, pull enrolments from records or overall
          const enrolRes = await academyApi.listEnrolments(token);
          setRegisterEnrolments((enrolRes.enrolments as AcademyEnrolment[]) ?? []);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load session register"))
      .finally(() => setLoadingRegister(false));
  }, [token, selectedSessionId]);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !date || !canCreate) return;
    setSavingSession(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { sessionDate: date };
      if (courseRunId) payload.courseRunId = courseRunId;
      if (classroomId) payload.classroomId = classroomId;
      if (instructorId) payload.instructorId = instructorId;

      const res = await academyApi.createAttendanceSession(token, payload);
      const created = res.session as AcademyAttendanceSession;
      setDate("");
      loadSessions();
      if (created?.id) {
        setSelectedSessionId(created.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setSavingSession(false);
    }
  };

  const removeSession = async (id: string) => {
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete attendance session?",
      message: "This permanently deletes the session and all associated student attendance records.",
      confirmLabel: "Delete session",
    });
    if (!confirmed) return;
    try {
      await academyApi.deleteAttendanceSession(token, id);
      if (selectedSessionId === id) setSelectedSessionId(null);
      loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // Bulk mark all students in the daily register
  const handleBulkMark = async (targetStatus: AcademyAttendanceStatus) => {
    if (!token || !selectedSessionId || registerEnrolments.length === 0 || !canCreate) return;
    setSavingBulk(true);
    setError(null);
    try {
      const rows = registerEnrolments.map((en) => ({
        enrolmentId: en.id,
        attendanceStatus: targetStatus,
      }));

      await academyApi.markAttendanceBulk(token, {
        sessionId: selectedSessionId,
        rows,
      });

      // Update local state
      const nextRecords = { ...sessionRecords };
      for (const en of registerEnrolments) {
        nextRecords[en.id] = targetStatus;
      }
      setSessionRecords(nextRecords);
      loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk marking failed");
    } finally {
      setSavingBulk(false);
    }
  };

  // Single mark student in the daily register
  const handleSingleMark = async (enrolmentId: string, status: AcademyAttendanceStatus) => {
    if (!token || !selectedSessionId || !canCreate) return;
    setError(null);
    try {
      await academyApi.markAttendance(token, {
        sessionId: selectedSessionId,
        enrolmentId,
        attendanceStatus: status,
      });
      setSessionRecords((prev) => ({ ...prev, [enrolmentId]: status }));
      loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update attendance status");
    }
  };

  const getRecordCount = (session: AcademyAttendanceSession) =>
    session.recordsCount ?? session._count?.records ?? session.records?.length ?? 0;

  // Overall attendance calculation
  const overallKpi = useMemo(() => {
    let totalRecords = 0;
    let presentLike = 0;
    for (const row of sessions) {
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
  }, [sessions]);

  return (
    <div className="w-full min-w-0 space-y-6">
      {confirmDialog}
      <PageHeader
        title="Attendance & Daily Registers"
        description="Track session registers, assign venues/instructors, and execute bulk attendance marking."
      />

      {!canCreate && !canDelete && (
        <div className="rounded-lg border border-security-navy-200 bg-security-navy-50/50 px-3 py-2 text-sm text-security-navy-700">
          Read-only: session and attendance modifications have not been granted for your account.
        </div>
      )}

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* KPI Card */}
      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <p className="text-xs font-medium uppercase tracking-wide text-security-navy-500">
          Overall attendance rate
        </p>
        <p className="mt-1 font-mono text-3xl font-semibold text-security-navy-900">
          {overallKpi.toFixed(1)}%
        </p>
      </div>

      {/* Create Session Form with Course Run, Classroom, and Instructor linking */}
      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">
          Create Training Session
        </h2>
        <form onSubmit={createSession} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div>
            <label className="label-text mb-1 block">Session date *</label>
            <DateInput
              value={date}
              onChange={setDate}
              className="input-modern"
              showToday
              disabled={!canCreate || savingSession}
              ariaLabel="Session date"
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Course Run</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={courseRunId}
              onChange={(e) => setCourseRunId(e.target.value)}
              disabled={!canCreate || savingSession}
            >
              <option value="">Link course run (recommended)</option>
              {courseRuns.map((cr) => (
                <option key={cr.id} value={cr.id}>
                  {cr.runCode} — {cr.course?.title ?? "Course"} ({String(cr.startDate).slice(0, 10)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Classroom Venue</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              disabled={!canCreate || savingSession}
            >
              <option value="">Select classroom (optional)</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.classroomName} (Cap: {c.capacity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Instructor</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              disabled={!canCreate || savingSession}
            >
              <option value="">Assign instructor (optional)</option>
              {instructors.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.firstName} {ins.lastName} ({ins.employeeNumber})
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
            <Button type="submit" disabled={!canCreate || !date} loading={savingSession}>
              Create Session
            </Button>
          </div>
        </form>
      </div>

      {/* Daily Session Register View (Revealed when a session is selected) */}
      {selectedSession && (
        <Card className="border-2 border-security-navy-300 p-5 shadow-security-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-security-navy-100 pb-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-security-amber-600">
                Active Daily Register
              </span>
              <h2 className="text-xl font-bold text-security-navy-900">
                Session: {String(selectedSession.sessionDate).slice(0, 10)}
              </h2>
              <p className="mt-0.5 text-xs text-security-navy-600">
                Course Run: {selectedSession.courseRun?.runCode ?? "Unlinked"} · Venue:{" "}
                {selectedSession.classroom?.classroomName ?? "Not assigned"} · Instructor:{" "}
                {selectedSession.instructor
                  ? `${selectedSession.instructor.firstName} ${selectedSession.instructor.lastName}`
                  : "Unassigned"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedSessionId(null)}
              >
                Close Register
              </Button>
            </div>
          </div>

          {/* Bulk Marking Action Toolbar */}
          {canCreate && registerEnrolments.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-security-navy-50/80 p-3">
              <span className="text-xs font-medium text-security-navy-700">
                Bulk Attendance Marking ({registerEnrolments.length} enrolled learners):
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleBulkMark("present")}
                  loading={savingBulk}
                >
                  Mark All Present
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleBulkMark("late")}
                  loading={savingBulk}
                >
                  Mark All Late
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleBulkMark("absent")}
                  loading={savingBulk}
                >
                  Mark All Absent
                </Button>
              </div>
            </div>
          )}

          {/* Daily Register Roster Table */}
          <div className="overflow-x-auto rounded-xl border border-security-navy-100">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loadingRegister}>
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-security-navy-500 bg-security-navy-50">
                  <th scope="col" className="px-4 py-3 text-left">Student #</th>
                  <th scope="col" className="px-4 py-3 text-left">Name</th>
                  <th scope="col" className="px-4 py-3 text-left">Current Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Quick Mark</th>
                </tr>
              </thead>
              <tbody>
                {loadingRegister ? (
                  <TableLoadingRow colSpan={4} label="Loading enrolled student register..." />
                ) : registerEnrolments.length === 0 ? (
                  <TableEmptyRow
                    colSpan={4}
                    message="No learners found for this session. Ensure the course run has enrolled students."
                  />
                ) : (
                  registerEnrolments.map((en) => {
                    const currentStatus = sessionRecords[en.id];
                    return (
                      <tr key={en.id} className="hover:bg-security-navy-50/40">
                        <td className="px-4 py-3 font-mono text-xs text-security-navy-700">
                          {en.student?.studentNumber ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-security-navy-900">
                          {en.student
                            ? `${en.student.firstName} ${en.student.lastName}`
                            : "Learner"}
                        </td>
                        <td className="px-4 py-3">
                          {currentStatus ? (
                            <Badge
                              variant={
                                currentStatus === "present"
                                  ? "success"
                                  : currentStatus === "late"
                                    ? "warning"
                                    : "error"
                              }
                            >
                              {currentStatus}
                            </Badge>
                          ) : (
                            <Badge variant="neutral">unmarked</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canCreate && (
                            <div className="inline-flex rounded-lg shadow-2xs">
                              {(["present", "late", "absent", "excused"] as const).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => handleSingleMark(en.id, st)}
                                  className={`px-2.5 py-1 text-xs font-medium first:rounded-l-md last:rounded-r-md border border-security-navy-200 transition-colors ${
                                    currentStatus === st
                                      ? "bg-security-navy text-white"
                                      : "bg-white text-security-navy-700 hover:bg-security-navy-50"
                                  }`}
                                >
                                  {st.charAt(0).toUpperCase() + st.slice(1)}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Sessions Table */}
      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-security-navy-900">All Sessions</h2>
          <span className="text-xs text-security-navy-500">
            Click &quot;Open Register&quot; to inspect roster and mark attendance
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loading}>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-security-navy-500">
                <th scope="col" className="px-4 py-3 text-left">Date</th>
                <th scope="col" className="px-4 py-3 text-left">Course Run</th>
                <th scope="col" className="px-4 py-3 text-left">Classroom</th>
                <th scope="col" className="px-4 py-3 text-left">Instructor</th>
                <th scope="col" className="px-4 py-3 text-left">Records</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={6} label="Loading sessions..." />
              ) : sessions.length === 0 ? (
                <TableEmptyRow
                  colSpan={6}
                  message="No attendance sessions created yet. Use the form above to start a session."
                />
              ) : (
                sessions.map((s) => {
                  const count = getRecordCount(s);
                  const isSelected = selectedSessionId === s.id;
                  return (
                    <tr
                      key={s.id}
                      className={`hover:bg-security-navy-50/40 ${isSelected ? "bg-security-amber-50/30" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-security-navy-900">
                        {String(s.sessionDate).slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-security-navy-700">
                        {s.courseRun?.runCode ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-security-navy-600">
                        {s.classroom?.classroomName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-security-navy-600">
                        {s.instructor
                          ? `${s.instructor.firstName} ${s.instructor.lastName}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium text-security-navy-900">
                          {count} marked
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <Button
                          variant={isSelected ? "primary" : "secondary"}
                          size="sm"
                          onClick={() => setSelectedSessionId(s.id)}
                        >
                          {isSelected ? "Active Register" : "Open Register"}
                        </Button>
                        {canDelete && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => removeSession(s.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
