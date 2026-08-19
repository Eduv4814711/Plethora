import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDocument } from "../msr-api";

/**
 * The upload route reads the multipart metadata as soon as the file part is
 * available. Parts are parsed in order, so metadata sent after the file is not
 * there yet and the request is rejected as invalid. A small file hides the bug —
 * the whole payload arrives in one chunk — so this guards the order directly
 * rather than trying to reproduce it with a large fixture.
 */
describe("uploadDocument multipart ordering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function captureForm() {
    // Typed with fetch's own signature so the recorded call keeps its `init`
    // argument — a bare `vi.fn(async () => …)` records calls as `[]`.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "doc_1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends every metadata field before the file part", async () => {
    const fetchMock = captureForm();
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "contract.pdf", {
      type: "application/pdf",
    });

    await uploadDocument("test-token", file, {
      title: "contract",
      documentType: "Team member document",
      category: "EMPLOYEE",
      employeeId: "emp_1",
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const keys = [...body.keys()];

    expect(keys[keys.length - 1]).toBe("file");
    expect(keys.indexOf("file")).toBe(keys.length - 1);
    for (const field of ["title", "documentType", "category", "employeeId"]) {
      expect(keys.indexOf(field)).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf(field)).toBeLessThan(keys.indexOf("file"));
    }
  });

  it("omits empty metadata rather than sending blank fields", async () => {
    const fetchMock = captureForm();
    const file = new File([new Uint8Array([0x25])], "x.pdf", { type: "application/pdf" });

    await uploadDocument("test-token", file, {
      title: "x",
      documentType: "Team member document",
      category: "EMPLOYEE",
      employeeId: "",
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect([...body.keys()]).not.toContain("employeeId");
  });
});
