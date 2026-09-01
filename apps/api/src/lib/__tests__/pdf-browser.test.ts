import { describe, expect, it } from "vitest";
import { launchPdfBrowser } from "../pdf-browser.js";

describe("pdf-browser", () => {
  it("launches a browser and closes cleanly", async () => {
    const browser = await launchPdfBrowser();
    expect(browser).toBeDefined();
    expect(typeof browser.newPage).toBe("function");
    await browser.close();
  });

  it("gracefully falls back when PUPPETEER_EXECUTABLE_PATH points to a non-existent path", async () => {
    const originalEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
    try {
      process.env.PUPPETEER_EXECUTABLE_PATH = "/non/existent/path/to/chromium";
      const browser = await launchPdfBrowser();
      expect(browser).toBeDefined();
      await browser.close();
    } finally {
      if (originalEnv !== undefined) {
        process.env.PUPPETEER_EXECUTABLE_PATH = originalEnv;
      } else {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      }
    }
  });
});

