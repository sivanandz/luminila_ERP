import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-static";

const DISALLOW = ["/checkout"];

/**
 * Explicit crawler policy.
 *
 * Search/answer crawlers stay allowed because they send visitors. Training
 * crawlers are allowed by default (brand visibility) and can be switched off
 * with SEO_BLOCK_AI_TRAINING=true. Google-Extended is deliberately omitted:
 * its official documentation was not verified for this change.
 */
export default function robots(): MetadataRoute.Robots {
    const blockTraining = (process.env.SEO_BLOCK_AI_TRAINING || "").toLowerCase() === "true";
    const searchBots = [
        "Googlebot",
        "Bingbot",
        "Applebot",
        "OAI-SearchBot",
        "ChatGPT-User",
        "PerplexityBot",
        "Claude-SearchBot",
        "Claude-User",
    ];
    const trainingBots = ["GPTBot", "ClaudeBot", "CCBot"];

    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: DISALLOW,
            },
            {
                userAgent: searchBots,
                allow: "/",
                disallow: DISALLOW,
            },
            {
                userAgent: trainingBots,
                ...(blockTraining
                    ? { disallow: "/" }
                    : { allow: "/", disallow: DISALLOW }),
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
