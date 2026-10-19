import { NextRequest, NextResponse } from 'next/server';
import { pb } from '@/lib/pocketbase';

export const dynamic = 'force-dynamic';

// Fallback high-res jewelry image
const DEFAULT_JEWELRY_IMAGE = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800&auto=format&fit=crop&q=80';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.redirect(DEFAULT_JEWELRY_IMAGE);
        }

        if (!pb.authStore.isValid) {
            try {
                await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');
            } catch { /* best effort */ }
        }

        const product = await pb.collection('products').getOne(id).catch(() => null);

        if (!product) {
            return NextResponse.redirect(DEFAULT_JEWELRY_IMAGE);
        }

        // 1. If explicit HTTP image_url exists
        if (product.image_url && product.image_url.startsWith('http')) {
            return NextResponse.redirect(product.image_url);
        }

        // 2. If base64 data URI in image_data exists
        if (product.image_data && typeof product.image_data === 'string' && product.image_data.startsWith('data:image')) {
            const matches = product.image_data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const contentType = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                return new NextResponse(buffer, {
                    status: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Content-Length': buffer.length.toString(),
                        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
                    }
                });
            }
        }

        // 3. Fallback to default
        return NextResponse.redirect(DEFAULT_JEWELRY_IMAGE);

    } catch (err) {
        console.error('Catalog image serving error:', err);
        return NextResponse.redirect(DEFAULT_JEWELRY_IMAGE);
    }
}
