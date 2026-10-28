/**
 * Cost-Based Channel Pricing Rules
 *
 * Cost price is the single root for pricing. Every sales channel — including
 * the in-store shop — carries an independent rule that turns cost into a
 * channel price:
 *
 *   price = cost × (1 + percent / 100) + fixed
 *
 * followed by an optional payment-gateway gross-up and an optional rounding
 * step. Channels never reference each other, so changing one rule cannot move
 * another channel's price.
 *
 * This module is intentionally free of PocketBase imports so the same resolver
 * can run in browser components and server routes.
 */

export type PriceRuleMode = "percent" | "fixed" | "hybrid";
export type PriceRounding = "none" | "nearest10" | "nearest50" | "charm99";

export interface ChannelPricingRule {
    mode: PriceRuleMode;
    /** Signed percentage, e.g. 200 = +200%, -5 = -5%. */
    percent?: number;
    /** Signed rupee amount applied after the percentage in hybrid mode. */
    fixed?: number;
    /** Gross up the result so the merchant receives the full amount after the gateway fee. */
    gatewayGrossUp?: boolean;
    rounding?: PriceRounding;
}

export interface SalesChannelDefinition {
    id: string;
    name?: string;
    label: string;
    shortLabel: string;
    description: string;
    badgeColor: "blue" | "emerald" | "violet" | "amber" | "pink" | "cyan" | "indigo" | "rose";
    /**
     * Legacy shop-relative preset. Kept for backwards compatibility and as the
     * quick-fill value in settings; actual pricing never reads it unless a
     * pricingRule has been configured.
     */
    discountPreset?: number;
    pricingRule?: ChannelPricingRule;
    isDefault?: boolean;
    isCustom?: boolean;
}

export type SalesChannelDef = SalesChannelDefinition;

export interface PricedProductShape {
    base_price: number;
    cost_price?: number | null;
    channel_prices?: Record<string, number> | null;
}

export const DEFAULT_GATEWAY_FEE_PERCENT = 2.2;

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

/**
 * Merge persisted channel definitions over the built-in set. Persisted values
 * win on id, while every default channel continues to exist even if a stale
 * payload predates it.
 */
export function normalizeChannelDefinitions(loaded: unknown): SalesChannelDefinition[] {
    const list = Array.isArray(loaded) ? (loaded as SalesChannelDefinition[]) : [];
    const map = new Map<string, SalesChannelDefinition>();
    DEFAULT_SALES_CHANNELS.forEach((channel) => map.set(channel.id, channel));
    list.forEach((channel) => {
        if (!channel || typeof channel.id !== "string" || !channel.id) return;
        map.set(channel.id, {
            ...channel,
            name: channel.name || channel.label,
            label: channel.label || channel.name || channel.id,
        });
    });
    return Array.from(map.values());
}

export interface GatewayMarkupResult {
    netAmount: number;
    feeAmount: number;
    grossAmount: number;
    feePercent: number;
}

/** Gross-up formula: Gross = ceil(Net / (1 - feeRate)). */
export function calculateGatewayMarkup(
    netAmount: number,
    feePercent: number = DEFAULT_GATEWAY_FEE_PERCENT
): GatewayMarkupResult {
    const net = Math.max(0, Number(netAmount) || 0);
    if (net === 0) {
        return { netAmount: 0, feeAmount: 0, grossAmount: 0, feePercent };
    }
    const rate = feePercent / 100;
    const gross = Math.ceil(net / (1 - rate));
    const fee = gross - net;
    return {
        netAmount: net,
        feeAmount: fee,
        grossAmount: gross,
        feePercent,
    };
}

export function applyPriceRounding(value: number, rounding: PriceRounding = "none"): number {
    const amount = Math.max(0, Number(value) || 0);
    switch (rounding) {
        case "nearest10":
            return Math.round(amount / 10) * 10;
        case "nearest50":
            return Math.round(amount / 50) * 50;
        case "charm99":
            return Math.max(99, Math.round(amount / 100) * 100 - 1);
        default:
            return Math.round(amount);
    }
}

/**
 * Apply a channel rule to a cost price. Returns null when the rule cannot be
 * evaluated (missing rule or non-positive cost), which callers treat as a
 * signal to fall back to a stored price.
 */
export function computeRulePrice(
    costPrice: number,
    rule?: ChannelPricingRule | null
): number | null {
    if (!rule) return null;

    const cost = Number(costPrice);
    if (!Number.isFinite(cost) || cost <= 0) return null;

    const percent = Number(rule.percent) || 0;
    const fixed = Number(rule.fixed) || 0;
    const mode: PriceRuleMode = rule.mode || "percent";

    let price = cost;
    if (mode === "percent" || mode === "hybrid") {
        price *= 1 + percent / 100;
    }
    if (mode === "fixed" || mode === "hybrid") {
        price += fixed;
    }

    if (!Number.isFinite(price) || price <= 0) return null;

    if (rule.gatewayGrossUp) {
        price = Math.ceil(price / (1 - DEFAULT_GATEWAY_FEE_PERCENT / 100));
    }

    return applyPriceRounding(price, rule.rounding || "none");
}

