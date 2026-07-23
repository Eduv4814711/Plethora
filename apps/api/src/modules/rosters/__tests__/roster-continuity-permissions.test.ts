import { describe, expect, it } from "vitest";
import { rosterActionPermissions } from "../roster-continuity.service.js";

const user = (capabilities: unknown = {}, isOwner = false) => ({
  sub: "u",
  email: "u@test.com",
  companyId: "c",
  name: "User",
  accountType: "staff" as const,
  jobTitle: null,
  isActive: true,
  isOwner,
  capabilities: capabilities as never,
});

describe("rosterActionPermissions", () => {
  it("keeps recurring edits and exception approval independent", () => {
    expect(rosterActionPermissions(user({ "/rostering": ["edit", "approve"] }))).toEqual({
      canManageBaseline: true,
      canManageExceptions: true,
      canUseAdvancedEditor: true,
    });
  });

  it("allows approve-only users to resolve daily exceptions", () => {
    expect(rosterActionPermissions(user({ "/rostering": ["approve"] }))).toEqual({
      canManageBaseline: false,
      canManageExceptions: true,
      canUseAdvancedEditor: false,
    });
  });

  it("keeps view-only users non-mutating and allows the owner", () => {
    expect(rosterActionPermissions(user({ "/rostering": ["view"] }))).toEqual({
      canManageBaseline: false,
      canManageExceptions: false,
      canUseAdvancedEditor: false,
    });
    expect(rosterActionPermissions(user({}, true)).canManageBaseline).toBe(true);
  });
});
