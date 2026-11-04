"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Layers, Search, Sparkles } from "lucide-react";
import { computeBundleAvailability, type BundleComponent } from "@/lib/bundles";

interface BundleComposerSectionProps {
    isBundle: boolean;
    onIsBundleChange: (val: boolean) => void;
    bundleItems: BundleComponent[];
    onBundleItemsChange: (items: BundleComponent[]) => void;
    availableProducts: Array<{
        id: string;
        variant_id?: string;
        sku: string;
        name: string;
        stock: number;
    }>;
}

export function BundleComposerSection({
    isBundle,
    onIsBundleChange,
    bundleItems,
    onBundleItemsChange,
    availableProducts,
}: BundleComposerSectionProps) {
    const [searchQuery, setSearchQuery] = useState("");

    const componentStockMap = new Map<string, number>();
    for (const p of availableProducts) {
        if (p.variant_id) {
            componentStockMap.set(p.variant_id, p.stock);
        }
        componentStockMap.set(p.id, p.stock);
    }

    const calculatedStock = computeBundleAvailability(bundleItems, componentStockMap);

    const filteredSuggestions = searchQuery.trim()
        ? availableProducts
              .filter(
                  (p) =>
                      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      p.name.toLowerCase().includes(searchQuery.toLowerCase())
              )
              .slice(0, 5)
        : [];

    const handleAddComponent = (product: {
        id: string;
        variant_id?: string;
        sku: string;
        name: string;
        stock: number;
    }) => {
        const existingIdx = bundleItems.findIndex((it) => it.sku === product.sku);
        if (existingIdx >= 0) {
            const next = [...bundleItems];
            next[existingIdx].quantity += 1;
            onBundleItemsChange(next);
        } else {
            onBundleItemsChange([
                ...bundleItems,
                {
                    product_id: product.id,
                    variant_id: product.variant_id || "",
                    sku: product.sku,
                    name: product.name,
                    quantity: 1,
                },
            ]);
        }
        setSearchQuery("");
    };

    const handleRemoveComponent = (index: number) => {
        onBundleItemsChange(bundleItems.filter((_, idx) => idx !== index));
    };

    const handleUpdateQuantity = (index: number, qty: number) => {
        const next = [...bundleItems];
        next[index] = { ...next[index], quantity: Math.max(1, qty) };
        onBundleItemsChange(next);
    };

    return (
        <div className="rounded-xl border border-surface-hover bg-bg-navy/80 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Layers className="size-4 text-purple-400" />
                    <div>
                        <Label className="text-xs font-bold text-white block">
                            Virtual Combo / Bridal Set Bundle
                        </Label>
                        <p className="text-[10px] text-moonstone">
                            Assembled from component SKUs. Stock is auto-calculated.
                        </p>
                    </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isBundle}
                        onChange={(e) => onIsBundleChange(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-navy peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
            </div>

            {isBundle && (
                <div className="space-y-3 pt-2 border-t border-surface-hover/50">
                    <div className="flex items-center justify-between bg-surface-navy/70 p-2.5 rounded-lg border border-purple-500/30">
                        <span className="text-xs text-moonstone">Computed Bundle Availability:</span>
                        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 font-mono font-bold text-xs">
                            {calculatedStock} Sets Ready to Sell
                        </Badge>
                    </div>

                    {/* Component Search Picker */}
                    <div className="relative">
                        <div className="flex items-center gap-1.5">
                            <Search className="size-3.5 text-moonstone" />
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search component SKU or name to add to combo…"
                                className="h-8 text-xs bg-surface-navy border-surface-hover text-white font-mono"
                            />
                        </div>

                        {filteredSuggestions.length > 0 && (
                            <div className="absolute top-9 left-0 right-0 z-30 rounded-lg border border-surface-hover bg-surface-navy shadow-xl divide-y divide-surface-hover/40 overflow-hidden">
                                {filteredSuggestions.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleAddComponent(p)}
                                        className="w-full text-left p-2 hover:bg-bg-navy flex items-center justify-between text-xs transition-colors"
                                    >
                                        <div>
                                            <span className="font-mono font-bold text-white">{p.sku}</span>
                                            <p className="text-[10px] text-moonstone truncate max-w-xs">{p.name}</p>
                                        </div>
                                        <span className="text-[10px] font-mono text-moonstone shrink-0">
                                            {p.stock} in stock
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Component List */}
                    <div className="space-y-1.5">
                        {bundleItems.map((comp, idx) => {
                            const available = componentStockMap.get(comp.variant_id) ?? 0;
                            return (
                                <div
                                    key={comp.sku + idx}
                                    className="p-2 rounded-lg bg-surface-navy border border-surface-hover flex items-center justify-between gap-2 text-xs"
                                >
                                    <div className="min-w-0">
                                        <p className="font-mono font-bold text-white truncate">{comp.sku}</p>
                                        <p className="text-[10px] text-moonstone truncate">{comp.name}</p>
                                        <span className="text-[9px] text-moonstone/70">
                                            Shelf stock: {available} pcs
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-moonstone">Qty in set:</span>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={comp.quantity}
                                            onChange={(e) =>
                                                handleUpdateQuantity(idx, parseInt(e.target.value, 10) || 1)
                                            }
                                            className="w-14 h-7 text-xs bg-bg-navy border-surface-hover text-white font-mono text-center"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveComponent(idx)}
                                            className="size-7 text-moonstone hover:text-red-400 flex items-center justify-center"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
