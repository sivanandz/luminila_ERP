#!/usr/bin/env node
/**
 * Cross-platform Next.js launcher.
 *
 * The storefront lives on an exFAT drive in development; libuv reports EISDIR
 * for readlink() on regular files there, which aborts webpack. The repo's
 * fix-exfat-readlink preload converts that back to EINVAL. Passing it through
 * NODE_OPTIONS makes the patch apply inside the Next child process, on Windows
 * and Linux alike.
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const fix = path.join(here, "fix-exfat-readlink.cjs");
const nextBin = require.resolve("next/dist/bin/next");
const args = process.argv.slice(2);

const existing = process.env.NODE_OPTIONS || "";
const env = {
    ...process.env,
    NODE_OPTIONS: `${existing} --require ${fix}`.trim(),
};

const result = spawnSync(process.execPath, [nextBin, ...args], {
    stdio: "inherit",
    env,
});

if (result.error) {
    console.error(`[storefront] ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
