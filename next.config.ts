import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";


const nextConfig: NextConfig = {
  // Server-backed desktop: the app runs a real Next server so the 13 API route
  // handlers exist at runtime. `standalone` traces only the dependencies the
  // server needs, which is what the Tauri bundle ships.
  ...(isProd && { output: "standalone" }),

  // Kept because the webview serves images from local PocketBase URLs.
  images: {
    unoptimized: true,
  },

  // Note: builds from exFAT drives also need scripts/fix-exfat-readlink.cjs
  // (wired into the build scripts) because libuv misreports readlink() there.

  // Asset prefix for dev mode (only if TAURI_DEV_HOST is explicitly set by Tauri)
  assetPrefix: process.env.TAURI_DEV_HOST ? `http://${process.env.TAURI_DEV_HOST}:3000` : undefined,

  // Enable React Compiler
  reactCompiler: true,
};

export default nextConfig;
