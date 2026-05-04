"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getTaskProject, createTask, type Task, type TaskProject } from "@/lib/api";

export default function TaskProjectDetailPage() {
  const params = useParams();
  const { token } = useAuth();
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
    if (!token || !project || !formTitle.trim()) return;
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
        <div className="h-9 w-48 bg-gray-200 rounded-lg" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg" />
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
    <div className="module-shell max-w-4xl">
      <div className="flex flex-col gap-4">
        <Link href="/tasks/projects" className="text-sm font-semibold text-security-navy-800 hover:underline min-h-11 inline-flex items-center w-fit">
          ← Back to Projects
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="page-title">{project.name}</h1>
            {project.description && (
              <p className="mt-2 max-w-2xl text-sm text-black">{project.description}</p>
            )}
          </div>
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary min-h-11 w-full sm:w-auto shrink-0">
            Add Task
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
          <form onSubmit={handleCreateTask} className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
            className="block card-dashboard p-4 transition-shadow hover:shadow-security-card-hover"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-black">{task.title}</h3>
              <span className="text-sm text-black font-medium">
                {task.status === "done" ? "Done" : task.status === "in_progress" ? "In Progress" : "To Do"}
              </span>
            </div>
            {task.dueDate && (
              <p className="text-sm text-black/80 mt-1">
                Due {new Date(task.dueDate).toLocaleDateString()}
              </p>
            )}
          </Link>
        ))}
      </div>

      {project.tasks.length === 0 && !showForm && (
        <div className="py-12 text-center text-sm text-black border-2 border-dashed border-neutral-200 rounded-security-lg bg-neutral-50/80">
          No tasks in this project yet.
        </div>
      )}
    </div>
  );
}
