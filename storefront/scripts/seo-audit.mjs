#!/usr/bin/env node
/**
 * Deterministic audit of the static export.
 *
 * Usage:
 *   node scripts/seo-audit.mjs [--out <dir>] [--json]
 *
 * The default output directory is the one scripts/build-static-isolated.mjs
 * creates in the OS temp directory:
 *   <os.tmpdir()>/niththigal-seo-build/out
 *
 * The audit never touches the network. It reads the HTML, robots.txt,
 * sitemap.xml, llms.txt, llms-full.txt and merchant-feed.xml that the build
 * produced and checks the contract in docs/SEO_CONTRACT.md.
 *
 * Statuses: "pass" and "warn" leave the exit code at 0; any "fail" exits 1.
 * Warnings never weaken a check: an assertion is either enforced (pass/fail)
 * or explicitly advisory (warn).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISOLATED_OUT_DIR = path.join(os.tmpdir(), "niththigal-seo-build", "out");

const args = process.argv.slice(2);
const asJson = args.includes("--json");

/** Read `--flag value` or `--flag=value`; "" when absent. */
function flagValue(flag) {
    const direct = args.indexOf(flag);
    if (direct >= 0 && args[direct + 1]) return args[direct + 1];
    const prefixed = args.find((value) => value.startsWith(`${flag}=`));
    return prefixed ? prefixed.slice(flag.length + 1) : "";
}

const requestedOut = flagValue("--out");
const outDir = path.resolve(requestedOut || ISOLATED_OUT_DIR);

const checks = [];
function record(id, status, detail) {
    checks.push({ id, status, detail });
}
const pass = (id, detail) => record(id, "pass", detail);
const warn = (id, detail) => record(id, "warn", detail);
const fail = (id, detail) => record(id, "fail", detail);

/** Join a few items for a detail string without dumping an unbounded list. */
function summarise(items, max = 10) {
    const list = [...new Set(items)].filter(Boolean);
    const shown = list.slice(0, max);
    const extra = list.length - shown.length;
    return `${shown.join(", ")}${extra > 0 ? ` (+${extra} more)` : ""}`;
}

if (!fs.existsSync(outDir)) {
    console.error(`[seo:audit] Export directory not found: ${outDir}`);
    console.error("[seo:audit] Run `npm run seo:build` first, or pass --out <dir>.");
    process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                       */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
};

function decodeHtml(value) {
    return String(value)
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : "";
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = Number.parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : "";
        })
        .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

function stripTags(value) {
    return decodeHtml(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isAbsoluteHttp(value) {
    return /^https?:\/\//i.test(cleanString(value));
}

function trimPath(value) {
    const trimmed = String(value || "").replace(/\/+$/, "");
    return trimmed || "/";
}

function pathOf(value) {
    try {
        return trimPath(new URL(value).pathname);
    } catch {
        return "";
    }
}

function originOf(value) {
    try {
        return new URL(value).origin;
    } catch {
        return "";
    }
}

function withoutScripts(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function attrValue(tag, name) {
    const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
    const match = tag.match(pattern);
    if (!match) return "";
    return match[1] !== undefined ? match[1] : match[2];
}

function metaContent(html, name) {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        if (attrValue(match[0], "name").toLowerCase() === name) {
            return decodeHtml(attrValue(match[0], "content")).trim();
        }
    }
    return "";
}

function canonicalHref(html) {
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const rel = attrValue(match[0], "rel").toLowerCase().split(/\s+/);
        if (rel.includes("canonical")) {
            return decodeHtml(attrValue(match[0], "href")).trim();
        }
    }
    return "";
}

/* ------------------------------------------------------------------ */
/* XML well-formedness scanner (no dependency, no DTD resolution)      */
/* ------------------------------------------------------------------ */

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function findTagEnd(text, from) {
    let quote = "";
    for (let index = from; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (char === quote) quote = "";
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === ">") {
            return index;
        }
    }
    return -1;
}

function validateXmlText(text, errors, where) {
    let index = 0;
    while (index < text.length) {
        const amp = text.indexOf("&", index);
        if (amp === -1) break;
        const semi = text.indexOf(";", amp + 1);
        if (semi === -1 || semi - amp > 12) {
            errors.push(`${where}: bare "&"`);
            index = amp + 1;
            continue;
        }
        const entity = text.slice(amp + 1, semi);
        if (!/^(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(entity)) {
            errors.push(`${where}: invalid entity &${entity};`);
        }
        index = semi + 1;
    }
    if (text.includes("]]>")) errors.push(`${where}: "]]>" in character data`);
}

function validateAttributes(raw, errors, tagName) {
    let index = 0;
    while (index < raw.length) {
        while (index < raw.length && /\s/.test(raw[index])) index += 1;
        if (index >= raw.length) break;
        const nameMatch = raw.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/);
        if (!nameMatch) {
            errors.push(`<${tagName}>: invalid attribute syntax`);
            return;
        }
        index += nameMatch[0].length;
        while (index < raw.length && /\s/.test(raw[index])) index += 1;
        if (raw[index] !== "=") {
            errors.push(`<${tagName}>: attribute ${nameMatch[0]} has no value`);
            return;
        }
        index += 1;
        while (index < raw.length && /\s/.test(raw[index])) index += 1;
        const quote = raw[index];
        if (quote !== '"' && quote !== "'") {
            errors.push(`<${tagName}>: unquoted attribute value`);
            return;
        }
        const close = raw.indexOf(quote, index + 1);
        if (close === -1) {
            errors.push(`<${tagName}>: unterminated attribute value`);
            return;
        }
        const value = raw.slice(index + 1, close);
        if (value.includes("<")) errors.push(`<${tagName}>: "<" in attribute value`);
        validateXmlText(value, errors, `<${tagName}> attribute`);
        index = close + 1;
    }
}

