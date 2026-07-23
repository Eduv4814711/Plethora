import { describe, expect, it } from "vitest";
import { canViewSensitiveCompanyFields } from "../authorization.js";
import {
  findUnassignableCapability,
  hasCapability,
  normalizeCapabilities,
  validateCapabilities,
} from "../../lib/capabilities.js";

const user = (capabilities: unknown = {}, isOwner = false) => ({
  isOwner,
  isActive: true,
  capabilities,
});

describe("capability normalization and validation", () => {
  it("rejects unknown paths and unsupported actions", () => {
    expect(validateCapabilities({ "/unknown": ["view"] }).success).toBe(false);
    expect(validateCapabilities({ "/reports": ["delete"] }).success).toBe(false);
  });

  it("deduplicates valid capabilities", () => {
    expect(normalizeCapabilities({ "/employees": ["view", "view", "edit", "bad"] })).toEqual({
      "/employees": ["view", "edit"],
    });
  });

  it("uses the most-specific assignment and does not imply view from edit", () => {
    const subject = user({
      "/employees": ["view", "edit"],
      "/employees/leave": ["view"],
    });
    expect(hasCapability(subject, "/employees/leave/requests", "view")).toBe(true);
    expect(hasCapability(subject, "/employees/leave/requests", "edit")).toBe(false);
    expect(hasCapability(user({ "/sites": ["edit"] }), "/sites", "view")).toBe(false);
  });

  it("prevents access managers from assigning capabilities beyond their own extent", () => {
    const manager = user({
      "/settings/access": ["view", "create", "edit", "manage_access"],
      "/employees": ["view", "edit"],
    });
    expect(findUnassignableCapability(manager, {
      "/employees": ["view", "edit"],
    })).toBeNull();
    expect(findUnassignableCapability(manager, {
      "/payroll": ["view"],
    })).toEqual({ path: "/payroll", capability: "view" });
    expect(findUnassignableCapability(manager, {
      "/settings/access": ["manage_access"],
    })).toEqual({ path: "/settings/access", capability: "manage_access" });
    expect(findUnassignableCapability(user({}, true), {
      "/payroll": ["approve"],
    })).toBeNull();
  });
});

describe("sensitive company fields", () => {
  it("allows the owner or an explicitly authorized module user", () => {
    expect(canViewSensitiveCompanyFields(user({}, true) as never)).toBe(true);
    expect(canViewSensitiveCompanyFields(user({ "/settings": ["edit"] }) as never)).toBe(true);
    expect(canViewSensitiveCompanyFields(user({ "/payroll": ["view_sensitive"] }) as never)).toBe(true);
  });

  it("denies unrelated and inactive users", () => {
    expect(canViewSensitiveCompanyFields(user({ "/attendance": ["view"] }) as never)).toBe(false);
    expect(canViewSensitiveCompanyFields({ ...user({}, true), isActive: false } as never)).toBe(false);
  });
});
