const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // npm workspaces hoist dependencies to the repo root; tracing root includes
  // those files in the production serverless bundle (Vercel + local `next build`).
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

module.exports = nextConfig;
