/**
 * WhatsApp Timed Flash Drops & 10-Minute Reservation Pool Engine
 * (Option B: WhatsApp Commerce 2.0)
 *
 * Provides:
 *  1. Timed exclusive flash sales for @newsletter channels and @g.us groups.
 *  2. 10-minute temporary inventory reservation lock to prevent overselling.
 *  3. Automatic release of expired holds.
 *  4. Real-time conversion tracking.
 */

import { pb, getTenantStorageKey } from './pocketbase';
import { whatsappManager } from './whatsapp';
import { formatPrice } from './utils';

export const RESERVATION_HOLD_MINUTES = 10;
export const RESERVATION_HOLD_MS = RESERVATION_HOLD_MINUTES * 60 * 1000;

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
}

// In-memory fallback cache with localStorage persistence for fast reactivity
const BASE_STORAGE_KEY = 'luminila_flash_drops_v1';

function getFlashDropStorageKey(): string {
    return getTenantStorageKey(BASE_STORAGE_KEY);
}

function getStoredDrops(): FlashDropCampaign[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(getFlashDropStorageKey());
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function saveStoredDrops(drops: FlashDropCampaign[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(getFlashDropStorageKey(), JSON.stringify(drops));
        window.dispatchEvent(new CustomEvent('luminila:flash-drops-updated', { detail: { drops } }));
    } catch (err) {
        console.warn('Failed to save flash drops:', err);
    }
}

/**
 * Clean up reservations older than 10 minutes
 */
export function cleanExpiredReservations(drops?: FlashDropCampaign[]): { drops: FlashDropCampaign[]; expiredCount: number } {
    const list = drops || getStoredDrops();
    const now = Date.now();
    let expiredCount = 0;

    const updated = list.map(drop => {
        let changed = false;
        const newReservations = drop.reservations.map(res => {
            if (res.status === 'active' && new Date(res.expiresAt).getTime() <= now) {
                expiredCount++;
                changed = true;
                return { ...res, status: 'expired' as const };
            }
            return res;
        });

        // Auto-end campaign if past endTime
        const isEnded = new Date(drop.endTime).getTime() <= now;
        const status = isEnded ? 'ended' : drop.status;

        if (changed || status !== drop.status) {
            return { ...drop, reservations: newReservations, status };
        }
        return drop;
    });

    if (expiredCount > 0 && !drops) {
        saveStoredDrops(updated);
    }

    return { drops: updated, expiredCount };
}

/**
 * List all active and scheduled flash drops
 */
export async function listFlashDrops(): Promise<FlashDropCampaign[]> {
    const { drops } = cleanExpiredReservations();
    return drops;
}

/**
 * Get a specific flash drop by ID
 */
export async function getFlashDrop(dropId: string): Promise<FlashDropCampaign | null> {
    const { drops } = cleanExpiredReservations();
    return drops.find(d => d.id === dropId) || null;
}

/**
 * Calculate available stock for a variant inside a drop (allocated minus active reservations)
 */
export function getDropAvailableStock(drop: FlashDropCampaign, variantId: string): number {
    const item = drop.items.find(i => i.variantId === variantId);
    if (!item) return 0;

    const activeReservations = drop.reservations.filter(
        r => r.variantId === variantId && r.status === 'active' && new Date(r.expiresAt).getTime() > Date.now()
    ).length;

    const completedReservations = drop.reservations.filter(
        r => r.variantId === variantId && r.status === 'completed'
    ).length;

    return Math.max(0, item.allocatedStock - activeReservations - completedReservations);
}

/**
 * Create a new Flash Drop campaign
 */
export async function createFlashDropCampaign(input: {
    title: string;
    description?: string;
    items: FlashDropItem[];
    durationHours: number;
    targetJids: string[];
}): Promise<FlashDropCampaign> {
    const drops = getStoredDrops();
    const now = new Date();
    const endTime = new Date(now.getTime() + input.durationHours * 60 * 60 * 1000);

    const newDrop: FlashDropCampaign = {
        id: `DROP-${Date.now().toString(36).toUpperCase()}`,
        title: input.title,
        description: input.description,
        items: input.items,
        startTime: now.toISOString(),
        endTime: endTime.toISOString(),
        status: 'active',
        targetJids: input.targetJids,
        reservations: [],
        created: now.toISOString(),
    };

    drops.unshift(newDrop);
    saveStoredDrops(drops);

    return newDrop;
}

/**
 * Reserve stock for 10 minutes when a buyer initiates checkout
 */
export async function reserveFlashDropStock(
    dropId: string,
    variantId: string,
    customerPhone: string,
    customerName?: string
): Promise<{ success: boolean; reservation?: FlashDropReservation; error?: string }> {
    const drops = getStoredDrops();
    const dropIndex = drops.findIndex(d => d.id === dropId);
    if (dropIndex === -1) {
        return { success: false, error: 'Flash drop campaign not found' };
    }

    const drop = drops[dropIndex];
    const now = Date.now();

    if (new Date(drop.endTime).getTime() <= now) {
        return { success: false, error: 'This flash drop has ended' };
    }

    const item = drop.items.find(i => i.variantId === variantId);
    if (!item) {
        return { success: false, error: 'Product item not found in this flash drop' };
    }

    // Check existing active reservation for the same phone
    const existing = drop.reservations.find(
        r => r.variantId === variantId &&
             r.customerPhone === customerPhone &&
             r.status === 'active' &&
             new Date(r.expiresAt).getTime() > now
    );

    if (existing) {
        return { success: true, reservation: existing };
    }

    const available = getDropAvailableStock(drop, variantId);
    if (available <= 0) {
        return { success: false, error: 'Sorry! All flash drop stock is currently claimed or reserved.' };
    }

    const reservation: FlashDropReservation = {
        id: `RES-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
        dropId,
        variantId,
        customerPhone,
        customerName,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(now + RESERVATION_HOLD_MS).toISOString(),
        status: 'active',
    };

    drop.reservations.push(reservation);
    drops[dropIndex] = drop;
    saveStoredDrops(drops);

    return { success: true, reservation };
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
 * Complete a reservation on successful checkout
 */
export async function completeFlashDropReservation(reservationId: string, orderId: string): Promise<boolean> {
    const drops = getStoredDrops();
    for (let d = 0; d < drops.length; d++) {
        const resIdx = drops[d].reservations.findIndex(r => r.id === reservationId);
        if (resIdx !== -1) {
            drops[d].reservations[resIdx].status = 'completed';
            drops[d].reservations[resIdx].orderId = orderId;
            saveStoredDrops(drops);
            return true;
        }
    }
    return false;
}

/**
 * Format attractive WhatsApp message for timed drop broadcast
 */
export function formatFlashDropBroadcastMessage(
    drop: FlashDropCampaign,
    item: FlashDropItem,
    checkoutUrl: string
): string {
    const discount = Math.round(((item.originalPrice - item.dropPrice) / item.originalPrice) * 100);
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
 * Broadcast Flash Drop to WhatsApp Channels (@newsletter) or Groups (@g.us)
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

    for (const item of drop.items) {
        const checkoutUrl = `${baseUrl}/checkout/whatsapp?dropId=${drop.id}&variantId=${item.variantId}`;
        const message = formatFlashDropBroadcastMessage(drop, item, checkoutUrl);

        for (const jid of targetJids) {
            try {
                let ok = false;
                if (item.imageUrl) {
                    ok = await whatsappManager.sendFile(jid, item.imageUrl, `${item.sku}.jpg`, message);
                } else {
                    ok = await whatsappManager.sendMessage(jid, message);
                }

                if (ok) sent++;
                else failed++;
            } catch {
                failed++;
            }
        }
    }

    return { sent, failed };
}
