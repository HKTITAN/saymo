import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The Next.js badge would land on top of the post in exported frames.
  devIndicators: false,
  // The edition (src/lib/studio/edition.ts), for the page as well as the
  // server: the product edition hides the AIs it doesn't offer.
  env: {
    STUDIO_EDITION: process.env.STUDIO_EDITION === "product" ? "product" : "in-house",
  },
  // The Mac app (desktop/) builds its own copy of the studio into a folder
  // inside .next (STUDIO_DESKTOP_DIST), so it never touches the dev server's
  // files or tsconfig.json. Without that variable nothing here changes.
  ...(process.env.STUDIO_DESKTOP_DIST
    ? {
        distDir: process.env.STUDIO_DESKTOP_DIST,
        typescript: { tsconfigPath: "desktop/studio.tsconfig.json", ignoreBuildErrors: true },
      }
    : {}),
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
