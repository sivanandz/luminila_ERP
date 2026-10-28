import { getBuildCatalog } from "@/lib/catalog-server";
import { getSiteContent } from "@/lib/site-content-server";
import { buildLlmsIndex } from "@/lib/llms-text";

export const dynamic = "force-static";

/** /llms.txt — the short, link-first guide for agents. */
export async function GET() {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    return new Response(buildLlmsIndex(content, catalog), {
        headers: { "content-type": "text/plain; charset=utf-8" },
    });
}