/** Scan a document for balanced tags, one root element and valid text. */
function scanXml(text) {
    const errors = [];
    const stack = [];
    let roots = 0;
    let index = 0;

    while (index < text.length) {
        const lt = text.indexOf("<", index);
        if (lt === -1) {
            validateXmlText(text.slice(index), errors, "text");
            break;
        }
        validateXmlText(text.slice(index, lt), errors, "text");

        if (text.startsWith("<!--", lt)) {
            const end = text.indexOf("-->", lt + 4);
            if (end === -1) {
                errors.push("unterminated comment");
                break;
            }
            index = end + 3;
            continue;
        }
        if (text.startsWith("<![CDATA[", lt)) {
            const end = text.indexOf("]]>", lt + 9);
            if (end === -1) {
                errors.push("unterminated CDATA section");
                break;
            }
            index = end + 3;
            continue;
        }
        if (text.startsWith("<?", lt)) {
            const end = text.indexOf("?>", lt + 2);
            if (end === -1) {
                errors.push("unterminated processing instruction");
                break;
            }
            index = end + 2;
            continue;
        }
        if (text.startsWith("<!", lt)) {
            const end = text.indexOf(">", lt + 2);
            if (end === -1) {
                errors.push("unterminated markup declaration");
                break;
            }
            index = end + 1;
            continue;
        }

        const end = findTagEnd(text, lt + 1);
        if (end === -1) {
            errors.push("unterminated tag");
            break;
        }
        const body = text.slice(lt + 1, end).trim();
        if (!body) {
            errors.push("empty tag");
            index = end + 1;
            continue;
        }

        if (body.startsWith("/")) {
            const name = body.slice(1).trim();
            if (!XML_NAME.test(name)) errors.push(`invalid closing tag </${name}>`);
            const open = stack.pop();
            if (!open) errors.push(`unexpected closing tag </${name}>`);
            else if (open !== name) errors.push(`mismatched </${name}> for <${open}>`);
            index = end + 1;
            continue;
        }

        const selfClosing = body.endsWith("/");
        const raw = selfClosing ? body.slice(0, -1).trim() : body;
        const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
        if (!nameMatch) {
            errors.push(`invalid tag <${body}>`);
            index = end + 1;
            continue;
        }
        const name = nameMatch[1];
        validateAttributes(raw.slice(name.length), errors, name);

        if (stack.length === 0) roots += 1;
        if (!selfClosing) stack.push(name);
        index = end + 1;
    }

    if (stack.length) errors.push(`unclosed <${stack.join(">, <")}>`);
    if (roots !== 1) errors.push(`expected exactly one root element, found ${roots}`);
    return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                         */
/* ------------------------------------------------------------------ */

function parseRobots(text) {
    const groups = [];
    let current = null;
    let rulesStarted = false;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        if (!line) {
            current = null;
            rulesStarted = false;
            continue;
        }
        const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!match) continue;
        const field = match[1].toLowerCase();
        const value = match[2].trim();
        if (field === "user-agent") {
            if (!current || rulesStarted) {
                current = { agents: [], rules: [] };
                groups.push(current);
                rulesStarted = false;
            }
            current.agents.push(value);
        } else if (field === "allow" || field === "disallow") {
            if (!current) {
                current = { agents: ["*"], rules: [] };
                groups.push(current);
            }
            rulesStarted = true;
            current.rules.push({ type: field, value });
        }
    }
    return groups;
}

function findGroup(groups, agent) {
    const wanted = agent.toLowerCase();
    return groups.find((group) =>
        group.agents.some((value) => value.toLowerCase() === wanted)
    );
}

function normalizeRule(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    return trimPath(trimmed);
}

function hasRule(group, type, value) {
    if (!group) return false;
    const wanted = normalizeRule(value);
    return group.rules.some((rule) => rule.type === type && normalizeRule(rule.value) === wanted);
}

function hasAnyRule(group, type) {
    return Boolean(group) && group.rules.some((rule) => rule.type === type);
}

const ROBOTS_PATH = path.join(outDir, "robots.txt");
const SEARCH_BOTS = [
    "Googlebot",
    "Bingbot",
    "Applebot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Claude-SearchBot",
    "Claude-User",
];
const TRAINING_BOTS = ["GPTBot", "ClaudeBot", "CCBot"];
const blockTraining = (process.env.SEO_BLOCK_AI_TRAINING || "").toLowerCase() === "true";

let robotsGroups = [];
if (!fs.existsSync(ROBOTS_PATH)) {
    fail("robots-exists", "robots.txt is missing");
} else {
    const text = fs.readFileSync(ROBOTS_PATH, "utf8");
    robotsGroups = parseRobots(text);
    pass("robots-exists", "robots.txt present");

    const sitemapLines = [...text.matchAll(/^Sitemap\s*:\s*(\S+)\s*$/gim)].map((m) => m[1]);
    if (sitemapLines.length && sitemapLines.every((value) => isAbsoluteHttp(value))) {
        pass("robots-sitemap", `absolute sitemap directive: ${sitemapLines[0]}`);
    } else {
        fail("robots-sitemap", "robots.txt has no absolute Sitemap directive");
    }

    const missingSearch = SEARCH_BOTS.filter((bot) => !findGroup(robotsGroups, bot));
    const brokenSearch = SEARCH_BOTS.filter((bot) => {
        const group = findGroup(robotsGroups, bot);
        return group && (!hasRule(group, "allow", "/") || !hasRule(group, "disallow", "/checkout"));
    });
    if (missingSearch.length) {
        fail("robots-ai-groups", `missing groups: ${summarise(missingSearch)}`);
    } else if (brokenSearch.length) {
        fail(
            "robots-ai-groups",
            `groups missing Allow: / or Disallow: /checkout: ${summarise(brokenSearch)}`
        );
    } else {
        pass("robots-ai-groups", `${SEARCH_BOTS.length} explicit search/answer crawler groups`);
    }

    const wildcard = findGroup(robotsGroups, "*");
    if (wildcard && hasRule(wildcard, "disallow", "/checkout")) {
        pass("robots-checkout-blocked", "/checkout is disallowed for *");
    } else {
        fail("robots-checkout-blocked", "the * group does not disallow /checkout");
    }

    if (wildcard && hasRule(wildcard, "allow", "/") && !hasRule(wildcard, "disallow", "/")) {
        pass("robots-allow-site", "the * group allows the site");
    } else {
        fail("robots-allow-site", "the * group does not allow /");
    }

    const assetBlockers = robotsGroups
        .flatMap((group) => group.rules)
        .filter((rule) => rule.type === "disallow")
        .map((rule) => rule.value.trim())
        .filter((value) => value && value !== "/")
        .filter(
            (value) =>
                value.startsWith("/_next") ||
                /\.(?:css|js)(?:$|\?)/i.test(value) ||
                value.includes("*.css") ||
                value.includes("*.js")
        );
    if (assetBlockers.length) {
        fail("robots-no-asset-block", `CSS/JS disallowed: ${summarise(assetBlockers)}`);
    } else {
        pass("robots-no-asset-block", "CSS/JS are not blocked");
    }

    const missingTraining = TRAINING_BOTS.filter((bot) => !findGroup(robotsGroups, bot));
    const wrongTraining = TRAINING_BOTS.filter((bot) => {
        const group = findGroup(robotsGroups, bot);
        if (!group) return false;
        if (blockTraining) {
            return !(hasRule(group, "disallow", "/") && !hasRule(group, "allow", "/"));
        }
        return !(hasRule(group, "allow", "/") && hasRule(group, "disallow", "/checkout"));
    });
    if (missingTraining.length) {
        fail("robots-training-groups", `missing groups: ${summarise(missingTraining)}`);
    } else if (wrongTraining.length) {
        fail(
            "robots-training-groups",
            `${blockTraining ? "SEO_BLOCK_AI_TRAINING=true expects Disallow: /" : "expected Allow: / and Disallow: /checkout"} for: ${summarise(wrongTraining)}`
        );
    } else {
        pass(
            "robots-training-groups",
            blockTraining
                ? `training crawlers blocked: ${summarise(TRAINING_BOTS)}`
                : `training crawlers allowed (set SEO_BLOCK_AI_TRAINING=true to block): ${summarise(TRAINING_BOTS)}`
        );
    }
}

