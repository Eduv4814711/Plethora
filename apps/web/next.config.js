/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    let apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").trim();
    // Next.js requires destination to start with /, http://, or https://
    if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
      apiUrl = "https://" + apiUrl.replace(/^\/+/, "");
    }
    const base = apiUrl.replace(/\/+$/, "");
    const destination = `${base}/:path*`;
    if (!destination.startsWith("http://") && !destination.startsWith("https://")) {
      throw new Error(`Invalid NEXT_PUBLIC_API_URL: destination "${destination}" must start with http:// or https://`);
    }
    return [{ source: "/api/:path*", destination }];
  },
};

module.exports = nextConfig;
