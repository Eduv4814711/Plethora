/** Clamp site staffing fields to valid roster engine range (1–50 per shift). */
export function resolveSiteShiftStaffing(site: {
  rosterDayShiftGuardsRequired?: number | null;
  rosterNightShiftGuardsRequired?: number | null;
}): { day: number; night: number } {
  const clamp = (n: number | null | undefined) =>
    Math.min(50, Math.max(1, Math.floor(Number(n) || 1)));

  return {
    day: clamp(site.rosterDayShiftGuardsRequired),
    night: clamp(site.rosterNightShiftGuardsRequired),
  };
}

/**
 * Minimum rosterable guards for simultaneous day + night coverage.
 * Day (06:00–18:00) and night (18:00–06:00) do not overlap, so the same pool
 * can cover both when each guard works at most one shift per type per day.
 */
export function minRosterableGuardsForStaffing(staffing: { day: number; night: number }): number {
  return Math.max(staffing.day, staffing.night);
}
