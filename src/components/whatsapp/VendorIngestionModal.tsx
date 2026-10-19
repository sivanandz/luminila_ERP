"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
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
import {
    Sparkles,
    Package,
    Search,
    Tag,
    Loader2,
    CheckCircle2,
    Building2,
    Users,
    Radio,
    Image as ImageIcon,
    Camera,
    ChevronDown,
    ChevronUp,
    Layers,
} from "lucide-react";
import { toast } from "sonner";
import { getTypeAheadProducts } from "@/lib/products";
import { getVendors, type Vendor } from "@/lib/vendors";
import {
    ingestVendorProduct,
    addToExistingInventory,
    queueLabelPrint,
    parseVendorOffer,
} from "@/lib/whatsapp-crm";
import {
    getSKUTaxonomies,
    loadSKUTaxonomies,
    subscribeSKUTaxonomies,
    type SKUTaxonomies,
    generateParentSKU,
    generateChildSKU,
    deriveHSNCode,
    getSubcategoriesForCategory,
    computeNextSkuSequence,
} from "@/lib/sku-generator";

// ============================================
// 1. Create New Product from Message (spec §8.2)
// ============================================

export interface VendorIngestionModalProps {
    isOpen: boolean;
    onClose: () => void;
    messageBody: string;
    vendorId?: string;
    vendorName?: string;
    imageUrl?: string;
    sourceContext?: {
        chatName?: string;
        senderName?: string;
        isGroup?: boolean;
        isChannel?: boolean;
    };
    /** Called after successful ingestion with the new variant id. */
    onIngested?: (result: { productId: string; variantId: string; sku: string }) => void;
}

