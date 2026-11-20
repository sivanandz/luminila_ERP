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

  // Dev watchdog noise: PocketBase rewrites its pb_data WAL files and agent
  // tooling writes .mimosa hook state / docs artifacts — all under the project
  // root. Each such write used to recompile the dev bundle and push a
  // full-reload HMR event to every open page, so pages "refreshed themselves"
  // while nobody was working. Keep the dev watcher on source only.
  webpack: (config, { dev }) => {
    if (dev && config.watchOptions) {
      // Single RegExp: webpack accepts one RegExp or an array of strings here.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: /[\\/](\.next|node_modules|\.git|\.mimosa|\.playwright-mcp|pocketbase|docs)[\\/]/,
      };
    }
    if (dev && process.env.LUMINILA_FS_DISK_CACHE !== "1") {
      // exFAT checkouts cannot satisfy webpack's filesystem-cache snapshot
      // ("Unable to snapshot resolve dependencies"), so the pack is dropped on
      // every write and each dev start is a full recompile anyway. Fall back to
      // the in-memory cache: identical HMR behaviour, no failed-snapshot noise.
      // Set LUMINILA_FS_DISK_CACHE=1 on NTFS machines to keep the disk cache.
      config.cache = { type: "memory" };
    }
    return config;
  },

  // Asset prefix for dev mode (only if TAURI_DEV_HOST is explicitly set by Tauri)
  assetPrefix: process.env.TAURI_DEV_HOST ? `http://${process.env.TAURI_DEV_HOST}:3000` : undefined,

  // Enable React Compiler
  reactCompiler: true,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
