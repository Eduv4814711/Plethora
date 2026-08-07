import { describe, expect, it } from "vitest";
import { suggestNextObNumber } from "../site-timesheet-utils";

describe("suggestNextObNumber", () => {
  it("increments a plain number", () => {
    expect(suggestNextObNumber("1042")).toBe("1043");
  });

  it("keeps a prefix", () => {
    expect(suggestNextObNumber("OB-1042")).toBe("OB-1043");
    expect(suggestNextObNumber("OB 7")).toBe("OB 8");
  });

  it("preserves zero padding", () => {
    expect(suggestNextObNumber("0099")).toBe("0100");
    expect(suggestNextObNumber("OB-0007")).toBe("OB-0008");
  });

  it("does not truncate when the number outgrows its padding", () => {
    expect(suggestNextObNumber("099")).toBe("100");
    expect(suggestNextObNumber("9")).toBe("10");
  });

  it("trims surrounding whitespace", () => {
    expect(suggestNextObNumber("  1042  ")).toBe("1043");
  });

  it("returns null when there is nothing to advance", () => {
    expect(suggestNextObNumber(null)).toBeNull();
    expect(suggestNextObNumber(undefined)).toBeNull();
    expect(suggestNextObNumber("")).toBeNull();
    expect(suggestNextObNumber("   ")).toBeNull();
    expect(suggestNextObNumber("OB-A")).toBeNull();
    expect(suggestNextObNumber("night shift")).toBeNull();
  });
});
