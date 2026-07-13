import { describe, expect, it } from "vitest";
import { createDownloadSignature, createSignedDownloadPath, verifySignedDownload } from "../signed-url.js";

describe("signed download URLs", () => {
  it("creates and verifies a valid signature", () => {
    const { path, expiresAt } = createSignedDownloadPath("documents/c1/file.pdf", 60);
    expect(path).toContain("/documents/download?");
    expect(path).toContain("key=documents%2Fc1%2Ffile.pdf");
    expect(verifySignedDownload("documents/c1/file.pdf", String(expiresAt), createDownloadSignature("documents/c1/file.pdf", expiresAt))).toBe(true);
  });

  it("rejects expired or tampered signatures", () => {
    const expired = Math.floor(Date.now() / 1000) - 10;
    const sig = createDownloadSignature("documents/c1/file.pdf", expired);
    expect(verifySignedDownload("documents/c1/file.pdf", String(expired), sig)).toBe(false);
    expect(verifySignedDownload("documents/c1/file.pdf", String(expired + 1000), sig)).toBe(false);
  });
});
