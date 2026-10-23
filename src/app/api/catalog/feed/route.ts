import { NextRequest, NextResponse } from 'next/server';
import { pb, ensureServerAuth, sanitizeFilter } from '@/lib/pocketbase';
import { getStorefrontBinding, normalizeBindingEmail } from '@/lib/storefront';
import { resolvePublicCatalogOrigin } from '@/lib/meta-catalog-batch';
import { authenticateOperator, constantTimeEqual, tenantAccessAllowed, extractBearer } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Meta Commerce Catalog Data Feed for WhatsApp Business
 * 
 * Supports automated, bulk synchronization of hundreds/thousands of products
 * and variants directly into Meta Commerce Manager / WhatsApp Catalog.
 * 
 * Usage:
 * - Enter this feed URL in Meta Commerce Manager (Data Sources > Data Feed):
 *   https://your-domain.com/api/catalog/feed?account_email=merchant@domain.com
 * - Meta will automatically poll this feed on a schedule (e.g. hourly) to sync
 *   all products, variants, live stock, and pricing into WhatsApp Business.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        let accountEmail = normalizeBindingEmail(
            searchParams.get('account_email') || process.env.META_FEED_ACCOUNT_EMAIL || ''
        );
        const phone = (searchParams.get('phone') || process.env.META_BUSINESS_PHONE || '').trim();

        // The feed is tenant data. Accept either the catalog sync key (server to
        // server: Meta or a scheduler) or a valid operator session. A Meta Graph
        // token is not accepted here; it has its own scope and must not act as a
        // shared bearer key.
        const syncKey = process.env.CATALOG_SYNC_KEY || '';
        const providedKey = req.headers.get('x-catalog-sync-key') || extractBearer(req);
        const keyValid = Boolean(syncKey) && Boolean(providedKey) && constantTimeEqual(providedKey, syncKey);

        if (!keyValid) {
            const session = await authenticateOperator(req, accountEmail || undefined);
            if (!session.ok) {
                return NextResponse.json({ error: 'Unauthorized catalog feed request' }, { status: 401 });
            }
            if (accountEmail && !tenantAccessAllowed(session.email, session.isSuperuser, accountEmail)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            if (!accountEmail && session.email) {
                accountEmail = normalizeBindingEmail(session.email);
            }
        }

        if (!accountEmail) {
            return NextResponse.json({ error: 'account_email is required' }, { status: 400 });
        }

        await ensureServerAuth(accountEmail);

        const safeEmail = sanitizeFilter(accountEmail);

        // 1. Fetch active products with Dual-Layer Tenant Isolation
        const productFilter = accountEmail
            ? `is_active = true && account_email = "${safeEmail}"`
            : `is_active = true`;
        const rawProducts = await pb.collection('products').getFullList({
            filter: productFilter,
            sort: '-created'
        });

        const products = rawProducts.filter((p) => {
            if (!p || p.is_active === false) return false;
            if (accountEmail && p.account_email && String(p.account_email).trim().toLowerCase() !== accountEmail) {
                return false;
            }
            return true;
        });

        // 2. Fetch variants with relational active guard + tenant scope
        const variantFilter = accountEmail
            ? `product.is_active = true && account_email = "${safeEmail}"`
            : `product.is_active = true`;
        const rawVariants = await pb.collection('product_variants').getFullList({
            filter: variantFilter
        });

        const activeProductIds = new Set(products.map(p => p.id));
        const variants = rawVariants.filter((v) => {
            if (!activeProductIds.has(v.product)) return false;
            if (accountEmail && v.account_email && String(v.account_email).trim().toLowerCase() !== accountEmail) {
                return false;
            }
            return true;
        });

        // Group variants by parent product
        const variantsByProduct = new Map<string, typeof variants>();
        for (const v of variants) {
            const pid = v.product;
            if (!variantsByProduct.has(pid)) {
                variantsByProduct.set(pid, []);
            }
            variantsByProduct.get(pid)!.push(v);
        }

        // 3. Build CSV Header (Standard Meta Commerce Catalog specification)
        const headers = [
            'id',
            'title',
            'description',
            'availability',
            'condition',
            'price',
            'link',
            'image_link',
            'brand',
            'item_group_id',
            'color',
            'material'
        ];

        const rows: string[][] = [];
        const origin = resolvePublicCatalogOrigin(req);
        const binding = await getStorefrontBinding(accountEmail || undefined);
        const brand = (binding.brandName || 'Niththigal Jewellery').replace(/"/g, '""');

        for (const p of products) {
            const pVariants = variantsByProduct.get(p.id) || [];
            const cleanDescription = (p.description || p.name || '')
                .replace(/[\r\n]+/g, ' ')
                .replace(/"/g, '""');
            const basePrice = Number(p.base_price) || 0;
            const imageLink = (p.image_url && p.image_url.startsWith('http'))
                ? p.image_url
                : `${origin}/api/catalog/image?id=${p.id}${accountEmail ? `&account_email=${encodeURIComponent(accountEmail)}` : ''}`;

            if (pVariants.length === 0) {
                // Standalone product
                const sku = p.sku || `PROD-${p.id}`;
                const stock = Number(p.stock_quantity) || 0;
                const availability = stock > 0 ? 'in stock' : 'out of stock';
                const priceFormatted = `${basePrice.toFixed(2)} INR`;
                const chatLink = `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, I want to order ${p.name} (SKU: ${sku})`)}`;

                rows.push([
                    `"${sku}"`,
                    `"${p.name.replace(/"/g, '""')}"`,
                    `"${cleanDescription}"`,
                    `"${availability}"`,
                    '"new"',
                    `"${priceFormatted}"`,
                    `"${chatLink}"`,
                    `"${imageLink}"`,
                    `"${brand}"`,
                    `"${sku}"`,
                    '""',
                    '""'
                ]);
            } else {
                // Product with variants
                for (const v of pVariants) {
                    const variantSku = p.sku ? `${p.sku}-${v.sku_suffix || v.id.slice(-4)}` : `VAR-${v.id}`;
                    const variantPrice = Math.max(0, basePrice + (Number(v.price_adjustment) || 0));
                    const variantStock = Number(v.stock_level) || 0;
                    const availability = variantStock > 0 ? 'in stock' : 'out of stock';
                    const priceFormatted = `${variantPrice.toFixed(2)} INR`;
                    const title = `${p.name} - ${v.variant_name || 'Standard'}`.replace(/"/g, '""');
                    const chatLink = `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, I want to order ${title} (SKU: ${variantSku})`)}`;

                    rows.push([
                        `"${variantSku}"`,
                        `"${title}"`,
                        `"${cleanDescription}"`,
                        `"${availability}"`,
                        '"new"',
                        `"${priceFormatted}"`,
                        `"${chatLink}"`,
                        `"${imageLink}"`,
                        `"${brand}"`,
                        `"${p.sku || p.id}"`, // item_group_id groups variants under same parent
                        `"${(v.color || '').replace(/"/g, '""')}"`,
                        `"${(v.material || '').replace(/"/g, '""')}"`
                    ]);
                }
            }
        }

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'inline; filename="whatsapp_catalog_feed.csv"',
                'Cache-Control': 'private, no-store'
            }
        });

    } catch (err: unknown) {
        console.error('Meta Catalog feed error:', err);
        return NextResponse.json({
            error: 'Failed to generate catalog feed',
            details: err instanceof Error ? err.message : String(err)
        }, { status: 500 });
    }
}