export function VendorIngestionModal({
    isOpen,
    onClose,
    messageBody,
    vendorId,
    vendorName,
    imageUrl,
    sourceContext,
    onIngested,
}: VendorIngestionModalProps) {
    const parsed = useMemo(() => (isOpen ? parseVendorOffer(messageBody) : null), [isOpen, messageBody]);

    const [taxonomies, setTaxonomies] = useState<SKUTaxonomies>(getSKUTaxonomies());
    const [skuGenre, setSkuGenre] = useState(parsed?.genreCode || 'TMP');
    const [skuCategory, setSkuCategory] = useState(parsed?.categoryCode || 'NEC');
    const [skuSubcat, setSkuSubcat] = useState(parsed?.subcategoryCode || 'CHK');
    const [skuPlating, setSkuPlating] = useState(parsed?.platingCode || 'MG');
    const [skuColor, setSkuColor] = useState(parsed?.colorCode || 'RB');
    const [skuSize, setSkuSize] = useState(parsed?.sizeCode || 'STD');
    const [skuBaseMetal, setSkuBaseMetal] = useState(parsed?.baseMetalCode || 'BR');
    const [skuStone, setSkuStone] = useState(parsed?.stoneCode || 'KP');
    const [nextSkuSeq, setNextSkuSeq] = useState(1);
    const [showAdvancedAttributes, setShowAdvancedAttributes] = useState(false);
    const [skipTaxonomy, setSkipTaxonomy] = useState(false);
    const [customSku, setCustomSku] = useState('');

    const [name, setName] = useState(() => {
        const cat = parsed?.category || 'Jewelry';
        const pur = parsed?.purity || '';
        return `${pur ? pur + ' ' : ''}${cat}`.trim();
    });
    const [category, setCategory] = useState(parsed?.category || '');
    const [purity, setPurity] = useState(parsed?.purity || '');
    const [weight, setWeight] = useState(parsed?.weightGrams?.toString() || '');
    const [costPrice, setCostPrice] = useState(parsed?.price?.toString() || '');
    const [marginPercent, setMarginPercent] = useState('40');
    const [quantity, setQuantity] = useState(parsed?.quantity?.toString() || '1');
    const [submitting, setSubmitting] = useState(false);
    const [ingested, setIngested] = useState<{ sku: string; variantId: string } | null>(null);

    // Product Photo Handling (handles WhatsApp decrypted base64, CDN URLs, and manual replacement)
    const [activeImage, setActiveImage] = useState<string | null>(imageUrl || null);
    const [imageLoadError, setImageLoadError] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setActiveImage(imageUrl || null);
        setImageLoadError(false);
    }, [imageUrl, isOpen]);

    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                setActiveImage(reader.result);
                setImageLoadError(false);
                toast.success('Product photo attached');
            }
        };
        reader.readAsDataURL(file);
    };

    // Vendor Selection
    const [vendorsList, setVendorsList] = useState<Vendor[]>([]);
    const [selectedVendorId, setSelectedVendorId] = useState<string>(vendorId || '');
    const [selectedVendorName, setSelectedVendorName] = useState<string>(vendorName || '');

    // Load registered taxonomies
    React.useEffect(() => {
        loadSKUTaxonomies().then(setTaxonomies);
        const unsubscribe = subscribeSKUTaxonomies(setTaxonomies);
        return () => unsubscribe();
    }, []);

    // Load registered vendors
    React.useEffect(() => {
        if (!isOpen) return;
        getVendors().then(setVendorsList).catch(() => {});
    }, [isOpen]);

    // Re-run smart extraction each time the modal opens with a new message
    React.useEffect(() => {
        if (!isOpen) return;
        setSkipTaxonomy(false);
        setCustomSku('');
        const p = parseVendorOffer(messageBody);
        const g = p.genreCode || 'TMP';
        const c = p.categoryCode || 'NEC';
        const s = p.subcategoryCode || 'CHK';
        setSkuGenre(g);
        setSkuCategory(c);
        setSkuSubcat(s);
        setSkuPlating(p.platingCode || 'MG');
        setSkuColor(p.colorCode || 'RB');
        setSkuSize(p.sizeCode || 'STD');
        setSkuBaseMetal(p.baseMetalCode || 'BR');
        setSkuStone(p.stoneCode || 'KP');

        const gLabel = taxonomies.genres.find(x => x.code === g)?.label.split(' ')[0] || '';
        const cLabel = taxonomies.categories.find(x => x.code === c)?.label || '';
        const sLabel = taxonomies.subcategories.find(x => x.code === s)?.label || '';
        const defaultName = `${gLabel} ${cLabel} ${sLabel}`.trim() || `${p.purity ? p.purity + ' ' : ''}${p.category || 'Jewelry'}`.trim();
        setName(defaultName);

        setCategory(cLabel || p.category || '');
        setPurity(p.purity || '');
        setWeight(p.weightGrams?.toString() || '');
        setCostPrice(p.price?.toString() || '');
        setQuantity(p.quantity?.toString() || '1');
        setIngested(null);
        setSelectedVendorId(vendorId || '');
        setSelectedVendorName(vendorName || '');
    }, [isOpen, messageBody, vendorId, vendorName, taxonomies.genres, taxonomies.categories, taxonomies.subcategories]);

    // Keep SKU sequence in sync with DB
    React.useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const prefix = `${skuGenre}${skuCategory}${skuSubcat}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
        computeNextSkuSequence(prefix).then(seq => {
            if (!cancelled) setNextSkuSeq(seq);
        });
        return () => { cancelled = true; };
    }, [isOpen, skuGenre, skuCategory, skuSubcat]);

    // Dynamically filter subcategories based on selected Category
    const filteredSubcategories = useMemo(() => {
        return getSubcategoriesForCategory(skuCategory, taxonomies.subcategories);
    }, [skuCategory, taxonomies.subcategories]);

    const handleCategoryChange = (catCode: string) => {
        setSkuCategory(catCode);
        const valid = getSubcategoriesForCategory(catCode, taxonomies.subcategories);
        let nextSub = skuSubcat;
        if (valid.length > 0 && !valid.some(s => s.code === skuSubcat)) {
            nextSub = valid[0].code;
            setSkuSubcat(nextSub);
        }
        if (catCode === "GEN") {
            setCategory("Uncategorized");
        } else {
            const gLabel = taxonomies.genres.find(x => x.code === skuGenre)?.label.split(' ')[0] || '';
            const cLabel = taxonomies.categories.find(x => x.code === catCode)?.label || '';
            const sLabel = taxonomies.subcategories.find(x => x.code === nextSub)?.label || '';
            setName(`${gLabel} ${cLabel} ${sLabel}`.trim());
        }
    };

    const handleSubcatChange = (subcatCode: string) => {
        setSkuSubcat(subcatCode);
        const gLabel = taxonomies.genres.find(x => x.code === skuGenre)?.label.split(' ')[0] || '';
        const cLabel = taxonomies.categories.find(x => x.code === skuCategory)?.label || '';
        const sLabel = taxonomies.subcategories.find(x => x.code === subcatCode)?.label || '';
        setName(`${gLabel} ${cLabel} ${sLabel}`.trim());
    };

    const suggestedRetail = useMemo(() => {
        const cost = parseFloat(costPrice) || 0;
        const margin = parseFloat(marginPercent) || 0;
        return Math.ceil(cost * (1 + margin / 100));
    }, [costPrice, marginPercent]);

    // Deterministic Parent and Child SKU Preview
    const liveParentSku = useMemo(() => {
        return generateParentSKU(skuGenre, skuCategory, skuSubcat, nextSkuSeq);
    }, [skuGenre, skuCategory, skuSubcat, nextSkuSeq]);

    const liveChildSku = useMemo(() => {
        return generateChildSKU(liveParentSku, skuPlating, skuColor, skuSize);
    }, [liveParentSku, skuPlating, skuColor, skuSize]);

    // Effective SKU depending on whether taxonomy is skipped
    const effectiveSku = useMemo(() => {
        if (skipTaxonomy) {
            if (customSku.trim()) return customSku.trim().toUpperCase();
            return `GEN-${String(nextSkuSeq).padStart(5, '0')}`;
        }
        return liveChildSku;
    }, [skipTaxonomy, customSku, nextSkuSeq, liveChildSku]);

    const derivedHsn = useMemo(() => {
        return deriveHSNCode(skuCategory, skuBaseMetal, skuStone);
    }, [skuCategory, skuBaseMetal, skuStone]);

    const handleIngest = async () => {
        if (!name.trim() || !(parseFloat(costPrice) > 0)) {
            toast.error('Product name and a cost price above zero are required');
            return;
        }
        setSubmitting(true);
        try {
            const effectiveVendorId = selectedVendorId || vendorId || undefined;
            const effectiveVendorName = selectedVendorName || vendorName;
            const sku = effectiveSku;
            const isSkippedOrGen = skipTaxonomy || skuCategory === 'GEN';
            const catLabel = isSkippedOrGen ? undefined : (taxonomies.categories.find(c => c.code === skuCategory)?.label || category || undefined);
            const effectiveHsn = isSkippedOrGen ? '71179090' : derivedHsn;

            const result = await ingestVendorProduct({
                name: name.trim(),
                sku,
                category: catLabel,
                costPrice: parseFloat(costPrice) || 0,
                retailPrice: suggestedRetail,
                quantity: parseInt(quantity, 10) || 0,
                weightGrams: parseFloat(weight) || undefined,
                purity: purity.trim() || undefined,
                imageUrl: activeImage || undefined,
                vendorId: effectiveVendorId,
                description: `Ingested from WhatsApp ${sourceContext?.chatName ? `[${sourceContext.chatName}] ` : ''}${effectiveVendorName ? `(${effectiveVendorName})` : ''}:\n${messageBody}`,
                hsnCode: effectiveHsn,
                platingCode: skipTaxonomy ? undefined : skuPlating,
                colorCode: skipTaxonomy ? undefined : skuColor,
                sizeCode: skipTaxonomy ? undefined : skuSize,
                baseMetalCode: skipTaxonomy ? undefined : skuBaseMetal,
                stoneCode: skipTaxonomy ? undefined : skuStone,
            });

            // Automatically queue barcode tag (spec §8.2)
            try {
                await queueLabelPrint({
                    variantId: result.variantId,
                    quantity: parseInt(quantity, 10) || 1,
                    template: 'dumbbell',
                    source: 'vendor_ingestion',
                });
            } catch (tagErr) {
                console.warn('Barcode tag auto-queue failed:', tagErr);
            }

            setIngested({ sku, variantId: result.variantId });
            onIngested?.({ productId: result.productId, variantId: result.variantId, sku });
            toast.success(`Ingested ${sku} — Barcode tag queued in /labels`);
        } catch (err) {
            console.error('Vendor ingestion failed:', err);
            toast.error((err as Error)?.message || 'Failed to ingest product');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-lg bg-card border-border max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Sparkles size={16} className="text-amber-400" />
                        Create New Product from Message
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Deterministic Master Jewelry SKU engine pre-filled from vendor message. Review &amp; ingest
                        {selectedVendorName ? ` for ${selectedVendorName}` : ''}.
                    </DialogDescription>
                </DialogHeader>

                {/* Source attribution banner for group/channel */}
                {sourceContext?.chatName && (
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-primary">
                            {sourceContext.isChannel ? <Radio size={13} className="text-violet-400" /> : <Users size={13} className="text-sky-400" />}
                            {sourceContext.chatName}
                        </span>
                        {sourceContext.senderName && (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                                Sender: {sourceContext.senderName}
                            </span>
                        )}
                    </div>
                )}

                {/* Image preview / upload (supports WhatsApp decrypted base64 or manual upload) */}
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 border border-border/60">
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoUpload}
                    />
                    {activeImage && !imageLoadError ? (
                        <div className="relative group size-12 shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element -- supports dynamic WhatsApp base64 data URIs and blob urls */}
                            <img
                                src={activeImage}
                                alt="Product Photo"
                                className="size-12 rounded object-cover border border-border/40 shrink-0 bg-background"
                                onError={() => setImageLoadError(true)}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                title="Change photo"
                                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center text-white"
                            >
                                <Camera size={14} />
                            </button>
                        </div>
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="size-12 rounded border border-dashed border-border/80 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 bg-background/50 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                            title="Click to attach a product photo"
                        >
                            <Camera size={16} />
                            <span className="text-[8px] mt-0.5 font-medium">+ Photo</span>
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                <ImageIcon size={12} className={activeImage && !imageLoadError ? "text-pink-500" : "text-muted-foreground"} />
                                {activeImage && !imageLoadError ? "Product Photo Attached" : "No Photo Attached"}
                            </p>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-[10px] text-primary hover:underline font-medium"
                            >
                                {activeImage && !imageLoadError ? "Replace Photo" : "Upload Photo"}
                            </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                            {activeImage && !imageLoadError
                                ? "Auto-synced to Catalog, POS, Labels & Storefront"
                                : "Attach photo from device or vendor WhatsApp"}
                        </p>
                    </div>
                </div>

                {parsed && (
                    <div className="rounded-lg bg-muted/50 border border-border/60 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed max-h-16 overflow-y-auto">
                        “{messageBody.slice(0, 220)}{messageBody.length > 220 ? '…' : ''}”
                    </div>
                )}

                {ingested ? (
                    <div className="space-y-3 py-2">
                        <div className="flex items-center gap-2 text-emerald-500 text-sm font-semibold">
                            <CheckCircle2 size={18} />
                            Product ingested as {ingested.sku}
                        </div>
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 flex items-center gap-3">
                            <Tag size={20} className="text-emerald-400 shrink-0" />
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-foreground">Barcode Tag Queued</p>
                                <p className="text-[11px] text-muted-foreground">
                                    Dumbbell tag with SKU {ingested.sku} added to queue. Print it anytime from the Labels module.
                                </p>
                            </div>
                        </div>
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button variant="outline" size="sm" onClick={onClose}>
                                Close
                            </Button>
                            <Button size="sm" onClick={() => { onClose(); window.location.href = '/labels'; }}>
                                <Tag size={14} className="mr-1.5" />
                                Go to Print Queue
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <div className="grid gap-3 py-1">
                        {/* 1. Architectural Master SKU or General SKU Preview Card */}
                        <div className={`rounded-xl border p-3 space-y-2 transition-colors ${skipTaxonomy ? 'border-amber-500/40 bg-amber-500/5' : 'border-primary/30 bg-primary/5'}`}>
                            <div className="flex items-center justify-between">
                                <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${skipTaxonomy ? 'text-amber-400' : 'text-primary'}`}>
                                    <Tag size={12} />
                                    {skipTaxonomy ? 'General SKU (Taxonomy Skipped)' : 'Master Architectural SKU'}
                                </span>
                                <span className="text-[10px] font-mono text-amber-400 font-semibold">
                                    HSN {skipTaxonomy || skuCategory === 'GEN' ? '71179090' : derivedHsn} (3% GST)
                                </span>
                            </div>
                            {skipTaxonomy ? (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={customSku || effectiveSku}
                                            onChange={(e) => setCustomSku(e.target.value.toUpperCase())}
                                            placeholder="e.g. GEN-00001 or VENDOR-101"
                                            className="h-8 font-mono text-xs font-bold text-amber-300 bg-background border-border"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCustomSku(`GEN-${String(nextSkuSeq).padStart(5, '0')}`)}
                                            className="h-8 text-[11px] px-2 text-amber-400 border-amber-500/30 hover:bg-amber-500/10 shrink-0"
                                            title="Reset to sequential generic SKU"
                                        >
                                            Auto GEN
                                        </Button>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">Freeform custom SKU or auto-generated sequential fallback</p>
                                </div>
                            ) : (
                                <div className="font-mono text-xs font-bold text-foreground bg-background px-2.5 py-1.5 rounded-lg border border-border flex items-center justify-between shadow-sm">
                                    <span className="text-primary truncate">{effectiveSku}</span>
                                    <span className="text-[10px] text-muted-foreground ml-2 shrink-0">Seq #{String(nextSkuSeq).padStart(5, '0')}</span>
                                </div>
                            )}
                        </div>

                        {/* 2. Vendor Attribution Selector */}
                        <div className="grid gap-1">
                            <Label htmlFor="vi-vendor" className="text-xs flex items-center gap-1.5">
                                <Building2 size={12} className="text-muted-foreground" />
                                Vendor / Supplier
                            </Label>
                            <select
                                id="vi-vendor"
                                value={selectedVendorId}
                                onChange={(e) => {
                                    setSelectedVendorId(e.target.value);
                                    const v = vendorsList.find(x => x.id === e.target.value);
                                    setSelectedVendorName(v?.name || '');
                                }}
                                className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                                <option value="">-- No Vendor / General Stock --</option>
                                {vendorsList.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name}{v.phone ? ` (${v.phone})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 3. Taxonomic Hierarchy Toggle & Configuration */}
                        <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-muted/40 border border-border/60">
                            <div className="flex items-center gap-2 min-w-0">
                                <Layers size={14} className={skipTaxonomy ? "text-amber-400" : "text-primary"} />
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                        Taxonomic Hierarchy
                                        {skipTaxonomy && (
                                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                                Skipped
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                        {skipTaxonomy ? "Product registered as Uncategorized" : "Genre, Category & Subcategory mapping"}
                                    </div>
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant={skipTaxonomy ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    const next = !skipTaxonomy;
                                    setSkipTaxonomy(next);
                                    if (next) {
                                        setSkuGenre("GEN");
                                        setSkuCategory("GEN");
                                        setSkuSubcat("GEN");
                                        setCategory("Uncategorized");
                                    } else {
                                        setSkuGenre("TMP");
                                        setSkuCategory("NEC");
                                        setSkuSubcat("CHK");
                                    }
                                }}
                                className={`h-7 text-[11px] px-2.5 font-medium shrink-0 ${skipTaxonomy ? "bg-amber-500 hover:bg-amber-600 text-black font-semibold" : "border-border text-foreground hover:bg-muted"}`}
                            >
                                {skipTaxonomy ? "Restore Taxonomy" : "Skip Taxonomy"}
                            </Button>
                        </div>

                        {skipTaxonomy ? (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 flex items-center justify-between text-xs">
                                <div className="space-y-0.5">
                                    <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                                        <Layers size={13} className="text-amber-400" />
                                        Taxonomic Category Skipped
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                        Product will be saved under <span className="text-amber-200 font-mono">Uncategorized</span> with statutory general HSN <span className="font-mono">71179090</span>.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSkipTaxonomy(false);
                                        setSkuGenre("TMP");
                                        setSkuCategory("NEC");
                                        setSkuSubcat("CHK");
                                    }}
                                    className="text-[11px] text-amber-400 hover:underline font-medium ml-2 shrink-0"
                                >
                                    Classify
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* 3. Taxonomic Hierarchy (Genre, Category, Dynamic Subcategory) */}
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-genre" className="text-[11px] text-muted-foreground">Style Genre</Label>
                                        <select
                                            id="vi-genre"
                                            value={skuGenre}
                                            onChange={(e) => setSkuGenre(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {taxonomies.genres.map(g => (
                                                <option key={g.code} value={g.code}>{g.code} - {g.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-cat" className="text-[11px] text-muted-foreground">Category</Label>
                                        <select
                                            id="vi-cat"
                                            value={skuCategory}
                                            onChange={(e) => handleCategoryChange(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {taxonomies.categories.map(c => (
                                                <option key={c.code} value={c.code}>{c.code} - {c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-subcat" className="text-[11px] text-muted-foreground">Subcategory</Label>
                                        <select
                                            id="vi-subcat"
                                            value={skuSubcat}
                                            onChange={(e) => handleSubcatChange(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {filteredSubcategories.map(s => (
                                                <option key={s.code} value={s.code}>{s.code} - {s.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* 4. Child Variant Finishes & Dimensions */}
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-plating" className="text-[11px] text-muted-foreground">Plating Finish</Label>
                                        <select
                                            id="vi-plating"
                                            value={skuPlating}
                                            onChange={(e) => setSkuPlating(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {taxonomies.platings.map(p => (
                                                <option key={p.code} value={p.code}>{p.code} - {p.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-color" className="text-[11px] text-muted-foreground">Primary Color</Label>
                                        <select
                                            id="vi-color"
                                            value={skuColor}
                                            onChange={(e) => setSkuColor(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {taxonomies.colors.map(col => (
                                                <option key={col.code} value={col.code}>{col.code} - {col.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="vi-size" className="text-[11px] text-muted-foreground">Size / Spec</Label>
                                        <select
                                            id="vi-size"
                                            value={skuSize}
                                            onChange={(e) => setSkuSize(e.target.value)}
                                            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary truncate"
                                        >
                                            {taxonomies.sizes.map(sz => (
                                                <option key={sz.code} value={sz.code}>{sz.code} - {sz.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* 5. Collapsible Base Metal & Stone (for HSN accuracy) */}
                                <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowAdvancedAttributes(prev => !prev)}
                                        className="w-full text-[11px] text-primary/90 hover:text-primary flex items-center justify-between font-medium"
                                    >
                                        <span>Metallurgy &amp; Stone ({skuBaseMetal} / {skuStone})</span>
                                        {showAdvancedAttributes ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                    {showAdvancedAttributes && (
                                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                                            <div className="grid gap-1">
                                                <Label htmlFor="vi-metal" className="text-[10px] text-muted-foreground">Base Metal</Label>
                                                <select
                                                    id="vi-metal"
                                                    value={skuBaseMetal}
                                                    onChange={(e) => setSkuBaseMetal(e.target.value)}
                                                    className="h-7.5 rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
                                                >
                                                    {taxonomies.baseMetals.map(m => (
                                                        <option key={m.code} value={m.code}>{m.code} - {m.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="grid gap-1">
                                                <Label htmlFor="vi-stone" className="text-[10px] text-muted-foreground">Stone Type</Label>
                                                <select
                                                    id="vi-stone"
                                                    value={skuStone}
                                                    onChange={(e) => setSkuStone(e.target.value)}
                                                    className="h-7.5 rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
                                                >
                                                    {taxonomies.stones.map(s => (
                                                        <option key={s.code} value={s.code}>{s.code} - {s.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* 6. Product Name */}
                        <div className="grid gap-1">
                            <Label htmlFor="vi-name" className="text-xs">Product Name</Label>
                            <Input id="vi-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs font-medium" />
                        </div>

                        {/* 7. Commercials & Weights */}
                        <div className="grid grid-cols-4 gap-2">
                            <div className="grid gap-1">
                                <Label htmlFor="vi-cost" className="text-xs">Cost (₹)</Label>
                                <Input id="vi-cost" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="vi-margin" className="text-xs">Margin %</Label>
                                <Input id="vi-margin" value={marginPercent} onChange={(e) => setMarginPercent(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="vi-qty" className="text-xs">Qty</Label>
                                <Input id="vi-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" inputMode="numeric" />
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="vi-weight" className="text-xs">Wt (g)</Label>
                                <Input id="vi-weight" value={weight} onChange={(e) => setWeight(e.target.value)} className="h-8 text-xs" placeholder="14.2" inputMode="decimal" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                            <span className="text-[11px] text-muted-foreground">Suggested Retail</span>
                            <span className="text-sm font-bold text-primary">₹{suggestedRetail.toLocaleString('en-IN')}</span>
                        </div>
                    </div>
                )}

                {!ingested && (
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                        <Button size="sm" onClick={handleIngest} disabled={submitting}>
                            {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : <Sparkles size={14} className="mr-1" />}
                            Approve &amp; Ingest
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ============================================
// 2. Add to Existing Inventory (spec §8.2)
// ============================================

export interface AddExistingInventoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    messageBody: string;
    vendorId?: string;
    vendorName?: string;
    sourceContext?: {
        chatName?: string;
        senderName?: string;
        isGroup?: boolean;
        isChannel?: boolean;
    };
    onAdded?: (variantId: string, quantity: number) => void;
}

interface VariantResult {
    id: string;
    fullSku: string;
    name: string;
    variantName: string;
    price: number;
    stock: number;
}

export function AddExistingInventoryModal({
    isOpen,
    onClose,
    messageBody,
    vendorId,
    vendorName,
    sourceContext,
    onAdded,
}: AddExistingInventoryModalProps) {
    const parsed = useMemo(() => (isOpen ? parseVendorOffer(messageBody) : null), [isOpen, messageBody]);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<VariantResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<VariantResult | null>(null);
    const [quantity, setQuantity] = useState(parsed?.quantity?.toString() || '1');
    const [submitting, setSubmitting] = useState(false);

    // Vendor Selection
    const [vendorsList, setVendorsList] = useState<Vendor[]>([]);
    const [selectedVendorId, setSelectedVendorId] = useState<string>(vendorId || '');
    const [selectedVendorName, setSelectedVendorName] = useState<string>(vendorName || '');

    // Load registered vendors
    React.useEffect(() => {
        if (!isOpen) return;
        getVendors().then(setVendorsList).catch(() => {});
    }, [isOpen]);

    // Re-parse the detected quantity each time the modal opens
    React.useEffect(() => {
        if (isOpen) {
            setQuantity(parseVendorOffer(messageBody).quantity?.toString() || '1');
            setSelectedVendorId(vendorId || '');
            setSelectedVendorName(vendorName || '');
        }
    }, [isOpen, messageBody, vendorId, vendorName]);

    const search = async () => {
        if (query.trim().length < 2) { setResults([]); return; }
        setSearching(true);
        try {
            const products = await getTypeAheadProducts(query.trim());
            setResults(products.slice(0, 8).map((p) => ({
                id: p.variant_id,
                fullSku: p.full_sku,
                name: p.name,
                variantName: p.variant_name,
                price: p.price,
                stock: p.stock,
            })));
        } catch {
            setResults([]);
        } finally {
            setSearching(false);
        }
    };

    React.useEffect(() => {
        const t = setTimeout(search, 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const handleConfirm = async () => {
        if (!selected || !(parseInt(quantity, 10) > 0)) {
            toast.error('Select a variant and enter a quantity');
            return;
        }
        setSubmitting(true);
        try {
            const effectiveVendorId = selectedVendorId || vendorId || undefined;
            const effectiveVendorName = selectedVendorName || vendorName;
            await addToExistingInventory({
                variantId: selected.id,
                quantity: parseInt(quantity, 10),
                vendorId: effectiveVendorId,
                notes: `Received via WhatsApp ${sourceContext?.chatName ? `[${sourceContext.chatName}] ` : ''}${effectiveVendorName ? `(${effectiveVendorName}) ` : ''}${parsed?.price ? `@ ₹${parsed.price}` : ''}`,
            });
            toast.success(`Added ${quantity} × ${selected.fullSku} to inventory`);
            onAdded?.(selected.id, parseInt(quantity, 10));
            onClose();
        } catch (err) {
            console.error('Add to inventory failed:', err);
            toast.error((err as Error)?.message || 'Failed to update inventory');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Package size={16} className="text-indigo-400" />
                        Add to Existing Inventory
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Find the matching variant and record the received quantity from this vendor chat.
                    </DialogDescription>
                </DialogHeader>

                {/* Source attribution banner for group/channel */}
                {sourceContext?.chatName && (
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-primary">
                            {sourceContext.isChannel ? <Radio size={13} className="text-violet-400" /> : <Users size={13} className="text-sky-400" />}
                            {sourceContext.chatName}
                        </span>
                        {sourceContext.senderName && (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                                Sender: {sourceContext.senderName}
                            </span>
                        )}
                    </div>
                )}

                <div className="grid gap-3 py-1">
                    {/* Vendor Attribution Selector */}
                    <div className="grid gap-1.5">
                        <Label htmlFor="aei-vendor" className="text-xs flex items-center gap-1.5">
                            <Building2 size={12} className="text-muted-foreground" />
                            Vendor / Supplier (for GRN)
                        </Label>
                        <select
                            id="aei-vendor"
                            value={selectedVendorId}
                            onChange={(e) => {
                                setSelectedVendorId(e.target.value);
                                const v = vendorsList.find(x => x.id === e.target.value);
                                setSelectedVendorName(v?.name || '');
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="">-- No Vendor / Direct Stock Adjustment --</option>
                            {vendorsList.map((v) => (
                                <option key={v.id} value={v.id}>
                                    {v.name}{v.phone ? ` (${v.phone})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search product or SKU…"
                            className="h-9 pl-8 text-xs"
                            autoFocus
                        />
                        {searching && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
                    </div>

                    {results.length > 0 && (
                        <div className="rounded-lg border border-border divide-y divide-border/60 max-h-44 overflow-y-auto">
                            {results.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => setSelected(r)}
                                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                                        selected?.id === r.id ? 'bg-primary/10' : 'hover:bg-muted/60'
                                    }`}
                                >
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold truncate">{r.name} <span className="text-muted-foreground font-normal">· {r.variantName}</span></p>
                                        <p className="text-[10px] font-mono text-muted-foreground">{r.fullSku}</p>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground shrink-0">stock {r.stock}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        <div className="grid gap-1.5">
                            <Label className="text-xs">Received Qty {parsed?.quantity ? `(parsed: ${parsed.quantity})` : ''}</Label>
                            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" inputMode="numeric" />
                        </div>
                        <div className="grid gap-1.5">
                            <Label className="text-xs">Detected Cost</Label>
                            <div className="h-8 px-2 flex items-center rounded-md border border-border bg-muted/40 text-xs text-muted-foreground">
                                {parsed?.price ? `₹${parsed.price.toLocaleString('en-IN')}` : '— not detected —'}
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" onClick={handleConfirm} disabled={submitting || !selected}>
                        {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : <PackagePlusIcon />}
                        Confirm Receipt
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PackagePlusIcon() {
    return <Package size={14} className="mr-1" />;
}
