#!/usr/bin/env node
/**
 * Deterministic SEO audit of the static export.
 *
 * Usage:
 *   node scripts/seo-audit.mjs [--out <dir>] [--json]
 *
 * It never touches the network. It reads the HTML, robots.txt, sitemap.xml,
 * llms.txt, llms-full.txt and merchant-feed.xml that `next build` produced.
 * Exit 0 when there are no `fail` checks; `warn` checks do not fail the build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const outFlag = args.indexOf("--out");
const outDir =
    outFlag >= 0 && args[outFlag + 1]
        ? path.resolve(args[outFlag + 1])
        : path.join(projectRoot, "out");

const checks = [];
const fail = (id, detail) => checks.push({ id, status: "fail", detail });
const warn = (id, detail) => checks.push({ id, status: "warn", detail });
const pass = (id, detail) => checks.push({ id, status: "pass", detail });

if (!fs.existsSync(outDir)) {
    console.error(`[seo:audit] Export directory not found: ${outDir}`);
    process.exit(2);
}

function decodeHtml(value) {
    return String(value)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
    return decodeHtml(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function walkHtml(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "_next" || entry.name.startsWith("__next")) continue;
            files.push(...walkHtml(full));
        } else if (entry.name.endsWith(".html")) {
            if (entry.name === "404.html" || entry.name === "_not-found.html") continue;
            files.push(full);
        }
    }
    return files;
}

function routeFor(file) {
    const rel = path.relative(outDir, file).replace(/\\/g, "/");
    if (rel === "index.html") return "/";
    if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"/index.html".length)}`;
    return `/${rel.slice(0, -".html".length)}`;
}

function collectTypes(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const item of node) collectTypes(item, out);
        return;
    }
    if (node["@type"]) {
        if (Array.isArray(node["@type"])) out.push(...node["@type"]);
        else out.push(node["@type"]);
    }
    for (const key of Object.keys(node)) collectTypes(node[key], out);
}

function findNodes(node, type, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const item of node) findNodes(item, type, out);
        return;
    }
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.includes(type)) out.push(node);
    for (const key of Object.keys(node)) findNodes(node[key], type, out);
}

function hasKey(node, key) {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some((item) => hasKey(item, key));
    if (Object.prototype.hasOwnProperty.call(node, key)) return true;
    return Object.keys(node).some((k) => hasKey(node[k], key));
}

function pathOf(url) {
    try {
        return new URL(url).pathname.replace(/\/+$/, "") || "/";
    } catch {
        return "";
    }
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                         */
/* ------------------------------------------------------------------ */
const robotsPath = path.join(outDir, "robots.txt");
if (!fs.existsSync(robotsPath)) {
    fail("robots-exists", "robots.txt is missing");
} else {
    const text = fs.readFileSync(robotsPath, "utf8");
    pass("robots-exists", "robots.txt present");
    if (/Sitemap:\s*https?:\/\//i.test(text)) {
        pass("robots-sitemap", "sitemap directive present");
    } else {
        fail("robots-sitemap", "robots.txt has no absolute Sitemap directive");
    }
    const requiredBots = [
        "Googlebot",
        "Bingbot",
        "OAI-SearchBot",
        "PerplexityBot",
        "Claude-SearchBot",
        "Claude-User",
        "GPTBot",
        "ClaudeBot",
        "CCBot",
    ];
    const missing = requiredBots.filter((bot) => !text.includes(bot));
    if (missing.length) fail("robots-ai-groups", `missing groups: ${missing.join(", ")}`);
    else pass("robots-ai-groups", "search and training crawler groups present");
    if (/Disallow:\s*\/checkout/i.test(text)) {
        pass("robots-checkout-blocked", "/checkout is disallowed");
    } else {
        fail("robots-checkout-blocked", "/checkout is not disallowed");
    }
    if (/Disallow:\s*\/(?:_next|.*\.css|.*\.js)/i.test(text)) {
        fail("robots-no-asset-block", "robots.txt blocks CSS/JS assets");
    } else {
        pass("robots-no-asset-block", "CSS/JS are not blocked");
    }
}

