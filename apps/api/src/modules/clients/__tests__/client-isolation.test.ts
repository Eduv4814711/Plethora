import { describe, expect, it } from "vitest";
import {
  clientOwnsSite,
  isFullAdminUser,
} from "../clients.routes.js";
import { contractExpiryPriority } from "../../documents/documents.service.js";

describe("client portal isolation", () => {
  it("allows only matching client site", () => {
    expect(clientOwnsSite("c1", "c1")).toBe(true);
    expect(clientOwnsSite("c1", "c2")).toBe(false);
    expect(clientOwnsSite("c1", null)).toBe(false);
  });
});

describe("isFullAdminUser", () => {
  it("treats admin without moduleAccess as full admin", () => {
    expect(isFullAdminUser({ role: "admin", moduleAccess: null })).toBe(true);
    expect(isFullAdminUser({ role: "admin", moduleAccess: undefined })).toBe(true);
  });

  it("rejects scoped admins with module lists", () => {
    expect(isFullAdminUser({ role: "admin", moduleAccess: ["/sites"] })).toBe(false);
  });

  it("rejects non-admin roles", () => {
    expect(isFullAdminUser({ role: "operations_manager", moduleAccess: ["/sites"] })).toBe(false);
  });
});

describe("contract expiry priority", () => {
  it("maps day thresholds to alert priorities", () => {
    expect(contractExpiryPriority(5)).toBe("CRITICAL");
    expect(contractExpiryPriority(20)).toBe("MEDIUM");
    expect(contractExpiryPriority(45)).toBe("LOW");
    expect(contractExpiryPriority(90)).toBe(null);
    expect(contractExpiryPriority(-1)).toBe("CRITICAL");
  });
});
