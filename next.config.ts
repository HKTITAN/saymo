import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The Next.js badge would land on top of the post in exported frames.
  devIndicators: false,
  experimental: {
    // Set by `next upgrade --agent=security` when it moved the app to
    // 16.4.3, so later upgrades follow security releases.
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
