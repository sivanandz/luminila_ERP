import type { NextConfig } from "next";

const isStandalone = process.env.BUILD_STANDALONE === "true";

const nextConfig: NextConfig = {
  // Dual-mode deployment:
  // - Default: Static export for 100% free Cloudflare Pages hosting
  // - Standalone: Docker/Node container for Hostinger VPS
  output: isStandalone ? "standalone" : "export",

  images: {
    unoptimized: true,
  },
};

export default nextConfig;
