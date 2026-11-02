/**
 * WhatsApp Timed Flash Drops & 10-Minute Reservation Pool Engine
 * (Option B: WhatsApp Commerce 2.0)
 *
 * Provides:
 *  1. Timed exclusive flash sales for @newsletter channels and @g.us groups.
 *  2. 10-minute temporary inventory reservation lock to prevent overselling.
 *  3. Automatic release of expired holds.
 *  4. Real-time conversion tracking.
 *
 * Persistence (WA-01): campaigns and reservations live in PocketBase
 * (`flash_drops` / `flash_drop_reservations`, migration 1793001100). A drop
 * created by the operator is therefore visible to a buyer on any device, and a
 * hold is enforced by the server. `localStorage` is no longer a store: the
 * previous `luminila_flash_drops_v1` blob made every external checkout link
 * resolve to "Flash Drop Not Found".
 *
 * The public checkout page reads through `/api/storefront/flash-drop` (the
 * browser session is unauthenticated, so PocketBase rules would deny it); the
 * operator surfaces read PocketBase directly under the tenant filter.
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import { whatsappManager } from './whatsapp';

export const RESERVATION_HOLD_MINUTES = 10;
export const RESERVATION_HOLD_MS = RESERVATION_HOLD_MINUTES * 60 * 1000;

export const FLASH_DROP_COLLECTION = 'flash_drops';
export const FLASH_RESERVATION_COLLECTION = 'flash_drop_reservations';

export interface FlashDropItem {
    productId: string;
    variantId: string;
    name: string;
    sku: string;
    imageUrl?: string;
    originalPrice: number;
    dropPrice: number;
    allocatedStock: number;
}

export interface FlashDropReservation {
    id: string;
    dropId: string;
    variantId: string;
    customerPhone: string;
    customerName?: string;
    shippingAddress?: string;
    createdAt: string;
    expiresAt: string;
    status: 'active' | 'completed' | 'expired' | 'cancelled';
    orderId?: string;
}

export interface FlashDropCampaign {
    id: string;
    title: string;
    description?: string;
    items: FlashDropItem[];
    startTime: string;
    endTime: string;
    status: 'draft' | 'scheduled' | 'active' | 'ended';
    targetJids: string[];
    reservations: FlashDropReservation[];
    created?: string;
    accountEmail?: string;
    /** Server-computed units left per variant (public projection only). */
    availableStock?: Record<string, number>;
}

interface FlashDropRecord {
    id: string;
    account_email?: string;
    title?: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
    status?: string;
    items?: unknown;
    target_jids?: unknown;
    created?: string;
}

interface FlashReservationRecord {
    id: string;
    drop?: string;
    variant?: string;
    phone?: string;
    name?: string;
    status?: string;
    expires_at?: string;
    order?: string;
    created?: string;
}

