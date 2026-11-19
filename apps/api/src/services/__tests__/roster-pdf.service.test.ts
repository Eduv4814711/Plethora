import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateRosterPDF } from "../roster-pdf.service.js";

describe("roster-pdf.service", () => {
  it("renders a valid multi-shift PDF buffer without Chromium", async () => {
    const buffer = await generateRosterPDF({
      companyName: "Plethora Security Services",
      employeeName: "Sipho Dlamini",
      generatedAtLabel: "2026-11-19 10:00",
      timeZoneLabel: "Africa/Johannesburg",
      shifts: [
        {
          dateLine: "Thu, 19 Nov 2026",
          timeRange: "06:00 - 18:00",
          site: "Sandton City Mall",
          post: "Main Gate",
        },
        {
          dateLine: "Fri, 20 Nov 2026",
          timeRange: "18:00 - 06:00",
          site: "Melrose Arch",
          post: "Control Room",
        },
      ],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(200);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders a valid PDF buffer when the guard has no upcoming shifts", async () => {
    const buffer = await generateRosterPDF({
      employeeName: "Thabo Mokoena",
      generatedAtLabel: "2026-11-19 10:00",
      timeZoneLabel: "UTC",
      shifts: [],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBe(1);
  });
});
