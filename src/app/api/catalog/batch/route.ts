import { NextRequest, NextResponse } from 'next/server';
import { pb } from '@/lib/pocketbase';
import { buildMetaBatchRequests, sendMetaCatalogBatch } from '@/lib/meta-catalog-batch';

export const dynamic = 'force-dynamic';

/**
 * Meta Catalog Batch API Endpoint
 * 
 * Allows instant, programmatic synchronization of single or multiple products
 * directly to Meta Commerce Manager & WhatsApp Catalog.
 * 
 * POST /api/catalog/batch
 * Body:
 * {
 *   "productIds": ["prod_123"], // or "all": true
 *   "action": "UPDATE" // "CREATE" | "UPDATE" | "DELETE"
 * }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { productIds = [], all = false, action = 'UPDATE' } = body;

        const catalogId = process.env.META_CATALOG_ID || '1548180657057026';
        const accessToken = process.env.META_GRAPH_ACCESS_TOKEN || '';
        const apiVersion = process.env.META_GRAPH_VERSION || 'v21.0';
        const phone = process.env.META_BUSINESS_PHONE || '917092122334';

        // 1. Authenticate with PocketBase as superuser for complete catalog access
        if (!pb.authStore.isValid) {
            try {
                await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');
            } catch {
                try {
                    await pb.collection('_superusers').authWithPassword('ananya@heritagejewels.com', 'Ananya2026!');
                } catch { /* proceed */ }
            }
        }

        // 2. Fetch products
        let products: any[] = [];
        if (all) {
            products = await pb.collection('products').getFullList({
                filter: 'is_active = true',
                sort: '-created'
            });
        } else if (Array.isArray(productIds) && productIds.length > 0) {
            const filterExpr = productIds.map(id => `id = "${id}"`).join(' || ');
            products = await pb.collection('products').getFullList({
                filter: filterExpr
            });
        } else {
            return NextResponse.json({
                error: 'Invalid request: provide productIds array or all: true'
            }, { status: 400 });
        }

        if (products.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No matching products to sync',
                total_processed: 0
            });
        }

        // 3. Fetch variants for these products
        const productPids = products.map(p => `product = "${p.id}"`).join(' || ');
        const variants = await pb.collection('product_variants').getFullList({
            filter: productPids
        });

        // 4. Resolve public origin
        const forwardedHost = req.headers.get('x-forwarded-host');
        const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
        const origin = forwardedHost 
            ? `${forwardedProto}://${forwardedHost}` 
            : req.nextUrl.origin;

        // 5. Build batch requests
        const batchRequests = buildMetaBatchRequests(
            products as any[],
            variants as any[],
            origin,
            phone,
            action
        );

        // 6. Check if Access Token is configured
        if (!accessToken) {
            return NextResponse.json({
                success: false,
                configured: false,
                message: 'Meta Graph Access Token not configured yet. The scheduled data feed is actively syncing, but instant Batch API requires META_GRAPH_ACCESS_TOKEN in .env.local',
                catalog_id: catalogId,
                total_items_prepared: batchRequests.length,
                preview_requests: batchRequests.slice(0, 3)
            }, { status: 200 });
        }

        // 7. Dispatch to Meta Graph API
        const metaRes = await sendMetaCatalogBatch(
            catalogId,
            accessToken,
            batchRequests,
            apiVersion
        );

        return NextResponse.json({
            success: metaRes.success,
            catalog_id: catalogId,
            total_processed: metaRes.total_processed,
            handles: metaRes.handles,
            errors: metaRes.errors,
            raw: metaRes.raw
        }, { status: metaRes.success ? 200 : 502 });

    } catch (err: unknown) {
        console.error('[MetaCatalogBatchRoute] Exception:', err);
        return NextResponse.json({
            error: 'Failed to process Meta Catalog Batch request',
            details: err instanceof Error ? err.message : String(err)
        }, { status: 500 });
    }
}
