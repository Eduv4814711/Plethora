/**
 * Launches a browser for HTML→PDF. On Vercel uses @sparticuz/chromium + puppeteer-core.
 * Elsewhere: puppeteer (bundled Chromium) when installed, else puppeteer-core + PUPPETEER_EXECUTABLE_PATH.
 */
export async function launchPdfBrowser() {
  if (process.env.VERCEL === "1") {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

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
