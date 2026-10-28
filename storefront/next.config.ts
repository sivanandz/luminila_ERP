import type { NextConfig } from "next";
import path from "path";

const isStandalone = process.env.BUILD_STANDALONE === "true";

const nextConfig: NextConfig = {
  // Dual-mode deployment:
  // - Default: Static export for 100% free Cloudflare Pages hosting
  // - Standalone: Docker/Node container for Hostinger VPS
  output: isStandalone ? "standalone" : "export",

  images: {
    unoptimized: true,
  },

  // This app lives in a nested directory of the luminila_inv_mgmt repo. Next's
  // workspace-root detection walks up to the repo root and then compiles the
  // PARENT app's proxy.ts/capture-config against THIS app's alias map, which
  // fails (they don't exist here). Pin the root to this directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
