"use client";

import { useEffect, useState } from "react";
import type { InstructorBranchOption, InstructorCourseOption, InstructorStatus } from "./types";

export type BulkActionType =
  | "export_selected"
  | "assign_branch"
  | "assign_course"
  | "archive_selected"
  | "delete_selected"
  | "send_reminder"
  | "mark_documents_requested";

export function BulkActionBar({
  selectedCount,
  branches,
  courses,
  allowedActions,
  disabled,
  onClear,
  onApply,
}: {
  selectedCount: number;
  branches: InstructorBranchOption[];
  courses: InstructorCourseOption[];
  allowedActions: BulkActionType[];
  disabled?: boolean;
  onClear: () => void;
  onApply: (payload: {
    action: BulkActionType;
    branchId?: string;
    courseId?: string;
    status?: InstructorStatus;
  }) => void;
}) {
  const [action, setAction] = useState<BulkActionType>("export_selected");
  const [branchId, setBranchId] = useState("");
  const [courseId, setCourseId] = useState("");

  useEffect(() => {
    if (!allowedActions.includes(action)) {
      setAction(allowedActions[0] ?? "export_selected");
    }
  }, [action, allowedActions]);

  if (selectedCount === 0 || allowedActions.length === 0) return null;

  const needsBranch = action === "assign_branch";
  const needsCourse = action === "assign_course";
  const actionDisabled = disabled || !allowedActions.includes(action) || (needsBranch && !branchId) || (needsCourse && !courseId);

  return (
    <div className="sticky bottom-3 z-40 rounded-2xl border border-slate-300 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {selectedCount} selected
        </span>
        <select
          className="input-compact min-w-56 rounded-xl"
          value={action}
          onChange={(e) => setAction(e.target.value as BulkActionType)}
        >
          {allowedActions.includes("export_selected") && <option value="export_selected">Export selected</option>}
          {allowedActions.includes("assign_branch") && <option value="assign_branch">Assign branch</option>}
          {allowedActions.includes("assign_course") && <option value="assign_course">Assign course</option>}
          {allowedActions.includes("archive_selected") && <option value="archive_selected">Archive selected</option>}
          {allowedActions.includes("delete_selected") && <option value="delete_selected">Delete selected</option>}
          {allowedActions.includes("send_reminder") && <option value="send_reminder">Send reminder</option>}
          {allowedActions.includes("mark_documents_requested") && <option value="mark_documents_requested">Mark documents requested</option>}
        </select>
        {needsBranch && (
          <select
            className="input-compact min-w-52 rounded-xl"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Select branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        )}
        {needsCourse && (
          <select
            className="input-compact min-w-52 rounded-xl"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">Select course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code ? `${course.code} · ${course.title}` : course.title}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-xs rounded-xl"
          disabled={actionDisabled}
          onClick={() => onApply({ action, branchId, courseId })}
        >
          Apply
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs rounded-xl" onClick={onClear} disabled={disabled}>
          Clear selection
        </button>
      </div>
    </div>
  );
}
