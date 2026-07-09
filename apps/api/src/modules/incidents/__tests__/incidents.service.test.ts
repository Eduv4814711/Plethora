import { describe, expect, it } from "vitest";
import { severityToAlertPriority } from "../incidents.service.js";

describe("incidents service helpers", () => {
  it("maps incident severity to alert priority", () => {
    expect(severityToAlertPriority("CRITICAL")).toBe("CRITICAL");
    expect(severityToAlertPriority("HIGH")).toBe("MEDIUM");
    expect(severityToAlertPriority("MEDIUM")).toBe("LOW");
    expect(severityToAlertPriority("LOW")).toBe("LOW");
  });
});