function findChannel(
    channels: SalesChannelDefinition[],
    channelId: string
): SalesChannelDefinition | undefined {
    const direct = channels.find((channel) => channel.id === channelId);
    if (direct) return direct;

    // Cross-compatibility aliases used by older data.
    const aliasId =
        channelId === "website"
            ? "shopify"
            : channelId === "shopify"
              ? "website"
              : channelId === "pos"
                ? "shop"
                : channelId === "shop"
                  ? "pos"
                  : "";
    return aliasId ? channels.find((channel) => channel.id === aliasId) : undefined;
}

function resolveOverride(
    overrides: Record<string, number> | null | undefined,
    channelId: string
): number | null {
    if (!overrides || typeof overrides !== "object") return null;

    const direct = Number(overrides[channelId]);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const aliasId =
        channelId === "website"
            ? "shopify"
            : channelId === "shopify"
              ? "website"
              : channelId === "pos"
                ? "shop"
                : channelId === "shop"
                  ? "pos"
                  : "";
    if (!aliasId) return null;

    const alias = Number(overrides[aliasId]);
    return Number.isFinite(alias) && alias > 0 ? alias : null;
}

export interface ChannelPriceResolution {
    price: number;
    source: "override" | "rule" | "base";
}

/**
 * Resolve one channel price for a product.
 *
 * Precedence: explicit per-product override → channel rule applied to cost →
 * stored base price. A variant adjustment is added last, matching the
 * historical behaviour.
 */
export function resolveChannelPrice(
    product: PricedProductShape,
    channelId: string,
    channels: SalesChannelDefinition[],
    variantAdjustment: number = 0
): ChannelPriceResolution {
    const base = Number(product.base_price) || 0;
    const adjustment = Number(variantAdjustment) || 0;

    const override = resolveOverride(product.channel_prices, channelId);
    if (override !== null) {
        return { price: override + adjustment, source: "override" };
    }

    const channel = findChannel(channels, channelId);
    if (channel?.pricingRule) {
        const computed = computeRulePrice(Number(product.cost_price) || 0, channel.pricingRule);
        if (computed !== null) {
            return { price: computed + adjustment, source: "rule" };
        }
    }

    return { price: base + adjustment, source: "base" };
}

export function getChannelPriceFromList(
    product: PricedProductShape,
    channelId: string,
    channels: SalesChannelDefinition[],
    variantAdjustment: number = 0
): number {
    return resolveChannelPrice(product, channelId, channels, variantAdjustment).price;
}

/** The shop selling price, used wherever a single "price" is displayed. */
export function getShopPriceFromList(
    product: PricedProductShape,
    channels: SalesChannelDefinition[]
): number {
    return getChannelPriceFromList(product, "pos", channels);
}

export interface ChannelPriceBreakdown {
    channelId: string;
    label: string;
    shortLabel: string;
    price: number;
    source: "override" | "rule" | "base";
}

export function getChannelBreakdownFromList(
    product: PricedProductShape,
    channels: SalesChannelDefinition[]
): ChannelPriceBreakdown[] {
    return channels.map((channel) => {
        const resolved = resolveChannelPrice(product, channel.id, channels);
        return {
            channelId: channel.id,
            label: channel.label || channel.name || channel.id,
            shortLabel: channel.shortLabel || channel.id,
            price: resolved.price,
            source: resolved.source,
        };
    });
}

export function describePricingRule(rule?: ChannelPricingRule | null): string {
    if (!rule) return "No rule";
    const parts: string[] = [];
    if (rule.mode === "percent" || rule.mode === "hybrid") {
        const pct = Number(rule.percent) || 0;
        parts.push(`${pct >= 0 ? "+" : ""}${pct}%`);
    }
    if (rule.mode === "fixed" || rule.mode === "hybrid") {
        const fixed = Number(rule.fixed) || 0;
        parts.push(`${fixed >= 0 ? "+" : "-"}₹${Math.abs(fixed).toLocaleString("en-IN")}`);
    }
    if (parts.length === 0) parts.push("0%");
    let label = `Cost ${parts.join(" ")}`;
    if (rule.gatewayGrossUp) label += " · PG";
    if (rule.rounding && rule.rounding !== "none") label += ` · ${rule.rounding}`;
    return label;
}
