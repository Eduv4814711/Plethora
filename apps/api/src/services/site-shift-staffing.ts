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
