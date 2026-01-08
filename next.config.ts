import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const internalHost = process.env.TAURI_DEV_HOST || "localhost";

const nextConfig: NextConfig = {
  // Required for Tauri - static export (no Node.js server)
  // Only enable in production to avoid dev server issues
  ...(isProd && { output: "export" }),

  // Required for static export - disable image optimization
  images: {
    unoptimized: true,
  },

  // Asset prefix for dev mode (Tauri loads from devUrl)
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,

  // Enable React Compiler
  reactCompiler: true,
};

export default nextConfig;
