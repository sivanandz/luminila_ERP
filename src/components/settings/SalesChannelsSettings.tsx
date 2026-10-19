"use client";

import React, { useState, useEffect } from "react";
import {
    getConfiguredChannels,
    loadConfiguredChannels,
    subscribeConfiguredChannels,
    addCustomChannel,
    updateChannel,
    removeCustomChannel,
    type SalesChannelDefinition,
} from "@/lib/channel-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import {
    Store,
    Globe,
    MessageCircle,
    Building2,
    Sparkles,
    Plus,
    Edit2,
    Trash2,
    Calculator,
    Percent,
    Layers,
    RotateCcw,
} from "lucide-react";

export function SalesChannelsSettings() {
    const [channels, setChannels] = useState<SalesChannelDefinition[]>(() => getConfiguredChannels());
    const [testBasePrice, setTestBasePrice] = useState<number>(1500);

    // Modal state for Add/Edit
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<SalesChannelDefinition | null>(null);
    const [formName, setFormName] = useState("");
    const [formId, setFormId] = useState("");
    const [formShortLabel, setFormShortLabel] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formColor, setFormColor] = useState<SalesChannelDefinition["badgeColor"]>("blue");
    const [formPreset, setFormPreset] = useState<string>("0");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        loadConfiguredChannels().then(setChannels);
        const unsubscribe = subscribeConfiguredChannels(setChannels);
        return () => unsubscribe();
    }, []);

    const openAddModal = () => {
        setEditingChannel(null);
        setFormName("");
        setFormId("");
        setFormShortLabel("");
        setFormDescription("");
        setFormColor("cyan");
        setFormPreset("0");
        setIsModalOpen(true);
    };

    const openEditModal = (ch: SalesChannelDefinition) => {
        setEditingChannel(ch);
        setFormName(ch.label || ch.name || "");
        setFormId(ch.id);
        setFormShortLabel(ch.shortLabel || "");
        setFormDescription(ch.description || "");
        setFormColor(ch.badgeColor || "blue");
        setFormPreset(ch.discountPreset !== undefined ? String(ch.discountPreset) : "0");
        setIsModalOpen(true);
    };

    const handleSaveChannel = async () => {
        if (!formName.trim()) {
            toast.error("Please enter a channel name");
            return;
        }

        const cleanId = (formId || formName)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .trim();

        if (!cleanId) {
            toast.error("Please enter a valid channel ID code");
            return;
        }

        const presetNum = parseFloat(formPreset) || 0;

        setIsSubmitting(true);
        try {
            if (editingChannel) {
                await updateChannel(editingChannel.id, {
                    label: formName.trim(),
                    name: formName.trim(),
                    shortLabel: formShortLabel.trim().toUpperCase() || formName.trim().slice(0, 6).toUpperCase(),
                    description: formDescription.trim(),
                    badgeColor: formColor,
                    discountPreset: presetNum,
                });
                toast.success(`Updated sales channel "${formName.trim()}"`);
            } else {
                await addCustomChannel({
                    id: cleanId,
                    label: formName.trim(),
                    name: formName.trim(),
                    shortLabel: formShortLabel.trim().toUpperCase() || formName.trim().slice(0, 6).toUpperCase(),
                    description: formDescription.trim() || `Sales channel for ${formName.trim()}`,
                    badgeColor: formColor,
                    discountPreset: presetNum,
                });
                toast.success(`Created sales channel "${formName.trim()}"`);
            }
            setIsModalOpen(false);
        } catch (e: any) {
            toast.error(e.message || "Failed to save channel");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteChannel = async (id: string, name: string) => {
        if (!confirm(`Are you sure you want to remove the "${name}" sales channel?`)) return;
        try {
            await removeCustomChannel(id);
            toast.success(`Removed channel "${name}"`);
        } catch (e: any) {
            toast.error(e.message || "Failed to remove channel");
        }
    };

    const getChannelIcon = (id: string) => {
        switch (id) {
            case "pos":
            case "shop":
                return <Store size={18} className="text-blue-400" />;
            case "website":
            case "shopify":
                return <Globe size={18} className="text-violet-400" />;
            case "whatsapp":
                return <MessageCircle size={18} className="text-emerald-400" />;
            case "wholesale":
            case "b2b":
                return <Building2 size={18} className="text-amber-400" />;
            default:
                return <Sparkles size={18} className="text-cyan-400" />;
        }
    };

    const getColorBadgeClass = (color: SalesChannelDefinition["badgeColor"]) => {
        switch (color) {
            case "blue":
                return "bg-blue-500/15 text-blue-400 border-blue-500/30";
            case "violet":
                return "bg-purple-500/15 text-purple-400 border-purple-500/30";
            case "emerald":
                return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
            case "amber":
                return "bg-amber-500/15 text-amber-400 border-amber-500/30";
            case "pink":
                return "bg-pink-500/15 text-pink-400 border-pink-500/30";
            case "cyan":
                return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
            case "indigo":
                return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
            case "rose":
                return "bg-rose-500/15 text-rose-400 border-rose-500/30";
            default:
                return "bg-primary/15 text-primary border-primary/30";
        }
    };

    return (
        <div className="space-y-6">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-surface-navy/90 via-surface-navy/70 to-bg-navy/80 border border-surface-hover/80">
                <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-primary/20 text-primary border border-primary/30">
                            <Layers size={20} />
                        </div>
                        <h2 className="text-lg font-bold text-white tracking-wide">
                            Multi-Channel Sales & Pricing Architecture
                        </h2>
                    </div>
                    <p className="text-xs text-moonstone max-w-2xl leading-relaxed">
                        Configure independent sales channels with custom pricing overrides, catalog sync targets, and discount/markup presets. Seamlessly supports In-Store POS, WhatsApp Direct, Website/Online store, and custom trade channels.
                    </p>
                </div>

                <Button
                    onClick={openAddModal}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs h-9 px-4 gap-1.5 shrink-0 shadow-lg"
                >
                    <Plus size={15} />
                    Add Sales Channel
                </Button>
            </div>

            {/* Channels Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {channels.map((chan) => {
                    const preset = chan.discountPreset || 0;
                    return (
                        <div
                            key={chan.id}
                            className="bg-card/70 border border-border/70 hover:border-primary/40 rounded-2xl p-4.5 flex flex-col justify-between gap-4 transition-all hover:shadow-md relative group"
                        >
                            <div className="space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2 rounded-xl bg-surface-navy/80 border border-surface-hover/60">
                                            {getChannelIcon(chan.id)}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-sm text-foreground leading-snug">
                                                {chan.label || chan.name}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <code className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.2 rounded border border-border/40">
                                                    id: {chan.id}
                                                </code>
                                                {chan.isDefault && (
                                                    <span className="text-[9px] uppercase font-bold text-primary tracking-wider">
                                                        Core
                                                    </span>
                                                )}
                                                {chan.isCustom && (
                                                    <span className="text-[9px] uppercase font-bold text-cyan-400 tracking-wider">
                                                        Custom
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] font-bold font-mono px-2 py-0.5 border ${getColorBadgeClass(chan.badgeColor)}`}
                                    >
                                        {chan.shortLabel}
                                    </Badge>
                                </div>

                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {chan.description}
                                </p>
                            </div>

                            {/* Preset rule & Action bar */}
                            <div className="pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Percent size={13} className="text-amber-400" />
                                    <span className="text-[11px] font-medium text-muted-foreground">Preset:</span>
                                    {preset === 0 ? (
                                        <span className="text-[11px] font-mono font-semibold text-foreground/80">
                                            Base (100%)
                                        </span>
                                    ) : preset > 0 ? (
                                        <span className="text-[11px] font-mono font-bold text-purple-400">
                                            +{preset}% Markup
                                        </span>
                                    ) : (
                                        <span className="text-[11px] font-mono font-bold text-emerald-400">
                                            {preset}% Discount
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openEditModal(chan)}
                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                        title="Edit Channel Details"
                                    >
                                        <Edit2 size={13} />
                                    </Button>
                                    {chan.isCustom && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteChannel(chan.id, chan.label || chan.name || chan.id)}
                                            className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                            title="Delete Custom Channel"
                                        >
                                            <Trash2 size={13} />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Live Interactive Multi-Channel Price Simulator */}
            <div className="p-5 rounded-2xl bg-card/60 border border-border/80 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Calculator size={18} className="text-gold" />
                        <div>
                            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                                Live Channel Pricing Simulator
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                                Preview how products with automated preset formulas price across your channels.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Sample Base Retail (₹):</Label>
                        <div className="relative w-32">
                            <span className="absolute left-2.5 top-1.5 text-xs text-muted-foreground font-mono">₹</span>
                            <Input
                                type="number"
                                min="0"
                                step="10"
                                value={testBasePrice}
                                onChange={(e) => setTestBasePrice(parseFloat(e.target.value) || 0)}
                                className="h-8 pl-6 text-xs font-mono font-bold bg-background border-border"
                            />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-1">
                    {channels.map((chan) => {
                        const preset = chan.discountPreset || 0;
                        const factor = 1 + preset / 100;
                        const simulated = Math.round(testBasePrice * factor);

                        return (
                            <div
                                key={chan.id}
                                className="p-3 rounded-xl bg-background/80 border border-border/60 flex flex-col justify-between gap-1.5"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] font-semibold text-muted-foreground truncate">
                                        {chan.shortLabel}
                                    </span>
                                    <span className="text-[9px] font-mono text-muted-foreground/80">
                                        {preset > 0 ? `+${preset}%` : preset < 0 ? `${preset}%` : "0%"}
                                    </span>
                                </div>
                                <div className="text-sm font-mono font-bold text-foreground">
                                    ₹{simulated.toLocaleString("en-IN")}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Modal: Add / Edit Channel */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-md bg-card/98 backdrop-blur-2xl border-border/90 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                            <Plus className="text-primary" size={16} />
                            {editingChannel ? `Edit Channel: ${editingChannel.label}` : "Add Custom Sales Channel"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3.5 py-2 text-xs">
                        <div className="space-y-1">
                            <Label className="text-xs font-semibold text-muted-foreground">Channel Name</Label>
                            <Input
                                placeholder="e.g. Instagram Live, Amazon India, Dubai Expo..."
                                value={formName}
                                onChange={(e) => {
                                    setFormName(e.target.value);
                                    if (!editingChannel && !formId) {
                                        setFormShortLabel(e.target.value.slice(0, 6).toUpperCase());
                                    }
                                }}
                                className="bg-background border-border text-xs h-9"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">ID Code (Identifier)</Label>
                                <Input
                                    placeholder="e.g. instagram"
                                    value={formId}
                                    disabled={!!editingChannel}
                                    onChange={(e) => setFormId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                                    className="bg-background border-border text-xs h-9 font-mono disabled:opacity-60"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Short Code (Tag)</Label>
                                <Input
                                    placeholder="e.g. INSTA"
                                    maxLength={8}
                                    value={formShortLabel}
                                    onChange={(e) => setFormShortLabel(e.target.value.toUpperCase())}
                                    className="bg-background border-border text-xs h-9 font-mono"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs font-semibold text-muted-foreground">Description</Label>
                            <Input
                                placeholder="Purpose or fulfillment notes for this channel..."
                                value={formDescription}
                                onChange={(e) => setFormDescription(e.target.value)}
                                className="bg-background border-border text-xs h-9"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Badge Accent Color</Label>
                                <Select
                                    value={formColor}
                                    onValueChange={(val) => {
                                        if (val) setFormColor(val as SalesChannelDefinition["badgeColor"]);
                                    }}
                                >
                                    <SelectTrigger className="bg-background border-border text-xs h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="blue">Blue</SelectItem>
                                        <SelectItem value="violet">Violet</SelectItem>
                                        <SelectItem value="emerald">Emerald</SelectItem>
                                        <SelectItem value="amber">Amber</SelectItem>
                                        <SelectItem value="pink">Pink</SelectItem>
                                        <SelectItem value="cyan">Cyan</SelectItem>
                                        <SelectItem value="indigo">Indigo</SelectItem>
                                        <SelectItem value="rose">Rose</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-muted-foreground">Preset % (+Markup / -Discount)</Label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        step="1"
                                        placeholder="0"
                                        value={formPreset}
                                        onChange={(e) => setFormPreset(e.target.value)}
                                        className="bg-background border-border text-xs h-9 font-mono pr-7"
                                    />
                                    <span className="absolute right-2.5 top-2 text-xs text-muted-foreground font-mono">%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsModalOpen(false)}
                            className="text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveChannel}
                            disabled={isSubmitting}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold"
                        >
                            {isSubmitting ? "Saving..." : (editingChannel ? "Update Channel" : "Create Channel")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
