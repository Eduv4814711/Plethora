"use client";

import { useState } from "react";
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
  disabled,
  onClear,
  onApply,
}: {
  selectedCount: number;
  branches: InstructorBranchOption[];
  courses: InstructorCourseOption[];
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

  if (selectedCount === 0) return null;

  const needsBranch = action === "assign_branch";
  const needsCourse = action === "assign_course";
  const actionDisabled = disabled || (needsBranch && !branchId) || (needsCourse && !courseId);

  return (
    <div className="sticky bottom-3 z-40 rounded-2xl border border-slate-300 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {selectedCount} selected
        </span>
        <select
          className="input-compact min-h-10 min-w-56 rounded-security-lg"
          value={action}
          onChange={(e) => setAction(e.target.value as BulkActionType)}
        >
          <option value="export_selected">Export selected</option>
          <option value="assign_branch">Assign branch</option>
          <option value="assign_course">Assign course</option>
          <option value="archive_selected">Archive selected</option>
          <option value="delete_selected">Delete selected</option>
          <option value="send_reminder">Send reminder</option>
          <option value="mark_documents_requested">Mark documents requested</option>
        </select>
        {needsBranch && (
          <select
            className="input-compact min-h-10 min-w-[13rem] rounded-security-lg"
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
            className="input-compact min-h-10 min-w-[13rem] rounded-security-lg"
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
          className="btn-primary text-sm py-2 px-4 rounded-security-lg"
          disabled={actionDisabled}
          onClick={() => onApply({ action, branchId, courseId })}
        >
          Apply
        </button>
        <button type="button" className="btn-ghost text-sm py-2 px-3 rounded-security-lg" onClick={onClear} disabled={disabled}>
          Clear selection
        </button>
      </div>
    </div>
  );
}
