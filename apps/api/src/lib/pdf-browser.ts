/**
 * Launches a browser for HTML→PDF: puppeteer-core + PUPPETEER_EXECUTABLE_PATH,
 * or bundled puppeteer when installed.
 */
// /dev/shm is tiny in most containers; without this Chromium crashes on larger documents.
const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

export async function launchPdfBrowser() {
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (exe) {
    const { default: puppeteer } = await import("puppeteer-core");
    return puppeteer.launch({
      executablePath: exe,
      headless: true,
      args: LAUNCH_ARGS,
    });
  }

  try {
    const { default: puppeteer } = await import("puppeteer");
    return await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
  } catch (e) {
    throw new Error(
      'PDF generation needs "puppeteer" (default) or set PUPPETEER_EXECUTABLE_PATH to Chrome/Chromium for puppeteer-core.',
      { cause: e }
    );
  }
}
