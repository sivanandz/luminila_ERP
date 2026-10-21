import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { pb, ensureServerAuth, getPocketBaseUrl, sanitizeFilter } from '@/lib/pocketbase';
import { getStorefrontBinding } from '@/lib/storefront';
import { buildMetaBatchRequests, resolvePublicCatalogOrigin, sendMetaCatalogBatch } from '@/lib/meta-catalog-batch';

export const dynamic = 'force-dynamic';

/**
 * Meta Catalog Batch API Endpoint
 *
 * Allows instant, programmatic synchronization of single or multiple products
 * directly to Meta Commerce Manager & WhatsApp Catalog.
 *
 * POST /api/catalog/batch
 * Headers: Authorization: Bearer <pocketbase_jwt>
 * Body:
 * {
 *   "productIds": ["prod_123"], // or "all": true
 *   "action": "UPDATE", // "CREATE" | "UPDATE" | "DELETE"
 *   "account_email": "merchant@domain.com"
 * }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { productIds = [], all = false, action = 'UPDATE', account_email: requestedEmail = '' } = body;

        // 1. Authenticate caller via PocketBase JWT or internal server sync key
        const authHeader = req.headers.get('authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
        const syncSecret = req.headers.get('x-catalog-sync-key') || '';
        const accessToken = process.env.META_GRAPH_ACCESS_TOKEN || '';

        let isAuthorized = false;
        let isSuperuserCaller = false;
        let verifiedEmail = '';

        if (syncSecret && accessToken && syncSecret === accessToken) {
            isAuthorized = true;
            isSuperuserCaller = true;
        } else if (token) {
            await ensureServerAuth(requestedEmail || undefined);
            const authPb = new PocketBase(pb.baseUrl || getPocketBaseUrl());
            try {
                authPb.authStore.save(token, null);
                const refreshed = await authPb.collection('users').authRefresh();
                isAuthorized = authPb.authStore.isValid;
                verifiedEmail = (refreshed?.record?.email || authPb.authStore.record?.email || '').trim().toLowerCase();
            } catch {
                try {
                    authPb.authStore.save(token, null);
                    const refreshed = await authPb.collection('_superusers').authRefresh();
                    isAuthorized = authPb.authStore.isValid;
                    isSuperuserCaller = true;
                    verifiedEmail = (refreshed?.record?.email || authPb.authStore.record?.email || '').trim().toLowerCase();
                } catch {
                    isAuthorized = false;
                }
            }
        }

        if (!isAuthorized) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized: Valid operator session token is required to trigger Meta Catalog sync.' },
                { status: 401 }
            );
        }

        const catalogId = process.env.META_CATALOG_ID || '1548180657057026';
        const apiVersion = process.env.META_GRAPH_VERSION || 'v21.0';
        const phone = process.env.META_BUSINESS_PHONE || '917092122334';

        // Resolve strict tenant scope: regular users are locked to their own email
        const tenantEmail = (
            isSuperuserCaller
                ? (requestedEmail || process.env.META_FEED_ACCOUNT_EMAIL || verifiedEmail)
                : (verifiedEmail || requestedEmail)
        ).trim().toLowerCase();

        if (!tenantEmail || tenantEmail === 'default') {
            return NextResponse.json(
                { success: false, error: 'Bad Request: Unable to resolve tenant account_email for catalog isolation.' },
                { status: 400 }
            );
        }

        const safeTenantEmail = sanitizeFilter(tenantEmail);

        // 2. Authenticate server PocketBase client via tenant registry or env credentials
        await ensureServerAuth(tenantEmail);

        // 3. Fetch products with Dual-Layer Tenant Isolation (DB Clause + In-Memory Guard)
        let products: any[] = [];
        if (all) {
            products = await pb.collection('products').getFullList({
                filter: `is_active = true && account_email = "${safeTenantEmail}"`,
                sort: '-created'
            });
        } else if (Array.isArray(productIds) && productIds.length > 0) {
            const idClauses = productIds
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map(id => `id = "${sanitizeFilter(id.trim())}"`)
                .join(' || ');
            if (!idClauses) {
                return NextResponse.json({ error: 'Invalid productIds array' }, { status: 400 });
            }
            products = await pb.collection('products').getFullList({
                filter: `(${idClauses}) && account_email = "${safeTenantEmail}"`
            });
        } else {
            return NextResponse.json({
                error: 'Invalid request: provide productIds array or all: true'
            }, { status: 400 });
        }

        // In-memory tenant isolation guard
        products = products.filter(
            (p) => !p.account_email || String(p.account_email).trim().toLowerCase() === tenantEmail
        );

        if (products.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No matching products to sync for this tenant',
                total_processed: 0
            });
        }

        // 4. Fetch variants with relational active guard + tenant filter
        const productPids = products.map(p => `product = "${sanitizeFilter(p.id)}"`).join(' || ');
        const rawVariants = await pb.collection('product_variants').getFullList({
            filter: `(${productPids}) && product.is_active = true && account_email = "${safeTenantEmail}"`
        });

        const activeProductIds = new Set(products.filter(p => p.is_active !== false).map(p => p.id));
        const variants = rawVariants.filter((v) => {
            if (v.account_email && String(v.account_email).trim().toLowerCase() !== tenantEmail) return false;
            if (action !== 'DELETE' && !activeProductIds.has(v.product)) return false;
            return true;
        });

        // 5. Resolve public origin (env -> proxy headers -> Cloudflare tunnel -> request origin)
        const origin = resolvePublicCatalogOrigin(req);

        // 6. Resolve tenant brand name
        const binding = await getStorefrontBinding(tenantEmail);
        const brandName = binding.brandName || 'Niththigal Jewellery';

        // 7. Build batch requests
        const batchRequests = buildMetaBatchRequests(
            products as any[],
            variants as any[],
            origin,
            phone,
            action,
            brandName
        );

        // 8. Check if Access Token is configured
        if (!accessToken) {
            return NextResponse.json({
                success: false,
                configured: false,
                message: 'Meta Graph Access Token not configured yet. The scheduled data feed is actively syncing, but instant Batch API requires META_GRAPH_ACCESS_TOKEN in .env.local',
                catalog_id: catalogId,
                tenant_email: tenantEmail,
                origin_used: origin,
                total_items_prepared: batchRequests.length,
                preview_requests: batchRequests.slice(0, 3)
            }, { status: 200 });
        }

        // 9. Dispatch to Meta Graph API
        const metaRes = await sendMetaCatalogBatch(
            catalogId,
            accessToken,
            batchRequests,
            apiVersion
        );

        return NextResponse.json({
            success: metaRes.success,
            catalog_id: catalogId,
            tenant_email: tenantEmail,
            origin_used: origin,
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
