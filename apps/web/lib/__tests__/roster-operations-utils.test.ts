import { describe, expect, it } from "vitest";
import type { RosterContinuityOverviewSite } from "../roster-api";
import { filterRosterOperationsSites, rosterSiteActionLabel } from "../roster-operations-utils";

function site(
  siteId: string,
  siteName: string,
  state: RosterContinuityOverviewSite["state"],
  issueCount = 0
): RosterContinuityOverviewSite {
  return {
    siteId,
    siteName,
    state,
    issueCount,
    criticalIssueCount: 0,
    guardCount: 2,
    maintainedThrough: null,
    lastReconciledAt: null,
    lastStatus: null,
    activePatternName: null,
    calendar: { id: "pay-aligned", name: "Pay period aligned", startDay: 26, endDay: 25 },
    nextIssue: null,
  };
}

describe("rostering operations helpers", () => {
  const sites = [
    site("1", "Control Room", "running"),
    site("2", "Access Control", "needs_attention", 2),
    site("3", "West Gate", "paused"),
  ];

  it("filters sites by status and case-insensitive search", () => {
    expect(filterRosterOperationsSites(sites, "needs_attention", "ACCESS").map((item) => item.siteId)).toEqual(["2"]);
    expect(filterRosterOperationsSites(sites, "all", "control").map((item) => item.siteId)).toEqual(["1", "2"]);
  });

  it("uses one contextual action per state", () => {
    expect(rosterSiteActionLabel(sites[0]!)).toBe("Open roster");
    expect(rosterSiteActionLabel(sites[1]!)).toBe("Review 2 issues");
    expect(rosterSiteActionLabel(site("4", "New", "not_setup"))).toBe("Set up roster");
  });
});
