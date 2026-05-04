"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  listTaskProjects,
  createTaskProject,
  updateTaskProject,
  deleteTaskProject,
  type TaskProject,
} from "@/lib/api";

export default function TaskProjectsPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => {
    if (!token) return;
    listTaskProjects(token)
      .then((r) => setProjects(r.data))
      .catch(console.error);
  };

  useEffect(() => {
    if (!token) return;
    refresh();
    setLoading(false);
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formName.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await createTaskProject(token, {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      setFormName("");
      setFormDescription("");
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!token || !editName.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await updateTaskProject(token, id, { name: editName.trim() });
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (p: TaskProject) => {
    if (!token || !confirm(`Delete project "${p.name}"? Tasks will be unassigned.`)) return;
    try {
      await deleteTaskProject(token, p.id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-48 bg-gray-200 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="module-shell max-w-4xl">
      <div className="flex flex-col gap-4">
        <Link href="/tasks" className="text-sm font-semibold text-security-navy-800 hover:underline min-h-11 inline-flex items-center w-fit">
          ← Back to Tasks
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="page-title">Task Projects</h1>
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary min-h-11 w-full sm:w-auto shrink-0">
            New Project
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="module-panel mb-6">
          <h2 className="section-title normal-case tracking-tight text-base mb-3">Create Project</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Project name"
              className="input-modern"
              autoFocus
            />
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Description (optional)"
              className="input-modern min-h-[60px]"
              rows={2}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="btn-primary">
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError("");
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <div
            key={p.id}
            className="card-dashboard p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {editingId === p.id ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input-compact flex-1"
                  autoFocus
                />
                <button
                  onClick={() => handleUpdate(p.id)}
                  disabled={submitting}
                  className="btn-primary text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <Link href={`/tasks/projects/${p.id}`} className="flex-1">
                  <h3 className="font-semibold text-black">{p.name}</h3>
                  {p._count && (
                    <p className="text-sm text-gray-600">{p._count.tasks} tasks</p>
                  )}
                </Link>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(p.id);
                      setEditName(p.name);
                    }}
                    className="btn-secondary text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="btn-secondary text-sm text-red-600 border-red-600"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && !showForm && (
        <div className="text-center py-12 text-gray-500">
          No projects yet. Create one to organize your tasks.
        </div>
      )}
    </div>
  );
}
