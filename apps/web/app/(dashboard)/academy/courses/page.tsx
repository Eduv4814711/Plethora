"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Course {
  id: string;
  code: string;
  title: string;
  active: boolean;
  feeAmount?: string | null;
}

export default function AcademyCoursesPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
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
    if (!token || !code.trim() || !title.trim() || !canManage) return;
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
    if (!token || !editId || !editTitle.trim() || !canManage) return;
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
    if (!token || !canManage) return;
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
    if (!token || !canManage) return;
    if (!confirm(`Delete or deactivate "${course.code} ${course.title}"?`)) return;
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
    <div className="module-shell">
      <div>
        <Link href="/academy" className="text-sm font-semibold text-security-navy-800 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="page-title mt-1">Courses</h1>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          Read-only: only admins can create, edit, activate, or delete courses.
        </div>
      )}

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 p-4">
        <div>
          <label className="label py-0 text-xs">Code</label>
          <input
            className="input-compact"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="label py-0 text-xs">Title</label>
          <input
            className="input-compact w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div>
          <label className="label py-0 text-xs">Fee (optional)</label>
          <input
            type="number"
            step="0.01"
            className="input-compact w-28"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <button
          type="submit"
          className="btn-primary text-sm py-2 px-4"
          disabled={!canManage || !code.trim() || !title.trim() || saving}
        >
          Add course
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-black">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-black">No courses yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="table-module">
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
                        disabled={!canManage || saving}
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
                        disabled={!canManage || saving}
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
                          : "badge-neutral"
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
                          className="btn-ghost text-xs py-1 px-2 min-h-8"
                          onClick={() => setEditActive((v) => !v)}
                          disabled={!canManage || saving}
                        >
                          {editActive ? "Set inactive" : "Set active"}
                        </button>
                        <button
                          type="button"
                          className="btn-primary text-xs py-1 px-2 min-h-8"
                          onClick={saveEdit}
                          disabled={!canManage || !editTitle.trim() || saving}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs py-1 px-2 min-h-8"
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
                          className="btn-ghost text-xs py-1 px-2 min-h-8"
                          onClick={() => startEdit(c)}
                          disabled={!canManage || saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs py-1 px-2 min-h-8"
                          onClick={() => toggleActive(c)}
                          disabled={!canManage || saving}
                        >
                          {c.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs py-1 px-2 min-h-8 text-red-800"
                          onClick={() => remove(c)}
                          disabled={!canManage || saving}
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
