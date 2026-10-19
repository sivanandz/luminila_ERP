/**
 * Multi-Channel Pricing Engine
 * Handles channel-specific pricing (POS, WhatsApp, Shopify, Wholesale, Exhibitions, Custom Channels)
 */

import { pb } from "./pocketbase";

export interface SalesChannelDefinition {
    id: string;
    name?: string;
    label: string;
    shortLabel: string;
    description: string;
    badgeColor: "blue" | "emerald" | "violet" | "amber" | "pink" | "cyan" | "indigo" | "rose";
    discountPreset?: number;
    isDefault?: boolean;
    isCustom?: boolean;
}

export type SalesChannelDef = SalesChannelDefinition;

export const DEFAULT_SALES_CHANNELS: SalesChannelDefinition[] = [
    {
        id: "pos",
        name: "Shop (In-Store POS)",
        label: "Shop (In-Store POS)",
        shortLabel: "Shop",
        description: "Standard counter, showroom, and walk-in retail price",
        badgeColor: "blue",
        isDefault: true,
    },
    {
        id: "website",
        name: "Website (Online Store)",
        label: "Website (Online Store)",
        shortLabel: "Website",
        description: "Official online store & website e-commerce pricing",
        badgeColor: "violet",
        discountPreset: 10,
        isDefault: true,
    },
    {
        id: "whatsapp",
        name: "WhatsApp (Direct & Catalog)",
        label: "WhatsApp (Direct & Catalog)",
        shortLabel: "WhatsApp",
        description: "Direct WhatsApp chat quotation & Meta Catalog price",
        badgeColor: "emerald",
        discountPreset: -5,
        isDefault: true,
    },
    {
        id: "wholesale",
        name: "B2B Wholesale / Trade",
        label: "B2B Wholesale / Trade",
        shortLabel: "B2B",
        description: "Wholesale merchant tier, gross lots, and bulk resellers",
        badgeColor: "amber",
        discountPreset: -20,
        isDefault: false,
    },
    {
        id: "exhibition",
        name: "Exhibition / Trunk Show",
        label: "Exhibition / Trunk Show",
        shortLabel: "Exhibition",
        description: "Special event, pop-up booth, and trade expo pricing",
        badgeColor: "pink",
        isDefault: false,
    },
];

function getStorageKey(): string {
    const email = pb.authStore.model?.email || "default";
    return `luminila_configured_channels_${email}`;
}

const PB_KEY = "sales_channel_definitions";

let currentChannels: SalesChannelDefinition[] = [...DEFAULT_SALES_CHANNELS];
const channelListeners = new Set<(channels: SalesChannelDefinition[]) => void>();

function mergeChannels(loaded: SalesChannelDefinition[]): SalesChannelDefinition[] {
    const map = new Map<string, SalesChannelDefinition>();
    DEFAULT_SALES_CHANNELS.forEach((c) => map.set(c.id, c));
    loaded.forEach((c) => map.set(c.id, { ...c, name: c.name || c.label }));
    return Array.from(map.values());
}

export function getConfiguredChannels(): SalesChannelDefinition[] {
    return [...currentChannels];
}

export function subscribeConfiguredChannels(
    callback: (channels: SalesChannelDefinition[]) => void
): () => void {
    channelListeners.add(callback);
    callback([...currentChannels]);
    return () => {
        channelListeners.delete(callback);
    };
}

