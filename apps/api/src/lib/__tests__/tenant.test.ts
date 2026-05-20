import { describe, expect, it } from "vitest";
import { companyScopedWhere } from "../tenant.js";

describe("companyScopedWhere", () => {
  it("scopes by company and id", () => {
    expect(companyScopedWhere("co1", "emp1")).toEqual({ id: "emp1", companyId: "co1" });
  });
});
