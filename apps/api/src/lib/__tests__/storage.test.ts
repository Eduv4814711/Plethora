import { describe, expect, it } from "vitest";
import { normalizeStorageKey, storage } from "../storage.js";

describe("normalizeStorageKey", () => {
  it("normalizes internal upload keys", () => {
    expect(normalizeStorageKey("/documents/company-1/file.pdf")).toBe(
      "documents/company-1/file.pdf"
    );
    expect(normalizeStorageKey("documents\\company-1\\file.pdf")).toBe(
      "documents/company-1/file.pdf"
    );
  });

  it.each([
    "",
    "../secret",
    "documents/../../secret",
    "documents//file.pdf",
    "documents/./file.pdf",
    "documents/C:/secret",
  ])("rejects unsafe key %s", (key) => {
    expect(() => normalizeStorageKey(key)).toThrow("INVALID_STORAGE_KEY");
  });
});

describe("storage.resolveKeyFromUrl", () => {
  it("resolves local upload URLs", () => {
    expect(storage.resolveKeyFromUrl("/uploads/tasks/company-1/file.pdf")).toBe(
      "tasks/company-1/file.pdf"
    );
  });

  it("rejects external and path-traversal URLs", () => {
    expect(storage.resolveKeyFromUrl("https://example.com/file.pdf")).toBeNull();
    expect(storage.resolveKeyFromUrl("/uploads/../../secret")).toBeNull();
  });
});
