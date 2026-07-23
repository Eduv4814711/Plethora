import { describe, expect, it } from "vitest";
import { matchesMagicBytes, sanitizeUploadFilename } from "../upload-validation.js";

describe("matchesMagicBytes", () => {
  it("requires the complete signature for safe image and PDF uploads", () => {
    expect(
      matchesMagicBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png"
      )
    ).toBe(true);
    expect(matchesMagicBytes(Buffer.from("RIFFnot-a-webp"), "image/webp")).toBe(false);
    expect(matchesMagicBytes(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(matchesMagicBytes(Buffer.from("<html>"), "application/pdf")).toBe(false);
  });

  it("distinguishes Word and Excel OOXML archive roots", () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const word = Buffer.concat([
      zipHeader,
      Buffer.from("[Content_Types].xml\u0000word/document.xml", "latin1"),
    ]);
    expect(
      matchesMagicBytes(
        word,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(true);
    expect(
      matchesMagicBytes(
        word,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(false);
  });

  it("rejects active content and binary files declared as text", () => {
    expect(matchesMagicBytes(Buffer.from("<svg></svg>"), "image/svg+xml")).toBe(false);
    expect(matchesMagicBytes(Buffer.from([0x00, 0x01, 0x02]), "text/plain")).toBe(false);
    expect(matchesMagicBytes(Buffer.from("name,value\none,1\n"), "text/csv")).toBe(true);
  });
});

describe("sanitizeUploadFilename", () => {
  it("removes path/control characters and forces the validated MIME extension", () => {
    expect(sanitizeUploadFilename("../payroll\u0000.exe", "application/pdf")).toBe(
      "payroll_.pdf"
    );
    expect(sanitizeUploadFilename("evidence.jpeg", "image/png")).toBe("evidence.png");
  });
});
