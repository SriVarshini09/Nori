import type { NextConfig } from "next";

/** Where apps/api listens. The browser only ever talks to this app; /api and /mcp are proxied so the session cookie stays same-origin. */
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/mcp", destination: `${API_URL}/mcp` },
    ];
  },
};

export default nextConfig;
