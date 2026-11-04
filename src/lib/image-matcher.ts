/**
 * Image Matcher Utility
 * Uses perceptual hashing for reverse image search with PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

interface MatchResult {
    product: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
        image_url: string | null;
    };
    similarity: number;
}

/**
 * Generate a simple perceptual hash from an image data URL
 * Uses average hash (aHash) algorithm
 */
export async function generateImageHash(imageDataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                // Create 8x8 canvas for hashing
                const canvas = document.createElement('canvas');
                canvas.width = 8;
                canvas.height = 8;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('Could not get canvas context'));
                    return;
                }

                // Draw resized grayscale image
                ctx.filter = 'grayscale(100%)';
                ctx.drawImage(img, 0, 0, 8, 8);

                // Get pixel data
                const imageData = ctx.getImageData(0, 0, 8, 8);
                const pixels = imageData.data;

                // Calculate average brightness
                let sum = 0;
                const grayscaleValues: number[] = [];
                for (let i = 0; i < pixels.length; i += 4) {
                    const gray = pixels[i]; // R value (already grayscale)
                    grayscaleValues.push(gray);
                    sum += gray;
                }
                const avg = sum / grayscaleValues.length;

                // Generate hash: 1 if pixel > average, 0 otherwise
                let hash = '';
                for (const val of grayscaleValues) {
                    hash += val > avg ? '1' : '0';
                }

                resolve(hash);
            } catch (e) {
                reject(e);
            }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageDataUrl;
    });
}

/**
 * Calculate Hamming distance between two hashes
 */
export function calculateSimilarity(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) return 0;

    let matching = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] === hash2[i]) matching++;
    }

    return matching / hash1.length;
}

/**
 * Find matching products for an image
 */
export async function findMatchingProducts(imageDataUrl: string, threshold = 0.6): Promise<MatchResult[]> {
    try {
        // Generate hash for input image
        const inputHash = await generateImageHash(imageDataUrl);
        console.log('[ImageMatcher] Input hash:', inputHash);

        // Fetch active products that actually have a photo, scoped to this tenant.
        // `image_data` (base64 gallery/camera captures) is as valid a source as
        // `image_url`; matching only image_url silently skipped those (INV-14).
        const tenant = accountScopeEmail();
        if (!tenant) {
            // Without a tenant the query would match every account's catalog
            // (ENG-1): refuse instead of running unscoped.
            console.warn('[ImageMatcher] No tenant account resolved; skipping image match.');
            return [];
        }
        const products = await pb.collection('products').getFullList({
            filter: `is_active = true && (image_url != "" || image_data != "") && account_email = "${sanitizeFilter(tenant)}"`,
        });

        const results: MatchResult[] = [];

        for (const product of products) {
            // Skip products without image hash
            if (!product.image_hash) {
                continue;
            }

            const similarity = calculateSimilarity(inputHash, product.image_hash);

            if (similarity >= threshold) {
                results.push({
                    product: {
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        base_price: product.base_price,
                        image_url: product.image_url
                    },
                    similarity
                });
            }
        }

        // Sort by similarity descending
        results.sort((a, b) => b.similarity - a.similarity);

        console.log('[ImageMatcher] Found', results.length, 'matches');
        return results.slice(0, 5); // Return top 5
    } catch (e) {
        console.error('[ImageMatcher] Error:', e);
        return [];
    }
}

/**
 * Store image hash for a product
 */
export async function storeProductImageHash(productId: string, imageUrl: string): Promise<boolean> {
    try {
        const hash = await generateImageHash(imageUrl);

        await pb.collection('products').update(productId, { image_hash: hash });

        return true;
    } catch (e) {
        console.error('[ImageMatcher] Error storing hash:', e);
        return false;
    }
}
