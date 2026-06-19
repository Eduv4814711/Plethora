/** Default site rules when there is no shift gender selection and no extra rules text. */
export const DEFAULT_ROSTER_SITE_RULES_LINES = [
  "Minimum staffing and gender mix apply per contract.",
  "Report replacements and absences to the control room immediately.",
] as const;

export type RosterShiftGender = "male" | "female" | "any";

function normalizeShiftGender(v: string | null | undefined): RosterShiftGender | null {
  if (v == null || v === "") return null;
  const s = String(v).toLowerCase();
  if (s === "male" || s === "female" || s === "any") return s;
  return null;
}

function lineForShift(shiftLabel: "Day" | "Night", g: RosterShiftGender): string {
  if (g === "male") return `${shiftLabel} shift: Male guards only.`;
  if (g === "female") return `${shiftLabel} shift: Female guards only.`;
  return `${shiftLabel} shift: No gender restriction.`;
}

/**
 * Lines shown under “Site rules” on the shift sheet and PDF: shift gender lines first, then custom text lines.
 * Falls back to defaults only when nothing is configured.
 */
function clampStaffing(n: number | null | undefined): number {
  if (n == null) return 1;
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(50, Math.max(0, v));
}

export function rosterSiteRulesLines(
  rosterSiteRules: string | null | undefined,
  rosterDayShiftGender?: string | null,
  rosterNightShiftGender?: string | null,
  staffing?: {
    rosterDayShiftGuardsRequired?: number | null;
    rosterNightShiftGuardsRequired?: number | null;
  }
): string[] {
  const fromShifts: string[] = [];
  const day = normalizeShiftGender(rosterDayShiftGender);
  const night = normalizeShiftGender(rosterNightShiftGender);
  if (day) fromShifts.push(lineForShift("Day", day));
  if (night) fromShifts.push(lineForShift("Night", night));

  const dayGuards = clampStaffing(staffing?.rosterDayShiftGuardsRequired);
  const nightGuards = clampStaffing(staffing?.rosterNightShiftGuardsRequired);
  fromShifts.push(`Day shift: ${dayGuards} guard(s) required per day.`);
  fromShifts.push(`Night shift: ${nightGuards} guard(s) required per day.`);

  const custom = rosterSiteRules?.trim()
    ? rosterSiteRules
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  const combined = [...fromShifts, ...custom];
  if (combined.length === 0) return [...DEFAULT_ROSTER_SITE_RULES_LINES];
  return combined;
}
