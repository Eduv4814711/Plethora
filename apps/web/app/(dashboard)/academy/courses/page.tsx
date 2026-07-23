"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { useConfirmDialog } from "@/components/ui";

interface Course {
  id: string;
  code: string;
  title: string;
  active: boolean;
  feeAmount?: string | null;
}

export default function AcademyCoursesPage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/academy", "edit"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFeeAmount, setEditFeeAmount] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listCourses(token)
      .then((d) => setCourses((d.courses as Course[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !code.trim() || !title.trim() || !canCreate) return;
    setError(null);
    setSaving(true);
    try {
      await academyApi.createCourse(token, {
        code: code.trim(),
        title: title.trim(),
        feeAmount: feeAmount.trim() ? Number(feeAmount) : null,
      });
      setCode("");
      setTitle("");
      setFeeAmount("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (course: Course) => {
    setEditId(course.id);
    setEditTitle(course.title);
    setEditFeeAmount(course.feeAmount ?? "");
    setEditActive(course.active);
    setError(null);
  };

  const saveEdit = async () => {
    if (!token || !editId || !editTitle.trim() || !canEdit) return;
    setError(null);
    setSaving(true);
    try {
      await academyApi.updateCourse(token, editId, {
        title: editTitle.trim(),
        feeAmount: editFeeAmount.trim() ? Number(editFeeAmount) : null,
        active: editActive,
      });
      setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (course: Course) => {
    if (!token || !canEdit) return;
    setError(null);
    setSaving(true);
    try {
      await academyApi.updateCourse(token, course.id, { active: !course.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (course: Course) => {
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete or deactivate course?",
      message: `${course.code} ${course.title} will be deleted when possible, or deactivated if it is already in use.`,
      confirmLabel: "Continue",
    });
    if (!confirmed) return;
    setError(null);
    setSaving(true);
    try {
      await academyApi.deleteCourse(token, course.id);
      if (editId === course.id) setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {confirmDialog}
      <div>
        <Link href="/academy" className="text-sm text-security-navy-700 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Courses</h1>
      </div>

      {!canCreate && !canEdit && !canDelete && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-100/50 px-3 py-2 text-sm">
          Read-only: course changes have not been granted for your account.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-300 p-4">
        <div>
          <label className="label-text mb-1 block">Code</label>
          <input
            className="input-compact"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!canCreate || saving}
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="label-text mb-1 block">Title</label>
          <input
            className="input-compact w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canCreate || saving}
          />
        </div>
        <div>
          <label className="label-text mb-1 block">Fee (optional)</label>
          <input
            type="number"
            step="0.01"
            className="input-compact w-28"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            disabled={!canCreate || saving}
          />
        </div>
        <button
          type="submit"
          className="btn-primary px-3 py-1.5 text-xs"
          disabled={!canCreate || !code.trim() || !title.trim() || saving}
        >
          Add course
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-neutral-500">No courses yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-300">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Fee</th>
                <th>Status</th>
                <th className="w-56 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td>
                    {editId === c.id ? (
                      <input
                        className="input-modern input-xs w-full min-w-[200px]"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={!canEdit || saving}
                      />
                    ) : (
                      c.title
                    )}
                  </td>
                  <td>
                    {editId === c.id ? (
                      <input
                        className="input-modern input-xs w-24"
                        value={editFeeAmount}
                        onChange={(e) => setEditFeeAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={!canEdit || saving}
                      />
                    ) : c.feeAmount != null ? (
                      c.feeAmount
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge-neutral ${
                        (editId === c.id ? editActive : c.active)
                          ? "badge-success"
                          : "badge-neutral border border-neutral-300"
                      }`}
                    >
                      {(editId === c.id ? editActive : c.active) ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="text-right">
                    {editId === c.id ? (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => setEditActive((v) => !v)}
                          disabled={!canEdit || saving}
                        >
                          {editActive ? "Set inactive" : "Set active"}
                        </button>
                        <button
                          type="button"
                          className="btn-primary px-2 py-1 text-xs"
                          onClick={saveEdit}
                          disabled={!canEdit || !editTitle.trim() || saving}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => setEditId(null)}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => startEdit(c)}
                          disabled={!canEdit || saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => toggleActive(c)}
                          disabled={!canEdit || saving}
                        >
                          {c.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs text-red-700"
                          onClick={() => remove(c)}
                          disabled={!canDelete || saving}
                        >
                          Delete
                        </button>
                      </div>
                    )}
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
