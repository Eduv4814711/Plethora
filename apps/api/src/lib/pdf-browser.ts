/**
 * Launches a browser for HTML→PDF: puppeteer-core + PUPPETEER_EXECUTABLE_PATH,
 * or bundled puppeteer when installed.
 */
export async function launchPdfBrowser() {
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (exe) {
    const { default: puppeteer } = await import("puppeteer-core");
    return puppeteer.launch({
      executablePath: exe,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  try {
    const { default: puppeteer } = await import("puppeteer");
    return await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (e) {
    throw new Error(
      'PDF generation needs "puppeteer" (default) or set PUPPETEER_EXECUTABLE_PATH to Chrome/Chromium for puppeteer-core.',
      { cause: e }
    );
  }
}
