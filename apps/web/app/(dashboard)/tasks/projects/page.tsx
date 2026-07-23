"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  listTaskProjects,
  createTaskProject,
  updateTaskProject,
  deleteTaskProject,
  type TaskProject,
} from "@/lib/api";
import { useConfirmDialog } from "@/components/ui";

export default function TaskProjectsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/tasks", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/tasks", "edit"));
  const canDelete = Boolean(user && hasCapability(user, "/tasks", "delete"));
  const { confirm, confirmDialog } = useConfirmDialog();
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
    if (!token || !canCreate || !formName.trim()) return;
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
    if (!token || !canEdit || !editName.trim()) return;
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
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete project?",
      message: `Tasks in "${p.name}" will be unassigned.`,
      confirmLabel: "Delete project",
    });
    if (!confirmed) return;
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
    <div className="animate-fade-in max-w-4xl mx-auto">
      {confirmDialog}
      <div className="mb-4">
        <Link href="/tasks" className="text-sm text-gray-600 hover:text-black">
          ← Back to Tasks
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">Task Projects</h1>
        {canCreate && <button onClick={() => setShowForm(true)} className="btn-primary">
          New Project
        </button>}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showForm && canCreate && (
        <div className="mb-6 bg-gray-100 border border-gray-300 rounded-lg p-4">
          <h2 className="font-bold text-black mb-3">Create Project</h2>
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
            className="bg-gray-100 border border-gray-300 rounded-lg p-4 flex items-center justify-between"
          >
              {canEdit && editingId === p.id ? (
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
                  {canEdit && <button
                    onClick={() => {
                      setEditingId(p.id);
                      setEditName(p.name);
                    }}
                    className="btn-secondary text-sm"
                  >
                    Edit
                  </button>}
                  {canDelete && <button
                    onClick={() => handleDelete(p)}
                    className="btn-secondary text-sm text-red-600 border-red-600"
                  >
                    Delete
                  </button>}
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
