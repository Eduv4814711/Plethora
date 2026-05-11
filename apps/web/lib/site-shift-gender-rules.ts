/** Mirrors API `rostering.service` shift staffing rules for client-side UX. */

export function normalizeEmployeeGenderForRoster(g: string | null | undefined): "male" | "female" | null {
  const raw = (g ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "m" || raw === "male") return "male";
  if (raw === "f" || raw === "female") return "female";
  return null;
}

function normalizeSiteShiftGenderRule(v: string | null | undefined): "male" | "female" | "any" | null {
  if (v == null || v === "") return null;
  const s = String(v).toLowerCase();
  if (s === "male" || s === "female" || s === "any") return s;
  return null;
}

export function meetsSiteShiftGenderRule(
  employeeGender: string | null | undefined,
  site: { rosterDayShiftGender?: string | null; rosterNightShiftGender?: string | null },
  postShiftType: string | null | undefined
): boolean {
  const kind = (postShiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
  const ruleRaw = kind === "night" ? site.rosterNightShiftGender : site.rosterDayShiftGender;
  const rule = normalizeSiteShiftGenderRule(ruleRaw);
  if (rule == null || rule === "any") return true;
  const emp = normalizeEmployeeGenderForRoster(employeeGender);
  if (emp === null) return false;
  return emp === rule;
}

/** For site-wide dual patterns (day + night blocks), the guard must satisfy both shift rules. */
export function meetsSiteDualShiftRosterRules(
  employeeGender: string | null | undefined,
  site: { rosterDayShiftGender?: string | null; rosterNightShiftGender?: string | null }
): boolean {
  return (
    meetsSiteShiftGenderRule(employeeGender, site, "day") &&
    meetsSiteShiftGenderRule(employeeGender, site, "night")
  );
}

export function siteHasRestrictiveShiftGenderRules(site: {
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
}): boolean {
  const d = normalizeSiteShiftGenderRule(site.rosterDayShiftGender);
  const n = normalizeSiteShiftGenderRule(site.rosterNightShiftGender);
  return d === "male" || d === "female" || n === "male" || n === "female";
}
