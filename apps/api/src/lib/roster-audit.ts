import { createAuditLog } from "./audit.js";
import type { RosterPlan } from "../services/roster-engine.service.js";

export const ROSTER_AUDIT = {
  GENERATION: "roster.generation",
  RESET: "roster.reset",
  MANUAL_SHIFT_EDIT: "shift.manual_edit",
} as const;

export async function auditRosterGeneration(params: {
  userId?: string;
  companyId: string;
  siteId: string;
  plan: Pick<RosterPlan, "startDate" | "endDate" | "summary">;
  created: number;
  deleted: number;
  source?: string;
}) {
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: ROSTER_AUDIT.GENERATION,
    entityType: "site",
    entityId: params.siteId,
    metadata: {
      startDate: params.plan.startDate,
      endDate: params.plan.endDate,
      created: params.created,
      deleted: params.deleted,
      summary: params.plan.summary,
      ...(params.source ? { source: params.source } : {}),
    },
  });
}

export async function auditRosterReset(params: {
  userId?: string;
  companyId: string;
  startDate: string;
  endDate: string;
  deleted: number;
  employeeId?: string;
  siteId?: string;
}) {
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: ROSTER_AUDIT.RESET,
    entityType: "shift",
    metadata: {
      startDate: params.startDate,
      endDate: params.endDate,
      employeeId: params.employeeId,
      siteId: params.siteId,
      deleted: params.deleted,
    },
  });
}

export async function auditManualShiftEdit(params: {
  userId?: string;
  companyId: string;
  shiftId: string;
  before: {
    employeeId: string;
    postId: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  after: {
    employeeId: string;
    postId: string;
    startTime: string;
    endTime: string;
  };
}) {
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: ROSTER_AUDIT.MANUAL_SHIFT_EDIT,
    entityType: "shift",
    entityId: params.shiftId,
    metadata: { before: params.before, after: params.after },
  });
}
