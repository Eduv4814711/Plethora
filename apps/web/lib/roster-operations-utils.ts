import type {
  RosterContinuityOverviewSite,
  RosterContinuityState,
} from "./roster-api";

export type RosterStatusFilter = "all" | RosterContinuityState;

export function filterRosterOperationsSites(
  sites: RosterContinuityOverviewSite[],
  filter: RosterStatusFilter,
  query: string
): RosterContinuityOverviewSite[] {
  const normalized = query.trim().toLocaleLowerCase();
  return sites.filter((site) => {
    if (filter !== "all" && site.state !== filter) return false;
    return !normalized || site.siteName.toLocaleLowerCase().includes(normalized);
  });
}

export function rosterSiteActionLabel(site: Pick<RosterContinuityOverviewSite, "state" | "issueCount">): string {
  if (site.state === "needs_attention") {
    return `Review ${site.issueCount} issue${site.issueCount === 1 ? "" : "s"}`;
  }
  if (site.state === "not_setup") return "Set up roster";
  if (site.state === "paused") return "Review paused roster";
  return "Open roster";
}
