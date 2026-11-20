import type { BceaEmployeeCategory, PsiraEnforcementMode } from "../../../lib/sa-labour-rules.config.js";
import type { SaSecurityFrameworkId } from "./sa-frameworks.js";

export interface SmartRosterGuardOtherShift {
  siteId: string;
  siteName: string;
  shiftType: "day" | "night";
  startTimeIso: string;
  endTimeIso: string;
}

export interface SmartRosterGuardInput {
  id: string;
  employeeNumber: string;
  fullName: string;
  status: string;
  employeeType: string;
  bceaCategory: BceaEmployeeCategory;
  gender: string | null;
  psiraGrade: string | null;
  psiraRegistrationNumber: string | null;
  psiraRegistrationExpiry: string | null;
  firearmCompetency: boolean;
  firearmCompetencyExpiry: string | null;
  armedGuard: boolean;
  preferredShiftType: "day" | "night" | "any";
  isSitePrimary: boolean;
  isReliever: boolean;
  eligiblePostIds: string[];
  priorWeekWorkedHoursByWeekKey: Record<string, number>;
  priorWorkDateKeys: string[];
  priorDayLastShiftType: "day" | "night" | "off" | null;
  leaveDateKeys: string[];
  otherSiteShiftsByDate: Record<string, SmartRosterGuardOtherShift[]>;
}

export interface SmartRosterPostInput {
  id: string | null;
  name: string;
  dayRequired: number;
  nightRequired: number;
  requiredPsiraGrade: string | null;
  requiresFirearm: boolean;
  requiredGender: "M" | "F" | "any" | null;
  dayAllowedDays: number[];
  nightAllowedDays: number[];
}

export interface SmartRosterDaySpec {
  dateKey: string;
  dayOfWeek: number;
  isoWeekStartKey: string;
  isSunday: boolean;
  isPublicHoliday: boolean;
}

export interface SmartRosterSolveRequest {
  siteId: string;
  siteName: string;
  frameworkId: SaSecurityFrameworkId;
  periodStart: string;
  periodEnd: string;
  dayStartTime: string;
  dayEndTime: string;
  nightStartTime: string;
  nightEndTime: string;
  shiftDurationHours: number;
  mealIntervalPaid: boolean;
  mealIntervalMinutes: number;
  psiraEnforcementMode: PsiraEnforcementMode;
  averagingEnabled: boolean;
  averagingWeeks: number;
  fortnightlyRestEnabled: boolean;
  allowOvertime: boolean;
  maxWeeklyOvertimeHours: number;
  preferDedicatedDayNight: boolean;
  posts: SmartRosterPostInput[];
  guards: SmartRosterGuardInput[];
  days: SmartRosterDaySpec[];
  holidaysMap: Record<string, string>;
  timeLimitMs?: number;
}

export interface SmartRosterShiftAssignment {
  guardId: string;
  guardName: string;
  employeeNumber: string;
  dateKey: string;
  shiftType: "day" | "night";
  shiftCode: "D" | "N" | "R";
  postId: string | null;
  postName: string | null;
  warnings: string[];
}

export interface SmartRosterUnfilledSlot {
  dateKey: string;
  shiftType: "day" | "night";
  postId: string | null;
  postName: string | null;
  requiredCount: number;
  filledCount: number;
  shortfall: number;
  reasons: string[];
}

export interface SmartRosterGuardComplianceSummary {
  guardId: string;
  guardName: string;
  employeeNumber: string;
  totalShifts: number;
  dayShifts: number;
  nightShifts: number;
  totalHours: number;
  ordinaryHours: number;
  overtimeHours: number;
  sundayHours: number;
  sundayDoubleHours: number;
  publicHolidayHours: number;
  nightShiftCount: number;
  nightAllowanceRand: number;
  restWarnings: string[];
  credentialWarnings: string[];
}

export interface SmartRosterSolveResult {
  solverUsed: "highs_milp" | "heuristic_lns" | "external_http";
  solverStatus: "Optimal" | "Feasible" | "Heuristic";
  solveDurationMs: number;
  fallbackReason?: string;
  assignments: SmartRosterShiftAssignment[];
  unfilledSlots: SmartRosterUnfilledSlot[];
  guardSummaries: SmartRosterGuardComplianceSummary[];
  metrics: {
    totalRequiredSlots: number;
    totalFilledSlots: number;
    coveragePercent: number;
    totalOvertimeHours: number;
    restViolationsCount: number;
    credentialWarningsCount: number;
  };
}

export interface RosterSolverAdapter {
  name: string;
  solve(request: SmartRosterSolveRequest): Promise<SmartRosterSolveResult>;
}
