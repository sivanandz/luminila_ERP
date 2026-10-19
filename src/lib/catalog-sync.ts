import { pb } from '@/lib/pocketbase';
import { Product } from '@/types/database';
import { getWhatsAppUrl, whatsappManager } from '@/lib/whatsapp';
import { getChannelPrice } from '@/lib/channel-pricing';

const SIDECAR_URL = {
    toString() { return `${getWhatsAppUrl()}/api/${whatsappManager.getSessionIdSafe() || 'luminila'}`; },
    valueOf() { return `${getWhatsAppUrl()}/api/${whatsappManager.getSessionIdSafe() || 'luminila'}`; }
} as unknown as string;

interface WhatsAppProduct {
    id: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    isHidden: boolean;
    image?: string;
    retailerId?: string;
    url?: string;
}

interface SidecarCatalogProduct {
    id: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    isHidden: boolean;
    image?: string;
    retailerId?: string;
    sku?: string;
}

interface CatalogSyncError {
    type: 'fetch_wa_catalog' | 'process_product' | 'fatal';
    error: string;
    sku?: string;
}

export async function syncCatalog() {
    console.log('Starting catalog sync...');

    // 1. Create Sync Log
    let logData;
    try {
        logData = await pb.collection('catalog_sync_logs').create({
            status: 'running',
            products_added: 0,
            products_updated: 0,
            products_deleted: 0,
            errors: [],
        });
    } catch (logError) {
        console.error('Failed to create sync log:', logError);
        return { success: false, error: 'Failed to create sync log' };
    }

    const logId = logData.id;
    let added = 0;
    let updated = 0;
    let deleted = 0;
    const errors: CatalogSyncError[] = [];

    try {
        // 2. Fetch PocketBase Products
        const dbProducts = await pb.collection('products').getFullList();

        // 3. Fetch WhatsApp Catalog
        let waProducts: WhatsAppProduct[] = [];
        try {
            const res = await fetch(`${SIDECAR_URL}/catalog/products`);
            if (!res.ok) throw new Error('Sidecar unreachable');
            const json = await res.json();
            if (json.success) {
                const rawProducts = json.products || [];
                waProducts = rawProducts.map((p: SidecarCatalogProduct) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    currency: p.currency,
                    isHidden: p.isHidden,
                    image: p.image,
                    retailerId: p.retailerId || p.sku
                }));
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn('Could not fetch WA catalog:', message);
            errors.push({ type: 'fetch_wa_catalog', error: message });
        }

        // 4. Index WA Products by retailerId (SKU)
        const waMap = new Map<string, WhatsAppProduct>();
        waProducts.forEach(p => {
            if (p.retailerId) waMap.set(p.retailerId, p);
        });

        // 5. Iterate DB Products
        for (const p of dbProducts) {
            try {
                if (!p.sku) continue;

                const waP = waMap.get(p.sku);
                const targetPrice = getChannelPrice(p as unknown as Product, 'whatsapp');

                if (p.is_active) {
                    if (!waP) {
                        await createProductInWhatsApp(p as unknown as Product);
                        added++;
                    } else {
                        if (waP.price !== targetPrice || waP.name !== p.name) {
                            await updateProductInWhatsApp(waP.id, p as unknown as Product);
                            updated++;
                        }
                    }
                } else {
                    if (waP) {
                        await deleteProductInWhatsApp(waP.id);
                        deleted++;
                    }
                }
            } catch (err) {
                console.error(`Error processing product ${p.sku}:`, err);
                errors.push({ type: 'process_product', sku: p.sku, error: err instanceof Error ? err.message : String(err) });
            }
        }

        // 6. Finish
        await pb.collection('catalog_sync_logs').update(logId, {
            status: 'success',
            completed_at: new Date().toISOString(),
            products_added: added,
            products_updated: updated,
            products_deleted: deleted,
            errors: errors
        });

        return { success: true, added, updated, deleted, errors };

    } catch (error) {
        console.error('Sync failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        await pb.collection('catalog_sync_logs').update(logId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            errors: [...errors, { type: 'fatal', error: message }]
        });

        return { success: false, error: message };
    }
}

// Helpers
async function createProductInWhatsApp(p: Product) {
    let imageBase64 = '';
    if (p.image_url) {
        try {
            imageBase64 = await urlToBase64(p.image_url);
        } catch (e) {
            console.warn(`Failed to convert image for ${p.sku}`, e);
        }
    }

    const payload = {
        name: p.name,
        description: p.description || '',
        price: getChannelPrice(p, 'whatsapp'),
        currency: 'INR',
        isHidden: false,
        url: p.image_url || '',
        retailerId: p.sku,
        image: imageBase64
    };

    const res = await fetch(`${SIDECAR_URL}/catalog/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Create failed: ${res.statusText}`);
}

async function updateProductInWhatsApp(waId: string, p: Product) {
    const payload = {
        options: {
            name: p.name,
            price: getChannelPrice(p, 'whatsapp'),
            description: p.description || '',
            isHidden: false
        }
    };

    const res = await fetch(`${SIDECAR_URL}/catalog/products/${waId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
}

async function deleteProductInWhatsApp(waId: string) {
    const res = await fetch(`${SIDECAR_URL}/catalog/products/${waId}`, {
        method: 'DELETE'
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
}

async function urlToBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    return `data:${blob.type};base64,${buffer.toString('base64')}`;
}
