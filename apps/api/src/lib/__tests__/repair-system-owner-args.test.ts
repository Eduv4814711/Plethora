import { describe, expect, it } from "vitest";
import { parseRepairArgs, usage } from "../../../scripts/repair-system-owner-access.js";

describe("repair-system-owner-access CLI parsing", () => {
  it("parses company + user-id and dry-run", () => {
    const args = parseRepairArgs([
      "--company-id",
      "co-1",
      "--user-id",
      "u-1",
      "--dry-run",
    ]);
    expect(args).toEqual({
      companyId: "co-1",
      userId: "u-1",
      email: null,
      dryRun: true,
      help: false,
    });
  });

  it("parses company + email", () => {
    const args = parseRepairArgs(["--company-id", "co-1", "--email", "Owner@Example.com"]);
    expect(args.companyId).toBe("co-1");
    expect(args.email).toBe("Owner@Example.com");
    expect(args.userId).toBeNull();
    expect(args.dryRun).toBe(false);
  });

  it("rejects unknown flags", () => {
    expect(() => parseRepairArgs(["--auto"])).toThrow(/Unknown argument/);
  });

  it("usage mentions required company and target", () => {
    const text = usage();
    expect(text).toMatch(/--company-id/);
    expect(text).toMatch(/--user-id/);
    expect(text).toMatch(/--email/);
  });
});
