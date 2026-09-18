import { describe, expect, it } from "vitest";
import { jsonInit } from "../billing-api";

describe("billing-api jsonInit", () => {
  it("omits Content-Type header and body when body is undefined", () => {
    const init = jsonInit("POST");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("omits Content-Type header and body for DELETE without body", () => {
    const init = jsonInit("DELETE");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("includes serialized body and Content-Type when body is provided", () => {
    const payload = { reason: "Budget exceeded" };
    const init = jsonInit("POST", payload);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("serializes empty object body if explicitly passed", () => {
    const init = jsonInit("POST", {});
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});