function parsePbDate(value?: string): string {
    if (!value) return '';
    // PocketBase serialises dates with a space separator; Safari/older engines
    // only parse the ISO `T` form.
    const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeItems(raw: unknown): FlashDropItem[] {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value
        .map((entry): FlashDropItem | null => {
            if (!entry || typeof entry !== 'object') return null;
            const item = entry as Record<string, unknown>;
            const variantId = String(item.variantId || '').trim();
            if (!variantId) return null;
            return {
                productId: String(item.productId || '').trim(),
                variantId,
                name: String(item.name || 'Jewelry piece'),
                sku: String(item.sku || ''),
                imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
                originalPrice: Math.max(0, Number(item.originalPrice) || 0),
                dropPrice: Math.max(0, Number(item.dropPrice) || 0),
                allocatedStock: Math.max(0, Math.floor(Number(item.allocatedStock) || 0)),
            };
        })
        .filter((item): item is FlashDropItem => item !== null);
}

function serializeItems(items: FlashDropItem[]): FlashDropItem[] {
    return normalizeItems(items);
}

function mapReservation(record: FlashReservationRecord): FlashDropReservation {
    const status = String(record.status || 'active') as FlashDropReservation['status'];
    return {
        id: record.id,
        dropId: String(record.drop || ''),
        variantId: String(record.variant || ''),
        customerPhone: String(record.phone || ''),
        customerName: record.name || undefined,
        createdAt: parsePbDate(record.created),
        expiresAt: parsePbDate(record.expires_at),
        status,
        orderId: record.order || undefined,
    };
}

function parseJidList(raw: unknown): string[] {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    return Array.isArray(value) ? value.map(String) : [];
}

function mapDrop(record: FlashDropRecord, reservations: FlashDropReservation[]): FlashDropCampaign {
    const start = parsePbDate(record.starts_at);
    const end = parsePbDate(record.ends_at);
    return {
        id: record.id,
        title: record.title || 'Flash Drop',
        description: record.description || undefined,
        items: normalizeItems(record.items),
        startTime: start,
        endTime: end,
        status: (record.status as FlashDropCampaign['status']) || 'active',
        targetJids: parseJidList(record.target_jids),
        reservations,
        created: parsePbDate(record.created),
        accountEmail: record.account_email || undefined,
    };
}

/** Tenant email of the signed-in operator; '' when there is no usable session. */
function currentTenantEmail(): string {
    const email = (getCurrentTenantEmail() || '').trim().toLowerCase();
    return email === 'default' ? '' : email;
}

/** Scope a filter to the signed-in tenant (same shape as the PB rules). */
export function withTenantFilter(extra?: string, tenantEmail?: string): string {
    const email = (tenantEmail || currentTenantEmail()).trim().toLowerCase();
    const base = (extra || '').trim();
    if (!email) return base;
    const scope = `account_email = "${sanitizeFilter(email)}"`;
    return base ? `(${base}) && ${scope}` : scope;
}

function belongsToTenant(record: { account_email?: string }, tenantEmail: string): boolean {
    const stored = String(record.account_email || '').trim().toLowerCase();
    // Rows created before account_email existed are treated as tenant-owned only
    // when there is a single account; otherwise they are another tenant's.
    return !stored || stored === tenantEmail;
}

/**
 * Mark active holds whose 10 minutes elapsed as expired so the admin lists and
 * the availability maths agree with the server. Best effort: availability is
 * always recomputed from `expires_at`, so a failed write never oversells.
 */
export async function expireStaleReservations(dropId?: string): Promise<number> {
    const tenant = currentTenantEmail();
    if (!tenant) return 0;
    const nowIso = new Date().toISOString();
    try {
        const stale = await pb.collection(FLASH_RESERVATION_COLLECTION).getFullList({
            filter: withTenantFilter(
                `status = "active" && expires_at <= "${sanitizeFilter(nowIso)}"${dropId ? ` && drop = "${sanitizeFilter(dropId)}"` : ''}`,
                tenant
            ),
            fields: 'id',
        });
        await Promise.all(
            stale.map((row) =>
                pb.collection(FLASH_RESERVATION_COLLECTION).update(row.id, { status: 'expired' }).catch(() => {})
            )
        );
        return stale.length;
    } catch {
        return 0;
    }
}

async function loadReservations(dropId: string, tenant: string): Promise<FlashDropReservation[]> {
    try {
        const records = await pb.collection(FLASH_RESERVATION_COLLECTION).getFullList({
            filter: withTenantFilter(`drop = "${sanitizeFilter(dropId)}"`, tenant),
            sort: '-created',
        });
        return (records as unknown as FlashReservationRecord[]).map(mapReservation);
    } catch {
        return [];
    }
}

/**
 * Expire holds in an already-loaded list (pure, for the UI). The server is the
 * authority; this only keeps the rendered countdowns honest.
 */
export function cleanExpiredReservations(drops?: FlashDropCampaign[]): { drops: FlashDropCampaign[]; expiredCount: number } {
    const list = drops || [];
    const now = Date.now();
    let expiredCount = 0;

    const updated = list.map((drop) => {
        let changed = false;
        const newReservations = drop.reservations.map((res) => {
            if (res.status === 'active' && new Date(res.expiresAt).getTime() <= now) {
                expiredCount++;
                changed = true;
                return { ...res, status: 'expired' as const };
            }
            return res;
        });

        const isEnded = new Date(drop.endTime).getTime() <= now;
        const status = isEnded ? 'ended' : drop.status;

        if (changed || status !== drop.status) {
            return { ...drop, reservations: newReservations, status };
        }
        return drop;
    });

    return { drops: updated, expiredCount };
}

/** Public/unauthenticated read through the storefront route. */
async function fetchPublicDrop(dropId: string, accountEmail?: string): Promise<FlashDropCampaign | null> {
    try {
        const params = new URLSearchParams({ dropId });
        if (accountEmail) params.set('account_email', accountEmail);
        const res = await fetch(`/api/storefront/flash-drop?${params.toString()}`, {
            cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data?.drop) return null;
        return data.drop as FlashDropCampaign;
    } catch {
        return null;
    }
}

/**
 * List all flash drops for the signed-in tenant (admin surfaces).
 */
export async function listFlashDrops(): Promise<FlashDropCampaign[]> {
    const tenant = currentTenantEmail();
    if (!tenant) return [];

    try {
        await expireStaleReservations();
        const records = await pb.collection(FLASH_DROP_COLLECTION).getFullList({
            filter: withTenantFilter(undefined, tenant),
            sort: '-created',
        });

        const reservations = await pb.collection(FLASH_RESERVATION_COLLECTION).getFullList({
            filter: withTenantFilter(undefined, tenant),
            sort: '-created',
        }).catch(() => []);
        const byDrop = new Map<string, FlashDropReservation[]>();
        for (const row of reservations as unknown as FlashReservationRecord[]) {
            const mapped = mapReservation(row);
            const key = mapped.dropId;
            if (!key) continue;
            const bucket = byDrop.get(key) || [];
            bucket.push(mapped);
            byDrop.set(key, bucket);
        }

        const drops = (records as unknown as FlashDropRecord[])
            .filter((record) => belongsToTenant(record, tenant))
            .map((record) => mapDrop(record, byDrop.get(record.id) || []));

        return cleanExpiredReservations(drops).drops;
    } catch (err) {
        console.warn('[flash-drops] listFlashDrops failed:', err);
        return [];
    }
}

/**
 * Get a specific flash drop by ID.
 *
 * Public browsers (the WhatsApp checkout link) are unauthenticated, so their
 * PocketBase read would be rejected by the collection rules; they go through
 * the server route instead. An authenticated operator reads the record (with
 * its reservations) directly.
 */
export async function getFlashDrop(dropId: string, accountEmail?: string): Promise<FlashDropCampaign | null> {
    if (!dropId) return null;

    const tenant = currentTenantEmail();
    const authenticated = typeof window === 'undefined' || pb.authStore.isValid;

    if (!authenticated || !tenant) {
        return fetchPublicDrop(dropId, accountEmail);
    }

    try {
        const record = await pb.collection(FLASH_DROP_COLLECTION).getOne(dropId) as unknown as FlashDropRecord;
        if (!belongsToTenant(record, tenant)) {
            // The link belongs to another store: read the public projection for
            // that store instead of reporting the drop as missing.
            return fetchPublicDrop(dropId, accountEmail || record.account_email);
        }
        await expireStaleReservations(dropId);
        const reservations = await loadReservations(dropId, tenant);
        return cleanExpiredReservations([mapDrop(record, reservations)]).drops[0] || null;
    } catch {
        // The id may belong to a tenant this browser cannot read; fall back to
        // the public projection (no reservation data) before giving up.
        return fetchPublicDrop(dropId, accountEmail || tenant);
    }
}

/**
 * Calculate available stock for a variant inside a drop (allocated minus active
 * and completed reservations). Expired holds stop counting the moment their
 * `expiresAt` passes, even before the cleanup write lands.
 */
export function getDropAvailableStock(drop: FlashDropCampaign, variantId: string): number {
    const item = drop.items.find((i) => i.variantId === variantId);
    if (!item) return 0;

    const activeReservations = drop.reservations.filter(
        (r) => r.variantId === variantId && r.status === 'active' && new Date(r.expiresAt).getTime() > Date.now()
    ).length;

    const completedReservations = drop.reservations.filter(
        (r) => r.variantId === variantId && r.status === 'completed'
    ).length;

    return Math.max(0, item.allocatedStock - activeReservations - completedReservations);
}

/**
 * Create a new Flash Drop campaign (operator).
 */
export async function createFlashDropCampaign(input: {
    title: string;
    description?: string;
    items: FlashDropItem[];
    durationHours: number;
    targetJids: string[];
}): Promise<FlashDropCampaign> {
    const tenant = currentTenantEmail();
    if (!tenant) {
        throw new Error('No tenant session: sign in before launching a flash drop.');
    }
    const items = serializeItems(input.items);
    if (items.length === 0) {
        throw new Error('A flash drop needs at least one product with a variant.');
    }

    const now = Date.now();
    const hours = Number(input.durationHours);
    const duration = Number.isFinite(hours) && hours > 0 ? hours : 4;

    const record = await pb.collection(FLASH_DROP_COLLECTION).create({
        account_email: tenant,
        title: input.title.trim(),
        description: input.description?.trim() || '',
        starts_at: new Date(now).toISOString(),
        ends_at: new Date(now + duration * 60 * 60 * 1000).toISOString(),
        status: 'active',
        items,
        target_jids: input.targetJids,
        created_by: pb.authStore.model?.id || '',
    }) as unknown as FlashDropRecord;

    return mapDrop(record, []);
}

/**
 * Update an existing campaign (operator). Only the mutable fields are accepted;
 * items stay a pricing snapshot so a completed sale cannot be repriced.
 */
export async function updateFlashDropCampaign(
    dropId: string,
    patch: {
        title?: string;
        description?: string;
        items?: FlashDropItem[];
        status?: FlashDropCampaign['status'];
        endsAt?: string;
        targetJids?: string[];
    }
): Promise<FlashDropCampaign> {
    const tenant = currentTenantEmail();
    if (!tenant) throw new Error('No tenant session: sign in before updating a flash drop.');

    const existing = await pb.collection(FLASH_DROP_COLLECTION).getOne(dropId) as unknown as FlashDropRecord;
    if (!belongsToTenant(existing, tenant)) {
        throw new Error('This flash drop belongs to another account.');
    }

    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title.trim();
    if (patch.description !== undefined) payload.description = patch.description.trim();
    if (patch.items !== undefined) payload.items = serializeItems(patch.items);
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.endsAt !== undefined) payload.ends_at = patch.endsAt;
    if (patch.targetJids !== undefined) payload.target_jids = patch.targetJids;

    const updated = await pb.collection(FLASH_DROP_COLLECTION).update(dropId, payload) as unknown as FlashDropRecord;
    const reservations = await loadReservations(dropId, tenant);
    return mapDrop(updated, reservations);
}

/**
 * Reserve stock for 10 minutes when a buyer initiates checkout.
 *
 * The server owns the hold: the route expires stale rows, counts live holds and
 * creates the reservation under the tenant. The client only transports the
 * phone/variant and never chooses a price or a stock quantity.
 */
export async function reserveFlashDropStock(
    dropId: string,
    variantId: string,
    customerPhone: string,
    customerName?: string,
    accountEmail?: string
): Promise<{ success: boolean; reservation?: FlashDropReservation; error?: string }> {
    const phone = customerPhone.replace(/\D/g, '');
    if (phone.length < 10) {
        return { success: false, error: 'A valid 10-digit WhatsApp phone number is required.' };
    }

    const tenant = (accountEmail || currentTenantEmail()).trim().toLowerCase();
    try {
        const res = await fetch('/api/storefront/flash-drop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'reserve',
                dropId,
                variantId,
                phone,
                name: customerName || '',
                accountEmail: tenant || undefined,
            }),
        });
        const data = await res.json().catch(() => null) as
            | { success?: boolean; reservation?: FlashDropReservation; error?: string }
            | null;
        if (!res.ok || !data?.success || !data?.reservation) {
            return { success: false, error: data?.error || 'Could not reserve this item.' };
        }
        return { success: true, reservation: data.reservation };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Could not reach the reservation service.',
        };
    }
}

