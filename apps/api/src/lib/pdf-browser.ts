import fs from "node:fs";

/**
 * Common Chromium / Chrome binary paths across Linux distributions, macOS, and Windows.
 */
const KNOWN_EXECUTABLE_PATHS = [
  // Linux (Debian, Ubuntu, Alpine, Arch, Nix, etc.)
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/lib/chromium/chromium",
  "/usr/lib/chromium-browser/chromium-browser",
  "/snap/bin/chromium",
  "/nix/var/nix/profiles/default/bin/chromium",
  // Windows
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

// /dev/shm is tiny in most containers; without this Chromium crashes on larger documents.
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
];

/**
 * Launches a browser for HTML→PDF conversion with resilient fallback:
 * 1. Checks PUPPETEER_EXECUTABLE_PATH if configured and exists on disk.
 * 2. Tries standard puppeteer default launch (bundled browser in ~/.cache/puppeteer).
 * 3. Tries resolving executable via puppeteer.executablePath().
 * 4. Tries auto-discovering from known system binary paths.
 */
export async function launchPdfBrowser() {
  const envExe = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  // 1. If explicit env var is set and valid, try it first
  if (envExe) {
    if (fs.existsSync(envExe)) {
      try {
        const { default: puppeteerCore } = await import("puppeteer-core");
        return await puppeteerCore.launch({
          executablePath: envExe,
          headless: true,
          args: LAUNCH_ARGS,
        });
      } catch (err) {
        console.warn(
          `[pdf-browser] Failed to launch browser at PUPPETEER_EXECUTABLE_PATH (${envExe}):`,
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.warn(
        `[pdf-browser] Configured PUPPETEER_EXECUTABLE_PATH (${envExe}) does not exist on disk. Attempting auto-discovery...`
      );
    }
  }

  // 2. Try default puppeteer launch (bundled browser in ~/.cache/puppeteer)
  try {
    const { default: puppeteer } = await import("puppeteer");
    return await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
  } catch {
    // Continue to fallback strategies
  }

  // 3. Try resolving path from puppeteer.executablePath()
  try {
    const { default: puppeteer } = await import("puppeteer");
    let resolvedPath: string | undefined;
    if (typeof puppeteer.executablePath === "function") {
      const p = (puppeteer.executablePath as () => string | Promise<string>)();
      resolvedPath = typeof (p as any)?.then === "function" ? await p : (p as string);
    }
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return await puppeteer.launch({
        executablePath: resolvedPath,
        headless: true,
        args: LAUNCH_ARGS,
      });
    }
  } catch {
    // Continue to system path search
  }

  // 4. Try auto-discovering from known system paths
  for (const candidatePath of KNOWN_EXECUTABLE_PATHS) {
    if (fs.existsSync(candidatePath)) {
      try {
        const { default: puppeteerCore } = await import("puppeteer-core");
        return await puppeteerCore.launch({
          executablePath: candidatePath,
          headless: true,
          args: LAUNCH_ARGS,
        });
      } catch {
        // Try next candidate
      }
    }
  }

  throw new Error(
    "Could not find or launch a Chromium/Chrome browser for PDF generation. " +
    "Ensure 'chromium' is installed in the deployment environment or set PUPPETEER_EXECUTABLE_PATH to a valid browser binary."
  );
}
