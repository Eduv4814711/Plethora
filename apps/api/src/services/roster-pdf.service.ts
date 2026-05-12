import { readFileSync } from "fs";
import { launchPdfBrowser } from "../lib/pdf-browser.js";
import { templatePath } from "../lib/template-dir.js";

const TEMPLATE_PATH = templatePath("roster.html");

export interface RosterPdfShiftRow {
  dateLine: string;
  timeRange: string;
  site: string;
  post: string;
}

export interface RosterPdfData {
  companyName?: string;
  employeeName: string;
  generatedAtLabel: string;
  timeZoneLabel: string;
  shifts: RosterPdfShiftRow[];
}

/**
 * A4 PDF roster for WhatsApp: large typography and card layout for mobile viewers.
 */
export async function generateRosterPDF(data: RosterPdfData): Promise<Buffer> {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const dataScript = `<script>window.__ROSTER_DATA__ = ${JSON.stringify(data)};</script>`;
  const fullHtml = html.replace("</head>", `${dataScript}</head>`);

  const browser = await launchPdfBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, {
      waitUntil: "networkidle0",
      timeout: 10000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "14mm", bottom: "14mm", left: "14mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
