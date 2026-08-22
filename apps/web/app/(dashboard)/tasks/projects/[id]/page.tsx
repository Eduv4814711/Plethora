"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { getTaskProject, createTask, type Task, type TaskProject } from "@/lib/api";

export default function TaskProjectDetailPage() {
  const params = useParams();
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/tasks", "create"));
  const id = params.id as string;

  const [project, setProject] = useState<(TaskProject & { tasks: Task[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => {
    if (!token || !id) return;
    getTaskProject(token, id)
      .then(setProject)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token || !id) return;
    refresh();
  }, [token, id]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canCreate || !project || !formTitle.trim()) return;
    setSubmitting(true);
    try {
      await createTask(token, {
        title: formTitle.trim(),
        projectId: project.id,
      });
      setFormTitle("");
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-48 bg-security-navy-100 rounded-lg" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-security-navy-100 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || "Project not found"}</p>
        <Link href="/tasks/projects" className="btn-secondary mt-4 inline-block">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/tasks/projects" className="text-sm text-security-navy-600 hover:text-security-navy-900">
          ← Back to Projects
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-security-navy-900">{project.name}</h1>
          {project.description && (
            <p className="text-security-navy-600 mt-1">{project.description}</p>
          )}
        </div>
        {canCreate && <button onClick={() => setShowForm(true)} className="btn-primary">
          Add Task
        </button>}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showForm && canCreate && (
        <div className="mb-6 bg-security-navy-50 border border-security-navy-200 rounded-lg p-4">
          <form onSubmit={handleCreateTask} className="flex gap-2">
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Task title"
              className="input-modern flex-1"
              autoFocus
            />
            <button type="submit" disabled={submitting} className="btn-primary">
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {project.tasks.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="block bg-security-navy-50 border border-security-navy-200 rounded-lg p-4 hover:border-security-navy-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-security-navy-900">{task.title}</h3>
              <span className="text-sm text-security-navy-600">
                {task.status === "done" ? "Done" : task.status === "in_progress" ? "In Progress" : "To Do"}
              </span>
            </div>
            {task.dueDate && (
              <p className="text-sm text-security-navy-500 mt-1">
                Due {new Date(task.dueDate).toLocaleDateString()}
              </p>
            )}
          </Link>
        ))}
      </div>

      {project.tasks.length === 0 && !showForm && (
        <div className="text-center py-12 text-security-navy-500">
          No tasks in this project yet.
        </div>
      )}
    </div>
  );
}
