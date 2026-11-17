import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the container deploy (see Dockerfile).
  output: "standalone",
  // Playwright drives the dev server over 127.0.0.1 while Next binds localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Cache Components: dynamic data is opt-in to caching with `use cache`.
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
