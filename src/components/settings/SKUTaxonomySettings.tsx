"use client";

import React, { useState, useEffect } from "react";
import {
    getSKUTaxonomies,
    loadSKUTaxonomies,
    addTaxonomyOption,
    updateTaxonomyOption,
    removeTaxonomyOption,
    resetSKUTaxonomies,
    subscribeSKUTaxonomies,
    generateParentSKU,
    generateChildSKU,
    generateWholesaleSKU,
    type SKUTaxonomies,
    type GenreOption,
    type CategoryOption,
    type SubcategoryOption,
    type BaseMetalOption,
    type PlatingOption,
    type StoneOption,
    type ColorOption,
    type SizeOption,
    type PackagingTierOption,
} from "@/lib/sku-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    Barcode,
    Plus,
    Pencil,
    Trash2,
    RotateCcw,
    Sparkles,
    Search,
    Tag,
    Layers,
    Package,
    Gem,
    Palette,
    Ruler,
    ShieldAlert,
} from "lucide-react";

type TaxonomyKey = keyof SKUTaxonomies;

interface TabMeta {
    key: TaxonomyKey;
    label: string;
    singular: string;
    icon: React.ReactNode;
    codeHint: string;
    codeLength: string;
    codeName: "code" | "suffix";
}

const TABS: TabMeta[] = [
    { key: "genres", label: "Style Genres", singular: "Genre", icon: <Sparkles size={16} />, codeHint: "3 chars (e.g. TMP, KUN)", codeLength: "3", codeName: "code" },
    { key: "categories", label: "Categories", singular: "Category", icon: <Layers size={16} />, codeHint: "3 chars (e.g. NEC, BAN)", codeLength: "3", codeName: "code" },
    { key: "subcategories", label: "Subcategories", singular: "Subcategory", icon: <Tag size={16} />, codeHint: "3 chars (e.g. CHK, JHU)", codeLength: "3", codeName: "code" },
    { key: "platings", label: "Plating Finishes", singular: "Plating", icon: <Palette size={16} />, codeHint: "2 chars (e.g. MG, MF)", codeLength: "2", codeName: "code" },
    { key: "colors", label: "Primary Colours", singular: "Colour", icon: <Palette size={16} />, codeHint: "2 chars (e.g. WH, RB)", codeLength: "2", codeName: "code" },
    { key: "sizes", label: "Sizes & Sizing", singular: "Size", icon: <Ruler size={16} />, codeHint: "3 chars (e.g. STD, 204, R14)", codeLength: "3", codeName: "code" },
    { key: "packagingTiers", label: "Packaging Tiers", singular: "Tier", icon: <Package size={16} />, codeHint: "3 chars (e.g. EA, C12, A06)", codeLength: "3", codeName: "suffix" },
    { key: "baseMetals", label: "Base Metals", singular: "Base Metal", icon: <Gem size={16} />, codeHint: "2 chars (e.g. BR, CP, GS)", codeLength: "2", codeName: "code" },
    { key: "stones", label: "Stone Embellishments", singular: "Stone", icon: <Gem size={16} />, codeHint: "2 chars (e.g. PL, CZ, KP)", codeLength: "2", codeName: "code" },
];

