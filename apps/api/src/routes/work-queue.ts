import type { FastifyInstance } from "fastify";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { hasPermission } from "../services/user-access.service.js";
import { prisma } from "../lib/prisma.js";

export interface WorkQueueItem {
  id: string;
  kind: "task" | "exception" | "approval" | "timesheet" | "incident" | "compliance" | "data_quality";
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  count: number;
  dueDate: string | null;
  workflowState: string;
  actionLabel: string;
  actionHref: string;
}

const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export async function workQueueRoutes(app: FastifyInstance) {
  app.get("/", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.WORK_QUEUE_READ)],
  }, async (request, reply) => {
    const user = request.user!;
    const now = new Date();
    const items: WorkQueueItem[] = [];
    const can = (permission: string) => hasPermission(request.access, permission);

    const [overdueTasks, dueTasks] = can(PERMISSIONS.TASKS_READ)
      ? await Promise.all([
          prisma.task.count({ where: { companyId: user.companyId, assigneeType: "user", assigneeId: user.sub, status: { notIn: ["done", "cancelled"] }, dueDate: { lt: now } } }),
          prisma.task.count({ where: { companyId: user.companyId, assigneeType: "user", assigneeId: user.sub, status: { notIn: ["done", "cancelled"] }, dueDate: { gte: now } } }),
        ])
      : [0, 0];
    if (overdueTasks) items.push({ id: "tasks-overdue", kind: "task", priority: "HIGH", title: "Overdue tasks", description: "Tasks assigned to you are past their due date.", count: overdueTasks, dueDate: null, workflowState: "overdue", actionLabel: "Review tasks", actionHref: "/tasks" });
    if (dueTasks) items.push({ id: "tasks-upcoming", kind: "task", priority: "LOW", title: "Upcoming tasks", description: "Your open tasks with a future due date.", count: dueTasks, dueDate: null, workflowState: "open", actionLabel: "View tasks", actionHref: "/tasks" });

    if (can(PERMISSIONS.ATTENDANCE_MANAGE)) {
      const exceptions = await prisma.attendanceException.groupBy({
        by: ["severity"],
        where: { companyId: user.companyId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
        _count: { id: true },
      });
      for (const group of exceptions) {
        const priority = group.severity === "CRITICAL" ? "CRITICAL" : group.severity === "MEDIUM" ? "MEDIUM" : "LOW";
        items.push({ id: `attendance-${group.severity}`, kind: "exception", priority, title: `${group.severity.toLowerCase().replace(/^./, (c) => c.toUpperCase())} attendance exceptions`, description: "Resolve attendance exceptions before approving site timesheets.", count: group._count.id, dueDate: null, workflowState: "needs_review", actionLabel: "Resolve exceptions", actionHref: "/attendance/exceptions" });
      }
    }

    if (can(PERMISSIONS.APPROVALS_REVIEW)) {
      const approvals = await prisma.approvalRequest.count({ where: { companyId: user.companyId, status: "PENDING", requestedById: { not: user.sub }, OR: [{ approverId: null }, { approverId: user.sub }] } });
      if (approvals) items.push({ id: "approvals-pending", kind: "approval", priority: "HIGH", title: "Approvals waiting for you", description: "Independent review is required before these changes can take effect.", count: approvals, dueDate: null, workflowState: "pending", actionLabel: "Review approvals", actionHref: "/approvals" });
    }

    if (can(PERMISSIONS.TIMESHEETS_MANAGE)) {
      const rows = await prisma.siteTimesheetRow.count({ where: { companyId: user.companyId, approvalStatus: { in: ["pending", "partially_reviewed"] } } });
      if (rows) items.push({ id: "timesheets-pending", kind: "timesheet", priority: "HIGH", title: "Timesheet rows need review", description: "Confirm hours, guards and occurrence-book references before payroll.", count: rows, dueDate: null, workflowState: "capture", actionLabel: "Continue timesheets", actionHref: "/rostering/site-timesheets" });
    }

    if (can(PERMISSIONS.INCIDENTS_READ)) {
      const incidents = await prisma.incident.count({ where: { companyId: user.companyId, severity: "CRITICAL", status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
      if (incidents) items.push({ id: "incidents-critical", kind: "incident", priority: "CRITICAL", title: "Critical incidents open", description: "Critical incidents require review and documented follow-up.", count: incidents, dueDate: null, workflowState: "open", actionLabel: "Review incidents", actionHref: "/incidents" });
    }

    if (can(PERMISSIONS.DATA_QUALITY_READ)) {
      const quality = await prisma.dataQualityIssue.groupBy({ by: ["severity"], where: { companyId: user.companyId, status: { in: ["OPEN", "UNDER_REVIEW"] } }, _count: { id: true } });
      for (const group of quality) items.push({ id: `quality-${group.severity}`, kind: "data_quality", priority: group.severity, title: `${group.severity.toLowerCase().replace(/^./, (c) => c.toUpperCase())} data issues`, description: "Review proposed corrections; no records will be changed automatically.", count: group._count.id, dueDate: null, workflowState: "needs_review", actionLabel: "Review data quality", actionHref: "/audit?view=data-quality" });
    }

    items.sort((a, b) => rank[a.priority] - rank[b.priority] || b.count - a.count || a.title.localeCompare(b.title));
    return reply.send({ data: items.slice(0, 12), total: items.length, generatedAt: now.toISOString() });
  });
}