/**
 * Get remaining seconds on an active reservation
 */
export function getReservationCountdown(expiresAt: string): { isExpired: boolean; remainingSeconds: number; formatted: string } {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) {
        return { isExpired: true, remainingSeconds: 0, formatted: '00:00' };
    }

    const remainingSeconds = Math.floor(diffMs / 1000);
    const mins = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
    const secs = (remainingSeconds % 60).toString().padStart(2, '0');

    return {
        isExpired: false,
        remainingSeconds,
        formatted: `${mins}:${secs}`,
    };
}

/**
 * Complete a reservation on a server-verified payment (operator/back-office).
 * The public confirmation path does the same write inside the route, so this is
 * only needed when a payment is reconciled manually.
 */
export async function completeFlashDropReservation(reservationId: string, orderId: string): Promise<boolean> {
    const tenant = currentTenantEmail();
    try {
        const record = await pb.collection(FLASH_RESERVATION_COLLECTION).getOne(reservationId);
        if (!belongsToTenant(record as { account_email?: string }, tenant)) return false;
        await pb.collection(FLASH_RESERVATION_COLLECTION).update(reservationId, {
            status: 'completed',
            order: orderId,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Format attractive WhatsApp message for timed drop broadcast
 */
export function formatFlashDropBroadcastMessage(
    drop: FlashDropCampaign,
    item: FlashDropItem,
    checkoutUrl: string
): string {
    const discount = item.originalPrice > 0
        ? Math.round(((item.originalPrice - item.dropPrice) / item.originalPrice) * 100)
        : 0;
    const end = new Date(drop.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    return [
        '✨ *LUMINILA JEWELRY — VIP FLASH DROP* ✨',
        '',
        `🔥 *${drop.title.toUpperCase()}*`,
        drop.description ? `_${drop.description}_` : '',
        '',
        `💎 Item: *${item.name}*`,
        `🏷️ SKU: \`${item.sku}\``,
        `💰 Flash Price: *₹${item.dropPrice.toLocaleString('en-IN')}* _(Save ${discount}% • MRP: ₹${item.originalPrice.toLocaleString('en-IN')})_`,
        `⏰ *Flash Sale Ends at ${end}*`,
        `⚡ Available: *Only ${item.allocatedStock} pieces available!*`,
        '',
        '⏳ *URGENT 10-MINUTE STOCK HOLD NOTICE:*',
        '• Opening checkout reserves 1 piece exclusively for you for *10 MINUTES ONLY*.',
        '• If payment is not completed within 10 minutes, the hold expires automatically and stock is released back to other VIP shoppers.',
        '',
        `👉 *Claim & 1-Click Pay with UPI:*`,
        `${checkoutUrl}`,
        '',
        '_Free insured shipping across India • 100% Anti-Tarnish Lifetime Polish Guarantee_',
    ].filter(Boolean).join('\n');
}

/**
 * Format WhatsApp confirmation message informing customer of active 10-minute hold
 */
export function formatReservationHoldMessage(
    reservation: FlashDropReservation,
    item: FlashDropItem,
    checkoutUrl: string
): string {
    const expiresFormatted = new Date(reservation.expiresAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return [
        '🔒 *LUMINILA JEWELS — 10-MINUTE STOCK HOLD CONFIRMED* 🔒',
        '',
        reservation.customerName ? `Dear *${reservation.customerName}*,` : 'Hello,',
        '',
        `We have temporarily reserved 1 piece of *${item.name}* exclusively for your order.`,
        '',
        '⏳ *IMPORTANT: 10-MINUTE HOLD POLICY*',
        `• Your reservation is active until *${expiresFormatted}* (10 minutes from claim).`,
        '• If payment is not completed within 10 minutes, this hold will automatically expire and the item will be released back to the next buyer in queue.',
        '',
        `💰 Amount Due: *₹${item.dropPrice.toLocaleString('en-IN')}*`,
        '',
        '👉 *Complete Your 1-Click UPI Payment Now:*',
        `${checkoutUrl}`,
        '',
        '_Secure 256-bit UPI Checkout • Free Doorstep Delivery across India_',
    ].filter(Boolean).join('\n');
}

/**
 * Send WhatsApp notification directly to customer confirming their 10-minute hold window
 */
export async function sendReservationHoldWhatsAppNotification(
    reservation: FlashDropReservation,
    item: FlashDropItem,
    checkoutUrl: string
): Promise<boolean> {
    if (!reservation.customerPhone) return false;
    const msg = formatReservationHoldMessage(reservation, item, checkoutUrl);
    try {
        return await whatsappManager.sendMessage(reservation.customerPhone, msg);
    } catch (err) {
        console.warn('Failed to send WhatsApp reservation notification:', err);
        return false;
    }
}

/**
 * Broadcast Flash Drop to WhatsApp Channels (@newsletter) or Groups (@g.us).
 * `account_email` is carried in the checkout link so a buyer on a device with no
 * session still resolves the correct tenant.
 */
export async function broadcastFlashDropToWhatsApp(
    dropId: string,
    targetJids: string[],
    baseUrl: string = typeof window !== 'undefined' ? window.location.origin : ''
): Promise<{ sent: number; failed: number }> {
    const drop = await getFlashDrop(dropId);
    if (!drop) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const account = drop.accountEmail || currentTenantEmail();

    for (const item of drop.items) {
        const params = new URLSearchParams({ dropId: drop.id, variantId: item.variantId });
        if (account) params.set('account_email', account);
        const checkoutUrl = `${baseUrl}/checkout/whatsapp?${params.toString()}`;
        const message = formatFlashDropBroadcastMessage(drop, item, checkoutUrl);

        for (const jid of targetJids) {
            try {
                // WA-15: the sidecar's send-image accepts an HTTP imageUrl;
                // send-file expects base64 and rejected the URL.
                const ok = item.imageUrl
                    ? await whatsappManager.sendImage(jid, item.imageUrl, message, `${item.sku || 'drop'}.jpg`)
                    : await whatsappManager.sendMessage(jid, message);

                if (ok) sent++;
                else failed++;
            } catch {
                failed++;
            }
        }
    }

    return { sent, failed };
}
