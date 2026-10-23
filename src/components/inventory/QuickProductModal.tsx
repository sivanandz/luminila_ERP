"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    PackagePlus,
    Wand2,
    Tag,
    Layers,
    Check,
    Loader2,
} from "lucide-react";
import { getCategories } from "@/lib/categories";
import { quickCreateInventoryProductForPOItem, type QuickProductDetails } from "@/lib/purchase";
import { toast } from "sonner";

export interface QuickProductCreatedResult {
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    basePrice: number;
    costPrice: number;
}

interface QuickProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (result: QuickProductCreatedResult) => void;
    poItemId?: string | null;
    initialData?: {
        name?: string;
        cost_price?: number;
        base_price?: number;
        category?: string;
        hsn_code?: string;
        material?: string;
        purity_karat?: string;
    };
}

const DEFAULT_CATEGORIES = [
    "Necklaces",
    "Earrings",
    "Rings",
    "Bangles",
    "Harams (Long Chains)",
    "Pendants",
    "Mangalsutras",
    "Chains",
    "Bracelets",
    "Silver Articles",
];

const PURITY_OPTIONS = [
    "24K (999 Pure)",
    "22K (916 Hallmark)",
    "18K (750 Hallmark)",
    "14K (585)",
    "925 Sterling Silver",
    "Silver (Fine)",
    "Fashion / Brass",
];

const MATERIAL_OPTIONS = [
    "Gold",
    "Silver",
    "Diamond",
    "Platinum",
    "Gemstone",
    "Imitation / Brass",
];

