import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // .data/ is the local mock mode's data (never deployed): keep it out of every server function's file trace
  outputFileTracingExcludes: { "/*": ["./.data/**/*"] },
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
