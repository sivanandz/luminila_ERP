/**
 * Multi-Channel Pricing Engine
 * Handles channel configuration persistence and cost-based pricing resolution.
 *
 * The price math lives in `pricing-rules.ts` so the same resolver can run in
 * browser components and server routes.
 */

import { pb } from "./pocketbase";
import {
    DEFAULT_SALES_CHANNELS,
    normalizeChannelDefinitions,
    resolveChannelPrice,
    getChannelBreakdownFromList,
    calculateGatewayMarkup,
    DEFAULT_GATEWAY_FEE_PERCENT,
    type SalesChannelDefinition,
} from "./pricing-rules";

export {
    DEFAULT_SALES_CHANNELS,
    DEFAULT_GATEWAY_FEE_PERCENT,
    calculateGatewayMarkup,
    applyPriceRounding,
    computeRulePrice,
    resolveChannelPrice,
    getChannelPriceFromList,
    getShopPriceFromList,
    getChannelBreakdownFromList,
    describePricingRule,
} from "./pricing-rules";

export type {
    ChannelPricingRule,
    PriceRuleMode,
    PriceRounding,
    SalesChannelDefinition,
    SalesChannelDef,
    PricedProductShape,
    GatewayMarkupResult,
    ChannelPriceResolution,
    ChannelPriceBreakdown,
} from "./pricing-rules";

/** Backwards-compatible alias used by the Razorpay payment flow. */
export const DEFAULT_RAZORPAY_FEE_PERCENT = DEFAULT_GATEWAY_FEE_PERCENT;

// Configured channel definitions are normalised by the shared pricing-rules
// module; see `normalizeChannelDefinitions`.

function getStorageKey(): string {
    const email = pb.authStore.model?.email || "default";
    return `luminila_configured_channels_${email}`;
}

const PB_KEY = "sales_channel_definitions";

let currentChannels: SalesChannelDefinition[] = [...DEFAULT_SALES_CHANNELS];
const channelListeners = new Set<(channels: SalesChannelDefinition[]) => void>();

function mergeChannels(loaded: SalesChannelDefinition[]): SalesChannelDefinition[] {
    return normalizeChannelDefinitions(loaded);
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
    product: {
        base_price: number;
        cost_price?: number | null;
        channel_prices?: Record<string, number> | null;
    },
    channelId: string = "pos",
    variantAdjustment: number = 0
): number {
    return resolveChannelPrice(product, channelId, currentChannels, variantAdjustment).price;
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
    product: {
        base_price: number;
        cost_price?: number | null;
        channel_prices?: Record<string, number> | null;
    }
): { channelId: string; label: string; shortLabel: string; price: number; isCustom: boolean }[] {
    return getChannelBreakdownFromList(product, currentChannels).map((row) => ({
        channelId: row.channelId,
        label: row.label,
        shortLabel: row.shortLabel,
        price: row.price,
        isCustom: row.source === "override",
    }));
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
