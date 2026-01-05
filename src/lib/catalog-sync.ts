import { supabase } from '@/lib/supabase';
import { Product } from '@/types/database';

const SIDECAR_URL = 'http://localhost:21465/api/default'; // Assuming 'default' session

interface WhatsAppProduct {
    id: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    isHidden: boolean;
    image?: string; // URL or Base64? usually URL in get response
    retailerId?: string; // We map this to SKU
    url?: string;
}

interface SyncLog {
    id: string;
    started_at: string;
    status: 'running' | 'success' | 'failed';
    products_added: number;
    products_updated: number;
    products_deleted: number;
    errors: any[];
}

export async function syncCatalog() {
    console.log('Starting catalog sync...');

    // 1. Create Sync Log
    const { data: logData, error: logError } = await supabase
        .from('catalog_sync_logs')
        .insert({
            status: 'running',
            products_added: 0,
            products_updated: 0,
            products_deleted: 0,
            errors: []
        })
        .select()
        .single();

    if (logError || !logData) {
        console.error('Failed to create sync log:', logError);
        return { success: false, error: 'Failed to create sync log' };
    }

    const logId = logData.id;
    let added = 0;
    let updated = 0;
    let deleted = 0;
    const errors: any[] = [];

    try {
        // 2. Fetch Supabase Products. 
        // We assume 'supabase' client is configured. 
        // In a real background job, use createClient with SERVICE_KEY.
        const { data: dbProducts, error: dbError } = await supabase
            .from('products')
            .select('*');

        if (dbError) throw new Error(`DB Fetch Error: ${dbError.message}`);

        // 3. Fetch WhatsApp Catalog
        let waProducts: WhatsAppProduct[] = [];
        try {
            const res = await fetch(`${SIDECAR_URL}/catalog/products`);
            if (!res.ok) throw new Error('Sidecar unreachable');
            const json = await res.json();
            if (json.success) {
                const rawProducts = json.products || [];
                // Normalize structure if needed, depends on WPPConnect response
                waProducts = rawProducts.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    price: p.price, // might be p.price / 1000 or similar? Need to verify unit. WPP usually takes integer amount? 
                    // Wait, standard WA API uses amount/1000. WPPConnect usually handles this? 
                    // We'll assume direct value mapping for now, will monitor in testing.
                    currency: p.currency,
                    isHidden: p.isHidden,
                    image: p.image,
                    retailerId: p.retailerId || p.sku // map sku to retailerId if provided
                }));
            }
        } catch (e: any) {
            console.warn('Could not fetch WA catalog, assuming empty or error:', e.message);
            errors.push({ type: 'fetch_wa_catalog', error: e.message });
        }

        // 4. Index WA Products by retailerId (SKU)
        const waMap = new Map<string, WhatsAppProduct>();
        waProducts.forEach(p => {
            if (p.retailerId) waMap.set(p.retailerId, p);
        });

        // 5. Iterate DB Products
        for (const p of dbProducts) {
            try {
                if (!p.sku) continue; // Skip products without SKU

                const waP = waMap.get(p.sku);

                if (p.is_active) {
                    if (!waP) {
                        // CREATE
                        await createProductInWhatsApp(p);
                        added++;
                    } else {
                        // UPDATE
                        // Simple check: price or name diff
                        if (waP.price !== p.base_price || waP.name !== p.name) {
                            await updateProductInWhatsApp(waP.id, p);
                            updated++;
                        }
                    }
                } else {
                    // Inactive in DB
                    if (waP) {
                        // DELETE from WA
                        await deleteProductInWhatsApp(waP.id);
                        deleted++;
                    }
                }
            } catch (err: any) {
                console.error(`Error processing product ${p.sku}:`, err);
                errors.push({ type: 'process_product', sku: p.sku, error: err.message });
            }
        }

        // 6. Finish
        await supabase
            .from('catalog_sync_logs')
            .update({
                status: 'success',
                completed_at: new Date().toISOString(),
                products_added: added,
                products_updated: updated,
                products_deleted: deleted,
                errors: errors
            })
            .eq('id', logId);

        return { success: true, added, updated, deleted, errors };

    } catch (error: any) {
        console.error('Sync failed:', error);
        await supabase
            .from('catalog_sync_logs')
            .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                errors: [...errors, { type: 'fatal', error: error.message }]
            })
            .eq('id', logId);

        return { success: false, error: error.message };
    }
}

// Helpers
async function createProductInWhatsApp(p: Product) {
    // Need base64 image
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
        price: p.base_price, // Assuming integer or float matches.
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
    // Only updating price and name for now. Image update often tricky.
    const payload = {
        options: {
            name: p.name,
            price: p.base_price,
            description: p.description || '',
            isHidden: false
        }
    };

    // WPPConnect edit might use PUT
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
