import { format } from "date-fns";

export type WorkflowStepStatus = "done" | "ready" | "blocked" | "waiting";

export interface WorkflowStepItem {
  step: number;
  title: string;
  caption: string;
  status: WorkflowStepStatus;
  statusLabel: string;
  href?: string;
}

export interface PayrollReadinessInfo {
  status: string;
  openExceptions: number;
  periodStart?: string;
  periodEnd?: string;
}

export interface PayrollRunLike {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "calculated" | "approved" | "paid" | string;
}

export function determineAttendanceBlockerState(params: {
  payrollReadiness?: PayrollReadinessInfo | null;
  pendingSiteTimesheetRows?: number;
}) {
  const { payrollReadiness, pendingSiteTimesheetRows } = params;
  const openExceptions = payrollReadiness?.openExceptions ?? 0;
  const pendingRows = pendingSiteTimesheetRows ?? 0;

  const isAttendanceBlocked =
    (payrollReadiness && payrollReadiness.status !== "READY") ||
    openExceptions > 0 ||
    pendingRows > 0;
  const isAttendanceClear = !isAttendanceBlocked && Boolean(payrollReadiness);
  const blockerCount = openExceptions + pendingRows;

  const attendanceBlockerMessage = isAttendanceBlocked
    ? `${blockerCount} attendance issue${blockerCount === 1 ? "" : "s"} must be resolved before payroll calculation.`
    : null;

  const attendanceBlockerHref =
    openExceptions > 0 && payrollReadiness?.periodStart && payrollReadiness?.periodEnd
      ? `/attendance/exceptions?status=OPEN&severity=CRITICAL&start=${payrollReadiness.periodStart.slice(0, 10)}&end=${payrollReadiness.periodEnd.slice(0, 10)}`
      : "/attendance/exceptions?status=OPEN";

  return {
    isAttendanceBlocked: Boolean(isAttendanceBlocked),
    isAttendanceClear: Boolean(isAttendanceClear),
    blockerCount,
    attendanceBlockerMessage,
    attendanceBlockerHref,
  };
}

export function buildPayrollWorkflowSteps(params: {
  openRun?: PayrollRunLike | null;
  isAttendanceClear: boolean;
  isAttendanceBlocked: boolean;
  blockerCount: number;
  attendanceBlockerHref: string;
}): WorkflowStepItem[] {
  const {
    openRun,
    isAttendanceClear,
    isAttendanceBlocked,
    blockerCount,
    attendanceBlockerHref,
  } = params;

  return [
    {
      step: 1,
      title: "Attendance",
      status: isAttendanceClear ? "done" : isAttendanceBlocked ? "blocked" : "ready",
      statusLabel: isAttendanceClear ? "Clear" : isAttendanceBlocked ? "Blocked" : "Review",
      caption: isAttendanceClear
        ? "All guard attendance approved & clear"
        : isAttendanceBlocked
        ? `${blockerCount} unapproved attendance issue${blockerCount === 1 ? "" : "s"}`
        : "Guard attendance (office staff use fixed salary)",
      href: isAttendanceBlocked ? attendanceBlockerHref : "/attendance",
    },
    {
      step: 2,
      title: "Create run",
      status: openRun ? "done" : "ready",
      statusLabel: openRun ? "Done" : "Ready",
      caption: openRun
        ? `${format(new Date(openRun.periodStart), "d MMM")} – ${format(new Date(openRun.periodEnd), "d MMM")} run created`
        : "Open a pay period for this cycle",
    },
    {
      step: 3,
      title: "Calculate",
      status:
        openRun && ["calculated", "approved", "paid"].includes(openRun.status)
          ? "done"
          : openRun?.status === "draft"
          ? isAttendanceBlocked
            ? "blocked"
            : "ready"
          : "waiting",
      statusLabel:
        openRun && ["calculated", "approved", "paid"].includes(openRun.status)
          ? "Calculated"
          : openRun?.status === "draft"
          ? isAttendanceBlocked
            ? "Blocked"
            : "Ready"
          : "Waiting",
      caption:
        openRun && ["calculated", "approved", "paid"].includes(openRun.status)
          ? "Gross, net & statutory amounts calculated"
          : openRun?.status === "draft"
          ? isAttendanceBlocked
            ? "Blocked until attendance is cleared"
            : "Ready to calculate wages & tax"
          : "Requires an open draft run",
    },
    {
      step: 4,
      title: "Approve",
      status:
        openRun && ["approved", "paid"].includes(openRun.status)
          ? "done"
          : openRun?.status === "calculated"
          ? "ready"
          : "waiting",
      statusLabel:
        openRun && ["approved", "paid"].includes(openRun.status)
          ? "Approved"
          : openRun?.status === "calculated"
          ? "Ready"
          : "Waiting",
      caption:
        openRun && ["approved", "paid"].includes(openRun.status)
          ? "Reviewed & locked for payment"
          : openRun?.status === "calculated"
          ? "Awaiting final sign-off"
          : "Requires calculation first",
    },
    {
      step: 5,
      title: "Mark paid",
      status:
        openRun?.status === "paid"
          ? "done"
          : openRun?.status === "approved"
          ? "ready"
          : "waiting",
      statusLabel:
        openRun?.status === "paid"
          ? "Paid"
          : openRun?.status === "approved"
          ? "Ready"
          : "Waiting",
      caption:
        openRun?.status === "paid"
          ? "Period closed & marked paid"
          : openRun?.status === "approved"
          ? "Ready to mark paid once disbursed"
          : "Awaiting approval first",
    },
  ];
}
