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
 * Day (06:00–18:00) and night (18:00–06:00) do not overlap, so the same pool
 * can cover both when each guard works at most one shift per type per day.
 */
export function minRosterableGuardsForStaffing(staffing: { day: number; night: number }): number {
  return Math.max(staffing.day, staffing.night);
}
