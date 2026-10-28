#!/usr/bin/env node
/**
 * IndexNow submission for the storefront.
 *
 * Reads INDEXNOW_KEY and NEXT_PUBLIC_SITE_URL from the environment or
 * .env.local, ensures public/<key>.txt exists, reads the URLs from
 * out/sitemap.xml (or the live sitemap), and POSTs them to the shared
 * IndexNow endpoint.
 *
 * A 200/202 means the endpoint received the submission; it does not mean the
 * URLs were indexed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    console.error(
        "[seo:indexnow] INDEXNOW_KEY must be 8-128 characters using only a-z, A-Z, 0-9 and -."
    );
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

async function readSitemap() {
    const local = path.join(projectRoot, "out", "sitemap.xml");
    if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
    const response = await fetch(`${siteUrl}/sitemap.xml`, {
        headers: { Accept: "application/xml" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

const sitemap = await readSitemap();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter((url) => {
        try {
            return new URL(url).host === parsed.host;
        } catch {
            return false;
        }
    })
    .slice(0, 10000);

if (!urls.length) {
    console.error("[seo:indexnow] No same-host URLs found in the sitemap.");
    process.exit(1);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
        host: parsed.host,
        key,
        keyLocation: `${siteUrl}/${key}.txt`,
        urlList: urls,
    }),
});

console.log(
    `[seo:indexnow] Submitted ${urls.length} URL(s); endpoint responded ${response.status}.`
);
if (response.status !== 200 && response.status !== 202) {
    const body = await response.text().catch(() => "");
    console.error(`[seo:indexnow] ${body}`.trim());
    process.exit(1);
}
