"use client";

import React, { useEffect, useMemo, useState } from "react";
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

import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    RadioTower,
    Radio,
    Users,
    Sparkles,
    Send,
    Plus,
    X,
    Loader2,
    Eye,
    Search,
    Package,
    Check,
    CheckCircle2,
    Layers,
    Share2,
    Megaphone,
    Pencil,
    RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
    broadcastProductsToDestinations,
    formatProductCatalogBroadcastMessage,
    type BroadcastProductItem,
    type AudienceSegment,
} from "@/lib/whatsapp-broadcast";
import { getAllChats, whatsappManager, type WPPChat } from "@/lib/whatsapp";
import { searchProductsForPicker } from "@/lib/products";
import type { Product } from "@/types/database";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { getChannelPrice } from "@/lib/channel-pricing";

export interface ProductBroadcastModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialSelectedProducts?: BroadcastProductItem[];
    onBroadcastSuccess?: () => void;
}

export function ProductBroadcastModal({
    isOpen,
    onClose,
    initialSelectedProducts = [],
    onBroadcastSuccess,
}: ProductBroadcastModalProps) {
    const { user } = useAuth();

    // Products being broadcast
    const [selectedProducts, setSelectedProducts] = useState<BroadcastProductItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<BroadcastProductItem[]>([]);
    const [searchingProducts, setSearchingProducts] = useState(false);
    const [showSearchPicker, setShowSearchPicker] = useState(false);

    // Broadcast text settings
    const [campaignTitle, setCampaignTitle] = useState("✨ *Luminila — New Arrivals & Inventory Drop* ✨");
    const [announcementNote, setAnnouncementNote] = useState("Limited handcrafted designs available. Reserve your favourite piece today!");
    const [callToAction, setCallToAction] = useState("💬 Reply with the SKU or product name to order or book a live video preview!");
    const [includeImages, setIncludeImages] = useState(true);

    // Target Destinations
    const [sendToStatus, setSendToStatus] = useState(true);
    const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
    const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [selectedSegments, setSelectedSegments] = useState<AudienceSegment[]>([]);

    // Discovered Chats (Channels, Communities & Groups)
    const [loadingChats, setLoadingChats] = useState(false);
    const [availableChannels, setAvailableChannels] = useState<WPPChat[]>([]);
    const [availableCommunities, setAvailableCommunities] = useState<WPPChat[]>([]);
    const [availableGroups, setAvailableGroups] = useState<WPPChat[]>([]);

    // Dispatch state
    const [broadcasting, setBroadcasting] = useState(false);
    const [previewTab, setPreviewTab] = useState<'config' | 'preview'>('config');
    const [customMessage, setCustomMessage] = useState<string>("");
    const [isEditingCustomMessage, setIsEditingCustomMessage] = useState<boolean>(false);

    // Reset or populate on open
    useEffect(() => {
        if (!isOpen) return;
        if (initialSelectedProducts.length > 0) {
            setSelectedProducts(initialSelectedProducts);
        }
        setShowSearchPicker(false);
        setIsEditingCustomMessage(false);
    }, [isOpen, initialSelectedProducts]);

    // Discover WhatsApp Channels, Communities and Groups for the connected session
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoadingChats(true);

        getAllChats(whatsappManager.getSessionIdSafe())
            .then((chats) => {
                if (cancelled) return;
                const channels = chats.filter((c) => c.id.includes('@newsletter'));
                const communities = chats.filter((c) =>
                    Boolean(c.isCommunityAnnounce || c.isCommunity || (c.name || '').toLowerCase().includes('announcement') || (c.name || '').toLowerCase().includes('community'))
                );
                const groups = chats.filter((c) =>
                    (c.isGroup || c.id.includes('@g.us')) &&
                    !c.isCommunityAnnounce &&
                    !(c.name || '').toLowerCase().includes('announcement')
                );

                setAvailableChannels(channels);
                setAvailableCommunities(communities);
                setAvailableGroups(groups);

                // Auto-select all channels & communities by default if any exist
                if (channels.length > 0) {
                    setSelectedChannels(channels.map((c) => c.id));
                }
                if (communities.length > 0) {
                    setSelectedCommunities(communities.map((c) => c.id));
                }
            })
            .catch((err) => {
                console.error('[broadcast] failed to discover chats:', err);
            })
            .finally(() => {
                if (!cancelled) setLoadingChats(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    // Search additional products from PocketBase
    useEffect(() => {
        if (!showSearchPicker || !searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearchingProducts(true);
            try {
                const items = await searchProductsForPicker(searchQuery);
                const mapped: BroadcastProductItem[] = items.map((p) => ({
                    id: p.id,
                    name: p.name,
                    sku: p.sku,
                    price: getChannelPrice(p, 'whatsapp'),
                    stock: 1,
                    category: p.category,
                    image: p.image_url || null,
                }));
                setSearchResults(mapped);
            } catch (err) {
                console.error('[broadcast] search failed:', err);
                setSearchResults([]);
            } finally {
                setSearchingProducts(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery, showSearchPicker]);

    const addProduct = (p: BroadcastProductItem) => {
        if (selectedProducts.some((x) => x.id === p.id)) {
            toast.info(`${p.name} is already selected`);
            return;
        }
        setSelectedProducts((prev) => [...prev, p]);
        toast.success(`Added ${p.name}`);
    };

    const removeProduct = (productId: string) => {
        setSelectedProducts((prev) => prev.filter((p) => p.id !== productId));
    };

    const toggleChannel = (id: string) => {
        setSelectedChannels((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleCommunity = (id: string) => {
        setSelectedCommunities((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleGroup = (id: string) => {
        setSelectedGroups((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleSegment = (seg: AudienceSegment) => {
        setSelectedSegments((prev) =>
            prev.includes(seg) ? prev.filter((x) => x !== seg) : [...prev, seg]
        );
    };

    const formattedPreview = useMemo(() => {
        return formatProductCatalogBroadcastMessage(selectedProducts, {
            title: campaignTitle,
            note: announcementNote,
            callToAction,
        });
    }, [selectedProducts, campaignTitle, announcementNote, callToAction]);

    useEffect(() => {
        if (!isEditingCustomMessage) {
            setCustomMessage(formattedPreview);
        }
    }, [formattedPreview, isEditingCustomMessage]);

    const handleBroadcast = async () => {
        if (selectedProducts.length === 0) {
            toast.error("Please select at least 1 product to broadcast");
            return;
        }

        const hasAnyDestination =
            sendToStatus ||
            selectedChannels.length > 0 ||
            selectedCommunities.length > 0 ||
            selectedGroups.length > 0 ||
            selectedSegments.length > 0;

        if (!hasAnyDestination) {
            toast.error("Please select at least one broadcast destination (Status, Channels, Communities, Groups, or Cohorts)");
            return;
        }

        setBroadcasting(true);
        try {
            const allGroupIds = Array.from(new Set([...selectedCommunities, ...selectedGroups]));
            const res = await broadcastProductsToDestinations({
                products: selectedProducts,
                destinations: {
                    status: sendToStatus,
                    channelIds: selectedChannels,
                    groupIds: allGroupIds,
                    customerSegments: selectedSegments,
                },
                campaignTitle,
                announcementNote,
                callToAction,
                customMessage: isEditingCustomMessage ? customMessage : undefined,
                includeImages,
                createdBy: user?.id,
            });

            const summaryParts: string[] = [];
            if (res.statusPosted) summaryParts.push("WhatsApp Status");
            if (res.channelsSent > 0) summaryParts.push(`${res.channelsSent} Channel(s)`);
            if (selectedCommunities.length > 0) summaryParts.push(`${selectedCommunities.length} Community Announcement(s)`);
            if (selectedGroups.length > 0) summaryParts.push(`${selectedGroups.length} Group(s)`);
            if (res.customersQueued > 0) summaryParts.push(`${res.customersQueued} Customer(s) queued`);

            if (summaryParts.length > 0) {
                toast.success(`Broadcast delivered to: ${summaryParts.join(", ")}!`, {
                    description: `${selectedProducts.length} products published with photos & details.`,
                });
                onBroadcastSuccess?.();
                onClose();
            } else if (res.errors.length > 0) {
                toast.error(`Broadcast encountered issues: ${res.errors.join("; ")}`);
            }
        } catch (err) {
            toast.error((err as Error)?.message || "Failed to broadcast products");
        } finally {
            setBroadcasting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base text-foreground">
                        <Share2 size={18} className="text-emerald-500" />
                        Broadcast Products to WhatsApp
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        Publish live product updates to WhatsApp Status (Stories), Channels, Community announcements, and Groups simultaneously.
                    </DialogDescription>
                </DialogHeader>

                {/* View switcher tabs */}
                <div className="flex border-b border-border text-xs mb-3">
                    <button
                        onClick={() => setPreviewTab('config')}
                        className={cn(
                            "py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5",
                            previewTab === 'config'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Layers size={14} /> Configure Broadcast ({selectedProducts.length} items)
                    </button>
                    <button
                        onClick={() => setPreviewTab('preview')}
                        className={cn(
                            "py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5",
                            previewTab === 'preview'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Eye size={14} /> WhatsApp Preview
                    </button>
                </div>

                {previewTab === 'config' ? (
                    <div className="space-y-4 text-xs">
                        {/* 1. Selected Products Showcase */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold flex items-center gap-1.5">
                                    <Package size={13} className="text-primary" />
                                    Selected Inventory Products ({selectedProducts.length})
                                </Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowSearchPicker(!showSearchPicker)}
                                    className="h-7 text-[11px] gap-1"
                                >
                                    <Plus size={12} /> {showSearchPicker ? "Hide Search" : "Add More Products"}
                                </Button>
                            </div>

                            {/* Search Drawer for adding more items */}
                            {showSearchPicker && (
                                <div className="p-2.5 rounded-lg border border-border bg-muted/30 space-y-2">
                                    <div className="relative">
                                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search by product name or SKU…"
                                            className="h-8 pl-8 text-xs bg-background"
                                        />
                                    </div>
                                    {searchingProducts && (
                                        <div className="flex items-center justify-center py-2 text-muted-foreground gap-2">
                                            <Loader2 size={12} className="animate-spin" /> Searching products…
                                        </div>
                                    )}
                                    {searchResults.length > 0 && (
                                        <div className="max-h-36 overflow-y-auto divide-y divide-border border border-border rounded-md bg-background">
                                            {searchResults.map((p) => (
                                                <div
                                                    key={p.id}
                                                    className="flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        {p.image ? (
                                                            <Image src={p.image} alt={p.name} width={28} height={28} className="size-7 rounded object-cover border border-border" />
                                                        ) : (
                                                            <div className="size-7 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                                                <Package size={12} />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-foreground truncate text-xs">{p.name}</p>
                                                            <p className="text-[10px] text-muted-foreground font-mono">{p.sku} • ₹{p.price.toLocaleString('en-IN')}</p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={() => addProduct(p)}
                                                        disabled={selectedProducts.some((x) => x.id === p.id)}
                                                        className="h-6 text-[10px] px-2"
                                                    >
                                                        {selectedProducts.some((x) => x.id === p.id) ? "Added" : "+ Add"}
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Selected Products Carousel / Chips */}
                            {selectedProducts.length === 0 ? (
                                <div className="text-center py-6 border border-dashed border-border rounded-lg text-muted-foreground text-xs">
                                    No products selected. Click &ldquo;Add More Products&rdquo; to choose items from inventory.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 border border-border rounded-lg bg-muted/10">
                                    {selectedProducts.map((p, idx) => (
                                        <div
                                            key={p.id}
                                            className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/80 relative group"
                                        >
                                            {p.image ? (
                                                <Image src={p.image} alt={p.name} width={44} height={44} className="size-11 rounded object-cover border border-border shrink-0" />
                                            ) : (
                                                <div className="size-11 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                                                    <Package size={16} />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold truncate text-xs text-foreground">{idx + 1}. {p.name}</p>
                                                <p className="text-[10px] font-mono text-primary font-bold">{p.sku}</p>
                                                <p className="text-[11px] font-bold text-foreground">₹{p.price.toLocaleString("en-IN")}</p>
                                            </div>
                                            <button
                                                onClick={() => removeProduct(p.id)}
                                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors"
                                                title="Remove"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* 2. Destination Targets */}
                        <div className="space-y-3 pt-2 border-t border-border">
                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                <RadioTower size={13} className="text-emerald-500" />
                                Broadcast Destinations
                            </Label>

                            {/* WhatsApp Status Toggle */}
                            <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                        <Sparkles size={13} className="text-emerald-500" />
                                        WhatsApp Status (Stories)
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                                            24hr Ephemeral
                                        </Badge>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        Publishes product photos and showcase text directly to your store&apos;s WhatsApp Status visible to all contacts.
                                    </p>
                                </div>
                                <Switch
                                    checked={sendToStatus}
                                    onCheckedChange={setSendToStatus}
                                />
                            </div>

                            {/* WhatsApp Channels */}
                            <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                            <Radio size={13} className="text-amber-500" />
                                            WhatsApp Channels ({availableChannels.length})
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            One-to-many newsletters and subscriber channels.
                                        </p>
                                    </div>
                                    {availableChannels.length > 0 && (
                                        <button
                                            onClick={() => {
                                                if (selectedChannels.length === availableChannels.length) {
                                                    setSelectedChannels([]);
                                                } else {
                                                    setSelectedChannels(availableChannels.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-primary hover:underline font-medium"
                                        >
                                            {selectedChannels.length === availableChannels.length ? "Deselect All" : "Select All"}
                                        </button>
                                    )}
                                </div>

                                {loadingChats ? (
                                    <div className="py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" /> Loading channels…
                                    </div>
                                ) : availableChannels.length === 0 ? (
                                    <p className="text-[11px] text-muted-foreground italic py-1">
                                        No WhatsApp channels detected on this paired account.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {availableChannels.map((c) => {
                                            const isSelected = selectedChannels.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    onClick={() => toggleChannel(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-amber-500/15 border-amber-500 text-amber-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Radio size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 2. WhatsApp Community Announcements */}
                            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 font-bold text-amber-500">
                                            <Megaphone size={14} className="text-amber-500" />
                                            Community Announcements ({availableCommunities.length})
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Official announcement channels for your WhatsApp Communities.
                                        </p>
                                    </div>
                                    {availableCommunities.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedCommunities.length === availableCommunities.length) {
                                                    setSelectedCommunities([]);
                                                } else {
                                                    setSelectedCommunities(availableCommunities.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-amber-500 hover:underline font-semibold"
                                        >
                                            {selectedCommunities.length === availableCommunities.length ? "Deselect All" : "Select All"}
                                        </button>
                                    )}
                                </div>

                                {loadingChats ? (
                                    <div className="py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" /> Loading community channels…
                                    </div>
                                ) : availableCommunities.length === 0 ? (
                                    <p className="text-[11px] text-muted-foreground italic py-1">
                                        No community announcement channels found on this account.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                                        {availableCommunities.map((c) => {
                                            const isSelected = selectedCommunities.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleCommunity(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-amber-500/20 border-amber-500 text-amber-400 shadow-sm"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Megaphone size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 3. WhatsApp Groups */}
                            <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                            <Users size={13} className="text-blue-500" />
                                            WhatsApp Groups ({availableGroups.length})
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            Wholesale, VIP, and general customer group chats.
                                        </p>
                                    </div>
                                    {availableGroups.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedGroups.length === availableGroups.length) {
                                                    setSelectedGroups([]);
                                                } else {
                                                    setSelectedGroups(availableGroups.map((c) => c.id));
                                                }
                                            }}
                                            className="text-[10px] text-primary hover:underline font-medium"
                                        >
                                            {selectedGroups.length === availableGroups.length ? "Deselect All" : "Select All"}
                                        </button>
                                    )}
                                </div>

                                {loadingChats ? (
                                    <div className="py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" /> Loading groups…
                                    </div>
                                ) : availableGroups.length === 0 ? (
                                    <p className="text-[11px] text-muted-foreground italic py-1">
                                        No active WhatsApp groups detected on this paired account.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                                        {availableGroups.map((c) => {
                                            const isSelected = selectedGroups.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleGroup(c.id)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors",
                                                        isSelected
                                                            ? "bg-blue-500/15 border-blue-500 text-blue-400"
                                                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <Users size={11} /> {c.name}
                                                    {isSelected && <Check size={11} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Optional Direct Customer Cohorts */}
                            <div className="p-2.5 rounded-lg border border-border bg-card space-y-1.5">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                        <CheckCircle2 size={13} className="text-purple-400" />
                                        Direct Customer Segments (Optional Staggered Queue)
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        Queues individual 1:1 WhatsApp messages with 8–22s anti-ban humanized jitter.
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {(['all_active', 'vip_tiers', 'wholesale'] as AudienceSegment[]).map((seg) => {
                                        const labels: Record<AudienceSegment, string> = {
                                            all_active: 'All Active Customers',
                                            vip_tiers: 'VIP Tiers (1000+ pts)',
                                            wholesale: 'Wholesale / B2B Buyers',
                                            points_over_500: 'Points > 500',
                                        };
                                        const isSelected = selectedSegments.includes(seg);
                                        return (
                                            <button
                                                key={seg}
                                                onClick={() => toggleSegment(seg)}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors",
                                                    isSelected
                                                        ? "bg-purple-500/15 border-purple-500 text-purple-300"
                                                        : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                )}
                                            >
                                                {labels[seg]}
                                                {isSelected && <Check size={11} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* 3. Promotional Content & Options */}
                        <div className="space-y-3 pt-2 border-t border-border">
                            <div className="grid gap-1.5">
                                <Label htmlFor="pb-title" className="text-xs font-medium">Header / Collection Title</Label>
                                <Input
                                    id="pb-title"
                                    value={campaignTitle}
                                    onChange={(e) => setCampaignTitle(e.target.value)}
                                    className="h-8 text-xs bg-background"
                                />
                            </div>

                            <div className="grid gap-1.5">
                                <Label htmlFor="pb-note" className="text-xs font-medium">Promotional Note / Offer</Label>
                                <Input
                                    id="pb-note"
                                    value={announcementNote}
                                    onChange={(e) => setAnnouncementNote(e.target.value)}
                                    placeholder="e.g. Special festive discount or limited stock alert…"
                                    className="h-8 text-xs bg-background"
                                />
                            </div>

                            <div className="grid gap-1.5">
                                <Label htmlFor="pb-cta" className="text-xs font-medium">Call to Action</Label>
                                <Input
                                    id="pb-cta"
                                    value={callToAction}
                                    onChange={(e) => setCallToAction(e.target.value)}
                                    className="h-8 text-xs bg-background"
                                />
                            </div>

                            <div className="flex items-center justify-between pt-1">
                                <span className="text-xs text-muted-foreground">Attach product image to posts (recommended)</span>
                                <Switch checked={includeImages} onCheckedChange={setIncludeImages} />
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Live Preview Tab */
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                                <Eye size={13} className="text-emerald-500" /> WhatsApp Message {isEditingCustomMessage ? "(Customized)" : "(Auto-Generated)"}
                            </span>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">{selectedProducts.length} Products</Badge>
                                {!isEditingCustomMessage ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setCustomMessage(formattedPreview);
                                            setIsEditingCustomMessage(true);
                                        }}
                                        className="h-6 text-[11px] gap-1 px-2 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                                    >
                                        <Pencil size={11} /> Edit Message Text
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                            setCustomMessage(formattedPreview);
                                            setIsEditingCustomMessage(false);
                                        }}
                                        className="h-6 text-[11px] gap-1 px-2 text-muted-foreground hover:text-foreground"
                                    >
                                        <RotateCcw size={11} /> Reset to Auto
                                    </Button>
                                )}
                            </div>
                        </div>

                        {isEditingCustomMessage ? (
                            <div className="space-y-1.5">
                                <Textarea
                                    value={customMessage}
                                    onChange={(e) => setCustomMessage(e.target.value)}
                                    rows={10}
                                    className="font-mono text-xs leading-relaxed bg-background"
                                    placeholder="Edit your broadcast message..."
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    You have full control over the exact text sent to channels, groups, and status.
                                </p>
                            </div>
                        ) : (
                            <div className="p-3.5 rounded-xl bg-card border border-border shadow-inner font-sans text-xs whitespace-pre-wrap text-foreground max-h-96 overflow-y-auto leading-relaxed border-l-4 border-l-emerald-500">
                                {formattedPreview}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="flex items-center justify-between gap-2 pt-3 border-t border-border">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        disabled={broadcasting}
                        className="text-xs"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleBroadcast}
                        disabled={broadcasting || selectedProducts.length === 0}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                    >
                        {broadcasting ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                Broadcasting Products…
                            </>
                        ) : (
                            <>
                                <Send size={14} />
                                Broadcast {selectedProducts.length} Product{selectedProducts.length === 1 ? '' : 's'}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