/* ------------------------------------------------------------------ */
/* sitemap.xml                                                        */
/* ------------------------------------------------------------------ */

const SITEMAP_PATH = path.join(outDir, "sitemap.xml");
const STATIC_PATHS = [
    "/",
    "/about",
    "/faq",
    "/shipping-returns",
    "/jewellery-care",
    "/privacy",
];
let sitemapLocations = [];
let sitemapPaths = new Set();
let siteOrigin = "";

if (!fs.existsSync(SITEMAP_PATH)) {
    fail("sitemap-exists", "sitemap.xml is missing");
} else {
    const text = fs.readFileSync(SITEMAP_PATH, "utf8");
    sitemapLocations = [...text.matchAll(/<loc>([^<]*)<\/loc>/gi)].map((match) =>
        decodeHtml(match[1]).trim()
    );
    pass("sitemap-exists", `sitemap.xml present with ${sitemapLocations.length} URL(s)`);

    const xml = scanXml(text);
    if (xml.ok) pass("sitemap-wellformed", "sitemap.xml is well-formed");
    else fail("sitemap-wellformed", `sitemap.xml: ${summarise(xml.errors, 5)}`);

    const origins = new Set(sitemapLocations.filter(isAbsoluteHttp).map(originOf).filter(Boolean));
    if (!sitemapLocations.length) {
        fail("sitemap-pages", "sitemap has no <loc> entries");
    } else if (sitemapLocations.some((value) => !isAbsoluteHttp(value))) {
        fail("sitemap-absolute", "sitemap contains a non-absolute URL");
    } else if (origins.size !== 1) {
        fail("sitemap-absolute", `sitemap mixes origins: ${summarise([...origins])}`);
    } else {
        siteOrigin = [...origins][0];
        pass("sitemap-absolute", `every sitemap URL is absolute on ${siteOrigin}`);
    }

    sitemapPaths = new Set(sitemapLocations.map(pathOf).filter(Boolean));
    if (sitemapLocations.some((value) => pathOf(value) === "/checkout")) {
        fail("sitemap-no-checkout", "sitemap contains /checkout");
    } else {
        pass("sitemap-no-checkout", "sitemap excludes /checkout");
    }

    const missingStatic = STATIC_PATHS.filter((value) => !sitemapPaths.has(value));
    if (missingStatic.length) {
        fail("sitemap-pages", `missing static pages: ${summarise(missingStatic)}`);
    } else {
        pass("sitemap-pages", `all ${STATIC_PATHS.length} static pages are listed`);
    }

    const imageLocations = [...text.matchAll(/<image:loc>([^<]*)<\/image:loc>/gi)].map((match) =>
        decodeHtml(match[1]).trim()
    );
    const badImages = imageLocations.filter((value) => {
        if (!isAbsoluteHttp(value)) return true;
        if (/data:/i.test(value)) return true;
        if (siteOrigin && originOf(value) === siteOrigin) {
            return !routeFileExists(pathOf(value));
        }
        return false;
    });
    if (badImages.length) {
        fail("sitemap-images", `non-crawlable image URLs: ${summarise(badImages)}`);
    } else {
        pass(
            "sitemap-images",
            imageLocations.length
                ? `${imageLocations.length} image URL(s) are absolute and local ones exist`
                : "no product image URLs (images are optional)"
        );
    }

    if (siteOrigin && /^http:\/\/localhost(?::\d+)?$/i.test(siteOrigin)) {
        warn(
            "sitemap-host",
            "sitemap uses the localhost build origin; set NEXT_PUBLIC_SITE_URL for production"
        );
    }
}

/* ------------------------------------------------------------------ */
/* llms.txt / llms-full.txt                                           */
/* ------------------------------------------------------------------ */

