/** Clamp site staffing fields to valid roster engine range (0–50 per shift). */
export function resolveSiteShiftStaffing(site: {
  rosterDayShiftGuardsRequired?: number | null;
  rosterNightShiftGuardsRequired?: number | null;
}): { day: number; night: number } {
  const clamp = (n: number | null | undefined) => {
    if (n == null) return 1;
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 1;
    return Math.min(50, Math.max(0, v));
  };

  return {
    day: clamp(site.rosterDayShiftGuardsRequired),
    night: clamp(site.rosterNightShiftGuardsRequired),
  };
}

/**
 * Minimum rosterable guards for simultaneous day + night coverage.
 * Day and night shifts on the same date cannot both be worked by the same guard
 * while satisfying SA rest rules, so minimum daily headcount is day + night.
 */
export function minRosterableGuardsForStaffing(staffing: { day: number; night: number }): number {
  return staffing.day + staffing.night;
}
