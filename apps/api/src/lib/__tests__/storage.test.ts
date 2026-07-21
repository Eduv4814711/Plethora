import { describe, expect, it, vi } from "vitest";
import { normalizeStorageKey, persistWithUploadedFileRollback, storage } from "../storage.js";

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

describe("persistWithUploadedFileRollback", () => {
  it("deletes an uploaded file and preserves the database error when persistence fails", async () => {
    const databaseError = new Error("transaction failed");
    const deleteFile = vi.fn(async () => undefined);

    await expect(persistWithUploadedFileRollback(
      "leave-private/company-1/application-1/document.pdf",
      async () => { throw databaseError; },
      { deleteFile }
    )).rejects.toBe(databaseError);

    expect(deleteFile).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledWith("leave-private/company-1/application-1/document.pdf");
  });

  it("reports cleanup failure without masking the database error", async () => {
    const databaseError = new Error("transaction failed");
    const cleanupError = new Error("cleanup failed");
    const onCleanupError = vi.fn();

    await expect(persistWithUploadedFileRollback(
      "leave-private/company-1/application-1/document.pdf",
      async () => { throw databaseError; },
      { deleteFile: async () => { throw cleanupError; }, onCleanupError }
    )).rejects.toBe(databaseError);

    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it("does not delete the file when persistence succeeds", async () => {
    const deleteFile = vi.fn(async () => undefined);

    await expect(persistWithUploadedFileRollback(
      "leave-private/company-1/application-1/document.pdf",
      async () => ({ id: "document-1" }),
      { deleteFile }
    )).resolves.toEqual({ id: "document-1" });

    expect(deleteFile).not.toHaveBeenCalled();
  });
});
