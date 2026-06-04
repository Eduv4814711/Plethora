"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  getTask,
  updateTask,
  listTaskProjects,
  deleteTask,
  completeTask,
  reopenTask,
  addTaskComment,
  uploadTaskAttachment,
  deleteTaskAttachment,
  addTaskReminder,
  deleteTaskReminder,
  buildApiUrl,
  type Task,
  type TaskProject,
  type TaskAttachment,
  type TaskReminder,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/api";
import { AssigneePicker } from "@/components/assignee-picker";
import { DateInput } from "@/components/date-input";

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { token } = useAuth();
  const id = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
  const [editDueDate, setEditDueDate] = useState<string>("");
  const [editAssignee, setEditAssignee] = useState<{ type: "user" | "employee" | null; id: string | null }>({
    type: null,
    id: null,
  });
  const [editRecurrence, setEditRecurrence] = useState<{
    frequency: "daily" | "weekly" | "monthly" | "";
    interval: number;
    endDate: string;
  }>({ frequency: "", interval: 1, endDate: "" });
  const [commentBody, setCommentBody] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => {
    if (!token || !id) return;
    getTask(token, id)
      .then(setTask)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load task"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token || !id) return;
    refresh();
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    listTaskProjects(token)
      .then((res) => setProjects(res.data ?? []))
      .catch(() => setProjects([]));
  }, [token]);

  useEffect(() => {
    if (task) {
      setEditTitle(task.title);
      setEditDescription(task.description ?? "");
      setEditProjectId(task.projectId ?? "");
      setEditStatus(task.status);
      setEditPriority(task.priority);
      setEditDueDate(task.dueDate ? task.dueDate.slice(0, 16) : "");
      setEditAssignee({
        type: task.assigneeType as "user" | "employee" | null,
        id: task.assigneeId ?? null,
      });
      const rec = task.recurrenceRule as { frequency?: string; interval?: number; endDate?: string } | null;
      setEditRecurrence({
        frequency: (rec?.frequency as "daily" | "weekly" | "monthly") || "",
        interval: rec?.interval ?? 1,
        endDate: rec?.endDate ? rec.endDate.slice(0, 10) : "",
      });
    }
  }, [task]);

  const handleSave = async () => {
    if (!token || !task) return;
    setSubmitting(true);
    try {
      const recurrenceRule =
        editRecurrence.frequency
          ? {
              frequency: editRecurrence.frequency,
              interval: editRecurrence.interval,
              endDate: editRecurrence.endDate ? new Date(editRecurrence.endDate).toISOString() : undefined,
            }
          : null;

      const updated = await updateTask(token, task.id, {
        title: editTitle,
        description: editDescription || null,
        projectId: editProjectId || null,
        status: editStatus,
        priority: editPriority,
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
        assigneeType: editAssignee.type,
        assigneeId: editAssignee.id,
        recurrenceRule,
      });
      setTask(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!token || !task) return;
    try {
      const updated = await completeTask(token, task.id);
      setTask(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete");
    }
  };

  const handleReopen = async () => {
    if (!token || !task) return;
    try {
      const updated = await reopenTask(token, task.id);
      setTask(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen");
    }
  };

  const handleDelete = async () => {
    if (!token || !task || !confirm("Delete this task?")) return;
    try {
      await deleteTask(token, task.id);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !task || !commentBody.trim()) return;
    setSubmitting(true);
    try {
      const comment = await addTaskComment(token, task.id, commentBody.trim());
      setTask((prev) =>
        prev
          ? { ...prev, comments: [...(prev.comments || []), comment] }
          : null
      );
      setCommentBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!token || !task || !file) return;
    setUploading(true);
    try {
      const att = await uploadTaskAttachment(token, task.id, file);
      setTask((prev) =>
        prev
          ? { ...prev, attachments: [...(prev.attachments || []), att] }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDeleteAttachment = async (attId: string) => {
    if (!token || !task) return;
    try {
      await deleteTaskAttachment(token, attId);
      setTask((prev) =>
        prev
          ? { ...prev, attachments: (prev.attachments || []).filter((a) => a.id !== attId) }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleAddReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !task || !remindAt) return;
    setSubmitting(true);
    try {
      const reminder = await addTaskReminder(token, task.id, new Date(remindAt).toISOString());
      setTask((prev) =>
        prev
          ? { ...prev, reminders: [...(prev.reminders || []), reminder] }
          : null
      );
      setRemindAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reminder");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReminder = async (remId: string) => {
    if (!token || !task) return;
    try {
      await deleteTaskReminder(token, remId);
      setTask((prev) =>
        prev
          ? { ...prev, reminders: (prev.reminders || []).filter((r) => r.id !== remId) }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete reminder");
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-64 bg-gray-200 rounded-lg" />
        <div className="h-48 bg-gray-200 rounded-lg" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || "Task not found"}</p>
        <Link href="/tasks" className="btn-secondary mt-4 inline-block">
          Back to Tasks
        </Link>
      </div>
    );
  }


  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/tasks" className="text-sm text-gray-600 hover:text-black">
          ← Back to Tasks
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-gray-100 border border-gray-300 rounded-lg p-6 mb-6">
        {editing ? (
          <div className="space-y-4">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="input-modern text-lg font-bold"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description"
              className="input-modern min-h-[80px]"
              rows={3}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select
                value={editProjectId}
                onChange={(e) => setEditProjectId(e.target.value)}
                className="input-compact w-full sm:w-72"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-4">
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                className="input-compact w-auto"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                className="input-compact w-auto"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <input
                type="datetime-local"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="input-compact w-auto"
              />
              <div className="w-48">
                <AssigneePicker value={editAssignee} onChange={setEditAssignee} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <span className="text-sm font-medium">Recurrence:</span>
              <select
                value={editRecurrence.frequency}
                onChange={(e) =>
                  setEditRecurrence((r) => ({ ...r, frequency: e.target.value as "daily" | "weekly" | "monthly" | "" }))
                }
                className="input-compact w-auto"
              >
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {editRecurrence.frequency && (
                <>
                  <input
                    type="number"
                    min={1}
                    value={editRecurrence.interval}
                    onChange={(e) =>
                      setEditRecurrence((r) => ({ ...r, interval: parseInt(e.target.value, 10) || 1 }))
                    }
                    className="input-compact w-20"
                  />
                  <span className="text-sm text-gray-600">
                    {editRecurrence.frequency === "daily"
                      ? "day(s)"
                      : editRecurrence.frequency === "weekly"
                        ? "week(s)"
                        : "month(s)"}
                  </span>
                  <DateInput
                    value={editRecurrence.endDate}
                    onChange={(v) => setEditRecurrence((r) => ({ ...r, endDate: v }))}
                    className="input-compact min-w-[11rem]"
                    showToday
                    ariaLabel="Recurrence end date"
                  />
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={submitting} className="btn-primary">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">{task.title}</h1>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="px-2 py-0.5 bg-gray-200 rounded text-sm">
                    {STATUS_LABELS[task.status]}
                  </span>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-sm">
                    {PRIORITY_LABELS[task.priority]}
                  </span>
                  {task.project && (
                    <span className="px-2 py-0.5 bg-gray-200 rounded text-sm">
                      {task.project.name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setEditing(true)} className="btn-secondary text-sm">
                  Edit
                </button>
                {task.status === "done" ? (
                  <button onClick={handleReopen} className="btn-secondary text-sm">
                    Reopen
                  </button>
                ) : (
                  <button onClick={handleComplete} className="btn-primary text-sm">
                    Complete
                  </button>
                )}
                <button onClick={handleDelete} className="btn-secondary text-sm text-red-600 border-red-600">
                  Delete
                </button>
              </div>
            </div>

            {task.description && (
              <p className="mt-4 text-gray-700 whitespace-pre-wrap">{task.description}</p>
            )}

            <div className="mt-4 text-sm text-gray-600">
              {task.dueDate && (
                <p>Due: {new Date(task.dueDate).toLocaleString()}</p>
              )}
              {task.assigneeDisplayName && (
                <p>Assigned to: {task.assigneeDisplayName}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Comments */}
      <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 mb-6">
        <h2 className="font-bold text-black mb-3">Comments</h2>
        <form onSubmit={handleAddComment} className="mb-4">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment..."
            className="input-modern min-h-[60px]"
            rows={2}
          />
          <button type="submit" disabled={submitting || !commentBody.trim()} className="btn-primary mt-2 text-sm">
            Add Comment
          </button>
        </form>
        <div className="space-y-3">
          {(task.comments || []).map((c) => (
            <div key={c.id} className="bg-white rounded p-3 border border-gray-200">
              <p className="text-sm text-gray-600">
                {c.user?.name ?? "Unknown"} • {new Date(c.createdAt).toLocaleString()}
              </p>
              <p className="mt-1 text-black">{c.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Attachments */}
      <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 mb-6">
        <h2 className="font-bold text-black mb-3">Attachments</h2>
        <label className="btn-secondary text-sm inline-block cursor-pointer">
          {uploading ? "Uploading..." : "Upload file"}
          <input
            type="file"
            className="hidden"
            onChange={handleUploadAttachment}
            disabled={uploading}
          />
        </label>
        <div className="mt-3 space-y-2">
          {(task.attachments || []).map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-white rounded p-2 border border-gray-200">
              <a
                href={a.url.startsWith("http") ? a.url : buildApiUrl(a.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                {a.filename}
              </a>
              <button
                onClick={() => handleDeleteAttachment(a.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Reminders */}
      <div className="bg-gray-100 border border-gray-300 rounded-lg p-4">
        <h2 className="font-bold text-black mb-3">Reminders</h2>
        <form onSubmit={handleAddReminder} className="mb-4 flex gap-2 items-end">
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            className="input-compact w-auto"
          />
          <button type="submit" disabled={submitting || !remindAt} className="btn-primary text-sm">
            Add Reminder
          </button>
        </form>
        <div className="space-y-2">
          {(task.reminders || []).map((r) => (
            <div key={r.id} className="flex items-center justify-between bg-white rounded p-2 border border-gray-200">
              <span className="text-sm">
                {new Date(r.remindAt).toLocaleString()}
              </span>
              <button
                onClick={() => handleDeleteReminder(r.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
