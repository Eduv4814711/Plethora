import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../exceptions.service.js", () => ({
  detectAndPersistExceptions: vi.fn(),
}));

import { detectAndPersistExceptions } from "../exceptions.service.js";
import { triggerPostClockExceptionSync } from "../post-clock-sync.js";

describe("triggerPostClockExceptionSync", () => {
  beforeEach(() => {
    vi.mocked(detectAndPersistExceptions).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log when the sync succeeds", async () => {
    vi.mocked(detectAndPersistExceptions).mockResolvedValue(undefined as never);

    triggerPostClockExceptionSync("company-1", "site-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(detectAndPersistExceptions).toHaveBeenCalledWith({
      companyId: "company-1",
      siteId: "site-1",
      lookbackHours: 24,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs the failure instead of swallowing it silently", async () => {
    const failure = new Error("boom");
    vi.mocked(detectAndPersistExceptions).mockRejectedValue(failure);

    triggerPostClockExceptionSync("company-1", "site-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(console.error).toHaveBeenCalledWith(
      "[AttendanceExceptions] Post-clock exception sync failed:",
      { companyId: "company-1", siteId: "site-1" },
      failure
    );
  });
});
