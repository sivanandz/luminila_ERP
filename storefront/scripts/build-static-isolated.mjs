#!/usr/bin/env node
/**
 * Isolated static export build.
 *
 * A running `next dev` process locks storefront/out and .next, so this script
 * copies the app into a temp directory outside the repository, links
 * node_modules in, and builds there. The dev server never sees the build and
 * the build never deletes the developer's .next cache.
 *
 * node_modules strategy:
 *   - Same volume as the OS temp dir and reparse points supported: junction
 *     directly to storefront/node_modules (fast path).
 *   - Otherwise (this repo lives on an exFAT volume, which has no symlinks or
 *     junctions, and Next's client entries break when node_modules is on
 *     another drive): mirror node_modules once into a cache on the OS temp
 *     volume and junction the mirror. The mirror is refreshed when
 *     node_modules/.package-lock.json is newer than it.
 *
 * Usage:
 *   node scripts/build-static-isolated.mjs
 *
 * Environment:
 *   NEXT_PUBLIC_SITE_URL   default http://localhost:3001
 *   ERP_API_URL            default http://127.0.0.1:3000 (local .env.local)
 *   STOREFRONT_*           passed through; the snapshot files below are enabled
 *                          automatically when they exist in the storefront root
 *
 * Prints:
 *   OUT_DIR=<build>/out    the exported site (pass to seo-audit --out)
 *   BUILD_DIR=<build>      the isolated project root
 *
 * Exits with the Next build's exit code.
 */