/* ------------------------------------------------------------------ */
/* sitemap.xml                                                        */
/* ------------------------------------------------------------------ */
const sitemapPath = path.join(outDir, "sitemap.xml");
let sitemapLocs = [];
if (!fs.existsSync(sitemapPath)) {
    fail("sitemap-exists", "sitemap.xml is missing");
} else {
    const text = fs.readFileSync(sitemapPath, "utf8");
    sitemapLocs = [...text.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) =>
        decodeHtml(match[1]).trim()
    );
    pass("sitemap-exists", `sitemap.xml present with ${sitemapLocs.length} URLs`);
    if (sitemapLocs.length === 0) {
        fail("sitemap-pages", "sitemap has no <loc> entries");
    } else if (sitemapLocs.some((url) => !/^https?:\/\//i.test(url))) {
        fail("sitemap-absolute", "sitemap contains a non-absolute URL");
    } else {
        pass("sitemap-absolute", "every sitemap URL is absolute");
    }
    if (sitemapLocs.some((url) => /\/checkout\/?$/.test(url))) {
        fail("sitemap-no-checkout", "sitemap contains /checkout");
    } else {
        pass("sitemap-no-checkout", "sitemap excludes /checkout");
    }
    if (sitemapLocs.some((url) => pathOf(url) === "/")) {
        pass("sitemap-home", "home is in the sitemap");
    } else {
        fail("sitemap-home", "home is missing from the sitemap");
    }
    const products = sitemapLocs.filter((url) => /\/products\//.test(url));
    const collections = sitemapLocs.filter((url) => /\/collections\//.test(url));
    if (products.length) pass("sitemap-products-match", `${products.length} product URLs`);
    else warn("sitemap-products-match", "no product URLs (catalogue may be empty)");
    if (collections.length) pass("sitemap-collections-match", `${collections.length} collection URLs`);
    else warn("sitemap-collections-match", "no collection URLs (catalogue may be empty)");
    if (sitemapLocs.length && sitemapLocs.every((url) => /^http:\/\/localhost/i.test(url))) {
        warn("sitemap-host", "sitemap uses the localhost build origin; set NEXT_PUBLIC_SITE_URL for production");
    }
}

/* ------------------------------------------------------------------ */
/* llms.txt / llms-full.txt                                           */
/* ------------------------------------------------------------------ */
for (const file of ["llms.txt", "llms-full.txt"]) {
    const full = path.join(outDir, file);
    if (!fs.existsSync(full)) {
        fail(`${file}-exists`, `${file} is missing`);
        continue;
    }
    const text = fs.readFileSync(full, "utf8");
    if (/^#\s+/m.test(text)) pass(`${file}-h1`, `${file} starts with an H1`);
    else fail(`${file}-h1`, `${file} has no H1`);
    if (/\]\(https?:\/\//.test(text)) pass(`${file}-links`, `${file} has absolute links`);
    else fail(`${file}-links`, `${file} has no absolute links`);
    if (file === "llms-full.txt" && productsInSitemap() && !/##\s+Products/i.test(text)) {
        warn(`${file}-products`, "product URLs exist but llms-full has no Products section");
    }
}

function productsInSitemap() {
    return sitemapLocs.some((url) => /\/products\//.test(url));
}

/* ------------------------------------------------------------------ */
/* merchant-feed.xml                                                  */
/* ------------------------------------------------------------------ */
const feedPath = path.join(outDir, "merchant-feed.xml");
if (!fs.existsSync(feedPath)) {
    warn("feed-exists", "merchant-feed.xml is missing (catalogue may be empty)");
} else {
    const text = fs.readFileSync(feedPath, "utf8");
    const itemCount = (text.match(/<item>/g) || []).length;
    pass("feed-exists", `merchant feed present with ${itemCount} item(s)`);
    const required = [
        "g:id",
        "title",
        "description",
        "link",
        "g:image_link",
        "g:availability",
        "g:price",
        "g:brand",
        "g:condition",
    ];
    const missing = required.filter((tag) => !text.includes(`<${tag}>`));
    if (missing.length) fail("feed-required-fields", `missing tags: ${missing.join(", ")}`);
    else pass("feed-required-fields", "required tags present");
    const ids = [...text.matchAll(/<g:id>([^<]+)<\/g:id>/g)].map((match) => match[1]);
    if (ids.length && new Set(ids).size !== ids.length) {
        fail("feed-unique-ids", "duplicate g:id values");
    } else if (ids.length) {
        pass("feed-unique-ids", `${ids.length} unique variant ids`);
    }
    const prices = [...text.matchAll(/<g:price>([^<]+)<\/g:price>/g)].map((match) => match[1]);
    if (prices.some((price) => !/^\d+\.\d{2}\s+[A-Z]{3}$/.test(price.trim()))) {
        fail("feed-price-format", "a g:price is not '<amount> <ISO currency>'");
    } else if (prices.length) {
        pass("feed-price-format", "prices use '<amount> INR'");
    }
    if (/\/checkout/.test(text)) fail("feed-no-checkout", "feed links to /checkout");
    else pass("feed-no-checkout", "feed does not link to /checkout");
}

/* ------------------------------------------------------------------ */
/* HTML pages                                                         */
/* ------------------------------------------------------------------ */
const htmlFiles = walkHtml(outDir);
const pages = [];
const titleMap = new Map();
const descriptionMap = new Map();

for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    const route = routeFor(file);
    const title = stripTags(
        (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""
    );
    const description = decodeHtml(
        (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || ""
    ).trim();
    const canonical = decodeHtml(
        (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) || [])[1] || ""
    ).trim();
    const robots = (
        html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i) || []
    )[1] || "";
    const lang = (html.match(/<html[^>]+lang=["']([^"']*)["']/i) || [])[1] || "";
    const h1Count = (html.match(/<h1\b/gi) || []).length;

    pages.push({ route, title, description, canonical, robots, h1Count, lang, html });

    if (!lang) fail("html-lang", `${route}: <html> has no lang`);
    if (!title) fail("html-title", `${route}: missing <title>`);
    if (!description) fail("html-description", `${route}: missing meta description`);
    if (!canonical) fail("html-canonical", `${route}: missing canonical`);
    if (canonical) {
        if (!/^https?:\/\//i.test(canonical)) {
            fail("html-canonical-absolute", `${route}: canonical is not absolute`);
        } else if (!/\/checkout/.test(route)) {
            const canonicalPath = pathOf(canonical);
            const expectedPath = route === "/" ? "/" : route.replace(/\/$/, "");
            if (canonicalPath !== expectedPath) {
                fail("html-canonical-self", `${route}: canonical points to ${canonicalPath}`);
            }
        }
    }
    if (route !== "/checkout" && h1Count !== 1) {
        fail("html-h1", `${route}: expected 1 H1, found ${h1Count}`);
    }

    if (route === "/checkout") {
        if (/noindex/i.test(robots)) pass("checkout-noindex", "checkout is noindex");
        else fail("checkout-noindex", "checkout is not noindex");
    } else if (/noindex/i.test(robots)) {
        fail("html-no-noindex", `${route}: unexpected noindex`);
    }

    if (title) {
        const key = title.toLowerCase();
        if (titleMap.has(key)) warn("html-title-unique", `${route}: duplicate title with ${titleMap.get(key)}`);
        else titleMap.set(key, route);
        if (title.length > 70) warn("html-title-length", `${route}: title is ${title.length} characters`);
    }
    if (description) {
        const key = description.toLowerCase();
        if (descriptionMap.has(key)) warn("html-description-unique", `${route}: duplicate description with ${descriptionMap.get(key)}`);
        else descriptionMap.set(key, route);
        if (description.length > 180) warn("html-description-length", `${route}: description is ${description.length} characters`);
    }

    const blocks = [
        ...html.matchAll(
            /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        ),
    ];
    const types = [];
    let parsedCount = 0;
    for (const block of blocks) {
        const raw = block[1].trim();
        let data;
        try {
            data = JSON.parse(raw);
        } catch (error) {
            fail("ldjson-parses", `${route}: JSON-LD does not parse: ${error.message}`);
            continue;
        }
        parsedCount += 1;
        collectTypes(data, types);
        if (!["https://schema.org", "http://schema.org"].includes(data["@context"])) {
            fail("ldjson-context", `${route}: JSON-LD @context is not schema.org`);
        }
        for (const forbidden of [
            "aggregateRating",
            "review",
            "priceValidUntil",
            "shippingDetails",
            "SearchAction",
        ]) {
            if (hasKey(data, forbidden)) {
                fail("ldjson-no-forbidden", `${route}: contains ${forbidden}`);
            }
        }
        if (raw.includes("data:image")) {
            fail("ldjson-no-data-urls", `${route}: JSON-LD contains a data-URL image`);
        }

        const products = [];
        findNodes(data, "Product", products);
        const seenSkus = [];
        for (const product of products) {
            if (!product.name) fail("ldjson-product", `${route}: Product missing name`);
            if (product.sku) seenSkus.push(String(product.sku));
            if (!product.offers && !product.isVariantOf) {
                warn("ldjson-product-offers", `${route}: Product ${product.name || "?"} has no offers`);
            }
        }
        if (seenSkus.length && new Set(seenSkus).size !== seenSkus.length) {
            fail("ldjson-product-sku", `${route}: duplicate variant sku`);
        }
        for (const offer of (() => {
            const found = [];
            findNodes(data, "Offer", found);
            return found;
        })()) {
            const price = Number(offer.price);
            if (!Number.isFinite(price) || price <= 0) {
                fail("ldjson-offer-price", `${route}: Offer price is not positive`);
            }
            if (!offer.priceCurrency) fail("ldjson-offer-currency", `${route}: Offer missing priceCurrency`);
        }
        for (const crumb of (() => {
            const found = [];
            findNodes(data, "BreadcrumbList", found);
            return found;
        })()) {
            const items = Array.isArray(crumb.itemListElement)
                ? crumb.itemListElement
                : [];
            if (items.length < 2) fail("ldjson-breadcrumb", `${route}: BreadcrumbList has fewer than 2 items`);
        }
    }

    if (blocks.length && parsedCount !== blocks.length) {
        // individual parse failures were already recorded
    }
    if (route === "/" && !types.includes("Organization") && !types.includes("OnlineStore")) {
        fail("ldjson-organization", "home: missing Organization/OnlineStore");
    }
    if (route === "/" && !types.includes("WebSite")) {
        warn("ldjson-website", "home: missing WebSite");
    }
    if (route === "/" && !types.includes("ItemList")) {
        warn("ldjson-home-itemlist", "home: missing ItemList");
    }
    if (/^\/products\//.test(route)) {
        if (!types.includes("Product") && !types.includes("ProductGroup")) {
            fail("ldjson-product-page", `${route}: missing Product/ProductGroup`);
        }
        if (!types.includes("BreadcrumbList")) {
            warn("ldjson-breadcrumb-page", `${route}: missing BreadcrumbList`);
        }
    }
    if (/^\/collections\//.test(route)) {
        if (!types.includes("CollectionPage")) {
            fail("ldjson-collection", `${route}: missing CollectionPage`);
        }
        if (types.includes("Product")) {
            fail("ldjson-collection-product", `${route}: listing page contains Product markup`);
        }
    }
}

pass("html-pages", `${pages.length} indexable HTML page(s)`);

/* ------------------------------------------------------------------ */
/* Internal links                                                     */
/* ------------------------------------------------------------------ */
function linkExists(href) {
    const clean = href.split("#")[0].split("?")[0];
    if (!clean || clean === "/") return fs.existsSync(path.join(outDir, "index.html"));
    if (/^\/(?:_next|api)\//.test(clean)) return true;
    const relative = clean.replace(/^\//, "");
    if (path.extname(relative)) return fs.existsSync(path.join(outDir, relative));
    return (
        fs.existsSync(path.join(outDir, `${relative}.html`)) ||
        fs.existsSync(path.join(outDir, relative, "index.html"))
    );
}

const broken = new Set();
for (const page of pages) {
    for (const match of page.html.matchAll(/href=["']([^"']+)["']/gi)) {
        const href = decodeHtml(match[1]).trim();
        if (!href || href.startsWith("#")) continue;
        if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(href)) continue;
        if (!href.startsWith("/")) continue;
        if (!linkExists(href)) broken.add(`${page.route} -> ${href}`);
    }
}
if (broken.size) {
    fail("internal-links-resolve", [...broken].slice(0, 12).join("; "));
} else {
    pass("internal-links-resolve", "all sampled internal links resolve");
}

/* ------------------------------------------------------------------ */
/* Result                                                             */
/* ------------------------------------------------------------------ */
const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const ok = failures.length === 0;

if (asJson) {
    console.log(
        JSON.stringify(
            {
                ok,
                outDir,
                summary: {
                    pass: checks.length - failures.length - warnings.length,
                    warn: warnings.length,
                    fail: failures.length,
                },
                checks,
            },
            null,
            2
        )
    );
} else {
    for (const check of checks) {
        console.log(
            `${check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL"} ${check.id}: ${check.detail}`
        );
    }
    console.log(
        `\n${ok ? "OK" : "FAILED"}: ${failures.length} failure(s), ${warnings.length} warning(s)`
    );
}

process.exit(ok ? 0 : 1);
