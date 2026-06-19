export type RosterReadinessHint = {
  code: string;
  level: "ok" | "warning" | "error";
  message: string;
};

/** Client-side roster readiness hints (mirrors API diagnostics wording). */
export function buildSiteRosterReadinessHints(site: {
  posts: { shiftType?: string | null }[];
  assignedGuards?: { employee: { status: string; gender?: string | null } }[];
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  rosterDayShiftGuardsRequired?: number;
  rosterNightShiftGuardsRequired?: number;
}): RosterReadinessHint[] {
  const dayPosts = site.posts.filter((p) => (p.shiftType ?? "day") !== "night");
  const nightPosts = site.posts.filter((p) => p.shiftType === "night");
  const clampStaffing = (n: number | null | undefined) => {
    if (n == null) return 1;
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 1;
    return Math.min(50, Math.max(0, v));
  };
  const dayStaff = clampStaffing(site.rosterDayShiftGuardsRequired);
  const nightStaff = clampStaffing(site.rosterNightShiftGuardsRequired);
  const rosterable = (site.assignedGuards ?? []).filter((a) =>
    ["active", "training", "hired", "reliever"].includes(a.employee.status)
  );
  const relievers = rosterable.filter((a) => a.employee.status === "reliever");
  const restrictiveGender =
    site.rosterDayShiftGender === "male" ||
    site.rosterDayShiftGender === "female" ||
    site.rosterNightShiftGender === "male" ||
    site.rosterNightShiftGender === "female";
  const missingGender = rosterable.filter((a) => {
    const g = (a.employee.gender ?? "").trim().toLowerCase();
    return g !== "m" && g !== "male" && g !== "f" && g !== "female";
  }).length;

  const hints: RosterReadinessHint[] = [];

  if (dayPosts.length > 0) {
    hints.push({
      code: "OK_DAY_POSTS_EXIST",
      level: "ok",
      message: `${dayPosts.length} day post(s) configured.`,
    });
  } else if (dayStaff > 0) {
    hints.push({
      code: "ERROR_MISSING_DAY_POSTS",
      level: "error",
      message: "No day post on this site. Day demand slots cannot be filled.",
    });
  }

  if (nightPosts.length > 0) {
    hints.push({
      code: "OK_NIGHT_POSTS_EXIST",
      level: "ok",
      message: `${nightPosts.length} night post(s) configured.`,
    });
  } else if (nightStaff > 0) {
    hints.push({
      code: "ERROR_MISSING_NIGHT_POSTS",
      level: "error",
      message: "No night post on this site. Night demand slots cannot be filled.",
    });
  }

  if (dayStaff > dayPosts.length && dayPosts.length > 0) {
    hints.push({
      code: "WARNING_STAFFING_EXCEEDS_POSTS",
      level: "warning",
      message: `Day staffing (${dayStaff}) exceeds day posts (${dayPosts.length}); posts will rotate.`,
    });
  }

  if (nightPosts.length > 0 && nightStaff > nightPosts.length) {
    hints.push({
      code: "WARNING_STAFFING_EXCEEDS_POSTS",
      level: "warning",
      message: `Night staffing (${nightStaff}) exceeds night posts (${nightPosts.length}); posts will rotate.`,
    });
  }

  if (missingGender > 0 && restrictiveGender) {
    hints.push({
      code: "WARNING_GUARDS_WITH_MISSING_GENDER",
      level: "warning",
      message: `${missingGender} guard(s) have no gender on profile; may be ineligible under site gender rules.`,
    });
  }

  const minRosterable = Math.max(dayStaff, nightStaff);
  if (rosterable.length < minRosterable) {
    hints.push({
      code: "ERROR_INSUFFICIENT_ROSTERABLE_GUARDS",
      level: "error",
      message: `Need at least ${minRosterable} rosterable guard(s) for ${dayStaff} day and ${nightStaff} night per day; ${rosterable.length} assigned.`,
    });
  }

  if (relievers.length > 0) {
    hints.push({
      code: "WARNING_RELIEVERS_WILL_BE_USED",
      level: "warning",
      message: `${relievers.length} reliever(s) on site; regular guards are preferred, relievers used as fallback.`,
    });
  }

  if (
    dayStaff > 0 &&
    nightStaff > 0 &&
    rosterable.length < dayStaff + nightStaff
  ) {
    hints.push({
      code: "WARNING_STRICT_REST_STAFFING",
      level: "warning",
      message: `Strict rest rules require one guard per shift per day (no day+night same day). For ${dayStaff} day and ${nightStaff} night slots you may need ${dayStaff + nightStaff}+ rosterable guards; ${rosterable.length} assigned.`,
    });
  }

  return hints;
}
