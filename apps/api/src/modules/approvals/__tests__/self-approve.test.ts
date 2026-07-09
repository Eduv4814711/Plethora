import { describe, expect, it } from "vitest";
import { canSelfApprove } from "../approvals.service.js";

describe("approval self-approve guard", () => {
  it("blocks same user approving their own request", () => {
    expect(canSelfApprove("user_a", "user_a")).toBe(true);
  });

  it("allows a different reviewer", () => {
    expect(canSelfApprove("user_a", "user_b")).toBe(false);
  });
});