export function SKUTaxonomySettings() {
    const [taxonomies, setTaxonomies] = useState<SKUTaxonomies>(getSKUTaxonomies());
    const [activeTab, setActiveTab] = useState<TaxonomyKey>("genres");
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any | null>(null);
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form fields for adding/editing item
    const [newCode, setNewCode] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [newMultiplier, setNewMultiplier] = useState("1");
    const [newCategoryCode, setNewCategoryCode] = useState("");
    const [newSizeType, setNewSizeType] = useState<SizeOption["category"]>("general");

    useEffect(() => {
        loadSKUTaxonomies().then(setTaxonomies);
        const unsubscribe = subscribeSKUTaxonomies(setTaxonomies);
        return () => unsubscribe();
    }, []);

    const currentTabMeta = TABS.find((t) => t.key === activeTab)!;

    const resetForm = () => {
        setNewCode("");
        setNewLabel("");
        setNewDescription("");
        setNewMultiplier("1");
        setNewCategoryCode("");
        setNewSizeType("general");
        setEditingItem(null);
    };

    const handleOpenAdd = () => {
        resetForm();
        setIsAddOpen(true);
    };

    const handleOpenEdit = (item: any) => {
        setEditingItem(item);
        const codeKey = currentTabMeta.codeName;
        setNewCode(item[codeKey] || "");
        setNewLabel(item.label || "");
        setNewDescription(item.description || "");
        setNewMultiplier(item.multiplier ? String(item.multiplier) : "1");
        setNewCategoryCode(item.categoryCode || "ALL");
        setNewSizeType(item.category || "general");
        setIsAddOpen(true);
    };

    const handleSaveItem = async () => {
        const cleanCode = newCode.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
        if (!cleanCode) {
            toast.error("Please provide a valid alphanumeric code/suffix");
            return;
        }
        if (!newLabel.trim()) {
            toast.error("Please provide a label");
            return;
        }

        setIsSubmitting(true);
        try {
            const isEditing = Boolean(editingItem);
            const oldCode = isEditing ? editingItem[currentTabMeta.codeName] : cleanCode;

            let itemPayload: any;
            if (activeTab === "genres") {
                itemPayload = {
                    code: cleanCode.slice(0, 3),
                    label: newLabel.trim(),
                    description: newDescription.trim() || `${newLabel.trim()} collection`,
                    isCustom: true,
                };
            } else if (activeTab === "categories") {
                itemPayload = {
                    code: cleanCode.slice(0, 3),
                    label: newLabel.trim(),
                    isCustom: true,
                };
            } else if (activeTab === "subcategories") {
                itemPayload = {
                    code: cleanCode.slice(0, 3),
                    label: newLabel.trim(),
                    categoryCode: newCategoryCode === "ALL" ? undefined : newCategoryCode || undefined,
                    isCustom: true,
                };
            } else if (activeTab === "platings") {
                itemPayload = {
                    code: cleanCode.slice(0, 2),
                    label: newLabel.trim(),
                    isCustom: true,
                };
            } else if (activeTab === "colors") {
                itemPayload = {
                    code: cleanCode.slice(0, 2),
                    label: newLabel.trim(),
                    isCustom: true,
                };
            } else if (activeTab === "sizes") {
                itemPayload = {
                    code: cleanCode.slice(0, 3),
                    label: newLabel.trim(),
                    category: newSizeType,
                    description: newDescription.trim(),
                    isCustom: true,
                };
            } else if (activeTab === "packagingTiers") {
                itemPayload = {
                    suffix: cleanCode.slice(0, 3),
                    label: newLabel.trim(),
                    multiplier: Math.max(1, parseInt(newMultiplier) || 1),
                    description: newDescription.trim() || `Wholesale lot of ${newMultiplier} units`,
                    isCustom: true,
                };
            } else if (activeTab === "baseMetals") {
                itemPayload = {
                    code: cleanCode.slice(0, 2),
                    label: newLabel.trim(),
                    isCustom: true,
                };
            } else if (activeTab === "stones") {
                itemPayload = {
                    code: cleanCode.slice(0, 2),
                    label: newLabel.trim(),
                    isCustom: true,
                };
            }

            if (isEditing) {
                await updateTaxonomyOption(activeTab, oldCode, itemPayload);
                toast.success(`Updated ${currentTabMeta.singular}: [${cleanCode}] ${newLabel.trim()}`);
            } else {
                await addTaxonomyOption(activeTab, itemPayload);
                toast.success(`Added custom ${currentTabMeta.singular}: [${cleanCode}] ${newLabel.trim()}`);
            }

            setIsAddOpen(false);
            resetForm();
        } catch (err: any) {
            toast.error(err.message || "Failed to save taxonomy option");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteItem = async (codeOrSuffix: string, label: string) => {
        if (!confirm(`Are you sure you want to remove "${label}" (${codeOrSuffix})?`)) {
            return;
        }

        try {
            await removeTaxonomyOption(activeTab, codeOrSuffix);
            toast.success(`Removed ${codeOrSuffix} from ${currentTabMeta.label}`);
        } catch (err: any) {
            toast.error(err.message || "Failed to remove option");
        }
    };

    const handleResetAll = async () => {
        try {
            await resetSKUTaxonomies();
            toast.success("All SKU taxonomies reset to enterprise defaults!");
            setIsResetConfirmOpen(false);
        } catch (err: any) {
            toast.error(err.message || "Failed to reset taxonomies");
        }
    };

    // Filter items in active tab
    const items = (taxonomies[activeTab] as any[]) || [];
    const filteredItems = items.filter((item) => {
        const codeVal = item[currentTabMeta.codeName] || "";
        const labelVal = item.label || "";
        const descVal = item.description || "";
        const q = searchQuery.toLowerCase().trim();
        return (
            codeVal.toLowerCase().includes(q) ||
            labelVal.toLowerCase().includes(q) ||
            descVal.toLowerCase().includes(q)
        );
    });

    // Compute sample SKU preview
    const sampleGenre = taxonomies.genres[0]?.code || "TMP";
    const sampleCat = taxonomies.categories[0]?.code || "NEC";
    const sampleSubcat = taxonomies.subcategories[0]?.code || "CHK";
    const samplePlating = taxonomies.platings[0]?.code || "MG";
    const sampleColor = taxonomies.colors[0]?.code || "RB";
    const sampleSize = taxonomies.sizes[0]?.code || "STD";
    const sampleTier = taxonomies.packagingTiers.find((t) => t.suffix !== "EA")?.suffix || "C12";

    const previewParent = generateParentSKU(sampleGenre, sampleCat, sampleSubcat, 4821);
    const previewChild = generateChildSKU(previewParent, samplePlating, sampleColor, sampleSize);
    const previewWholesale = generateWholesaleSKU(previewChild, sampleTier);

    return (
        <div className="space-y-6">
            {/* Header section with live formula card */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-5">
                <div>
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <Barcode className="text-primary" size={24} />
                        Jewelry SKU Architecture Engine
                    </h2>
                    <p className="text-muted-foreground text-xs mt-1">
                        Configure master taxonomy tokens for deterministic 14-char Parent, 21-char Child, and Multi-pack Wholesale SKUs.
                    </p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsResetConfirmOpen(true)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                    >
                        <RotateCcw size={14} className="mr-1.5" />
                        Reset Defaults
                    </Button>
                    <Button size="sm" onClick={handleOpenAdd} className="text-xs">
                        <Plus size={14} className="mr-1.5" />
                        Add {currentTabMeta.singular}
                    </Button>
                </div>
            </div>

            {/* Dynamic Live SKU Preview Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 via-background to-secondary/10 border border-primary/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles size={13} /> Active Architectural Spec Preview
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono bg-card px-2 py-0.5 rounded border border-border text-foreground font-bold">
                            {previewParent}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-mono bg-card px-2 py-0.5 rounded border border-border text-primary font-bold">
                            {previewChild}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-mono bg-card px-2 py-0.5 rounded border border-border text-emerald-400 font-bold">
                            {previewWholesale}
                        </span>
                    </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                    Taxonomies synced across POS, Inventory & Barcode Labels
                </div>
            </div>

            {/* Sub-nav Tabs for 9 Taxonomy Categories */}
            <div className="flex overflow-x-auto gap-1 p-1 bg-surface-navy/60 rounded-xl border border-surface-hover/60">
                {TABS.map((tab) => {
                    const count = (taxonomies[tab.key] as any[])?.length || 0;
                    const isActive = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => {
                                setActiveTab(tab.key);
                                setSearchQuery("");
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                                isActive
                                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                            }`}
                        >
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
                            <span
                                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                    isActive ? "bg-black/20 text-white" : "bg-card text-muted-foreground"
                                }`}
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search and Action Bar */}
            <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-2.5 text-muted-foreground" size={14} />
                    <Input
                        placeholder={`Search in ${currentTabMeta.label.toLowerCase()}...`}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 text-xs h-9"
                    />
                </div>
                <div className="text-xs text-muted-foreground">
                    Showing {filteredItems.length} of {items.length} options
                </div>
            </div>

            {/* Options Grid / Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredItems.map((item, index) => {
                    const code = item[currentTabMeta.codeName];
                    const isCustom = Boolean(item.isCustom);

                    return (
                        <div
                            key={`${activeTab}-${code}-${index}`}
                            className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                                isCustom
                                    ? "bg-primary/5 border-primary/30 hover:border-primary/50"
                                    : "bg-card border-border hover:border-border/80"
                            }`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm font-black px-2 py-0.5 rounded bg-surface-hover/80 text-foreground border border-border">
                                            {code}
                                        </span>
                                        <span className="text-xs font-bold text-foreground">
                                            {item.label}
                                        </span>
                                    </div>
                                    {item.description && (
                                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                                            {item.description}
                                        </p>
                                    )}
                                    {item.multiplier !== undefined && (
                                        <span className="inline-block text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                                            Multiplier: {item.multiplier}x units
                                        </span>
                                    )}
                                    {item.categoryCode && (
                                        <span className="inline-block text-[10px] font-mono text-muted-foreground">
                                            Category: {item.categoryCode}
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                    {isCustom ? (
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/20 px-1.5 py-0.5 rounded">
                                            Custom
                                        </span>
                                    ) : (
                                        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                                            Default
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-1">
                                <span className="text-[10px] font-mono text-muted-foreground">
                                    Token: [{code}]
                                </span>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleOpenEdit(item)}
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
                                    >
                                        <Pencil size={12} className="mr-1" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteItem(code, item.label)}
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 size={12} className="mr-1" />
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {filteredItems.length === 0 && (
                <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground space-y-2">
                    <p className="text-sm">No taxonomy options found matching &quot;{searchQuery}&quot;</p>
                    <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
                        Clear Search Filter
                    </Button>
                </div>
            )}

            {/* Add / Edit Taxonomy Dialog */}
            <Dialog open={isAddOpen} onOpenChange={(open) => {
                setIsAddOpen(open);
                if (!open) resetForm();
            }}>
                <DialogContent className="max-w-md bg-card/95 backdrop-blur-2xl border-border/90 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground">
                            {editingItem ? <Pencil className="text-primary" size={18} /> : <Plus className="text-primary" size={18} />}
                            {editingItem ? `Edit ${currentTabMeta.singular}: [${editingItem[currentTabMeta.codeName]}]` : `Add Custom ${currentTabMeta.singular}`}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                {currentTabMeta.singular} Token Code
                            </Label>
                            <Input
                                placeholder={currentTabMeta.codeHint}
                                value={newCode}
                                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                                maxLength={activeTab === "packagingTiers" ? 3 : parseInt(currentTabMeta.codeLength)}
                                className="font-mono uppercase tracking-wider"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Sanitized alphanumeric code (e.g. &quot;{currentTabMeta.codeHint}&quot;). Must be unique.
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                Display Label
                            </Label>
                            <Input
                                placeholder={`e.g. Modern Rose Gold, Choker, Size 2.4...`}
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                            />
                        </div>

                        {activeTab === "subcategories" && (
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                    Linked Category Code (Optional)
                                </Label>
                                <Select value={newCategoryCode} onValueChange={(val) => setNewCategoryCode(val || "ALL")}>
                                    <SelectTrigger className="text-xs">
                                        <SelectValue placeholder="Any Category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Any / Global</SelectItem>
                                        {taxonomies.categories.map((c, idx) => (
                                            <SelectItem key={`${c.code}-${idx}`} value={c.code}>
                                                {c.code} - {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {activeTab === "sizes" && (
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                    Size Family
                                </Label>
                                <Select
                                    value={newSizeType}
                                    onValueChange={(val) => { if (val) setNewSizeType(val as SizeOption["category"]); }}
                                >
                                    <SelectTrigger className="text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="general">Standard / General</SelectItem>
                                        <SelectItem value="bangle">Bangle (Inner Diameter)</SelectItem>
                                        <SelectItem value="ring">Finger Ring</SelectItem>
                                        <SelectItem value="chain">Chain / Necklace Length</SelectItem>
                                        <SelectItem value="custom">Custom Sizing</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {activeTab === "packagingTiers" && (
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                    Unit Multiplier
                                </Label>
                                <Input
                                    type="number"
                                    min="1"
                                    placeholder="e.g. 12 (for card of 12 pcs)"
                                    value={newMultiplier}
                                    onChange={(e) => setNewMultiplier(e.target.value)}
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Inventory decrements by this multiplier on wholesale scanning.
                                </p>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                Description / Notes (Optional)
                            </Label>
                            <Input
                                placeholder="Details about this style or finish..."
                                value={newDescription}
                                onChange={(e) => setNewDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveItem} disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : editingItem ? "Save Changes" : "Add to Taxonomies"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset Defaults Confirmation Dialog */}
            <Dialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
                <DialogContent className="max-w-sm bg-card/95 backdrop-blur-2xl border-border/90 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <ShieldAlert size={20} /> Reset Taxonomies
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground py-2">
                        This will restore all 9 taxonomy domains to factory jewelry standards. Custom codes will be removed. Existing generated product SKUs will not be affected.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setIsResetConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" size="sm" onClick={handleResetAll}>
                            Confirm Reset
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
