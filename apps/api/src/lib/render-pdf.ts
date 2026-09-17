import { readFileSync } from "fs";
import { launchPdfBrowser } from "./pdf-browser.js";
import { templatePath } from "./template-dir.js";

export interface RenderPdfOptions {
  landscape?: boolean;
  margin?: { top: string; right: string; bottom: string; left: string };
}

export interface RenderPdfJob {
  templateFile: string;
  globalName: string;
  data: unknown;
  options?: RenderPdfOptions;
}

const DEFAULT_MARGIN = { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" };

function buildHtml(job: RenderPdfJob): string {
  const html = readFileSync(templatePath(job.templateFile), "utf-8");
  const dataScript = `<script>window.${job.globalName} = ${JSON.stringify(job.data).replace(/</g, "\\u003c")};</script>`;
  return html.replace("</head>", `${dataScript}</head>`);
}

async function renderInBrowser(
  browser: Awaited<ReturnType<typeof launchPdfBrowser>>,
  job: RenderPdfJob
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(job), { waitUntil: "load", timeout: 10000 });
    // Best-effort wait for any logo images to settle without hanging:
    try {
      await page.waitForNetworkIdle({ idleTime: 100, timeout: 1500 });
    } catch {
      // Continue even if network idle times out (e.g. offline dev or blocked external font/logo)
    }
    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: job.options?.landscape ?? false,
      printBackground: true,
      margin: job.options?.margin ?? DEFAULT_MARGIN,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Renders a template with its data injected on `window[globalName]`. */
export async function renderPdf(
  templateFile: string,
  globalName: string,
  data: unknown,
  options?: RenderPdfOptions
): Promise<Buffer> {
  let browser: Awaited<ReturnType<typeof launchPdfBrowser>> | null = null;
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PDF generation timed out after 25 seconds")), 25_000);
    timer.unref?.();
  });

  const renderWork = async (): Promise<Buffer> => {
    browser = await launchPdfBrowser();
    return await renderInBrowser(browser, { templateFile, globalName, data, options });
  };

  try {
    return await Promise.race([renderWork(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (browser) {
      await (browser as { close: () => Promise<void> }).close().catch(() => {});
    }
  }
}

/**
 * Renders several documents through a single browser. A month-end pack is 2N+1 documents;
 * launching Chromium per document costs seconds and hundreds of MB each.
 */
export async function renderPdfBatch(jobs: RenderPdfJob[]): Promise<Buffer[]> {
  if (jobs.length === 0) return [];
  const browser = await launchPdfBrowser();
  try {
    const results: Buffer[] = [];
    for (const job of jobs) {
      results.push(await renderInBrowser(browser, job));
    }
    return results;
  } finally {
    await browser.close();
  }
}
