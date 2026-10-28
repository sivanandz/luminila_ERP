import { getBuildCatalog } from "@/lib/catalog-server";
import { getSiteContent } from "@/lib/site-content-server";
import { buildLlmsFull } from "@/lib/llms-text";

export const dynamic = "force-static";

/** /llms-full.txt — the fuller guide with real product and policy detail. */
export async function GET() {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    return new Response(buildLlmsFull(content, catalog), {
        headers: { "content-type": "text/plain; charset=utf-8" },
    });
}
