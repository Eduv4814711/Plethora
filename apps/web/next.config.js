const path = require("path");
const fs = require("fs");

const monorepoRoot = path.join(__dirname, "../..");
const useTracingRoot = fs.existsSync(path.join(monorepoRoot, "package.json"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // npm workspaces hoist dependencies to the repo root; include them in the server bundle trace.
  experimental: {
    ...(useTracingRoot ? { outputFileTracingRoot: monorepoRoot } : {}),
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
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