export async function loadConfiguredChannels(): Promise<SalesChannelDefinition[]> {
    const currentUserEmail = pb.authStore.model?.email;
    if (!currentUserEmail) {
        if (typeof window !== "undefined") {
            try {
                const cached = localStorage.getItem(getStorageKey());
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        currentChannels = mergeChannels(parsed);
                        channelListeners.forEach((l) => l([...currentChannels]));
                        return [...currentChannels];
                    }
                }
            } catch { /* ignore */ }
        }
        currentChannels = [...DEFAULT_SALES_CHANNELS];
        channelListeners.forEach((l) => l([...currentChannels]));
        return [...currentChannels];
    }

    try {
        const record = await pb
            .collection("store_settings")
            .getFirstListItem(`key="${PB_KEY}" && account_email="${currentUserEmail}"`)
            .catch(() => null);

        if (record && record.value) {
            const val = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            if (Array.isArray(val) && val.length > 0) {
                currentChannels = mergeChannels(val);
                if (typeof window !== "undefined") {
                    localStorage.setItem(getStorageKey(), JSON.stringify(currentChannels));
                }
                channelListeners.forEach((l) => l([...currentChannels]));
                return [...currentChannels];
            }
        } else {
            // Check localStorage cache if DB has no record
            if (typeof window !== "undefined") {
                const cached = localStorage.getItem(getStorageKey());
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            currentChannels = mergeChannels(parsed);
                            channelListeners.forEach((l) => l([...currentChannels]));
                            return [...currentChannels];
                        }
                    } catch { /* ignore */ }
                }
            }
            // Fresh tenant with no custom channels yet - reset to default channels
            currentChannels = [...DEFAULT_SALES_CHANNELS];
            if (typeof window !== "undefined") {
                localStorage.setItem(getStorageKey(), JSON.stringify(currentChannels));
            }
            channelListeners.forEach((l) => l([...currentChannels]));
            return [...currentChannels];
        }
    } catch (e) {
        console.warn("Failed to load sales channels from PocketBase:", e);
        if (typeof window !== "undefined") {
            try {
                const cached = localStorage.getItem(getStorageKey());
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        currentChannels = mergeChannels(parsed);
                        channelListeners.forEach((l) => l([...currentChannels]));
                        return [...currentChannels];
                    }
                }
            } catch { /* ignore */ }
        }
    }
    return [...currentChannels];
}

export async function saveConfiguredChannels(
    channels: SalesChannelDefinition[]
): Promise<void> {
    const currentUserEmail = pb.authStore.model?.email;
    currentChannels = [...channels];
    if (typeof window !== "undefined") {
        localStorage.setItem(getStorageKey(), JSON.stringify(currentChannels));
    }
    channelListeners.forEach((l) => l([...currentChannels]));

    if (!currentUserEmail) return;

    try {
        const existing = await pb
            .collection("store_settings")
            .getFirstListItem(`key="${PB_KEY}" && account_email="${currentUserEmail}"`)
            .catch(() => null);

        if (existing) {
            await pb.collection("store_settings").update(existing.id, {
                value: currentChannels,
                category: "sales_config",
                account_email: currentUserEmail,
            });
        } else {
            await pb.collection("store_settings").create({
                key: PB_KEY,
                value: currentChannels,
                category: "sales_config",
                account_email: currentUserEmail,
            });
        }
    } catch (e) {
        console.warn("Failed to persist sales channels to PocketBase:", e);
    }
}

/**
 * Add a custom sales channel
 */
export async function addCustomChannel(
    channel: Omit<SalesChannelDefinition, "isDefault" | "isCustom">
): Promise<SalesChannelDefinition[]> {
    const cleanId = channel.id.toLowerCase().replace(/[^a-z0-9_-]/g, "").trim();
    if (!cleanId) throw new Error("Channel ID is required");

    const existingIndex = currentChannels.findIndex((c) => c.id === cleanId);
    const newChan: SalesChannelDefinition = {
        ...channel,
        id: cleanId,
        name: channel.name || channel.label || cleanId,
        label: channel.label || channel.name || cleanId,
        isDefault: false,
        isCustom: true,
    };

    let updated: SalesChannelDefinition[];
    if (existingIndex >= 0) {
        updated = [...currentChannels];
        updated[existingIndex] = newChan;
    } else {
        updated = [...currentChannels, newChan];
    }

    await saveConfiguredChannels(updated);
    return updated;
}

/**
 * Update an existing channel's properties (label, discountPreset, description, badgeColor)
 */
export async function updateChannel(
    channelId: string,
    updates: Partial<Omit<SalesChannelDefinition, "id">>
): Promise<SalesChannelDefinition[]> {
    const existingIndex = currentChannels.findIndex((c) => c.id === channelId);
    if (existingIndex === -1) throw new Error(`Channel ${channelId} not found`);

    const updated = [...currentChannels];
    const prev = updated[existingIndex];
    updated[existingIndex] = {
        ...prev,
        ...updates,
        id: channelId,
        name: updates.name || updates.label || prev.name,
        label: updates.label || updates.name || prev.label,
    };

    await saveConfiguredChannels(updated);
    return updated;
}

/**
 * Remove a custom channel (default channels cannot be removed)
 */
