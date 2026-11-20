import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteerCore from "puppeteer-core";

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
  "/usr/bin/google-chrome-unstable",
  "/usr/local/bin/chromium",
  "/usr/local/bin/chrome",
  "/usr/lib/chromium/chromium",
  "/usr/lib/chromium/chrome",
  "/usr/lib/chromium-browser/chromium-browser",
  "/usr/lib/chromium-browser/chrome",
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

const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;

// /dev/shm is tiny in most containers; without these Chromium can crash on
// larger documents. The no-sandbox flags are also required by the packaged
// Chrome-for-Testing binary in some managed Windows environments.
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-sync",
  "--mute-audio",
];

async function launchFromExecutable(executablePath: string) {
  return puppeteerCore.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
  });
}

function findDownloadedChromeExecutable(): string | null {
  const cacheBases = [
    path.join(process.cwd(), "apps", "api", ".cache", "puppeteer", "chrome"),
    path.join(process.cwd(), ".cache", "puppeteer", "chrome"),
    path.join(__dirname, "..", "..", ".cache", "puppeteer", "chrome"),
    path.join(__dirname, "..", "..", "..", ".cache", "puppeteer", "chrome"),
    path.join(os.homedir(), ".cache", "puppeteer", "chrome"),
    process.env.PUPPETEER_CACHE_DIR ? path.join(process.env.PUPPETEER_CACHE_DIR, "chrome") : null,
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

  const binaryNames = process.platform === "win32"
    ? ["chrome.exe"]
    : ["chrome", "chromium"];

  for (const base of cacheBases) {
    try {
      const versions = fs.readdirSync(base);
      for (const version of versions) {
        const versionDir = path.join(base, version);
        if (!fs.statSync(versionDir).isDirectory()) continue;
        const subdirs = fs.readdirSync(versionDir);
        for (const sub of subdirs) {
          const subPath = path.join(versionDir, sub);
          if (!fs.statSync(subPath).isDirectory()) continue;
          for (const binName of binaryNames) {
            const candidate = path.join(subPath, binName);
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
        }
      }
    } catch {
      // Continue to next cache base
    }
  }
  return null;
}

async function resolveBundledBrowserPath(): Promise<string | null> {
  return findDownloadedChromeExecutable();
}

export function findAvailablePdfBrowserPath(): string | null {
  const envExe = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (envExe && fs.existsSync(envExe)) return envExe;

  const bundled = findDownloadedChromeExecutable();
  if (bundled) return bundled;

  for (const candidatePath of KNOWN_EXECUTABLE_PATHS) {
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return null;
}

/**
 * Launches a browser for HTML→PDF conversion using puppeteer-core with resilient discovery:
 * 1. Checks PUPPETEER_EXECUTABLE_PATH if configured and exists on disk.
 * 2. Resolves any local cached Chromium binary from workspace .cache or home cache.
 * 3. Checks installed system browser binaries (e.g. /usr/bin/chromium, Chrome, Edge).
 */
export async function launchPdfBrowser() {
  const envExe = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  // 1. If explicit env var is set and valid, try it first
  if (envExe) {
    if (fs.existsSync(envExe)) {
      try {
        return await launchFromExecutable(envExe);
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

  // 2. Resolve cached Chromium if present
  const bundledExecutablePath = await resolveBundledBrowserPath();
  if (bundledExecutablePath) {
    try {
      return await launchFromExecutable(bundledExecutablePath);
    } catch (err) {
      console.warn(
        `[pdf-browser] Failed to launch bundled browser at ${bundledExecutablePath}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 3. Try an installed system browser (e.g. /usr/bin/chromium or Edge/Chrome on Windows)
  for (const candidatePath of KNOWN_EXECUTABLE_PATHS) {
    if (fs.existsSync(candidatePath)) {
      try {
        return await launchFromExecutable(candidatePath);
      } catch (err) {
        console.warn(
          `[pdf-browser] Failed to launch system browser at ${candidatePath}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  throw new Error(
    "Could not find or launch a Chromium/Chrome browser for PDF generation. " +
    "Ensure 'chromium' is installed in the deployment environment or set PUPPETEER_EXECUTABLE_PATH to a valid browser binary."
  );
}
