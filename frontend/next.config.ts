import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production build for Azure App Service: a self-contained server (node server.js), without node_modules.
  // Enabled only by the deployment workflow, so that "next start" keeps working locally.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
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