export async function removeCustomChannel(channelId: string): Promise<SalesChannelDefinition[]> {
    const updated = currentChannels.filter((c) => c.id !== channelId || c.isDefault);
    await saveConfiguredChannels(updated);
    return updated;
}

/**
 * Resolve price for a product on a specific sales channel
 * Returns the channel-specific override if set (> 0), otherwise falls back to base_price.
 */
export function getChannelPrice(
    product: { base_price: number; channel_prices?: Record<string, number> | null },
    channelId: string = "pos",
    variantAdjustment: number = 0
): number {
    const base = Number(product.base_price) || 0;
    const adjustment = Number(variantAdjustment) || 0;

    if (
        product.channel_prices &&
        typeof product.channel_prices === "object"
    ) {
        // Direct channel price check
        const directPrice = product.channel_prices[channelId];
        if (directPrice !== undefined && directPrice !== null && Number(directPrice) > 0) {
            return Number(directPrice) + adjustment;
        }

        // Cross-compatibility aliases: website <-> shopify, shop <-> pos
        if (channelId === "website" && product.channel_prices.shopify && Number(product.channel_prices.shopify) > 0) {
            return Number(product.channel_prices.shopify) + adjustment;
        }
        if (channelId === "shopify" && product.channel_prices.website && Number(product.channel_prices.website) > 0) {
            return Number(product.channel_prices.website) + adjustment;
        }
        if (channelId === "shop" && product.channel_prices.pos && Number(product.channel_prices.pos) > 0) {
            return Number(product.channel_prices.pos) + adjustment;
        }
        if (channelId === "pos" && product.channel_prices.shop && Number(product.channel_prices.shop) > 0) {
            return Number(product.channel_prices.shop) + adjustment;
        }
    }

    return base + adjustment;
}

/**
 * Checks if a product has any channel-specific price overrides configured
 */
export function hasCustomChannelPrices(
    product: { channel_prices?: Record<string, number> | null }
): boolean {
    if (!product.channel_prices || typeof product.channel_prices !== "object") return false;
    return Object.values(product.channel_prices).some((val) => typeof val === "number" && val > 0);
}

/**
 * Return formatted channel breakdown for badges or tooltips
 */
export function getProductChannelBreakdown(
    product: { base_price: number; channel_prices?: Record<string, number> | null }
): { channelId: string; label: string; shortLabel: string; price: number; isCustom: boolean }[] {
    const channels = getConfiguredChannels();
    const base = Number(product.base_price) || 0;

    return channels.map((c) => {
        const hasOverride =
            product.channel_prices &&
            product.channel_prices[c.id] !== undefined &&
            Number(product.channel_prices[c.id]) > 0;

        const price = hasOverride ? Number(product.channel_prices![c.id]) : base;

        return {
            channelId: c.id,
            label: c.label,
            shortLabel: c.shortLabel,
            price,
            isCustom: Boolean(hasOverride),
        };
    });
}

/** Standard Razorpay gateway MDR rate (2% base + 18% GST on fee = 2.36%, or standard 2.2% negotiated) */
export const DEFAULT_RAZORPAY_FEE_PERCENT = 2.2;

export interface GatewayMarkupResult {
    netAmount: number;
    feeAmount: number;
    grossAmount: number;
    feePercent: number;
}

/**
 * Calculates net-neutral gateway markup.
 * Formula: Gross = ceil(Net / (1 - feeRate))
 * Ensures that when Razorpay deducts feePercent, the merchant receives 100% of the target Net amount.
 */
export function calculateGatewayMarkup(
    netAmount: number,
    feePercent: number = DEFAULT_RAZORPAY_FEE_PERCENT
): GatewayMarkupResult {
    const net = Math.max(0, Number(netAmount) || 0);
    if (net === 0) {
        return { netAmount: 0, feeAmount: 0, grossAmount: 0, feePercent };
    }
    const rate = feePercent / 100;
    // Exact gross-up formula to prevent margin leakage
    const gross = Math.ceil(net / (1 - rate));
    const fee = gross - net;
    return {
        netAmount: net,
        feeAmount: fee,
        grossAmount: gross,
        feePercent,
    };
}

export interface RealizedMarginResult {
    sellingPrice: number;
    costPrice: number;
    nominalProfit: number;
    nominalMarginPercent: number;
    realizedSellingPrice: number;
    realizedProfit: number;
    realizedMarginPercent: number;
    gatewayFeeDeducted: number;
}

