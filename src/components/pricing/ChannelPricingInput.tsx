"use client";

import React, { useState, useEffect } from "react";
import {
    getConfiguredChannels,
    loadConfiguredChannels,
    subscribeConfiguredChannels,
    addCustomChannel,
    removeCustomChannel,
    calculateGatewayMarkup,
    computeRulePrice,
    describePricingRule,
    type SalesChannelDefinition,
} from "@/lib/channel-pricing";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Store,
    MessageCircle,
    Globe,
    Building2,
    Sparkles,
    Plus,
    ChevronDown,
    ChevronUp,
    Percent,
    RotateCcw,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface ChannelPricingInputProps {
    basePrice: number;
    costPrice?: number;
    channelPrices: Record<string, number>;
    onChange: (channelPrices: Record<string, number>) => void;
    onBasePriceChange?: (basePrice: number) => void;
}

export function ChannelPricingInput({
    basePrice,
    costPrice = 0,
    channelPrices,
    onChange,
    onBasePriceChange,
}: ChannelPricingInputProps) {
    const [channels, setChannels] = useState<SalesChannelDefinition[]>(() => getConfiguredChannels());
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    // Modal state for adding a custom sales channel
    const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
    const [newChannelName, setNewChannelName] = useState("");
    const [newChannelCode, setNewChannelCode] = useState("");
    const [newChannelTag, setNewChannelTag] = useState("");
    const [newChannelDesc, setNewChannelDesc] = useState("");
    const [newChannelColor, setNewChannelColor] = useState<SalesChannelDefinition["badgeColor"]>("cyan");
    const [newChannelPreset, setNewChannelPreset] = useState("0");
    const [isSavingChannel, setIsSavingChannel] = useState(false);

    useEffect(() => {
        loadConfiguredChannels().then(setChannels).catch(console.error);
        const unsubscribe = subscribeConfiguredChannels(setChannels);
        return () => unsubscribe();
    }, []);

    // Categorize channels: The Big 3 Primary Channels vs Additional/Custom Channels
    const primaryChannelIds = ["pos", "whatsapp", "website"];
    const primaryChannels = [
        channels.find((c) => c.id === "pos" || c.id === "shop") || {
            id: "pos",
            name: "Shop (In-Store POS)",
            label: "Shop (In-Store POS)",
            shortLabel: "Shop",
            description: "Counter & showroom retail price",
            badgeColor: "blue" as const,
        },
        channels.find((c) => c.id === "whatsapp") || {
            id: "whatsapp",
            name: "WhatsApp (Direct & Catalog)",
            label: "WhatsApp (Direct & Catalog)",
            shortLabel: "WhatsApp",
            description: "Direct WhatsApp chat & Meta Catalog price",
            badgeColor: "emerald" as const,
            discountPreset: -5,
        },
        channels.find((c) => c.id === "website" || c.id === "shopify") || {
            id: "website",
            name: "Website (Online Store)",
            label: "Website (Online Store)",
            shortLabel: "Website",
            description: "Official online store e-commerce price",
            badgeColor: "violet" as const,
            discountPreset: 10,
        },
    ];

    const additionalChannels = channels.filter(
        (c) => c.id !== "pos" && c.id !== "shop" && c.id !== "whatsapp" && c.id !== "website" && c.id !== "shopify"
    );

    const getChannelIcon = (id: string) => {
        switch (id) {
            case "pos":
            case "shop":
                return <Store size={15} className="text-blue-400" />;
            case "whatsapp":
                return <MessageCircle size={15} className="text-emerald-400" />;
            case "website":
            case "shopify":
                return <Globe size={15} className="text-violet-400" />;
            case "wholesale":
            case "b2b":
                return <Building2 size={15} className="text-amber-400" />;
            case "exhibition":
                return <Sparkles size={15} className="text-pink-400" />;
            default:
                return <Store size={15} className="text-cyan-400" />;
        }
    };

    const handlePriceChange = (channelId: string, val: string) => {
        const num = parseFloat(val);
        const updated = { ...channelPrices };

        if (isNaN(num) || num <= 0) {
            delete updated[channelId];
            if (channelId === "website") delete updated.shopify;
            if (channelId === "pos") delete updated.shop;
        } else {
            updated[channelId] = num;
            // Cross-channel compatibility aliases
            if (channelId === "website") updated.shopify = num;
            if (channelId === "shopify") updated.website = num;
            if (channelId === "pos") updated.shop = num;
            if (channelId === "shop") updated.pos = num;

            // If updating Shop/POS and caller wants base price synced, notify
            if ((channelId === "pos" || channelId === "shop") && onBasePriceChange) {
                onBasePriceChange(num);
            }
        }
        onChange(updated);
    };

    const handleApplyPreset = (channelId: string, percentage: number) => {
        const effectiveBase = basePrice > 0 ? basePrice : (channelPrices.pos || 0);
        if (effectiveBase <= 0) {
            toast.error("Please enter a Shop / Base price first");
            return;
        }

        const calculated = Math.round(effectiveBase * (1 + percentage / 100));
        const updated = { ...channelPrices, [channelId]: calculated };
        if (channelId === "website") updated.shopify = calculated;
        onChange(updated);
        toast.success(
            `Set ${channelId.toUpperCase()} to ₹${calculated.toLocaleString("en-IN")} (${percentage >= 0 ? `+${percentage}%` : `${percentage}%`})`
        );
    };

    const handleApplyGatewayMarkup = (channelId: string) => {
        const effectiveBase = basePrice > 0 ? basePrice : (channelPrices.pos || 0);
        if (effectiveBase <= 0) {
            toast.error("Please enter a Shop / Base price first");
            return;
        }

        const { grossAmount, feeAmount } = calculateGatewayMarkup(effectiveBase, 2.2);
        const updated = { ...channelPrices, [channelId]: grossAmount };
        if (channelId === "website") updated.shopify = grossAmount;
        onChange(updated);
        toast.success(
            `Added 2.2% PG Markup to ${channelId.toUpperCase()}: ₹${grossAmount.toLocaleString("en-IN")} (+₹${feeAmount} fee covered)`
        );
    };

    const handleMatchShop = (channelId: string) => {
        const updated = { ...channelPrices };
        delete updated[channelId];
        if (channelId === "website") delete updated.shopify;
        onChange(updated);
        toast.info(`Cleared override for ${channelId.toUpperCase()}; its rule or base price now applies.`);
    };

    const handleResetAll = () => {
        onChange({});
        toast.info("Reset all sales channels to inherit Base Price");
    };

    const handleCreateChannel = async () => {
        if (!newChannelName.trim()) {
            toast.error("Channel name is required");
            return;
        }

        const cleanId = (newChannelCode || newChannelName)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .slice(0, 12);

        if (!cleanId) {
            toast.error("Invalid channel identifier");
            return;
        }

        const presetNum = parseFloat(newChannelPreset) || 0;

        setIsSavingChannel(true);
        try {
            await addCustomChannel({
                id: cleanId,
                label: newChannelName.trim(),
                name: newChannelName.trim(),
                shortLabel: (newChannelTag || newChannelName).trim().slice(0, 6).toUpperCase(),
                description: newChannelDesc.trim() || `Custom sales channel for ${newChannelName.trim()}`,
                badgeColor: newChannelColor,
                discountPreset: presetNum,
                pricingRule:
                    presetNum !== 0
                        ? { mode: "percent", percent: presetNum }
                        : undefined,
            });
            toast.success(`Created sales channel: ${newChannelName}`);
            setIsAddChannelOpen(false);
            setNewChannelName("");
            setNewChannelCode("");
            setNewChannelTag("");
            setNewChannelDesc("");
            setNewChannelPreset("0");
            setIsMoreOpen(true);
        } catch (e: any) {
            toast.error(e.message || "Failed to create channel");
        } finally {
            setIsSavingChannel(false);
        }
    };

    const handleDeleteCustomChannel = async (id: string, name: string) => {
        if (!confirm(`Delete custom sales channel "${name}"?`)) return;
        try {
            await removeCustomChannel(id);
            const updated = { ...channelPrices };
            delete updated[id];
            onChange(updated);
            toast.success(`Removed channel "${name}"`);
        } catch (e: any) {
            toast.error(e.message || "Failed to remove channel");
        }
    };

    const customOverridesCount = Object.keys(channelPrices).filter(
        (k) => Number(channelPrices[k]) > 0
    ).length;
    const ruleCount = channels.filter((channel) => channel.pricingRule).length;

    return (
        <div className="space-y-3 border border-surface-hover/70 rounded-2xl p-3.5 bg-bg-navy/40">
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-xl bg-primary/15 text-primary border border-primary/20">
                        <Store size={15} />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            Multi-Channel Sales Pricing
                            {customOverridesCount > 0 ? (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0">
                                    {customOverridesCount} Override{customOverridesCount > 1 ? "s" : ""}
                                </Badge>
                            ) : ruleCount > 0 ? (
                                <Badge className="bg-primary/15 text-primary border border-primary/30 text-[9px] px-1.5 py-0">
                                    {ruleCount} Rule{ruleCount > 1 ? "s" : ""} Applied
                                </Badge>
                            ) : (
                                <span className="text-[10px] text-moonstone font-normal">
                                    No rules configured
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] text-moonstone">
                            Prices are derived from cost by each channel's rule. Type a value only to override.
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsAddChannelOpen(true)}
                        className="h-7 text-[11px] border-primary/30 text-primary hover:bg-primary/10 px-2.5 gap-1"
                    >
                        <Plus size={12} />
                        Add Channel
                    </Button>
                </div>
            </div>

            {/* THE BIG 3 PRIMARY CHANNELS - ALWAYS VISIBLE */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {primaryChannels.map((chan) => {
                    const hasCustom =
                        channelPrices[chan.id] !== undefined && Number(channelPrices[chan.id]) > 0;
                    const rulePrice = computeRulePrice(costPrice, chan.pricingRule);
                    const currentValue = hasCustom ? String(channelPrices[chan.id]) : "";

                    return (
                        <div
                            key={chan.id}
                            className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                                hasCustom
                                    ? "bg-primary/10 border-primary/40 shadow-sm"
                                    : "bg-surface-navy/70 border-surface-hover/60"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {getChannelIcon(chan.id)}
                                    <span
                                        className="text-xs font-bold text-white truncate"
                                        title={describePricingRule(chan.pricingRule)}
                                    >
                                        {chan.label}
                                    </span>
                                </div>
                                {hasCustom ? (
                                    <span className="text-[9px] font-mono uppercase bg-primary/25 text-primary px-1.5 py-0.2 rounded font-bold shrink-0">
                                        Custom
                                    </span>
                                ) : chan.pricingRule ? (
                                    <span className="text-[9px] font-mono uppercase bg-emerald-500/15 text-emerald-300 px-1.5 py-0.2 rounded shrink-0">
                                        Rule
                                    </span>
                                ) : (
                                    <span className="text-[9px] font-mono uppercase bg-white/5 text-moonstone px-1.5 py-0.2 rounded shrink-0">
                                        Base
                                    </span>
                                )}
                            </div>

                            {/* Price Input */}
                            <div className="relative">
                                <span className="absolute left-2.5 top-2 text-moonstone text-xs font-mono font-bold">
                                    ₹
                                </span>
                                <Input
                                    type="number"
                                    min="0"
                                    step="1"
                                    placeholder={
                                        rulePrice !== null
                                            ? `Rule: ₹${rulePrice}`
                                            : basePrice > 0
                                              ? `Base: ₹${basePrice}`
                                              : "Override"
                                    }
                                    value={currentValue}
                                    onChange={(e) => handlePriceChange(chan.id, e.target.value)}
                                    className="pl-6 h-8 bg-bg-navy border-surface-hover text-white text-xs font-mono font-bold focus:border-primary"
                                />
                            </div>

                            {/* Rule summary / manual presets */}
                            <div className="flex items-center justify-between text-[10px] pt-0.5">
                                {chan.pricingRule ? (
                                    <>
                                        <span
                                            className="text-moonstone truncate font-mono"
                                            title={describePricingRule(chan.pricingRule)}
                                        >
                                            {describePricingRule(chan.pricingRule)}
                                        </span>
                                        {hasCustom && (
                                            <button
                                                type="button"
                                                onClick={() => handleMatchShop(chan.id)}
                                                className="text-primary hover:text-primary/80 shrink-0"
                                            >
                                                Use rule
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {chan.id === "whatsapp" && (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApplyGatewayMarkup("whatsapp")}
                                                        title="Add 2.2% Razorpay markup to protect imitation jewelry margin"
                                                        className="text-amber-400 hover:text-amber-300 hover:underline font-mono"
                                                    >
                                                        +2.2% PG
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApplyPreset("whatsapp", -5)}
                                                        className="text-emerald-400 hover:text-emerald-300 hover:underline font-mono"
                                                    >
                                                        -5% Promo
                                                    </button>
                                                </div>
                                                {hasCustom && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMatchShop("whatsapp")}
                                                        className="text-moonstone hover:text-white"
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {chan.id === "website" && (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApplyGatewayMarkup("website")}
                                                        title="Add 2.2% Razorpay markup to protect imitation jewelry margin"
                                                        className="text-amber-400 hover:text-amber-300 hover:underline font-mono"
                                                    >
                                                        +2.2% PG
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApplyPreset("website", 10)}
                                                        className="text-purple-400 hover:text-purple-300 hover:underline font-mono"
                                                    >
                                                        +10% Buffer
                                                    </button>
                                                </div>
                                                {hasCustom && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMatchShop("website")}
                                                        className="text-moonstone hover:text-white"
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {chan.id === "pos" && (
                                            <span className="text-moonstone truncate text-[10px]">
                                                Counter retail price
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Additional & Custom Channels Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-surface-hover/50 text-[11px]">
                <button
                    type="button"
                    onClick={() => setIsMoreOpen(!isMoreOpen)}
                    className="flex items-center gap-1.5 text-moonstone hover:text-white transition-colors py-1 cursor-pointer"
                >
                    <span className="font-semibold">
                        Additional Sales Channels & B2B Tiers ({additionalChannels.length})
                    </span>
                    {isMoreOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {customOverridesCount > 0 && (
                    <button
                        type="button"
                        onClick={handleResetAll}
                        className="text-red-400 hover:text-red-300 text-[10px] flex items-center gap-1 font-mono transition-colors"
                    >
                        <RotateCcw size={10} /> Reset All Overrides
                    </button>
                )}
            </div>

            {/* Expanded Additional Channels Grid */}
            {isMoreOpen && (
                <div className="space-y-3 pt-1 animate-in fade-in duration-150">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {additionalChannels.map((chan) => {
                            const hasCustom =
                                channelPrices[chan.id] !== undefined && Number(channelPrices[chan.id]) > 0;
                            const currentVal = hasCustom ? String(channelPrices[chan.id]) : "";
                            const rulePrice = computeRulePrice(costPrice, chan.pricingRule);

                            return (
                                <div
                                    key={chan.id}
                                    className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                                        hasCustom
                                            ? "bg-primary/10 border-primary/40 shadow-sm"
                                            : "bg-surface-navy/70 border-surface-hover/60"
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            {getChannelIcon(chan.id)}
                                            <span className="text-xs font-bold text-white truncate">
                                                {chan.label}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {chan.isCustom && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteCustomChannel(chan.id, chan.label)}
                                                    className="text-red-400 hover:text-red-300 p-0.5 rounded hover:bg-red-500/10"
                                                    title="Remove channel"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            )}
                                            <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                                                {chan.shortLabel}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="relative">
                                        <span className="absolute left-2.5 top-2 text-moonstone text-xs font-mono font-bold">
                                            ₹
                                        </span>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="1"
                                            placeholder={
                                            rulePrice !== null
                                                ? `Rule: ₹${rulePrice}`
                                                : `Base: ₹${basePrice || 0}`
                                        }
                                            value={currentVal}
                                            onChange={(e) => handlePriceChange(chan.id, e.target.value)}
                                            className="pl-6 h-8 bg-bg-navy border-surface-hover text-white text-xs font-mono font-bold focus:border-primary"
                                        />
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-moonstone gap-2">
                                        {chan.pricingRule ? (
                                            <span className="truncate font-mono" title={describePricingRule(chan.pricingRule)}>
                                                {describePricingRule(chan.pricingRule)}
                                            </span>
                                        ) : chan.discountPreset ? (
                                            <button
                                                type="button"
                                                onClick={() => handleApplyPreset(chan.id, chan.discountPreset || 0)}
                                                className="text-amber-400 hover:underline font-mono"
                                            >
                                                Apply Preset ({chan.discountPreset > 0 ? `+${chan.discountPreset}%` : `${chan.discountPreset}%`})
                                            </button>
                                        ) : (
                                            <span className="truncate">{chan.description}</span>
                                        )}
                                        {hasCustom && (
                                            <button
                                                type="button"
                                                onClick={() => handleMatchShop(chan.id)}
                                                className="shrink-0 text-moonstone hover:text-white"
                                            >
                                                {chan.pricingRule ? "Use rule" : "Clear"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Modal to add custom sales channel */}
            <Dialog open={isAddChannelOpen} onOpenChange={setIsAddChannelOpen}>
                <DialogContent className="max-w-md bg-card/98 backdrop-blur-2xl border-border/90 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                            <Plus className="text-primary" size={16} />
                            Add Custom Sales Channel
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2 text-xs">
                        <div className="space-y-1">
                            <Label className="text-xs font-semibold text-muted-foreground">Channel Name</Label>
                            <Input
                                placeholder="e.g. Instagram Boutique, Amazon India, Dubai Expo..."
                                value={newChannelName}
                                onChange={(e) => {
                                    setNewChannelName(e.target.value);
                                    if (!newChannelTag) {
                                        setNewChannelTag(e.target.value.slice(0, 6).toUpperCase());
                                    }
                                }}
                                className="text-xs h-8.5 bg-background border-border"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">ID Code</Label>
                                <Input
                                    placeholder="e.g. instagram"
                                    value={newChannelCode}
                                    onChange={(e) => setNewChannelCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                                    className="text-xs h-8.5 font-mono bg-background border-border"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Tag / Badge</Label>
                                <Input
                                    placeholder="e.g. INSTA"
                                    value={newChannelTag}
                                    onChange={(e) => setNewChannelTag(e.target.value.toUpperCase())}
                                    maxLength={8}
                                    className="text-xs h-8.5 font-mono bg-background border-border"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs font-semibold text-muted-foreground">Description</Label>
                            <Input
                                placeholder="Purpose or channel notes..."
                                value={newChannelDesc}
                                onChange={(e) => setNewChannelDesc(e.target.value)}
                                className="text-xs h-8.5 bg-background border-border"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Badge Color</Label>
                                <Select
                                    value={newChannelColor}
                                    onValueChange={(val) => {
                                        if (val) setNewChannelColor(val as SalesChannelDefinition["badgeColor"]);
                                    }}
                                >
                                    <SelectTrigger className="text-xs h-8.5 bg-background border-border">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="cyan">Cyan</SelectItem>
                                        <SelectItem value="blue">Blue</SelectItem>
                                        <SelectItem value="emerald">Emerald</SelectItem>
                                        <SelectItem value="violet">Violet</SelectItem>
                                        <SelectItem value="amber">Amber</SelectItem>
                                        <SelectItem value="pink">Pink</SelectItem>
                                        <SelectItem value="indigo">Indigo</SelectItem>
                                        <SelectItem value="rose">Rose</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Cost preset % (+Markup / -Discount)</Label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        placeholder="0"
                                        value={newChannelPreset}
                                        onChange={(e) => setNewChannelPreset(e.target.value)}
                                        className="text-xs h-8.5 font-mono pr-7 bg-background border-border"
                                    />
                                    <span className="absolute right-2.5 top-2 text-xs text-muted-foreground font-mono">%</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    Applied to cost price. Fine-tune it in Settings → Sales channels.
                                </p>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsAddChannelOpen(false)}
                            className="text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleCreateChannel}
                            disabled={isSavingChannel}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold"
                        >
                            {isSavingChannel ? "Saving..." : "Create Channel"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
