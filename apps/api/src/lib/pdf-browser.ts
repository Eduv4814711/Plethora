import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function findBinaryInDir(dir: string, depth = 0): string | null {
  if (depth > 6 || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findBinaryInDir(full, depth + 1);
        if (found) return found;
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (
          lower === "chrome" ||
          lower === "chromium" ||
          lower === "chrome.exe" ||
          lower === "chromium.exe"
        ) {
          return full;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findLocalCachedBrowser(): string | null {
  const potentialCacheDirs = [
    path.join(process.cwd(), ".cache", "puppeteer"),
    path.join(process.cwd(), "apps", "api", ".cache", "puppeteer"),
    path.join(__dirname, "..", "..", ".cache", "puppeteer"),
    path.join(__dirname, "..", "..", "..", ".cache", "puppeteer"),
  ];

  for (const dir of potentialCacheDirs) {
    const bin = findBinaryInDir(dir);
    if (bin && fs.existsSync(bin)) {
      return bin;
    }
  }
  return null;
}

/**
 * Launches a browser for HTML→PDF conversion with resilient fallback:
 * 1. Checks PUPPETEER_EXECUTABLE_PATH if configured and exists on disk.
 * 2. Checks local workspace .cache/puppeteer directory (downloaded during build).
 * 3. Tries standard puppeteer default launch.
 * 4. Tries resolving executable via puppeteer.executablePath().
 * 5. Tries auto-discovering from known system binary paths.
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

  // 2. Check locally bundled / downloaded browser in .cache/puppeteer inside repository
  const localCachedBin = findLocalCachedBrowser();
  if (localCachedBin) {
    try {
      const { default: puppeteerCore } = await import("puppeteer-core");
      return await puppeteerCore.launch({
        executablePath: localCachedBin,
        headless: true,
        args: LAUNCH_ARGS,
      });
    } catch (err) {
      console.warn(
        `[pdf-browser] Found local cached browser at ${localCachedBin} but launch failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 3. Try default puppeteer launch
  try {
    const { default: puppeteer } = await import("puppeteer");
    return await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
  } catch {
    // Continue to fallback strategies
  }

  // 4. Try resolving path from puppeteer.executablePath()
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

  // 5. Try auto-discovering from known system paths
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