export function QuickProductModal({
    isOpen,
    onClose,
    onSuccess,
    poItemId,
    initialData,
}: QuickProductModalProps) {
    const [name, setName] = useState(initialData?.name || "");
    const [category, setCategory] = useState(initialData?.category || "Necklaces");
    const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
    const [customCategory, setCustomCategory] = useState("");
    const [sku, setSku] = useState("");
    const [costPrice, setCostPrice] = useState(initialData?.cost_price || 0);
    const [basePrice, setBasePrice] = useState(initialData?.base_price || 0);
    const [material, setMaterial] = useState(initialData?.material || "Gold");
    const [purity, setPurity] = useState(initialData?.purity_karat || "22K (916 Hallmark)");
    const [grossWeight, setGrossWeight] = useState<number | "">("");
    const [netWeight, setNetWeight] = useState<number | "">("");
    const [makingCharges, setMakingCharges] = useState<number | "">("");
    const [hsnCode, setHsnCode] = useState(initialData?.hsn_code || "7113");
    const [location, setLocation] = useState("Showcase Tray A");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Sync when initialData changes
    useEffect(() => {
        if (isOpen) {
            if (initialData?.name) setName(initialData.name);
            if (initialData?.cost_price !== undefined) {
                setCostPrice(initialData.cost_price);
                if (!initialData.base_price) {
                    setBasePrice(Math.round(initialData.cost_price * 1.35));
                }
            }
            if (initialData?.base_price) setBasePrice(initialData.base_price);
            if (initialData?.category) setCategory(initialData.category);
            if (initialData?.hsn_code) setHsnCode(initialData.hsn_code);
            if (initialData?.material) setMaterial(initialData.material);
            if (initialData?.purity_karat) setPurity(initialData.purity_karat);

            // Fetch live categories from db
            getCategories()
                .then((cats) => {
                    if (cats.length > 0) {
                        const names = Array.from(new Set([...cats.map((c: any) => c.name), ...DEFAULT_CATEGORIES]));
                        setCategories(names);
                    }
                })
                .catch(() => {});
        }
    }, [isOpen, initialData]);

    const handleApplyMargin = (multiplier: number) => {
        if (costPrice > 0) {
            setBasePrice(Math.round(costPrice * multiplier));
        }
    };

    const handleGenerateSku = () => {
        const prefix = category.substring(0, 3).toUpperCase() || "JWL";
        const random = Math.floor(1000 + Math.random() * 9000);
        setSku(`${prefix}-${random}`);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            toast.error("Product name is required");
            return;
        }

        const chosenCategory = customCategory.trim() || category;
        const finalBasePrice = basePrice > 0 ? basePrice : Math.round(costPrice * 1.35);

        setSubmitting(true);
        try {
            const details: QuickProductDetails = {
                name: name.trim(),
                sku: sku.trim() || undefined,
                category: chosenCategory,
                cost_price: Number(costPrice) || 0,
                base_price: Number(finalBasePrice),
                hsn_code: hsnCode.trim() || "7113",
                location: location.trim() || "Showcase Tray A",
                material,
                purity_karat: purity,
                gross_weight: typeof grossWeight === "number" ? grossWeight : undefined,
                net_weight: typeof netWeight === "number" ? netWeight : undefined,
                making_charges: typeof makingCharges === "number" ? makingCharges : undefined,
                description: description.trim() || undefined,
            };

            const result = await quickCreateInventoryProductForPOItem(poItemId || undefined, details);
            toast.success(`Registered product "${result.name}" with SKU ${result.sku}!`);
            onSuccess(result);
            onClose();
        } catch (err: any) {
            console.error("Error quick-creating product:", err);
            toast.error(err.message || "Failed to create product in inventory");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl custom-scrollbar">
                <DialogHeader className="border-b border-surface-hover/50 pb-3">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                        <PackagePlus className="size-5 text-amber-400" />
                        <span>Register New Vendor Item to Inventory</span>
                    </DialogTitle>
                    <p className="text-xs text-moonstone mt-1">
                        Procuring unlisted goods from a vendor? Catalog this item immediately with jewelry specs and link it to your purchase order.
                    </p>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5 md:col-span-2">
                            <Label className="text-xs text-moonstone">Product Name *</Label>
                            <Input
                                autoFocus
                                required
                                placeholder="e.g. 22K Peacock Antique Necklace"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="bg-bg-navy/80 border-surface-hover/60 text-white text-sm"
                            />
                        </div>

                        {/* Category */}
                        <div className="space-y-1.5">
                            <Label className="text-xs text-moonstone">Category *</Label>
                            <Select value={category} onValueChange={(val) => val && setCategory(val)}>
                                <SelectTrigger className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-9">
                                    <SelectValue placeholder="Select Category" />
                                </SelectTrigger>
                                <SelectContent className="bg-surface-navy border-surface-hover/80 text-white text-xs">
                                    {categories.map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {c}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="__custom__">+ Enter Custom Category...</SelectItem>
                                </SelectContent>
                            </Select>
                            {category === "__custom__" && (
                                <Input
                                    placeholder="Enter new category name..."
                                    value={customCategory}
                                    onChange={(e) => setCustomCategory(e.target.value)}
                                    className="mt-1.5 bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8"
                                />
                            )}
                        </div>

                        {/* SKU */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-moonstone">SKU (Auto or Custom)</Label>
                                <button
                                    type="button"
                                    onClick={handleGenerateSku}
                                    className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-mono"
                                >
                                    <Wand2 className="size-3" /> Auto-generate
                                </button>
                            </div>
                            <Input
                                placeholder="e.g. NECK-22K-001 (Blank = Auto)"
                                value={sku}
                                onChange={(e) => setSku(e.target.value)}
                                className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-9 font-mono"
                            />
                        </div>
                    </div>

                    {/* Pricing */}
                    <div className="border border-surface-hover/40 rounded-xl p-3 bg-bg-navy/30 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-moonstone uppercase tracking-wider flex items-center gap-1.5">
                                <Tag className="size-3.5 text-primary" /> Pricing & Margin
                            </span>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-moonstone">Markup:</span>
                                <Badge
                                    onClick={() => handleApplyMargin(1.25)}
                                    className="cursor-pointer hover:bg-surface-hover/80 bg-surface-navy text-[10px] border-surface-hover text-moonstone"
                                >
                                    +25%
                                </Badge>
                                <Badge
                                    onClick={() => handleApplyMargin(1.35)}
                                    className="cursor-pointer hover:bg-surface-hover/80 bg-surface-navy text-[10px] border-surface-hover text-amber-400"
                                >
                                    +35% (Std)
                                </Badge>
                                <Badge
                                    onClick={() => handleApplyMargin(1.50)}
                                    className="cursor-pointer hover:bg-surface-hover/80 bg-surface-navy text-[10px] border-surface-hover text-moonstone"
                                >
                                    +50%
                                </Badge>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Procurement / Cost Price (₹) *</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={costPrice}
                                    onChange={(e) => {
                                        const c = parseFloat(e.target.value) || 0;
                                        setCostPrice(c);
                                        if (basePrice <= 0 || basePrice === Math.round(costPrice * 1.35)) {
                                            setBasePrice(Math.round(c * 1.35));
                                        }
                                    }}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-9 font-mono"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Selling / Retail Price (₹) *</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={basePrice}
                                    onChange={(e) => setBasePrice(parseFloat(e.target.value) || 0)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-9 font-mono font-bold text-champagne"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Jewelry Specs */}
                    <div className="border border-surface-hover/40 rounded-xl p-3 bg-bg-navy/30 space-y-3">
                        <span className="text-xs font-semibold text-moonstone uppercase tracking-wider flex items-center gap-1.5">
                            <Layers className="size-3.5 text-amber-400" /> Jewelry Specifications (Optional)
                        </span>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Material</Label>
                                <Select value={material} onValueChange={(val) => val && setMaterial(val)}>
                                    <SelectTrigger className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-surface-navy border-surface-hover/80 text-white text-xs">
                                        {MATERIAL_OPTIONS.map((m) => (
                                            <SelectItem key={m} value={m}>
                                                {m}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Purity / Karat</Label>
                                <Select value={purity} onValueChange={(val) => val && setPurity(val)}>
                                    <SelectTrigger className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-surface-navy border-surface-hover/80 text-white text-xs">
                                        {PURITY_OPTIONS.map((p) => (
                                            <SelectItem key={p} value={p}>
                                                {p}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Gross Wt (g)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder="0.000"
                                    value={grossWeight}
                                    onChange={(e) => setGrossWeight(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8 font-mono"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Net Wt (g)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder="0.000"
                                    value={netWeight}
                                    onChange={(e) => setNetWeight(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8 font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 pt-1">
                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Making Charges (₹)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={makingCharges}
                                    onChange={(e) => setMakingCharges(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8 font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">HSN Code</Label>
                                <Input
                                    placeholder="7113"
                                    value={hsnCode}
                                    onChange={(e) => setHsnCode(e.target.value)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8 font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-moonstone">Location / Tray</Label>
                                <Input
                                    placeholder="Showcase Tray A"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    className="bg-bg-navy/80 border-surface-hover/60 text-white text-xs h-8"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="border-t border-surface-hover/50 pt-3 flex items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onClose}
                            disabled={submitting}
                            className="text-xs text-moonstone hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={submitting || !name.trim()}
                            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-semibold px-4"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="size-3.5 animate-spin mr-1.5" /> Registering...
                                </>
                            ) : (
                                <>
                                    <Check className="size-3.5 mr-1.5" /> Save to Inventory & Link
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
