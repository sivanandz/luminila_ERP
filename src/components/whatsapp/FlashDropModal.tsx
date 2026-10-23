"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Flame,
    Clock,
    Sparkles,
    Send,
    Plus,
    X,
    Loader2,
    Eye,
    Search,
    Package,
    CheckCircle2,
    RadioTower,
    Users,
    ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { whatsappManager, type WPPChat } from "@/lib/whatsapp";
import { searchProductsForPicker } from "@/lib/products";
import type { Product } from "@/types/database";
import { formatPrice } from "@/lib/utils";
import {
    createFlashDropCampaign,
    broadcastFlashDropToWhatsApp,
    listFlashDrops,
    type FlashDropCampaign,
    type FlashDropItem,
} from "@/lib/whatsapp-flash-drops";

export interface FlashDropModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export function FlashDropModal({
    isOpen,
    onClose,
    onSuccess,
}: FlashDropModalProps) {
    const [activeTab, setActiveTab] = useState<'create' | 'active'>('create');
    const [title, setTitle] = useState("🔥 VIP Midnight Drop — Handcrafted Kundan Collection");
    const [description, setDescription] = useState("Exclusive 4-hour drop with guaranteed 10-min reservation hold.");
    const [durationHours, setDurationHours] = useState(4);

    // Selected products
    const [selectedItems, setSelectedItems] = useState<FlashDropItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Product[]>([]);
    const [searching, setSearching] = useState(false);

    // Targets
    const [targetChannels, setTargetChannels] = useState<string[]>([]);
    const [availableChannels, setAvailableChannels] = useState<WPPChat[]>([]);
    const [availableGroups, setAvailableGroups] = useState<WPPChat[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);

    // Active Drops
    const [activeDrops, setActiveDrops] = useState<FlashDropCampaign[]>([]);
    const [launching, setLaunching] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        listFlashDrops().then(setActiveDrops);

        // Fetch WhatsApp Channels & Groups
        setLoadingChats(true);
        whatsappManager.getChats().then((chats: WPPChat[]) => {
            const channels = chats.filter((c: WPPChat) => c.id.endsWith('@newsletter'));
            const groups = chats.filter((c: WPPChat) => c.id.endsWith('@g.us') && !c.id.endsWith('@newsletter'));
            setAvailableChannels(channels);
            setAvailableGroups(groups);
            // Default select first channel if available
            if (channels.length > 0 && targetChannels.length === 0) {
                setTargetChannels([channels[0].id]);
            }
        }).catch((err: unknown) => {
            console.warn('Failed to load chats:', err);
        }).finally(() => setLoadingChats(false));
    }, [isOpen]);

    // Live search products
    useEffect(() => {
        if (!searchQuery.trim() || searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const items = await searchProductsForPicker(searchQuery, { expandVariants: true });
                setSearchResults(items);
            } catch {
                setSearchResults([]);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleAddItem = (prod: Product) => {
        const prodExpanded = prod as unknown as { expand?: { 'product_variants(product)'?: { id: string; price: number; stock_level?: number; sku?: string }[] } };
        const variants = prodExpanded.expand?.['product_variants(product)'] || [];
        const variant = variants[0];
        const origPrice = variant?.price || prod.base_price || 1500;
        const dropPrice = Math.round(origPrice * 0.85); // Default 15% drop discount

        const newItem: FlashDropItem = {
            productId: prod.id,
            variantId: variant?.id || prod.id,
            name: prod.name,
            sku: variant?.sku || prod.sku || 'SKU-001',
            imageUrl: prod.image_url || undefined,
            originalPrice: origPrice,
            dropPrice,
            allocatedStock: Math.max(1, Math.min(10, variant?.stock_level || 5)),
        };

        setSelectedItems(prev => [...prev.filter(i => i.variantId !== newItem.variantId), newItem]);
        setSearchQuery("");
        setSearchResults([]);
    };

    const handleRemoveItem = (variantId: string) => {
        setSelectedItems(prev => prev.filter(i => i.variantId !== variantId));
    };

    const handleUpdatePrice = (variantId: string, dropPrice: number) => {
        setSelectedItems(prev => prev.map(i => i.variantId === variantId ? { ...i, dropPrice } : i));
    };

    const handleUpdateStock = (variantId: string, allocatedStock: number) => {
        setSelectedItems(prev => prev.map(i => i.variantId === variantId ? { ...i, allocatedStock } : i));
    };

    const handleLaunchDrop = async () => {
        if (selectedItems.length === 0) {
            toast.error("Please add at least one product item to the flash drop");
            return;
        }
        if (targetChannels.length === 0) {
            toast.error("Please select at least one WhatsApp Channel or VIP Group");
            return;
        }

        setLaunching(true);
        try {
            const drop = await createFlashDropCampaign({
                title,
                description,
                items: selectedItems,
                durationHours,
                targetJids: targetChannels,
            });

            toast.info(`Dispatching drop to ${targetChannels.length} WhatsApp destination(s)...`);
            const { sent, failed } = await broadcastFlashDropToWhatsApp(drop.id, targetChannels);

            if (sent > 0) {
                toast.success(`🔥 Flash Drop launched! Broadcast sent to ${sent} destination(s).`);
            } else if (failed > 0) {
                toast.warning(`Drop created, but could not deliver to WhatsApp sidecar.`);
            }

            const updated = await listFlashDrops();
            setActiveDrops(updated);
            setActiveTab('active');
            onSuccess?.();
        } catch (err) {
            toast.error("Failed to launch flash drop: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLaunching(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl bg-card border-border text-foreground max-h-[90vh] flex flex-col p-6">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold border border-amber-500/20">
                                <Flame size={20} />
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                                    WhatsApp Timed Flash Drops
                                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                                        Commerce 2.0
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">
                                    Broadcast exclusive timed drops with a guaranteed 10-minute stock reservation hold.
                                </DialogDescription>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg text-xs font-semibold">
                            <button
                                onClick={() => setActiveTab('create')}
                                className={`px-3 py-1.5 rounded-md transition-all ${activeTab === 'create' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                New Drop
                            </button>
                            <button
                                onClick={() => setActiveTab('active')}
                                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${activeTab === 'active' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Active Drops ({activeDrops.length})
                            </button>
                        </div>
                    </div>
                </DialogHeader>

                {activeTab === 'create' ? (
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
                        {/* Title & Duration */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-1.5">
                                <Label className="text-xs font-bold text-muted-foreground uppercase">Drop Campaign Title</Label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Flash Drop Title"
                                    className="bg-muted/30"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                                    <Clock size={12} /> Duration
                                </Label>
                                <select
                                    value={durationHours}
                                    onChange={(e) => setDurationHours(Number(e.target.value))}
                                    className="w-full h-9 rounded-md bg-muted/30 border border-input px-2 text-xs focus:ring-1 focus:ring-primary font-semibold"
                                >
                                    <option value={1}>1 Hour Drop</option>
                                    <option value={2}>2 Hours Drop</option>
                                    <option value={4}>4 Hours Drop</option>
                                    <option value={8}>8 Hours Drop</option>
                                    <option value={24}>24 Hours Drop</option>
                                </select>
                            </div>
                        </div>

                        {/* Search Products */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-muted-foreground uppercase">Add Products to Flash Drop</Label>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by product name or SKU to add..."
                                    className="pl-8 bg-muted/30"
                                />
                                {searching && <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                            </div>

                            {/* Search Results Dropdown */}
                            {searchResults.length > 0 && (
                                <div className="p-1 bg-popover border border-border rounded-xl shadow-lg space-y-1 max-h-48 overflow-y-auto">
                                    {searchResults.map((prod) => (
                                        <div
                                            key={prod.id}
                                            onClick={() => handleAddItem(prod)}
                                            className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/80 cursor-pointer transition-colors"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Package size={14} className="text-primary" />
                                                <span className="font-medium text-foreground">{prod.name}</span>
                                                <span className="font-mono text-muted-foreground text-[10px]">({prod.sku})</span>
                                            </div>
                                            <span className="font-mono font-bold text-primary">{formatPrice(prod.base_price)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Selected Items List */}
                        {selectedItems.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                    Allocated Items ({selectedItems.length})
                                </Label>
                                <div className="space-y-2 border border-border rounded-xl p-2 bg-muted/20">
                                    {selectedItems.map((item) => (
                                        <div key={item.variantId} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-card border border-border">
                                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                                {item.imageUrl ? (
                                                    <Image src={item.imageUrl} alt={item.name} width={36} height={36} className="rounded object-cover" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded bg-muted flex items-center justify-center font-bold text-muted-foreground">💎</div>
                                                )}
                                                <div className="truncate">
                                                    <p className="font-semibold text-foreground truncate">{item.name}</p>
                                                    <p className="font-mono text-[10px] text-muted-foreground">SKU: {item.sku} • Reg: {formatPrice(item.originalPrice)}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">Drop Price (₹)</span>
                                                    <input
                                                        type="number"
                                                        value={item.dropPrice}
                                                        onChange={(e) => handleUpdatePrice(item.variantId, Number(e.target.value))}
                                                        className="w-20 h-7 rounded border border-border bg-muted/40 text-center font-mono font-bold text-emerald-400 text-xs"
                                                    />
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">Allocated Qty</span>
                                                    <input
                                                        type="number"
                                                        value={item.allocatedStock}
                                                        onChange={(e) => handleUpdateStock(item.variantId, Number(e.target.value))}
                                                        className="w-16 h-7 rounded border border-border bg-muted/40 text-center font-mono font-bold text-foreground text-xs"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveItem(item.variantId)}
                                                    className="p-1 text-destructive hover:bg-destructive/10 rounded"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* WhatsApp Channels & VIP Groups Picker */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                                <RadioTower size={13} className="text-emerald-400" />
                                Target WhatsApp Channels &amp; VIP Groups
                            </Label>
                            <div className="grid grid-cols-2 gap-2">
                                {availableChannels.map(ch => (
                                    <label key={ch.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30 cursor-pointer hover:border-primary/50 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={targetChannels.includes(ch.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setTargetChannels(prev => [...prev, ch.id]);
                                                else setTargetChannels(prev => prev.filter(id => id !== ch.id));
                                            }}
                                            className="rounded accent-primary"
                                        />
                                        <span className="truncate font-medium">{ch.name || ch.id}</span>
                                        <Badge variant="outline" className="ml-auto text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                            Channel
                                        </Badge>
                                    </label>
                                ))}
                                {availableGroups.slice(0, 4).map(grp => (
                                    <label key={grp.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30 cursor-pointer hover:border-primary/50 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={targetChannels.includes(grp.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setTargetChannels(prev => [...prev, grp.id]);
                                                else setTargetChannels(prev => prev.filter(id => id !== grp.id));
                                            }}
                                            className="rounded accent-primary"
                                        />
                                        <span className="truncate font-medium">{grp.name || grp.id}</span>
                                        <Badge variant="outline" className="ml-auto text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                                            VIP Group
                                        </Badge>
                                    </label>
                                ))}
                            </div>
                            {availableChannels.length === 0 && availableGroups.length === 0 && (
                                <p className="text-[11px] text-amber-400/80">
                                    No WhatsApp channels or groups found. Connect WhatsApp session in Settings to dispatch.
                                </p>
                            )}
                        </div>

                        {/* 10-Minute Reservation Guarantee Info */}
                        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
                            <span className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                                <Clock size={13} /> 10-Minute Reservation Pool Guarantee Active
                            </span>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                When customers open the link from WhatsApp, 1 unit of stock is locked for 10 minutes. If the UPI checkout is not completed in 10 minutes, the hold expires automatically and returns to the drop pool.
                            </p>
                        </div>
                    </div>
                ) : (
                    /* Active Drops Tab */
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                        {activeDrops.length === 0 ? (
                            <div className="text-center py-10 space-y-2">
                                <Flame size={32} className="mx-auto text-muted-foreground opacity-40" />
                                <p className="text-muted-foreground font-medium">No flash drop campaigns active.</p>
                                <Button size="sm" onClick={() => setActiveTab('create')}>Launch First Drop</Button>
                            </div>
                        ) : (
                            activeDrops.map((drop) => {
                                const isEnded = new Date(drop.endTime).getTime() <= Date.now();
                                const activeResCount = drop.reservations.filter(r => r.status === 'active').length;
                                const completedCount = drop.reservations.filter(r => r.status === 'completed').length;

                                return (
                                    <div key={drop.id} className="p-3.5 bg-muted/20 border border-border rounded-xl space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                                                    {drop.title}
                                                    <Badge className={`text-[10px] ${isEnded ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'}`}>
                                                        {isEnded ? 'Ended' : 'Live Now'}
                                                    </Badge>
                                                </h4>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Ends at: {new Date(drop.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            <div className="text-right font-mono">
                                                <span className="text-emerald-400 font-bold block">{completedCount} Sold</span>
                                                <span className="text-amber-400 text-[10px]">{activeResCount} In-Cart Hold</span>
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                                            <span className="text-muted-foreground">
                                                {drop.items.length} item(s) • Targets: {drop.targetJids.length} channel(s)
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 text-[10px] px-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                                    onClick={() => {
                                                        const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/checkout/whatsapp?dropId=${drop.id}`;
                                                        navigator.clipboard.writeText(`✨ *LUMINILA VIP FLASH LINK (Strict 10-Min Hold)* ✨\n👉 Claim & 1-click pay with UPI: ${url}\n_⏳ Notice: 1 unit is reserved exclusively for you for 10 minutes only upon opening._`);
                                                        toast.success("Copied 10-Min VIP Checkout Link to clipboard!");
                                                    }}
                                                >
                                                    Copy 10-Min Link
                                                </Button>
                                                <span className="font-mono text-primary font-bold">
                                                    Drop ID: {drop.id}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                <DialogFooter className="pt-3 border-t border-border mt-3">
                    <Button variant="outline" size="sm" onClick={onClose} disabled={launching}>
                        Cancel
                    </Button>
                    {activeTab === 'create' && (
                        <Button
                            size="sm"
                            onClick={handleLaunchDrop}
                            disabled={launching || selectedItems.length === 0}
                            className="bg-amber-600 hover:bg-amber-500 text-white font-bold"
                        >
                            {launching ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Flame size={14} className="mr-1.5" />}
                            Launch &amp; Broadcast Flash Drop
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
