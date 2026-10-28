"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Camera,
    Check,
    ImagePlus,
    Link2,
    Loader2,
    PackagePlus,
    Plus,
    SlidersHorizontal,
    Sparkles,
    X,
} from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { Category } from "@/lib/categories";
import {
    computeRulePrice,
    getConfiguredChannels,
    loadConfiguredChannels,
    type SalesChannelDefinition,
} from "@/lib/channel-pricing";
import { CRAFT_DEFINITIONS, PLATING_DEFINITIONS, OCCASION_DEFINITIONS, BASE_METAL_DEFINITIONS } from "@/lib/imitation-jewelry-engine";
import { ChannelPricingInput } from "@/components/pricing/ChannelPricingInput";
import { STORAGE_LOCATIONS } from "@/lib/products";
import {
    compressImageFile,
    createDraftProduct,
    nextSku,
    sizePresetsForCategory,
} from "@/lib/quick-product";

interface QuickAddProductDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    categories: Category[];
    existingSkus: string[];
    onCreated: (result: {
        productId: string;
        name: string;
        sku: string;
        categoryName: string;
    }) => void;
}

function formatPrice(value: number): string {
    return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** Remembers whether the user prefers the expanded form across sessions. */
const FULL_FORM_STORAGE_KEY = "luminila_quick_add_full_form";

export function QuickAddProductDialog({
    open,
    onOpenChange,
    categories,
    existingSkus,
    onCreated,
}: QuickAddProductDialogProps) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState(categories[0]?.name || "Uncategorized");
    const [customCategory, setCustomCategory] = useState("");
    const [costPrice, setCostPrice] = useState("");
    const [sellingPrice, setSellingPrice] = useState("");
    const [stock, setStock] = useState("0");
    const [description, setDescription] = useState("");
    const [craft, setCraft] = useState("");
    const [imageData, setImageData] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [showImageUrl, setShowImageUrl] = useState(false);
    const [imageBusy, setImageBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [channels, setChannels] = useState<SalesChannelDefinition[]>(() =>
        getConfiguredChannels()
    );
    const [showCustomCategory, setShowCustomCategory] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [sku, setSku] = useState("");
    const [location, setLocation] = useState("Showcase Tray A");
    const [hsnCode, setHsnCode] = useState("71179010");
    const [plating, setPlating] = useState("");
    const [occasion, setOccasion] = useState("");
    const [baseMetal, setBaseMetal] = useState("");
    const [channelPrices, setChannelPrices] = useState<Record<string, number>>({});

    const galleryInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        loadConfiguredChannels().then(setChannels).catch(console.error);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        setChannels(getConfiguredChannels());
    }, [open]);

    useEffect(() => {
        if (!open) return;
        try {
            setExpanded(localStorage.getItem(FULL_FORM_STORAGE_KEY) === "true");
        } catch {
            // Storage can be unavailable in private modes; default to compact.
        }
    }, [open]);

    const effectiveCategory = customCategory.trim() || category;
    const sizePreset = sizePresetsForCategory(effectiveCategory);
    const cost = parseFloat(costPrice) || 0;

    const shopChannel = channels.find((channel) => channel.id === "pos" || channel.id === "shop");
    const shopRulePrice = computeRulePrice(cost, shopChannel?.pricingRule);
    const posOverride = Number(channelPrices.pos ?? channelPrices.shop) || 0;
    const effectiveSelling =
        posOverride > 0
            ? posOverride
            : shopRulePrice ?? (parseFloat(sellingPrice) || 0);

    const websiteChannel = channels.find(
        (channel) => channel.id === "website" || channel.id === "shopify"
    );
    const websiteOverride =
        Number(channelPrices.website ?? channelPrices.shopify) || 0;
    const websitePrice =
        websiteOverride > 0
            ? websiteOverride
            : computeRulePrice(cost, websiteChannel?.pricingRule) ?? effectiveSelling;

    const whatsappChannel = channels.find((channel) => channel.id === "whatsapp");
    const whatsappOverride = Number(channelPrices.whatsapp) || 0;
    const whatsappPrice =
        whatsappOverride > 0
            ? whatsappOverride
            : computeRulePrice(cost, whatsappChannel?.pricingRule) ?? effectiveSelling;

    const previewChannels = channels
        .filter((channel) => channel.pricingRule || channel.id === "pos")
        .slice(0, 4)
        .map((channel) => {
            const rulePriced = computeRulePrice(cost, channel.pricingRule);
            const override = Number(channelPrices[channel.id]) || 0;
            const fallback = effectiveSelling > 0 ? effectiveSelling : null;
            return {
                id: channel.id,
                label: channel.shortLabel || channel.label || channel.id,
                price: override > 0 ? override : rulePriced ?? fallback,
            };
        });

    const resetPiece = useCallback(() => {
        setName("");
        setSku("");
        setCostPrice("");
        setSellingPrice("");
        setStock("0");
        setDescription("");
        setImageData("");
        setImageUrl("");
        setChannelPrices({});
    }, []);

    const resetAll = useCallback(() => {
        resetPiece();
        setCategory(categories[0]?.name || "Uncategorized");
        setCustomCategory("");
        setCraft("");
        setLocation("Showcase Tray A");
        setHsnCode("71179010");
        setPlating("");
        setOccasion("");
        setBaseMetal("");
        setShowCustomCategory(false);
        setShowImageUrl(false);
    }, [resetPiece, categories]);

    const toggleExpanded = () => {
        setExpanded((value) => {
            const next = !value;
            try {
                localStorage.setItem(FULL_FORM_STORAGE_KEY, String(next));
            } catch {
                // Preference is a convenience; failing to persist is harmless.
            }
            return next;
        });
    };

    const applyImageFile = useCallback(async (file: File) => {
        if (!file.type.startsWith("image/")) {
            toast.error("Choose an image file.");
            return;
        }
        setImageBusy(true);
        try {
            const compressed = await compressImageFile(file);
            setImageData(compressed);
            setImageUrl("");
        } catch (error) {
            console.error(error);
            toast.error("Could not read that image.");
        } finally {
            setImageBusy(false);
        }
    }, []);

    const handlePaste = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            const item = Array.from(event.clipboardData.items).find((entry) =>
                entry.type.startsWith("image/")
            );
            const file = item?.getAsFile();
            if (file) {
                event.preventDefault();
                void applyImageFile(file);
            }
        },
        [applyImageFile]
    );

    const handleDrop = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void applyImageFile(file);
        },
        [applyImageFile]
    );

    const canSave =
        name.trim().length > 0 &&
        effectiveSelling > 0 &&
        !saving &&
        !imageBusy;

    const save = async (addAnother: boolean) => {
        if (!name.trim()) {
            toast.error("Give the piece a name.");
            return;
        }
        if (effectiveSelling <= 0) {
            toast.error("Enter a cost price or a shop selling price first.");
            return;
        }

        setSaving(true);
        try {
            const result = await createDraftProduct({
                name,
                sku: sku.trim() || undefined,
                categoryName: effectiveCategory,
                categories,
                costPrice: cost,
                sellingPrice: effectiveSelling,
                stock: parseInt(stock, 10) || 0,
                description,
                craft,
                plating,
                occasion,
                baseMetal,
                hsnCode,
                location,
                channelPrices,
                imageData,
                imageUrl: imageUrl.trim() || undefined,
                existingSkus,
            });

            toast.success(`${result.name} saved as a draft`, {
                description: "Publish it when the photo and price are ready.",
            });
            onCreated({
                productId: result.productId,
                name: result.name,
                sku: result.sku,
                categoryName: effectiveCategory,
            });

            if (addAnother) {
                resetPiece();
            } else {
                resetAll();
                onOpenChange(false);
            }
        } catch (error) {
            console.error(error);
            toast.error(
                error instanceof Error ? error.message : "Could not save the product"
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent
                className="max-w-xl bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-h-[min(94vh,calc(100dvh-1.5rem))] overflow-y-auto p-0 shadow-2xl"
                onPaste={handlePaste}
            >
                <DialogHeader className="px-5 pt-5 pb-3 border-b border-surface-hover/60">
                    <DialogTitle className="flex items-center gap-2 text-base font-bold text-white">
                        <PackagePlus size={18} className="text-primary" />
                        Quick add a piece
                        <span className="text-[10px] font-mono uppercase tracking-wide text-moonstone bg-bg-navy/70 border border-surface-hover/60 px-2 py-0.5 rounded-full">
                            Draft
                        </span>
                        <button
                            type="button"
                            onClick={toggleExpanded}
                            aria-pressed={expanded}
                            title={expanded ? "Hide the full product form" : "Show the full product form"}
                            className="ml-auto flex items-center gap-1 rounded-full border border-surface-hover/60 bg-bg-navy/70 px-2 py-0.5 text-[10px] font-medium text-moonstone transition-colors hover:text-white"
                        >
                            <SlidersHorizontal size={11} />
                            {expanded ? "Hide full form" : "Full form"}
                        </button>
                    </DialogTitle>
                    <p className="text-[11px] text-moonstone leading-relaxed">
                        Cost is the pricing root. Channel prices are calculated from your
                        saved rules; nothing goes live until you publish.
                    </p>
                </DialogHeader>

                <div className="px-5 py-4 space-y-4">
                    {/* Photo */}
                    <div className="grid grid-cols-[128px_1fr] gap-3 items-start">
                        <div
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            className={`relative aspect-square rounded-xl border-2 border-dashed overflow-hidden flex items-center justify-center transition-colors ${
                                dragging
                                    ? "border-primary bg-primary/10"
                                    : "border-surface-hover/80 bg-bg-navy/60"
                            }`}
                        >
                            {imageData || imageUrl ? (
                                <>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- preview is a compressed data URL with dynamic dimensions */}
                                    <img
                                        src={imageData || imageUrl}
                                        alt="Product preview"
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setImageData("");
                                            setImageUrl("");
                                        }}
                                        className="absolute top-1.5 right-1.5 size-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                                        aria-label="Remove photo"
                                    >
                                        <X size={13} />
                                    </button>
                                </>
                            ) : imageBusy ? (
                                <Loader2 size={20} className="animate-spin text-moonstone" />
                            ) : (
                                <div className="text-center px-2">
                                    <ImagePlus size={20} className="mx-auto text-moonstone" />
                                    <p className="text-[10px] text-moonstone mt-1 leading-tight">
                                        Drop, paste
                                        <br />
                                        or choose
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => galleryInputRef.current?.click()}
                                    className="h-8 text-[11px] border-surface-hover/80 bg-bg-navy/60 text-white hover:bg-surface-hover/40"
                                >
                                    <ImagePlus size={13} />
                                    Gallery
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => cameraInputRef.current?.click()}
                                    className="h-8 text-[11px] border-surface-hover/80 bg-bg-navy/60 text-white hover:bg-surface-hover/40"
                                >
                                    <Camera size={13} />
                                    Camera
                                </Button>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowImageUrl((value) => !value)}
                                className="text-[10px] text-moonstone hover:text-white flex items-center gap-1"
                            >
                                <Link2 size={11} />
                                {showImageUrl ? "Hide image URL" : "Use an image URL"}
                            </button>
                            {showImageUrl && (
                                <Input
                                    value={imageUrl}
                                    onChange={(event) => {
                                        setImageUrl(event.target.value);
                                        if (event.target.value) setImageData("");
                                    }}
                                    placeholder="https://…"
                                    className="h-8 bg-bg-navy border-surface-hover text-xs"
                                />
                            )}
                            <p className="text-[10px] text-moonstone leading-tight">
                                Photos are compressed to 1200 px. You can add one later
                                and still save the draft.
                            </p>
                            <input
                                ref={galleryInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void applyImageFile(file);
                                    event.target.value = "";
                                }}
                            />
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void applyImageFile(file);
                                    event.target.value = "";
                                }}
                            />
                        </div>
                    </div>

                    {/* Identity */}
                    <div className="space-y-1">
                        <Label className="text-[11px] text-moonstone">Product name</Label>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="e.g. Malar temple jhumkas"
                            className="h-10 bg-bg-navy border-surface-hover text-sm text-white"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <Label className="text-[11px] text-moonstone">Category</Label>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowCustomCategory((value) => {
                                            if (value) setCustomCategory("");
                                            return !value;
                                        })
                                    }
                                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                                >
                                    <Plus size={10} />
                                    New
                                </button>
                            </div>
                            {showCustomCategory ? (
                                <Input
                                    value={customCategory}
                                    onChange={(event) => setCustomCategory(event.target.value)}
                                    placeholder="New category name"
                                    className="h-9 bg-bg-navy border-surface-hover text-xs"
                                    autoFocus
                                />
                            ) : (
                                <Select
                                    value={category}
                                    onValueChange={(value) => {
                                        if (!value) return;
                                        setCategory(value);
                                        setCustomCategory("");
                                    }}
                                >
                                    <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.length === 0 && (
                                            <SelectItem value="Uncategorized">Uncategorized</SelectItem>
                                        )}
                                        {categories.map((entry) => (
                                            <SelectItem key={entry.id} value={entry.name}>
                                                {entry.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        <div className="space-y-1">
                            <Label className="text-[11px] text-moonstone">Style / craft</Label>
                            <Select
                                value={craft || "none"}
                                onValueChange={(value) =>
                                    setCraft(value === "none" ? "" : value || "")
                                }
                            >
                                <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                    <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">—</SelectItem>
                                    {Object.entries(CRAFT_DEFINITIONS).map(([key, definition]) => (
                                        <SelectItem key={key} value={key}>
                                            {definition.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Pricing */}
                    <div className="rounded-lg border border-surface-hover/70 bg-bg-navy/50 p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-moonstone">
                                    Cost price (₹)
                                </Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={costPrice}
                                    onChange={(event) => setCostPrice(event.target.value)}
                                    placeholder="600"
                                    className="h-9 bg-bg-navy border-surface-hover text-sm font-mono text-teal-300"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-[11px] text-moonstone">
                                    {shopRulePrice !== null
                                        ? "Shop price (from rule)"
                                        : "Shop selling price (₹)"}
                                </Label>
                                {shopRulePrice !== null ? (
                                    <div className="h-9 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 flex items-center text-sm font-mono font-bold text-emerald-300">
                                        {formatPrice(shopRulePrice)}
                                    </div>
                                ) : (
                                    <Input
                                        type="number"
                                        min="0"
                                        value={sellingPrice}
                                        onChange={(event) => setSellingPrice(event.target.value)}
                                        placeholder="1,899"
                                        className="h-9 bg-bg-navy border-surface-hover text-sm font-mono text-white"
                                    />
                                )}
                            </div>
                        </div>

                        {shopRulePrice === null && (
                            <p className="text-[10px] leading-relaxed text-amber-300/80">
                                No Shop cost rule is configured yet, so enter the counter
                                price here. Set channel rules in Settings → Sales channels.
                            </p>
                        )}

                        {previewChannels.length > 1 && (
                            <div className="flex flex-wrap gap-1.5">
                                {previewChannels.map((preview) => (
                                    <span
                                        key={preview.id}
                                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-navy border border-surface-hover/60 text-moonstone"
                                    >
                                        {preview.label}{" "}
                                        <strong className="text-white font-semibold">
                                            {preview.price === null
                                                ? "—"
                                                : formatPrice(preview.price)}
                                        </strong>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-moonstone">Stock</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={stock}
                                    onChange={(event) => setStock(event.target.value)}
                                    className="h-9 bg-bg-navy border-surface-hover text-sm font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-moonstone">
                                    One-line description
                                </Label>
                                <Input
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    placeholder="Shown under the product name"
                                    className="h-9 bg-bg-navy border-surface-hover text-xs"
                                />
                            </div>
                        </div>

                        {sizePreset.sizes.length > 0 && (
                            <p className="text-[10px] text-moonstone leading-tight">
                                Creates sizes {sizePreset.sizes.join(" · ")}. Stock goes to{" "}
                                {sizePreset.defaultSize}; the other sizes start at 0.
                            </p>
                        )}
                    </div>

                    {expanded && (
                        <div className="space-y-3 rounded-lg border border-surface-hover/70 bg-bg-navy/40 p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-[11px] font-semibold text-white">
                                    Full details
                                </p>
                                <span className="text-[9px] font-mono uppercase tracking-wide text-moonstone">
                                    Optional
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">SKU</Label>
                                    <Input
                                        value={sku}
                                        onChange={(event) => setSku(event.target.value.toUpperCase())}
                                        placeholder={`Auto: ${nextSku(effectiveCategory, existingSkus)}`}
                                        className="h-9 bg-bg-navy border-surface-hover font-mono text-xs text-primary"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">
                                        Storage location
                                    </Label>
                                    <Select
                                        value={location}
                                        onValueChange={(value) => value && setLocation(value)}
                                    >
                                        <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {STORAGE_LOCATIONS.map((entry) => (
                                                <SelectItem key={entry} value={entry}>
                                                    {entry}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">HSN code</Label>
                                    <Input
                                        value={hsnCode}
                                        onChange={(event) => setHsnCode(event.target.value)}
                                        className="h-9 bg-bg-navy border-surface-hover font-mono text-xs text-amber-300"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">Plating</Label>
                                    <Select
                                        value={plating || "none"}
                                        onValueChange={(value) =>
                                            setPlating(value === "none" ? "" : value || "")
                                        }
                                    >
                                        <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                            <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(PLATING_DEFINITIONS).map(([key, definition]) => (
                                                <SelectItem key={key} value={key}>
                                                    {definition.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">Occasion</Label>
                                    <Select
                                        value={occasion || "none"}
                                        onValueChange={(value) =>
                                            setOccasion(value === "none" ? "" : value || "")
                                        }
                                    >
                                        <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                            <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(OCCASION_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-moonstone">Base metal</Label>
                                    <Select
                                        value={baseMetal || "none"}
                                        onValueChange={(value) =>
                                            setBaseMetal(value === "none" ? "" : value || "")
                                        }
                                    >
                                        <SelectTrigger className="h-9 bg-bg-navy border-surface-hover text-xs text-white">
                                            <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(BASE_METAL_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2 border-t border-surface-hover/50 pt-3">
                                <div>
                                    <p className="text-[11px] font-semibold text-white">
                                        Channel overrides
                                    </p>
                                    <p className="text-[10px] text-moonstone">
                                        Leave a channel empty to use its cost rule.
                                    </p>
                                </div>
                                <ChannelPricingInput
                                    basePrice={effectiveSelling}
                                    costPrice={cost}
                                    channelPrices={channelPrices}
                                    onChange={setChannelPrices}
                                    onBasePriceChange={(value) =>
                                        setSellingPrice(String(value))
                                    }
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                        <Sparkles size={13} className="text-primary mt-0.5 shrink-0" />
                        <p className="text-[10px] text-moonstone leading-relaxed">
                            SKU is generated from the category. This piece stays hidden
                            from the storefront until you publish it; the website and
                            WhatsApp prices use {formatPrice(websitePrice)} and{" "}
                            {formatPrice(whatsappPrice)}.
                        </p>
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-surface-hover/60 flex items-center justify-between gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                            resetAll();
                            onOpenChange(false);
                        }}
                        disabled={saving}
                        className="h-9 text-xs text-moonstone hover:text-white"
                    >
                        Cancel
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void save(true)}
                            disabled={!canSave}
                            className="h-9 text-xs border-surface-hover/80 bg-transparent text-white hover:bg-surface-hover/40"
                        >
                            Save & add another
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void save(false)}
                            disabled={!canSave}
                            className="h-9 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {saving ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Saving…
                                </>
                            ) : (
                                <>
                                    <Check size={14} />
                                    Save draft
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
