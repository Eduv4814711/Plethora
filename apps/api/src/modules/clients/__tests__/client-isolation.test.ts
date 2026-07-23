import { describe, expect, it } from "vitest";
import {
  clientOwnsSite,
} from "../clients.routes.js";
import { contractExpiryPriority } from "../../documents/documents.service.js";

describe("client portal isolation", () => {
  it("allows only matching client site", () => {
    expect(clientOwnsSite("c1", "c1")).toBe(true);
    expect(clientOwnsSite("c1", "c2")).toBe(false);
    expect(clientOwnsSite("c1", null)).toBe(false);
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
