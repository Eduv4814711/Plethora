import { describe, expect, it, vi } from "vitest";
import {
  AccessStaleError,
  apiErrorFromResponse,
  registerAccessStaleCallback,
} from "../api";

describe("AccessStaleError", () => {
  it("exposes ACCESS_STALE code", () => {
    const err = new AccessStaleError();
    expect(err.code).toBe("ACCESS_STALE");
    expect(err.message).toMatch(/sign in again/i);
  });
});

describe("apiErrorFromResponse", () => {
  it("maps ACCESS_STALE responses", async () => {
    const cb = vi.fn();
    registerAccessStaleCallback(cb);
    const res = new Response(JSON.stringify({ code: "ACCESS_STALE", message: "stale" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    const err = await apiErrorFromResponse(res);
    expect(err).toBeInstanceOf(AccessStaleError);
    expect((err as AccessStaleError).code).toBe("ACCESS_STALE");
    expect(cb).toHaveBeenCalled();
    registerAccessStaleCallback(null);
  });
});
