/**
 * Omnichannel Real-Time Anti-Oversell Buffer Engine
 * Reverse-engineered from Vasy.ai Omnichannel E-Commerce ERP features.
 * 
 * Prevents dual-selling between physical store counters (POS) and online channels
 * (Shopify, WooCommerce, WhatsApp Catalog, Marketplaces).
 */

export type SalesChannel =
    | 'pos'
    | 'shopify'
    | 'woocommerce'
    | 'whatsapp'
    | 'amazon'
    | 'other';

export interface ChannelBufferConfig {
    channel: SalesChannel;
    safetyBuffer: number;      // Reserve held back from this channel
    isFrozen?: boolean;        // Manual channel freeze
    priorityOrder: number;     // 1 = highest priority (POS)
}

export interface ChannelStockAllocation {
    channel: SalesChannel;
    allocatedStock: number;    // Quantity visible & sellable on this channel
    isFrozen: boolean;
    freezeReason?: string;
}

export interface StockAllocationResult {
    variantId: string;
    totalPhysicalStock: number;
    activeReservations: number;
    effectiveAvailableStock: number;
    channelAllocations: Record<SalesChannel, ChannelStockAllocation>;
    warning?: string;
}

export interface ActiveCartReservation {
    cartId: string;
    variantId: string;
    quantity: number;
    channel: SalesChannel;
    reservedAt: number;        // Epoch timestamp ms
    expiresAt: number;         // Epoch timestamp ms
}

export const DEFAULT_CHANNEL_CONFIGS: ChannelBufferConfig[] = [
    { channel: 'pos', safetyBuffer: 0, priorityOrder: 1 },         // POS can sell down to last piece
    { channel: 'whatsapp', safetyBuffer: 1, priorityOrder: 2 },    // WhatsApp priority customers
    { channel: 'shopify', safetyBuffer: 2, priorityOrder: 3 },     // Online Shopify buffer 2 units
    { channel: 'woocommerce', safetyBuffer: 2, priorityOrder: 4 }, // Online WooCommerce buffer 2 units
    { channel: 'amazon', safetyBuffer: 3, priorityOrder: 5 },      // Marketplaces buffer 3 units
];

/**
 * Calculates sellable stock per channel taking buffers, reservations, and freezes into account
 */
export function calculateChannelStock(
    totalPhysicalStock: number,
    activeReservations: number = 0,
    configs: ChannelBufferConfig[] = DEFAULT_CHANNEL_CONFIGS,
    variantId: string = 'var-default'
): StockAllocationResult {
    const rawStock = Math.max(0, Math.floor(totalPhysicalStock));
    const reserved = Math.max(0, Math.floor(activeReservations));
    const effectiveStock = Math.max(0, rawStock - reserved);

    const allocations = {} as Record<SalesChannel, ChannelStockAllocation>;

    for (const cfg of configs) {
        if (cfg.isFrozen) {
            allocations[cfg.channel] = {
                channel: cfg.channel,
                allocatedStock: 0,
                isFrozen: true,
                freezeReason: 'Channel manually frozen by administrator',
            };
            continue;
        }

        // For POS, full effective stock is sellable
        if (cfg.channel === 'pos') {
            allocations[cfg.channel] = {
                channel: cfg.channel,
                allocatedStock: effectiveStock,
                isFrozen: effectiveStock === 0,
                freezeReason: effectiveStock === 0 ? 'Out of physical stock' : undefined,
            };
            continue;
        }

        // For online/external channels, apply safety buffer
        const sellable = Math.max(0, effectiveStock - cfg.safetyBuffer);
        const isAutoFrozen = sellable === 0 && effectiveStock > 0;

        allocations[cfg.channel] = {
            channel: cfg.channel,
            allocatedStock: sellable,
            isFrozen: sellable === 0,
            freezeReason: isAutoFrozen
                ? `Safety buffer threshold (${cfg.safetyBuffer} units) active; physical stock reserved for in-store walk-in buyers`
                : (effectiveStock === 0 ? 'Out of physical stock' : undefined),
        };
    }

    let warning: string | undefined;
    if (rawStock > 0 && effectiveStock <= 2) {
        warning = `Critical stock level (${rawStock} units remaining). Online channels throttled to prevent in-store dual selling.`;
    }

    return {
        variantId,
        totalPhysicalStock: rawStock,
        activeReservations: reserved,
        effectiveAvailableStock: effectiveStock,
        channelAllocations: allocations,
        warning,
    };
}

/**
 * In-memory temporary cart reservation tracker with TTL
 */
export class CartReservationManager {
    private reservations: Map<string, ActiveCartReservation[]> = new Map();

    /**
     * Attempts to acquire stock reservation for checkout
     */
    public reserveStock(
        cartId: string,
        variantId: string,
        quantity: number,
        channel: SalesChannel,
        currentPhysicalStock: number,
        ttlMinutes: number = 15,
        configs: ChannelBufferConfig[] = DEFAULT_CHANNEL_CONFIGS
    ): { success: boolean; reservedQuantity: number; error?: string } {
        this.cleanExpired();

        const activeRes = this.getActiveReservationCount(variantId);
        const allocation = calculateChannelStock(currentPhysicalStock, activeRes, configs, variantId);
        const channelAlloc = allocation.channelAllocations[channel];

        if (!channelAlloc || channelAlloc.isFrozen || channelAlloc.allocatedStock < quantity) {
            return {
                success: false,
                reservedQuantity: 0,
                error: channelAlloc?.freezeReason || `Insufficient sellable stock on channel ${channel}. Available: ${channelAlloc?.allocatedStock ?? 0}`,
            };
        }

        const now = Date.now();
        const resEntry: ActiveCartReservation = {
            cartId,
            variantId,
            quantity,
            channel,
            reservedAt: now,
            expiresAt: now + (ttlMinutes * 60 * 1000),
        };

        if (!this.reservations.has(variantId)) {
            this.reservations.set(variantId, []);
        }
        this.reservations.get(variantId)!.push(resEntry);

        return {
            success: true,
            reservedQuantity: quantity,
        };
    }

    /**
     * Releases or commits reservation upon order completion / abandonment
     */
    public releaseReservation(cartId: string, variantId?: string): number {
        let releasedCount = 0;
        for (const [vId, list] of this.reservations.entries()) {
            if (variantId && vId !== variantId) continue;
            const remaining = list.filter(r => {
                if (r.cartId === cartId) {
                    releasedCount += r.quantity;
                    return false;
                }
                return true;
            });
            this.reservations.set(vId, remaining);
        }
        return releasedCount;
    }

    /**
     * Gets total active reserved units for a variant
     */
    public getActiveReservationCount(variantId: string): number {
        this.cleanExpired();
        const list = this.reservations.get(variantId) || [];
        return list.reduce((sum, r) => sum + r.quantity, 0);
    }

    private cleanExpired() {
        const now = Date.now();
        for (const [vId, list] of this.reservations.entries()) {
            const active = list.filter(r => r.expiresAt > now);
            this.reservations.set(vId, active);
        }
    }
}
