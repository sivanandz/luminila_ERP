import {
    jsonLdGraph,
    serializeJsonLd,
    type JsonLdNode,
} from "@/lib/seo";

/**
 * Server-rendered JSON-LD. One script element per graph keeps the document
 * small and makes the markup part of the initial HTML, which Google requires
 * for reliable Shopping crawls.
 */
export function JsonLd({
    nodes,
    id,
}: {
    nodes: (JsonLdNode | null | undefined)[];
    id?: string;
}) {
    const graph = jsonLdGraph(nodes);
    const entries = graph["@graph"];
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return (
        <script
            id={id}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
        />
    );
}
