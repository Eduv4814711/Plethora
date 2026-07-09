"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  listTasks,
  listTaskProjects,
  createTask,
  type Task,
  type TaskProject,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/api";
import { AssigneePicker } from "@/components/assignee-picker";
import { AlertBanner, EmptyState } from "@/components/ui";

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  critical: "Critical",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "badge-neutral",
  medium: "badge-warning",
  high: "badge-warning",
  urgent: "badge-error",
  critical: "badge-error",
};

const QUICK_FILTERS = [
  { value: "all", label: "All" },
  { value: "my", label: "My Tasks" },
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due Today" },
  { value: "critical", label: "Critical" },
] as const;

type QuickFilter = (typeof QUICK_FILTERS)[number]["value"];

function TaskCard({ task }: { task: Task }) {
  const dueStr = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null;
  const isOverdue =
    task.dueDate &&
    !["done", "cancelled"].includes(task.status) &&
    new Date(task.dueDate) < new Date();

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="card-dashboard block p-4 transition-colors hover:border-security-navy-200"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-black truncate flex-1">{task.title}</h3>
        <span className={`shrink-0 ${PRIORITY_COLORS[task.priority] ?? "badge-neutral"}`}>
          {PRIORITY_LABELS[task.priority] ?? task.priority}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm text-neutral-600">
        <span>{STATUS_LABELS[task.status] ?? task.status}</span>
        {task.project && (
          <span className="text-neutral-500">• {task.project.name}</span>
        )}
        {task.assigneeDisplayName && (
          <span className="text-neutral-500">• {task.assigneeDisplayName}</span>
        )}
      </div>
      {typeof task.completionPercentage === "number" && task.status !== "done" && task.status !== "cancelled" && (
        <div className="mt-2">
          <div className="flex justify-between text-xs text-neutral-500 mb-0.5">
            <span>Progress</span>
            <span>{task.completionPercentage}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
            <div
              className="h-full bg-security-navy-600 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, task.completionPercentage))}%` }}
            />
          </div>
        </div>
      )}
      {dueStr && (
        <p className={`mt-1 text-xs ${isOverdue ? "text-red-600 font-medium" : "text-neutral-500"}`}>
          Due {dueStr}
        </p>
      )}
    </Link>
  );
}

export default function TasksPage() {
  const { token, user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [formTitle, setFormTitle] = useState("");
  const [formProjectId, setFormProjectId] = useState<string>("");
  const [formPriority, setFormPriority] = useState<TaskPriority>("medium");
  const [formAssignee, setFormAssignee] = useState<{ type: "user" | "employee" | null; id: string | null }>({
    type: null,
    id: null,
  });
  const [formError, setFormError] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    if (!token) return;
    const params: { projectId?: string; status?: TaskStatus; filter?: "overdue" | "due_today" | "my" | "critical" } = {};
    if (projectFilter !== "all") params.projectId = projectFilter;
    if (statusFilter !== "all") params.status = statusFilter as TaskStatus;
    if (quickFilter !== "all") params.filter = quickFilter;

    setFetchError("");
    try {
      const [taskResult, projectResult] = await Promise.all([
        listTasks(token, { ...params, limit: 100 }),
        listTaskProjects(token),
      ]);
      setTasks(taskResult.data);
      setTotal(taskResult.total);
      setProjects(projectResult.data);
    } catch (err) {
      console.error(err);
      setTasks([]);
      setFetchError("Unable to load tasks. Check the connection and try again.");
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, projectFilter, statusFilter, quickFilter]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formTitle.trim()) {
      setFormError("Title is required");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await createTask(token, {
        title: formTitle.trim(),
        projectId: formProjectId || null,
        priority: formPriority,
        assigneeType: formAssignee.type,
        assigneeId: formAssignee.id,
      });
      setFormTitle("");
      setFormProjectId("");
      setFormPriority("medium");
      setFormAssignee({ type: null, id: null });
      setShowForm(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-48 bg-neutral-200 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-neutral-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="mt-1 text-sm text-neutral-600">Track operational work, assignments, and follow-ups.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="tasks-project-filter" className="sr-only">Filter tasks by project</label>
          <select
            id="tasks-project-filter"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="input-compact w-auto"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label htmlFor="tasks-status-filter" className="sr-only">Filter tasks by status</label>
          <select
            id="tasks-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-compact w-auto"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Link
            href="/tasks/projects"
            className="btn-secondary text-sm py-2"
          >
            Projects
          </Link>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm py-2">
            New Task
          </button>
        </div>
      </div>

      {fetchError && <AlertBanner variant="error" className="mb-6">{fetchError}</AlertBanner>}

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setQuickFilter(f.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              quickFilter === f.value
                ? "bg-security-navy-700 text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="card-dashboard mb-6 p-4">
          <h2 className="section-title mb-3">Create task</h2>
          <form onSubmit={handleCreateTask} className="space-y-3">
            <label htmlFor="task-title" className="label-text block">Task title</label>
            <input
              id="task-title"
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Task title"
              className="input-modern"
              autoFocus
            />
            <div className="flex flex-wrap gap-3">
              <select
                value={formProjectId}
                onChange={(e) => setFormProjectId(e.target.value)}
                className="input-compact w-auto"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value as TaskPriority)}
                className="input-compact w-auto"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
              <div className="w-48">
                <AssigneePicker value={formAssignee} onChange={setFormAssignee} />
              </div>
            </div>
            {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="btn-primary">
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormError("");
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>

      {tasks.length === 0 && (
        <EmptyState
          className="mt-6"
          title={projectFilter !== "all" || statusFilter !== "all" || quickFilter !== "all" ? "No tasks match these filters" : "No tasks created yet"}
          description={
            projectFilter !== "all" || statusFilter !== "all" || quickFilter !== "all"
              ? "Adjust the filters to find operational work."
              : "Create tasks to assign work, track follow-ups, and keep operations moving."
          }
          action={
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => setShowForm(true)}>
              New task
            </button>
          }
        />
      )}
    </div>
  );
}
