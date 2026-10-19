import { NextRequest, NextResponse } from 'next/server';
import { pb } from '@/lib/pocketbase';

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
        const accountEmail = searchParams.get('account_email') || '';
        const phone = searchParams.get('phone') || '917092122334';

        // Ensure superuser authentication to bypass tenant isolation for public feed generation
        if (!pb.authStore.isValid) {
            try {
                await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');
            } catch {
                try {
                    await pb.collection('_superusers').authWithPassword('ananya@heritagejewels.com', 'Ananya2026!');
                } catch { /* proceed with current auth */ }
            }
        }

        // 1. Fetch active products
        const productFilter = accountEmail 
            ? `is_active = true && account_email = "${accountEmail}"` 
            : `is_active = true`;
        const products = await pb.collection('products').getFullList({
            filter: productFilter,
            sort: '-created'
        });

        // 2. Fetch variants
        const variantFilter = accountEmail 
            ? `account_email = "${accountEmail}"` 
            : '';
        const variants = await pb.collection('product_variants').getFullList({
            ...(variantFilter ? { filter: variantFilter } : {})
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

        const forwardedHost = req.headers.get('x-forwarded-host');
        const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
        const origin = forwardedHost 
            ? `${forwardedProto}://${forwardedHost}` 
            : req.nextUrl.origin;

        for (const p of products) {
            const pVariants = variantsByProduct.get(p.id) || [];
            const cleanDescription = (p.description || p.name || '')
                .replace(/[\r\n]+/g, ' ')
                .replace(/"/g, '""');
            const brand = 'Niththigal Jewellery';
            const basePrice = Number(p.base_price) || 0;
            const imageLink = (p.image_url && p.image_url.startsWith('http'))
                ? p.image_url
                : `${origin}/api/catalog/image?id=${p.id}`;

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
                'Cache-Control': 'public, max-age=300, s-maxage=300'
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
