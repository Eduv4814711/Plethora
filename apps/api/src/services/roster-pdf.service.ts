import { readFileSync } from "fs";
import { join } from "path";
import { cwd } from "process";

const TEMPLATE_PATH = join(cwd(), "src", "templates", "roster.html");

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

  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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
