const path = require("path");
const fs = require("fs");

const monorepoRoot = path.join(__dirname, "../..");
const useTracingRoot = fs.existsSync(path.join(monorepoRoot, "package.json"));

/**
 * Next.js rewrite `destination` must start with `/`, `http://`, or `https://`.
 * Railway UI often pastes a bare hostname; default https for remote hosts, http for local.
 */
function normalizeApiBaseUrl(raw) {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost:3001";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  const isLocal =
    /^localhost\b/i.test(trimmed) ||
    /^127\.\d+\.\d+\.\d+(?::\d+)?$/i.test(trimmed) ||
    /^\[::1\](?::\d+)?$/i.test(trimmed) ||
    /^::1(?::\d+)?$/i.test(trimmed);
  return `${isLocal ? "http" : "https"}://${trimmed}`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Set DOCKER_BUILD=1 in Dockerfile.web so the image can run node server.js (standalone).
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  // npm workspaces hoist dependencies to the repo root; include them in the server bundle trace.
  ...(useTracingRoot ? { outputFileTracingRoot: monorepoRoot } : {}),
  async rewrites() {
    const apiUrl = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
    const prefix = (process.env.NEXT_PUBLIC_API_PATH_PREFIX ?? "").replace(
      /\/$/,
      ""
    );
    const destination =
      prefix === ""
        ? `${apiUrl}/:path*`
        : `${apiUrl}${prefix}/:path*`;
    return [{ source: "/api/:path*", destination }];
  },
};

module.exports = nextConfig;
