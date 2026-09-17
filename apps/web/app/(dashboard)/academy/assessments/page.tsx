"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import type { AcademyAssessment, AcademyAssessmentResult } from "@/lib/academy-types";
import { hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import {
  AlertBanner,
  Badge,
  Button,
  PageHeader,
  TableEmptyRow,
  TableLoadingRow,
  useConfirmDialog,
} from "@/components/ui";

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

export default function AcademyAssessmentsPage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canEdit = Boolean(user && (hasCapability(user, "/academy", "edit") || hasCapability(user, "/academy", "create")));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));

  const [rows, setRows] = useState<AcademyAssessment[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);

  // Create form state
  const [learnerId, setLearnerId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [assessmentType, setAssessmentType] = useState("Final Exam");
  const [assessmentDate, setAssessmentDate] = useState("");
  const [result, setResult] = useState<"" | AcademyAssessmentResult>("");
  const [mark, setMark] = useState<string>("");

  // Edit modal state
  const [editingAssessment, setEditingAssessment] = useState<AcademyAssessment | null>(null);
  const [editResult, setEditResult] = useState<"" | AcademyAssessmentResult>("");
  const [editMark, setEditMark] = useState<string>("");
  const [editType, setEditType] = useState<string>("");
  const [editModeration, setEditModeration] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listAssessments(token)
      .then((r) => setRows((r.assessments as AcademyAssessment[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load assessments"))
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
    if (!token || !learnerId || !courseId || !assessmentDate || !canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        learnerId,
        courseId,
        assessmentType,
        assessmentDate,
      };
      if (result) {
        payload.result = result;
      }
      if (mark !== "") {
        const parsedMark = Number(mark);
        if (!Number.isNaN(parsedMark)) payload.mark = parsedMark;
      }

      await academyApi.createAssessment(token, payload);
      setAssessmentDate("");
      setMark("");
      setResult("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create assessment");
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (item: AcademyAssessment) => {
    setEditingAssessment(item);
    setEditResult(item.result ?? "");
    setEditMark(item.mark != null ? String(item.mark) : "");
    setEditType(item.assessmentType ?? "");
    setEditModeration(item.moderationStatus ?? "");
  };

  const saveOutcomeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingAssessment || !canEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        assessmentType: editType.trim() || editingAssessment.assessmentType,
        result: editResult || null,
        mark: editMark !== "" ? Number(editMark) : null,
        moderationStatus: editModeration.trim() || null,
      };

      await academyApi.updateAssessment(token, editingAssessment.id, payload);
      setEditingAssessment(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update assessment outcome");
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete assessment record?",
      message: "This permanently removes the learner assessment result from the register.",
      confirmLabel: "Delete record",
    });
    if (!confirmed) return;
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

  const getResultBadge = (res: string | null | undefined) => {
    if (!res) return <Badge variant="neutral">pending</Badge>;
    if (res === "pass" || res === "competent") {
      return <Badge variant="success">{res}</Badge>;
    }
    if (res === "fail" || res === "not_yet_competent") {
      return <Badge variant="error">{res}</Badge>;
    }
    return <Badge variant="warning">{res}</Badge>;
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      {confirmDialog}
      <PageHeader
        title="Assessments"
        description="Capture assessment outcomes, marks (0–100), attempts, and competency statuses."
      />

      {!canCreate && !canDelete && (
        <div className="rounded-lg border border-security-navy-200 bg-security-navy-50/50 px-3 py-2 text-sm text-security-navy-700">
          Read-only: assessment outcome modifications have not been granted for your account.
        </div>
      )}

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Creation form with result and mark inputs */}
      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">
          New assessment
        </h2>
        <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label-text mb-1 block">Learner *</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={learnerId}
              onChange={(e) => setLearnerId(e.target.value)}
              disabled={!canCreate || saving}
              required
            >
              <option value="">Select learner</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.studentNumber} — {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Course *</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              disabled={!canCreate || saving}
              required
            >
              <option value="">Select course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Type *</label>
            <input
              className="input-modern w-full rounded-security-lg"
              placeholder="e.g. Final Exam, Practical"
              value={assessmentType}
              onChange={(e) => setAssessmentType(e.target.value)}
              disabled={!canCreate || saving}
              required
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Date *</label>
            <DateInput
              value={assessmentDate}
              onChange={setAssessmentDate}
              className="input-modern"
              showToday
              disabled={!canCreate || saving}
              ariaLabel="Assessment date"
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Mark (0–100)</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input-modern w-full rounded-security-lg"
              placeholder="Score"
              value={mark}
              onChange={(e) => setMark(e.target.value)}
              disabled={!canCreate || saving}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Result</label>
            <select
              className="input-modern w-full rounded-security-lg"
              value={result}
              onChange={(e) => setResult(e.target.value as AcademyAssessmentResult)}
              disabled={!canCreate || saving}
            >
              <option value="">Pending / Unrecorded</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="competent">Competent</option>
              <option value="not_yet_competent">Not Yet Competent</option>
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-6 flex justify-end">
            <Button type="submit" disabled={!canCreate} loading={saving}>
              Record assessment
            </Button>
          </div>
        </form>
      </div>

      {/* Assessment Register Table */}
      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4">
          <h2 className="text-base font-semibold text-security-navy-900">Assessment register</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loading}>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-security-navy-500">
                <th scope="col" className="px-4 py-3 text-left">Learner</th>
                <th scope="col" className="px-4 py-3 text-left">Course</th>
                <th scope="col" className="px-4 py-3 text-left">Type</th>
                <th scope="col" className="px-4 py-3 text-left">Date</th>
                <th scope="col" className="px-4 py-3 text-left">Mark</th>
                <th scope="col" className="px-4 py-3 text-left">Result</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={7} label="Loading assessments..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={7}
                  message="No assessments recorded yet. Use the form above to record assessment outcomes."
                />
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-security-navy-50/40">
                    <td className="px-4 py-3 font-medium text-security-navy-900">
                      {r.learner
                        ? `${r.learner.firstName} ${r.learner.lastName}`
                        : r.learnerId}
                      {r.learner?.studentNumber && (
                        <span className="block text-xs font-mono text-security-navy-500">
                          {r.learner.studentNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-security-navy-700">
                      {r.course ? `${r.course.code} — ${r.course.title}` : r.courseId}
                    </td>
                    <td className="px-4 py-3 text-security-navy-700">{r.assessmentType}</td>
                    <td className="px-4 py-3 text-security-navy-600">
                      {String(r.assessmentDate).slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-security-navy-900">
                      {r.mark != null ? `${r.mark}%` : "—"}
                    </td>
                    <td className="px-4 py-3">{getResultBadge(r.result)}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canEdit && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditModal(r)}
                        >
                          Edit Outcome
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => remove(r.id)}
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Assessment Outcome Modal */}
      {editingAssessment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-assessment-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-security-navy-100 bg-white p-6 shadow-security-card">
            <h3 id="edit-assessment-title" className="text-lg font-semibold text-security-navy-900">
              Update Assessment Outcome
            </h3>
            <p className="mt-1 text-xs text-security-navy-500">
              {editingAssessment.learner
                ? `${editingAssessment.learner.firstName} ${editingAssessment.learner.lastName}`
                : editingAssessment.learnerId}{" "}
              · {editingAssessment.assessmentType}
            </p>

            <form onSubmit={saveOutcomeEdit} className="mt-4 space-y-3">
              <div>
                <label className="label-text mb-1 block" htmlFor="edit-assessment-type">
                  Assessment Type
                </label>
                <input
                  id="edit-assessment-type"
                  className="input-modern w-full rounded-security-lg"
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label-text mb-1 block" htmlFor="edit-assessment-mark">
                  Mark (0–100%)
                </label>
                <input
                  id="edit-assessment-mark"
                  type="number"
                  min={0}
                  max={100}
                  className="input-modern w-full rounded-security-lg"
                  placeholder="e.g. 85"
                  value={editMark}
                  onChange={(e) => setEditMark(e.target.value)}
                />
              </div>

              <div>
                <label className="label-text mb-1 block" htmlFor="edit-assessment-result">
                  Result Status
                </label>
                <select
                  id="edit-assessment-result"
                  className="input-modern w-full rounded-security-lg"
                  value={editResult}
                  onChange={(e) => setEditResult(e.target.value as AcademyAssessmentResult)}
                >
                  <option value="">Pending / None</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="competent">Competent</option>
                  <option value="not_yet_competent">Not Yet Competent</option>
                </select>
              </div>

              <div>
                <label className="label-text mb-1 block" htmlFor="edit-moderation-status">
                  Moderation Status (optional)
                </label>
                <input
                  id="edit-moderation-status"
                  className="input-modern w-full rounded-security-lg"
                  placeholder="e.g. Internally Moderated, Verified"
                  value={editModeration}
                  onChange={(e) => setEditModeration(e.target.value)}
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditingAssessment(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={savingEdit}>
                  Save Outcome
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
