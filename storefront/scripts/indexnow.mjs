#!/usr/bin/env node
/**
 * IndexNow submission for the storefront.
 *
 * Reads INDEXNOW_KEY and NEXT_PUBLIC_SITE_URL from the environment or
 * .env.local, ensures public/<key>.txt exists, reads the URLs from the isolated
 * export's sitemap.xml, and POSTs them to the shared IndexNow endpoint.
 *
 * Usage:
 *   node scripts/indexnow.mjs [--out <dir>] [--dry-run]
 *
 * The default sitemap is the one scripts/build-static-isolated.mjs writes:
 *   <os.tmpdir()>/niththigal-seo-build/out/sitemap.xml
 * When that file does not exist, the live <SITE_URL>/sitemap.xml is fetched.
 *
 * Nothing is invented: a missing key, a missing https origin or an empty
 * sitemap is an error. A 200/202 response means the endpoint received the
 * submission; it does not mean the URLs were indexed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISOLATED_OUT_DIR = path.join(os.tmpdir(), "niththigal-seo-build", "out");
const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const MAX_URLS = 10000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function flagValue(flag) {
    const direct = args.indexOf(flag);
    if (direct >= 0 && args[direct + 1]) return args[direct + 1];
    const prefixed = args.find((value) => value.startsWith(`${flag}=`));
    return prefixed ? prefixed.slice(flag.length + 1) : "";
}

function readEnvFile(file) {
    if (!fs.existsSync(file)) return {};
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return values;
}

const envFile = readEnvFile(path.join(projectRoot, ".env.local"));
const key = String(process.env.INDEXNOW_KEY || envFile.INDEXNOW_KEY || "").trim();
const siteUrl = String(
    process.env.NEXT_PUBLIC_SITE_URL || envFile.NEXT_PUBLIC_SITE_URL || ""
)
    .trim()
    .replace(/\/+$/, "");

if (!key) {
    console.error("[seo:indexnow] INDEXNOW_KEY is required (8-128 characters: a-z, A-Z, 0-9, -).");
    process.exit(1);
}
if (!KEY_PATTERN.test(key)) {
    console.error(
        "[seo:indexnow] INDEXNOW_KEY must be 8-128 characters using only a-z, A-Z, 0-9 and -."
    );
    process.exit(1);
}

if (!siteUrl) {
    console.error("[seo:indexnow] NEXT_PUBLIC_SITE_URL is required; no origin is invented.");
    process.exit(1);
}

let parsed;
try {
    parsed = new URL(siteUrl);
} catch {
    console.error("[seo:indexnow] NEXT_PUBLIC_SITE_URL must be an absolute URL.");
    process.exit(1);
}

if (parsed.protocol !== "https:") {
    console.error("[seo:indexnow] IndexNow requires an https SITE_URL.");
    process.exit(1);
}

const host = parsed.hostname.toLowerCase();
if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
) {
    console.error("[seo:indexnow] Refusing to submit a loopback/private host.");
    process.exit(1);
}

const keyFile = path.join(projectRoot, "public", `${key}.txt`);
if (!fs.existsSync(keyFile) || fs.readFileSync(keyFile, "utf8").trim() !== key) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, key, "utf8");
    console.log(`[seo:indexnow] Wrote ${path.relative(projectRoot, keyFile)}.`);
}

function decodeXml(value) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function readLocalSitemap() {
    const directories = [];
    const requested = flagValue("--out");
    if (requested) directories.push(path.resolve(requested));
    directories.push(ISOLATED_OUT_DIR);
    for (const directory of directories) {
        const candidate = path.join(directory, "sitemap.xml");
        if (fs.existsSync(candidate)) return { xml: fs.readFileSync(candidate, "utf8"), source: candidate };
    }
    return null;
}

async function readSitemap() {
    const local = readLocalSitemap();
    if (local) return local;
    const response = await fetch(`${siteUrl}/sitemap.xml`, {
        headers: { Accept: "application/xml" },
    });
    if (!response.ok) throw new Error(`live sitemap returned HTTP ${response.status}`);
    return { xml: await response.text(), source: `${siteUrl}/sitemap.xml` };
}

let sitemap;
try {
    sitemap = await readSitemap();
} catch (error) {
    console.error(
        `[seo:indexnow] Could not read a sitemap: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
}

const urls = [
    ...new Set(
        [...sitemap.xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
            .map((match) => decodeXml(match[1]).trim())
            .filter((url) => {
                try {
                    return new URL(url).host === parsed.host;
                } catch {
                    return false;
                }
            })
    ),
].slice(0, MAX_URLS);

if (!urls.length) {
    console.error(`[seo:indexnow] No same-host URLs found in ${sitemap.source}.`);
    process.exit(1);
}

console.log(`[seo:indexnow] Read ${urls.length} URL(s) from ${sitemap.source}.`);

if (dryRun) {
    console.log("[seo:indexnow] Dry run; nothing was submitted.");
    process.exit(0);
}

const keyLocation = `${siteUrl}/${key}.txt`;
let response;
try {
    response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
            host: parsed.host,
            key,
            keyLocation,
            urlList: urls,
        }),
    });
} catch (error) {
    console.error(
        `[seo:indexnow] Submission failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
}

console.log(`[seo:indexnow] Endpoint responded ${response.status}.`);
if (response.status !== 200 && response.status !== 202) {
    const body = await response.text().catch(() => "");
    if (body.trim()) console.error(`[seo:indexnow] ${body.trim()}`);
    console.error(
        "[seo:indexnow] A 200/202 means the endpoint received the submission; this request failed."
    );
    process.exit(1);
}

console.log(
    "[seo:indexnow] Accepted (received, not necessarily indexed). Key location: " + keyLocation
);