/**
 * Calculates exact realized profit and margin taking payment gateway deductions into account.
 * Crucial for imitation jewelry where margins are thin and 2.2% fee can destroy 20%+ of net profit.
 */
export function calculateRealizedMargin(
    sellingPrice: number,
    costPrice: number,
    hasGatewayDeduction: boolean = false,
    feePercent: number = DEFAULT_RAZORPAY_FEE_PERCENT
): RealizedMarginResult {
    const sell = Math.max(0, Number(sellingPrice) || 0);
    const cost = Math.max(0, Number(costPrice) || 0);

    const nominalProfit = sell - cost;
    const nominalMarginPercent = sell > 0 ? (nominalProfit / sell) * 100 : 0;

    let feeDeducted = 0;
    let realizedSell = sell;

    if (hasGatewayDeduction && sell > 0) {
        feeDeducted = Math.round(sell * (feePercent / 100) * 100) / 100;
        realizedSell = sell - feeDeducted;
    }

    const realizedProfit = realizedSell - cost;
    const realizedMarginPercent = realizedSell > 0 ? (realizedProfit / realizedSell) * 100 : 0;

    return {
        sellingPrice: sell,
        costPrice: cost,
        nominalProfit,
        nominalMarginPercent: Math.round(nominalMarginPercent * 10) / 10,
        realizedSellingPrice: realizedSell,
        realizedProfit: Math.round(realizedProfit * 100) / 100,
        realizedMarginPercent: Math.round(realizedMarginPercent * 10) / 10,
        gatewayFeeDeducted: feeDeducted,
    };
}

/** Threshold below which UPI transactions qualify for 0% MDR / Surcharge Waiver in India */
export const DEFAULT_UPI_DISCOUNT_THRESHOLD = 2000;
const UPI_DISCOUNT_STORAGE_KEY = "luminila_upi_surcharge_discount_enabled";

/**
 * Checks if the UPI < ₹2,000 surcharge discount feature is enabled
 */
export function isUpiDiscountEnabled(): boolean {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(UPI_DISCOUNT_STORAGE_KEY);
    return stored === null ? true : stored === "true"; // Default enabled
}

/**
 * Enable or disable the UPI < ₹2,000 surcharge discount feature
 */
export function setUpiDiscountEnabled(enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(UPI_DISCOUNT_STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent("luminila:upi-discount-toggled", { detail: { enabled } }));
}

export interface UpiSurchargeDiscountResult {
    applicable: boolean;
    netAmount: number;
    standardFee: number;
    discountAmount: number;
    finalCustomerCharge: number;
    reason: string;
}

/**
 * Computes discount on merchant surcharge for UPI transactions under ₹2,000.
 * In India, UPI transactions under ₹2,000 carry zero or negligible MDR.
 * If enabled and amount < threshold and method is UPI, the 2.2% surcharge is 100% discounted (waived).
 */
export function calculateUpiSurchargeDiscount(
    amount: number,
    isUpi: boolean = true,
    enabled: boolean = isUpiDiscountEnabled(),
    threshold: number = DEFAULT_UPI_DISCOUNT_THRESHOLD,
    feePercent: number = DEFAULT_RAZORPAY_FEE_PERCENT
): UpiSurchargeDiscountResult {
    const net = Math.max(0, Number(amount) || 0);
    const markup = calculateGatewayMarkup(net, feePercent);
    const isUnderThreshold = net > 0 && net < threshold;

    if (enabled && isUpi && isUnderThreshold) {
        return {
            applicable: true,
            netAmount: net,
            standardFee: markup.feeAmount,
            discountAmount: markup.feeAmount, // Full 100% waiver of surcharge
            finalCustomerCharge: net, // Customer pays exact net amount
            reason: `UPI payment under ₹${threshold.toLocaleString("en-IN")} qualifies for 0% MDR surcharge waiver discount.`,
        };
    }

    return {
        applicable: false,
        netAmount: net,
        standardFee: markup.feeAmount,
        discountAmount: 0,
        finalCustomerCharge: markup.grossAmount,
        reason: !isUnderThreshold
            ? `Amount exceeds ₹${threshold.toLocaleString("en-IN")}.`
            : !isUpi
            ? "Non-UPI payment method."
            : "Surcharge discount disabled.",
    };
}