import { spawnSync } from "node:child_process";
import { access, cp, mkdir, rm, stat, symlink } from "node:fs/promises";
import { constants as fsConstants, readlinkSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STOREFRONT_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = dirname(STOREFRONT_DIR);
const REAL_NODE_MODULES = join(STOREFRONT_DIR, "node_modules");
// Shared with scripts/next-run.mjs: converts a spurious exFAT EISDIR from
// fs.readlink back to EINVAL, which webpack treats as "not a symlink".
const READLINK_SHIM = join(SCRIPT_DIR, "fix-exfat-readlink.cjs");

const TEMP_ROOT = os.tmpdir();
const BUILD_DIR = join(TEMP_ROOT, "niththigal-seo-build");
const OUT_DIR = join(BUILD_DIR, "out");
const NODE_MODULES_CACHE_DIR = join(TEMP_ROOT, "niththigal-seo-node_modules");
const NODE_MODULES_CACHE = join(NODE_MODULES_CACHE_DIR, "node_modules");

/** Everything the Next build needs; nothing else leaves the repository. */
const COPY_ENTRIES = [
    "src",
    "public",
    "next.config.ts",
    "tsconfig.json",
    "postcss.config.mjs",
    "package.json",
    "next-env.d.ts",
    ".env.local",
];

/** Optional offline fixtures read by the build-time data modules. */
const SNAPSHOT_ENTRIES = ["catalog-snapshot.json", "content-snapshot.json"];

const LOCAL_ERP_ORIGIN = "http://127.0.0.1:3000";
const LOCAL_SITE_URL = "http://localhost:3001";

const LOCK_ERROR_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"]);

function sameVolume(a, b) {
    return parse(a).root.toLowerCase() === parse(b).root.toLowerCase();
}

async function exists(path) {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function sleep(ms) {
    return new Promise((done) => setTimeout(done, ms));
}

/**
 * Remove a directory. Windows holds handles briefly after a build or a virus
 * scan, so EPERM/EBUSY are retried with a short backoff.
 */
async function removeDir(path) {
    const delays = [0, 150, 400, 900, 1800];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
        if (delays[attempt]) await sleep(delays[attempt]);
        try {
            await rm(path, { recursive: true, force: true, maxRetries: 0 });
            return;
        } catch (error) {
            const code = error && error.code;
            const last = attempt === delays.length - 1;
            if (!LOCK_ERROR_CODES.has(code) || last) throw error;
            console.warn(
                `[seo:build] Retrying cleanup of ${path} after ${code} (attempt ${attempt + 1}).`
            );
        }
    }
}

async function copyProject() {
    for (const entry of COPY_ENTRIES) {
        const source = join(STOREFRONT_DIR, entry);
        if (!(await exists(source))) continue;
        await cp(source, join(BUILD_DIR, entry), {
            recursive: true,
            force: true,
            dereference: false,
        });
    }
}

async function copySnapshots() {
    const copied = [];
    for (const entry of SNAPSHOT_ENTRIES) {
        const source = join(STOREFRONT_DIR, entry);
        if (!(await exists(source))) continue;
        await cp(source, join(BUILD_DIR, entry), { force: true });
        copied.push(entry);
    }
    return copied;
}

async function cacheFresh() {
    try {
        const [cache, lock] = await Promise.all([
            stat(NODE_MODULES_CACHE),
            stat(join(REAL_NODE_MODULES, ".package-lock.json")),
        ]);
        return cache.mtimeMs >= lock.mtimeMs;
    } catch {
        return false;
    }
}

/**
 * Mirror node_modules onto the OS temp volume (first run only, about 90 s for
 * this project). The mirror is a real directory so Next can resolve its client
 * entries with a same-drive relative path.
 */
async function ensureNodeModulesCache() {
    if (await cacheFresh()) return;
    console.log(
        `[seo:build] Mirroring node_modules to ${NODE_MODULES_CACHE_DIR} (first run only)…`
    );
    await removeDir(NODE_MODULES_CACHE);
    await mkdir(NODE_MODULES_CACHE_DIR, { recursive: true });
    await cp(REAL_NODE_MODULES, NODE_MODULES_CACHE, {
        recursive: true,
        force: true,
        dereference: false,
    });
}

async function linkNodeModules() {
    if (!(await exists(REAL_NODE_MODULES))) {
        throw new Error(`node_modules not found at ${REAL_NODE_MODULES}; run npm install first.`);
    }
    const link = join(BUILD_DIR, "node_modules");

    // Fast path: the project volume supports a junction and is on the same
    // drive as the build, so Next's relative client-entry paths stay valid.
    if (sameVolume(STOREFRONT_DIR, BUILD_DIR)) {
        try {
            await symlink(REAL_NODE_MODULES, link, "junction");
            return;
        } catch (error) {
            console.warn(
                `[seo:build] Direct node_modules junction failed (${error && error.code}); using the temp mirror.`
            );
        }
    }

    await ensureNodeModulesCache();
    await symlink(NODE_MODULES_CACHE, link, "junction");
}

/**
 * Some volumes answer fs.readlink with EISDIR for an ordinary file. Next's
 * trace plugin only tolerates EINVAL/ENOENT/UNKNOWN, so the build needs the
 * normalising shim. Probe a file that definitely exists.
 */
function needsReadlinkShim() {
    try {
        readlinkSync(join(STOREFRONT_DIR, "package.json"));
        return false;
    } catch (error) {
        return Boolean(error) && error.code === "EISDIR";
    }
}

function buildEnvironment(copiedSnapshots) {
    const env = { ...process.env };

    // Never inherit a container build setting: this script must export HTML.
    delete env.BUILD_STANDALONE;

    env.NEXT_TELEMETRY_DISABLED = "1";

    if (!env.NEXT_PUBLIC_SITE_URL) {
        env.NEXT_PUBLIC_SITE_URL = LOCAL_SITE_URL;
    }

    const localErp = !env.ERP_API_URL;
    if (localErp) {
        env.ERP_API_URL = LOCAL_ERP_ORIGIN;
        // The build-time fetch refuses loopback unless this explicit opt-in is
        // set; a developer workstation building against the local ERP does.
        env.STOREFRONT_ALLOW_LOCAL_ERP = "true";
    }

    if (copiedSnapshots.includes("catalog-snapshot.json") && !env.STOREFRONT_CATALOG_SNAPSHOT) {
        env.STOREFRONT_CATALOG_SNAPSHOT = "catalog-snapshot.json";
    }
    if (copiedSnapshots.includes("content-snapshot.json") && !env.STOREFRONT_CONTENT_SNAPSHOT) {
        env.STOREFRONT_CONTENT_SNAPSHOT = "content-snapshot.json";
    }

    return env;
}

async function main() {
    console.log(`[seo:build] Isolated build directory: ${BUILD_DIR}`);
    await removeDir(BUILD_DIR);
    await mkdir(BUILD_DIR, { recursive: true });
    await copyProject();
    const copiedSnapshots = await copySnapshots();
    await linkNodeModules();

    // Launch Next through the build's own node_modules link so its internal
    // paths resolve on the same volume as the project.
    const nextBin = join(BUILD_DIR, "node_modules", "next", "dist", "bin", "next");
    if (!(await exists(nextBin))) {
        throw new Error(`Next binary not found at ${nextBin}; run npm install first.`);
    }

    const nodeArgs = [];
    if (needsReadlinkShim()) {
        console.warn(
            "[seo:build] fs.readlink returns EISDIR on this volume; loading the normalising shim."
        );
        nodeArgs.push("--require", READLINK_SHIM);
    }

    const env = buildEnvironment(copiedSnapshots);
    console.log(
        `[seo:build] NEXT_PUBLIC_SITE_URL=${env.NEXT_PUBLIC_SITE_URL} ERP_API_URL=${env.ERP_API_URL}`
    );
    if (copiedSnapshots.length) {
        console.log(`[seo:build] Snapshots: ${copiedSnapshots.join(", ")}`);
    }

    const child = spawnSync(
        process.execPath,
        [...nodeArgs, nextBin, "build", "--webpack"],
        {
            cwd: BUILD_DIR,
            env,
            stdio: "inherit",
            windowsHide: true,
        }
    );
    if (child.error) throw child.error;

    const status = child.status ?? 1;
    if (status === 0) {
        console.log(`OUT_DIR=${OUT_DIR}`);
        console.log(`BUILD_DIR=${BUILD_DIR}`);
    } else {
        console.error(`[seo:build] Next build failed with exit code ${status}.`);
    }
    process.exit(status);
}

main().catch((error) => {
    console.error("[seo:build] Isolated build failed:", error);
    process.exit(1);
});