function llmsLines(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function markdownLinkPaths(text) {
    return [...text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
}

function coversPath(urls, target) {
    return urls.some((value) => pathOf(value) === target);
}

for (const [file, prefix] of [
    ["llms.txt", "llms"],
    ["llms-full.txt", "llms-full"],
]) {
    const location = path.join(outDir, file);
    if (!fs.existsSync(location)) {
        fail(`${prefix}-exists`, `${file} is missing`);
        continue;
    }
    const text = fs.readFileSync(location, "utf8");
    const lines = llmsLines(text);
    const first = lines[0] || "";
    if (/^#\s+\S/.test(first)) {
        pass(`${prefix}-h1`, `${file} starts with an H1: ${first.slice(0, 80)}`);
    } else {
        fail(`${prefix}-h1`, `${file} does not start with an H1 (got: ${first.slice(0, 80)})`);
    }
    if (/^>\s+\S/.test(lines[1] || "")) {
        pass(`${prefix}-summary`, `${file} has a blockquote summary`);
    } else {
        fail(`${prefix}-summary`, `${file} has no blockquote summary after the H1`);
    }

    if (!/community convention/i.test(text) || !/not an official standard/i.test(text)) {
        fail(
            `${prefix}-convention`,
            `${file} must state that llms.txt is a community convention, not an official standard`
        );
    } else {
        pass(`${prefix}-convention`, `${file} states this is a community convention`);
    }

    const links = markdownLinkPaths(text);
    const required = [...STATIC_PATHS];
    for (const candidate of sitemapPaths) {
        if (candidate.startsWith("/products/") || candidate.startsWith("/collections/")) {
            required.push(candidate);
        }
    }
    const missingLinks = required.filter((target) => !coversPath(links, target));
    if (missingLinks.length) {
        fail(`${prefix}-links`, `missing absolute links: ${summarise(missingLinks)}`);
    } else {
        pass(`${prefix}-links`, `${links.length} absolute link(s) cover every required page`);
    }
}

if (sitemapPaths.size) {
    const products = [...sitemapPaths].filter((value) => value.startsWith("/products/"));
    const fullLocation = path.join(outDir, "llms-full.txt");
    if (!products.length) {
        pass("llms-full-products", "no product pages exist (catalogue may be empty)");
    } else if (!fs.existsSync(fullLocation)) {
        fail("llms-full-products", "llms-full.txt is missing");
    } else {
        const full = fs.readFileSync(fullLocation, "utf8");
        const links = markdownLinkPaths(full);
        const missing = products.filter((target) => !coversPath(links, target));
        if (missing.length) {
            fail("llms-full-products", `products without a link: ${summarise(missing)}`);
        } else {
            pass("llms-full-products", `all ${products.length} product page(s) are linked`);
        }
    }
}

/* ------------------------------------------------------------------ */
/* merchant-feed.xml                                                  */
/* ------------------------------------------------------------------ */

const FEED_PATH = path.join(outDir, "merchant-feed.xml");
if (!fs.existsSync(FEED_PATH)) {
    fail("feed-exists", "merchant-feed.xml is missing");
} else {
    const text = fs.readFileSync(FEED_PATH, "utf8");
    const xml = scanXml(text);
    if (xml.ok) pass("feed-wellformed", "merchant-feed.xml is well-formed");
    else fail("feed-wellformed", `merchant-feed.xml: ${summarise(xml.errors, 5)}`);

    const rawItems = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
    pass("feed-exists", `merchant feed present with ${rawItems.length} item(s)`);

    function tagText(block, tag) {
        const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
        return match ? match[1].trim() : "";
    }

    const requiredTags = [
        "g:id",
        "title",
        "description",
        "link",
        "g:image_link",
        "g:availability",
        "g:price",
        "g:brand",
        "g:condition",
        "g:identifier_exists",
    ];
    const missingFields = [];
    const boundProblems = [];
    const valueProblems = [];
    const priceProblems = [];
    const linkProblems = [];
    const ids = [];
    const groups = new Map();

    for (const block of rawItems) {
        const values = {};
        for (const tag of requiredTags) {
            const value = decodeHtml(tagText(block, tag));
            values[tag] = value;
            if (!value) missingFields.push(tag);
        }
        if (!values["g:id"]) continue;
        ids.push(values["g:id"]);

        const title = values.title;
        const description = values.description;
        if (title.length > 150) boundProblems.push(`title ${values["g:id"]} is ${title.length}`);
        if (description.length > 5000) {
            boundProblems.push(`description ${values["g:id"]} is ${description.length}`);
        }

        const price = values["g:price"].match(/^(\d+(?:\.\d+)?)\s+INR$/);
        if (!price || !(Number(price[1]) > 0)) {
            priceProblems.push(`${values["g:id"]}: ${values["g:price"] || "missing"}`);
        }

        if (!["in_stock", "out_of_stock"].includes(values["g:availability"])) {
            valueProblems.push(`${values["g:id"]}: availability ${values["g:availability"]}`);
        }
        if (values["g:condition"] !== "new") {
            valueProblems.push(`${values["g:id"]}: condition ${values["g:condition"]}`);
        }
        if (values["g:identifier_exists"] !== "no") {
            valueProblems.push(`${values["g:id"]}: identifier_exists ${values["g:identifier_exists"]}`);
        }

        if (!isAbsoluteHttp(values.link) || !/[?&]variant=/.test(values.link)) {
            linkProblems.push(`${values["g:id"]}: ${values.link || "missing"}`);
        }
        if (!isAbsoluteHttp(values["g:image_link"]) || /data:/i.test(values["g:image_link"])) {
            linkProblems.push(`${values["g:id"]}: image ${values["g:image_link"] || "missing"}`);
        }

        let productPath = "";
        try {
            productPath = pathOf(values.link);
        } catch {
            productPath = "";
        }
        if (productPath) {
            if (!groups.has(productPath)) groups.set(productPath, []);
            groups.get(productPath).push({ id: values["g:id"], block });
        }
    }

    if (!rawItems.length) {
        warn("feed-required-fields", "feed has no items (catalogue may be empty)");
    } else if (missingFields.length) {
        fail("feed-required-fields", `missing values: ${summarise(missingFields)}`);
    } else {
        pass("feed-required-fields", `${rawItems.length} item(s) carry every required field`);
    }

    if (boundProblems.length) fail("feed-field-bounds", summarise(boundProblems));
    else pass("feed-field-bounds", "titles <=150 and descriptions <=5000 characters");

    if (priceProblems.length) fail("feed-price-format", summarise(priceProblems));
    else if (rawItems.length) pass("feed-price-format", "prices use '<amount> INR' and are positive");
    else pass("feed-price-format", "no items to price");

    if (valueProblems.length) fail("feed-field-values", summarise(valueProblems));
    else if (rawItems.length) pass("feed-field-values", "availability, condition and identifier_exists are valid");
    else pass("feed-field-values", "no items to validate");

    if (ids.length !== new Set(ids).size) {
        fail("feed-unique-ids", "duplicate g:id values");
    } else if (ids.length) {
        pass("feed-unique-ids", `${ids.length} unique variant id(s)`);
    } else {
        pass("feed-unique-ids", "no items");
    }

    if (linkProblems.length) fail("feed-links", summarise(linkProblems));
    else pass("feed-links", "links and image links are absolute variant URLs");

    const groupProblems = [];
    for (const [productPath, items] of groups) {
        if (items.length < 2) continue;
        const groupIds = items.map((item) => decodeHtml(tagText(item.block, "g:item_group_id")));
        if (groupIds.some((value) => !value)) {
            groupProblems.push(`${productPath}: missing g:item_group_id`);
        } else if (new Set(groupIds).size !== 1) {
            groupProblems.push(`${productPath}: differing g:item_group_id`);
        }
    }
    if (groupProblems.length) fail("feed-item-groups", summarise(groupProblems));
    else pass("feed-item-groups", "multi-variant products share one g:item_group_id");

    if (/<\/?(?:g:)?(?:shipping|tax)(?:\s|>)/i.test(text)) {
        fail("feed-no-shipping-tax", "feed contains shipping or tax values the site does not state");
    } else {
        pass("feed-no-shipping-tax", "no invented shipping or tax fields");
    }

    if (/\/checkout/.test(text)) fail("feed-no-checkout", "feed links to /checkout");
    else pass("feed-no-checkout", "feed does not link to /checkout");
}

/* ------------------------------------------------------------------ */
/* HTML pages and JSON-LD                                             */
/* ------------------------------------------------------------------ */

function walkHtml(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
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
    const relative = path.relative(outDir, file).replace(/\\/g, "/");
    if (relative === "index.html") return "/";
    if (relative.endsWith("/index.html")) {
        return `/${relative.slice(0, -"/index.html".length)}`;
    }
    return `/${relative.slice(0, -".html".length)}`;
}

function routeFileExists(routePath) {
    const clean = trimPath(routePath);
    if (clean === "/") return fs.existsSync(path.join(outDir, "index.html"));
    if (clean.startsWith("/_next/") || clean.startsWith("/api/")) return true;
    if (clean.split("/").includes("..")) return false;
    const relative = clean.replace(/^\//, "");
    if (path.extname(relative)) return fs.existsSync(path.join(outDir, relative));
    return (
        fs.existsSync(path.join(outDir, `${relative}.html`)) ||
        fs.existsSync(path.join(outDir, relative, "index.html"))
    );
}

function extractJsonLd(html) {
    return [
        ...html.matchAll(
            /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        ),
    ].map((match) => match[1].trim());
}

function typesOf(node) {
    const value = node ? node["@type"] : undefined;
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
    return typeof value === "string" ? [value] : [];
}

function eachObject(value, visit) {
    if (Array.isArray(value)) {
        for (const item of value) eachObject(item, visit);
        return;
    }
    if (!value || typeof value !== "object") return;
    visit(value);
    for (const key of Object.keys(value)) eachObject(value[key], visit);
}

function eachString(value, visit) {
    if (typeof value === "string") {
        visit(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) eachString(item, visit);
        return;
    }
    if (value && typeof value === "object") {
        for (const key of Object.keys(value)) eachString(value[key], visit);
    }
}

function isSchemaContext(document) {
    const context = document ? document["@context"] : undefined;
    const values = Array.isArray(context) ? context : [context];
    return values.some(
        (value) => typeof value === "string" && /^https?:\/\/schema\.org\/?$/i.test(value.trim())
    );
}

const htmlFiles = walkHtml(outDir).sort();
const pages = htmlFiles.map((file) => {
    const html = fs.readFileSync(file, "utf8");
    const visible = withoutScripts(html);
    const rawBlocks = extractJsonLd(html);
    const documents = [];
    const parseErrors = [];
    const contextErrors = [];
    for (const raw of rawBlocks) {
        try {
            const parsed = JSON.parse(raw);
            documents.push(parsed);
            if (!isSchemaContext(parsed)) contextErrors.push("block has no schema.org @context");
        } catch (error) {
            parseErrors.push(error instanceof Error ? error.message : String(error));
        }
    }
    const canonical = canonicalHref(html);
    return {
        file,
        html,
        visible,
        route: routeFor(file),
        lang: attrValue(html.match(/<html\b[^>]*>/i)?.[0] || "", "lang"),
        title: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
        description: metaContent(html, "description"),
        canonical,
        canonicalOrigin: originOf(canonical),
        robots: metaContent(html, "robots"),
        h1Count: (visible.match(/<h1\b/gi) || []).length,
        documents,
        parseErrors,
        contextErrors,
    };
});

if (!siteOrigin && pages.length) {
    siteOrigin = pages.find((page) => page.canonicalOrigin)?.canonicalOrigin || "";
}

/* --- metadata ----------------------------------------------------- */

const missingLang = pages.filter((page) => !page.lang).map((page) => page.route);
if (missingLang.length) fail("html-lang", `missing <html lang>: ${summarise(missingLang)}`);
else pass("html-lang", `${pages.length} page(s) declare a language`);

const missingTitle = pages.filter((page) => !page.title).map((page) => page.route);
if (missingTitle.length) fail("html-title", `missing <title>: ${summarise(missingTitle)}`);
else pass("html-title", `${pages.length} page(s) have a title`);

const titleSeen = new Map();
const duplicateTitles = [];
for (const page of pages) {
    if (!page.title) continue;
    const key = page.title.toLowerCase();
    if (titleSeen.has(key)) duplicateTitles.push(`${page.route} = ${titleSeen.get(key)}`);
    else titleSeen.set(key, page.route);
}
if (duplicateTitles.length) warn("html-title-unique", summarise(duplicateTitles));
else pass("html-title-unique", "titles are unique");

const missingDescription = pages.filter((page) => !page.description).map((page) => page.route);
if (missingDescription.length) {
    fail("html-description", `missing meta description: ${summarise(missingDescription)}`);
} else {
    pass("html-description", `${pages.length} page(s) have a meta description`);
}

const descriptionSeen = new Map();
const duplicateDescriptions = [];
for (const page of pages) {
    if (!page.description) continue;
    const key = page.description.toLowerCase();
    if (descriptionSeen.has(key)) {
        duplicateDescriptions.push(`${page.route} = ${descriptionSeen.get(key)}`);
    } else {
        descriptionSeen.set(key, page.route);
    }
}
if (duplicateDescriptions.length) warn("html-description-unique", summarise(duplicateDescriptions));
else pass("html-description-unique", "descriptions are unique");

const missingCanonical = pages.filter((page) => !page.canonical).map((page) => page.route);
const nonAbsoluteCanonical = pages
    .filter((page) => page.canonical && !isAbsoluteHttp(page.canonical))
    .map((page) => page.route);
const wrongCanonical = [];
for (const page of pages) {
    if (!page.canonical || !isAbsoluteHttp(page.canonical)) continue;
    if (page.canonicalOrigin && siteOrigin && page.canonicalOrigin !== siteOrigin) {
        wrongCanonical.push(`${page.route} -> ${page.canonical}`);
        continue;
    }
    if (pathOf(page.canonical) !== page.route) {
        wrongCanonical.push(`${page.route} -> ${pathOf(page.canonical)}`);
    }
}
if (missingCanonical.length) {
    fail("html-canonical", `missing canonical: ${summarise(missingCanonical)}`);
} else if (nonAbsoluteCanonical.length) {
    fail("html-canonical", `non-absolute canonical: ${summarise(nonAbsoluteCanonical)}`);
} else if (wrongCanonical.length) {
    fail("html-canonical", `canonical is not self: ${summarise(wrongCanonical)}`);
} else {
    pass("html-canonical", `${pages.length} page(s) have an absolute, self-referencing canonical`);
}

const checkout = pages.find((page) => page.route === "/checkout");
const wrongH1 = pages
    .filter((page) => page.route !== "/checkout" && page.h1Count !== 1)
    .map((page) => `${page.route} (${page.h1Count})`);
if (wrongH1.length) {
    fail("html-h1", `expected exactly one H1: ${summarise(wrongH1)}`);
} else {
    const indexableCount = pages.filter((page) => page.route !== "/checkout").length;
    const checkoutH1 = checkout ? `; /checkout is noindex and has ${checkout.h1Count} H1(s)` : "";
    pass("html-h1", `${indexableCount} indexable page(s) have exactly one H1${checkoutH1}`);
}

const unintendedNoindex = pages
    .filter((page) => page.route !== "/checkout" && /noindex/i.test(page.robots))
    .map((page) => page.route);
if (unintendedNoindex.length) {
    fail("html-no-noindex", `unexpected noindex: ${summarise(unintendedNoindex)}`);
} else {
    pass("html-no-noindex", "no unexpected noindex directive");
}

if (!checkout) {
    warn("checkout-noindex", "no /checkout page was exported");
} else if (/noindex/i.test(checkout.robots)) {
    pass(
        "checkout-noindex",
        /nofollow/i.test(checkout.robots)
            ? "/checkout is noindex, nofollow"
            : "/checkout is noindex (nofollow is not set)"
    );
} else {
    fail("checkout-noindex", "/checkout is not noindex");
}

/* --- JSON-LD ------------------------------------------------------ */

const parseFailures = [];
const contextFailures = [];
const forbidden = [];
const misplacedReturnPolicy = [];
const dataUrls = [];
const organizationProblems = [];
const returnPolicyProblems = [];
const websiteProblems = [];
const productProblems = [];
const offerProblems = [];
const breadcrumbProblems = [];
const collectionProblems = [];
const faqProblems = [];
const homeItemListProblems = [];
const variantSkuSeen = new Map();

for (const page of pages) {
    if (!page.documents.length) {
        parseFailures.push(`${page.route}: no JSON-LD script`);
        continue;
    }
    for (const error of page.parseErrors) parseFailures.push(`${page.route}: ${error}`);
    for (const error of page.contextErrors) contextFailures.push(`${page.route}: ${error}`);

    const objects = [];
    for (const document of page.documents) {
        eachObject(document, (node) => objects.push(node));
        eachString(document, (value) => {
            // Only inline image payloads; prose can legitimately contain
            // the word "data:" without being a data URL.
            if (/data:image/i.test(value)) dataUrls.push(page.route);
        });
    }

    const typed = (type) => objects.filter((node) => typesOf(node).includes(type));
    const organizations = objects.filter((node) => {
        const types = typesOf(node);
        return types.includes("Organization") || types.includes("OnlineStore");
    });
    const products = typed("Product");
    const groups = typed("ProductGroup");
    const offers = typed("Offer");
    const breadcrumbs = typed("BreadcrumbList");
    const collections = typed("CollectionPage");
    const faqs = typed("FAQPage");
    const itemLists = typed("ItemList");
    const websites = typed("WebSite");

    // Forbidden honesty fields anywhere.
    for (const node of objects) {
        for (const key of [
            "aggregateRating",
            "review",
            "priceValidUntil",
            "shippingDetails",
            "SearchAction",
        ]) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                forbidden.push(`${page.route}: ${key}`);
            }
        }
        if (Object.prototype.hasOwnProperty.call(node, "hasMerchantReturnPolicy")) {
            const types = typesOf(node);
            if (!types.includes("Organization") && !types.includes("OnlineStore")) {
                misplacedReturnPolicy.push(`${page.route}: ${types.join("|") || "untyped"}`);
            }
        }
    }

    // Organization / OnlineStore: name, url and the visible return policy.
    if (!organizations.length) {
        organizationProblems.push(`${page.route}: no Organization/OnlineStore`);
    }
    for (const node of organizations) {
        if (!cleanString(node.name)) organizationProblems.push(`${page.route}: Organization missing name`);
        if (!isAbsoluteHttp(node.url)) {
            organizationProblems.push(`${page.route}: Organization missing absolute url`);
        }
        const policy = node.hasMerchantReturnPolicy;
        const policies = Array.isArray(policy) ? policy : policy ? [policy] : [];
        if (!policies.length) {
            returnPolicyProblems.push(`${page.route}: no hasMerchantReturnPolicy`);
            continue;
        }
        for (const entry of policies) {
            const days = Number(entry && entry.merchantReturnDays);
            const country = entry && entry.applicableCountry;
            const countries = Array.isArray(country) ? country : [country];
            if (days !== 7) {
                returnPolicyProblems.push(`${page.route}: merchantReturnDays is ${String(entry && entry.merchantReturnDays)}`);
            }
            if (!countries.map((value) => cleanString(value)).includes("IN")) {
                returnPolicyProblems.push(`${page.route}: applicableCountry is not IN`);
            }
        }
    }

    // Product / ProductGroup required fields.
    if (page.route.startsWith("/products/") && !products.length && !groups.length) {
        productProblems.push(`${page.route}: no Product or ProductGroup`);
    }
    const groupIds = new Set(groups.map((group) => cleanString(group["@id"])).filter(Boolean));
    for (const group of groups) {
        const name = cleanString(group.name) || "ProductGroup";
        if (!cleanString(group.name)) productProblems.push(`${page.route}: ProductGroup missing name`);
        if (!cleanString(group.productGroupID)) {
            productProblems.push(`${page.route}: ${name} missing productGroupID`);
        }
        if (!isAbsoluteHttp(group.url)) productProblems.push(`${page.route}: ${name} missing absolute url`);
        if (!group.brand || !cleanString(group.brand.name)) {
            productProblems.push(`${page.route}: ${name} missing brand`);
        }
        const variants = Array.isArray(group.hasVariant) ? group.hasVariant : [];
        if (variants.length < 2) {
            productProblems.push(`${page.route}: ${name} has ${variants.length} variant(s)`);
        }
        const groupOwner = `${page.route} ${name}`;
        for (const variant of variants) {
            const variantName = cleanString(variant && variant.name) || "?";
            if (!typesOf(variant).includes("Product")) {
                productProblems.push(`${page.route}: ${name} variant ${variantName} is not a Product`);
            }
            if (!cleanString(variant && variant.name)) {
                productProblems.push(`${page.route}: ${name} variant missing name`);
            }
            const sku = cleanString(variant && variant.sku);
            if (!sku) {
                productProblems.push(`${page.route}: ${name} variant ${variantName} has no sku`);
            } else {
                const key = sku.toLowerCase();
                if (variantSkuSeen.has(key)) {
                    productProblems.push(
                        `${page.route}: variant sku ${sku} is also used by ${variantSkuSeen.get(key)}`
                    );
                } else {
                    variantSkuSeen.set(key, groupOwner);
                }
            }
            const parentId = cleanString(variant && variant.isVariantOf && variant.isVariantOf["@id"]);
            if (!parentId || !groupIds.has(parentId)) {
                productProblems.push(`${page.route}: ${name} variant ${variantName} has no isVariantOf link`);
            }
            if (!variant || !variant.offers) {
                productProblems.push(`${page.route}: ${name} variant ${variantName} has no offers`);
            }
        }
    }

    for (const product of products) {
        const name = cleanString(product.name) || "Product";
        if (!cleanString(product.name)) productProblems.push(`${page.route}: Product missing name`);
        if (!product.brand || !cleanString(product.brand.name)) {
            productProblems.push(`${page.route}: ${name} missing brand`);
        }
        if (!product.isVariantOf && !product.offers) {
            productProblems.push(`${page.route}: ${name} has no offers`);
        }
        if (product.isVariantOf) {
            // Group variants are validated (and their skus checked for global
            // uniqueness) in the ProductGroup branch above; this catches a
            // variant whose group was not emitted on the page.
            if (!cleanString(product.sku)) {
                productProblems.push(`${page.route}: variant ${name} has no sku`);
            }
            const parentId = cleanString(product.isVariantOf["@id"]);
            if (parentId && !groupIds.has(parentId)) {
                productProblems.push(`${page.route}: variant ${name} points at an unknown group`);
            }
        }
    }

    for (const offer of offers) {
        const price = Number(offer.price);
        if (!Number.isFinite(price) || price <= 0) {
            offerProblems.push(`${page.route}: price ${String(offer.price)}`);
        }
        if (cleanString(offer.priceCurrency) !== "INR") {
            offerProblems.push(`${page.route}: currency ${cleanString(offer.priceCurrency) || "missing"}`);
        }
        if (!/^https?:\/\/schema\.org\/(?:InStock|OutOfStock)$/.test(cleanString(offer.availability))) {
            offerProblems.push(`${page.route}: availability ${cleanString(offer.availability) || "missing"}`);
        }
        if (!isAbsoluteHttp(offer.url)) {
            offerProblems.push(`${page.route}: missing absolute offer url`);
        }
    }

    // Breadcrumbs: at least two steps and the pages the plan gives one.
    const needsBreadcrumb =
        page.route.startsWith("/products/") ||
        page.route.startsWith("/collections/") ||
        ["/about", "/faq", "/shipping-returns", "/jewellery-care", "/privacy"].includes(page.route);
    if (needsBreadcrumb && !breadcrumbs.length) {
        breadcrumbProblems.push(`${page.route}: no BreadcrumbList`);
    }
    for (const breadcrumb of breadcrumbs) {
        const items = Array.isArray(breadcrumb.itemListElement)
            ? breadcrumb.itemListElement
            : [];
        if (items.length < 2) {
            breadcrumbProblems.push(`${page.route}: ${items.length} item(s)`);
        }
        for (const item of items) {
            if (!cleanString(item && item.name)) {
                breadcrumbProblems.push(`${page.route}: ListItem missing name`);
            }
            const target = cleanString(item && item.item);
            if (target && !isAbsoluteHttp(target)) {
                breadcrumbProblems.push(`${page.route}: ListItem item is not absolute`);
            }
        }
    }

    if (page.route.startsWith("/collections/")) {
        if (!collections.length) {
            collectionProblems.push(`${page.route}: no CollectionPage`);
        }
        if (products.length) {
            collectionProblems.push(`${page.route}: contains Product markup`);
        }
        for (const collection of collections) {
            const entity = collection.mainEntity;
            if (!entity || !typesOf(entity).includes("ItemList")) {
                collectionProblems.push(`${page.route}: CollectionPage has no ItemList`);
            } else if (!Array.isArray(entity.itemListElement) || !entity.itemListElement.length) {
                collectionProblems.push(`${page.route}: CollectionPage ItemList is empty`);
            }
        }
    }

    if (page.route === "/faq") {
        if (!faqs.length) {
            faqProblems.push("/faq: no FAQPage");
        }
        for (const faq of faqs) {
            const questions = Array.isArray(faq.mainEntity) ? faq.mainEntity : [faq.mainEntity];
            const usable = questions.filter(
                (question) =>
                    question &&
                    cleanString(question.name) &&
                    question.acceptedAnswer &&
                    cleanString(question.acceptedAnswer.text)
            );
            if (!usable.length) faqProblems.push("/faq: FAQPage has no complete Question");
        }
    }

    if (page.route === "/") {
        if (!websites.length) {
            websiteProblems.push("home: no WebSite");
        } else {
            for (const website of websites) {
                if (!cleanString(website.name)) websiteProblems.push("home: WebSite missing name");
                if (!isAbsoluteHttp(website.url)) websiteProblems.push("home: WebSite missing absolute url");
            }
        }
        if ([...sitemapPaths].some((value) => value.startsWith("/products/"))) {
            const usableList = itemLists.find(
                (list) => Array.isArray(list.itemListElement) && list.itemListElement.length
            );
            if (!usableList) homeItemListProblems.push("home: no non-empty ItemList");
        }
    }
}

if (parseFailures.length) fail("ldjson-parses", summarise(parseFailures));
else pass("ldjson-parses", "every JSON-LD block parses");

if (contextFailures.length) fail("ldjson-context", summarise(contextFailures));
else pass("ldjson-context", "every JSON-LD block declares the schema.org @context");

if (forbidden.length) fail("ldjson-no-forbidden", summarise(forbidden));
else pass("ldjson-no-forbidden", "no aggregateRating, review, priceValidUntil, shippingDetails or SearchAction");

if (misplacedReturnPolicy.length) {
    fail("ldjson-return-policy-placement", summarise(misplacedReturnPolicy));
} else {
    pass("ldjson-return-policy-placement", "hasMerchantReturnPolicy appears only on OnlineStore");
}

if (dataUrls.length) fail("ldjson-no-data-urls", summarise(dataUrls));
else pass("ldjson-no-data-urls", "no data-URL images in JSON-LD");

if (organizationProblems.length) fail("ldjson-organization", summarise(organizationProblems));
else pass("ldjson-organization", "Organization/OnlineStore has a name and absolute url on every page");

if (returnPolicyProblems.length) fail("ldjson-return-policy", summarise(returnPolicyProblems));
else pass("ldjson-return-policy", "the OnlineStore carries a 7-day, IN return policy");

if (websiteProblems.length) fail("ldjson-website", summarise(websiteProblems));
else pass("ldjson-website", "the home page declares a WebSite with a name and absolute url");

if (productProblems.length) fail("ldjson-product", summarise(productProblems));
else pass("ldjson-product", "Product/ProductGroup fields and unique variant skus are valid");

if (offerProblems.length) fail("ldjson-offer", summarise(offerProblems));
else pass("ldjson-offer", "every Offer has a positive INR price and availability");

if (breadcrumbProblems.length) fail("ldjson-breadcrumb", summarise(breadcrumbProblems));
else pass("ldjson-breadcrumb", "every BreadcrumbList has at least two valid items");

if (collectionProblems.length) fail("ldjson-collection", summarise(collectionProblems));
else pass("ldjson-collection", "CollectionPage carries an ItemList and no Product markup");

if (faqProblems.length) fail("ldjson-faq", summarise(faqProblems));
else pass("ldjson-faq", "FAQPage carries complete visible questions");

if (homeItemListProblems.length) fail("ldjson-home-itemlist", summarise(homeItemListProblems));
else pass("ldjson-home-itemlist", "the home page lists real products when they exist");

/* --- sitemap vs exported pages ----------------------------------- */

if (sitemapPaths.size) {
    const exportedRoutes = new Set(pages.map((page) => page.route));
    const exportedProducts = [...exportedRoutes].filter((route) => route.startsWith("/products/"));
    const sitemapProducts = [...sitemapPaths].filter((route) => route.startsWith("/products/"));
    const missingProductPages = sitemapProducts.filter((route) => !exportedRoutes.has(route));
    const missingProductUrls = exportedProducts.filter((route) => !sitemapPaths.has(route));
    if (missingProductPages.length) {
        fail("sitemap-products-match", `sitemap products without a page: ${summarise(missingProductPages)}`);
    } else if (missingProductUrls.length) {
        fail("sitemap-products-match", `product pages missing from the sitemap: ${summarise(missingProductUrls)}`);
    } else if (!sitemapProducts.length) {
        pass("sitemap-products-match", "no product pages (catalogue may be empty)");
    } else {
        pass("sitemap-products-match", `${sitemapProducts.length} product URL(s) match exported pages`);
    }

    const exportedCollections = [...exportedRoutes].filter((route) =>
        route.startsWith("/collections/")
    );
    const sitemapCollections = [...sitemapPaths].filter((route) =>
        route.startsWith("/collections/")
    );
    const missingCollectionPages = sitemapCollections.filter(
        (route) => !exportedRoutes.has(route)
    );
    const missingCollectionUrls = exportedCollections.filter(
        (route) => !sitemapPaths.has(route)
    );
    if (missingCollectionPages.length) {
        fail(
            "sitemap-collections-match",
            `sitemap collections without a page: ${summarise(missingCollectionPages)}`
        );
    } else if (missingCollectionUrls.length) {
        fail(
            "sitemap-collections-match",
            `collection pages missing from the sitemap: ${summarise(missingCollectionUrls)}`
        );
    } else if (!sitemapCollections.length) {
        pass("sitemap-collections-match", "no collection pages (catalogue may be empty)");
    } else {
        pass(
            "sitemap-collections-match",
            `${sitemapCollections.length} collection URL(s) match exported pages`
        );
    }
}

/* ------------------------------------------------------------------ */
/* Internal links                                                     */
/* ------------------------------------------------------------------ */

const brokenLinks = [];
for (const page of pages) {
    for (const match of page.visible.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const href = decodeHtml(match[1] !== undefined ? match[1] : match[2]).trim();
        if (!href || href.startsWith("#")) continue;
        if (/^(?:mailto|tel|data|javascript|blob):/i.test(href)) continue;
        if (href.startsWith("//")) continue;

        let target = href;
        if (/^https?:\/\//i.test(href)) {
            const origin = originOf(href);
            if (!siteOrigin || origin !== siteOrigin) continue;
            try {
                target = new URL(href).pathname;
            } catch {
                continue;
            }
        }
        if (!target.startsWith("/")) continue;
        const routePath = target.split("#")[0].split("?")[0];
        if (!routeFileExists(routePath)) {
            brokenLinks.push(`${page.route} -> ${href}`);
        }
    }
}

if (brokenLinks.length) fail("internal-links-resolve", summarise(brokenLinks, 15));
else pass("internal-links-resolve", "every internal link resolves to an exported route or asset");

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
        const label =
            check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
        console.log(`${label} ${check.id}: ${check.detail}`);
    }
    console.log(
        `\n${ok ? "OK" : "FAILED"}: ${failures.length} failure(s), ${warnings.length} warning(s)`
    );
}

process.exit(ok ? 0 : 1);
