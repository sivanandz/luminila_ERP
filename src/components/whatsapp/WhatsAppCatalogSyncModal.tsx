"use client";

import React, { useState, useEffect } from "react";
import {
    X,
    RefreshCw,
    CheckCircle,
    AlertCircle,
    Package,
    Search,
    Loader2,
    Trash2,
    ExternalLink,
} from "lucide-react";
import {
    getPublishableProducts,
    syncProductToWhatsApp,
    batchSyncCatalog,
    removeProductFromWhatsApp,
    WhatsAppProductItem,
} from "@/lib/whatsapp-catalog";

export interface WhatsAppCatalogSyncModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function WhatsAppCatalogSyncModal({ isOpen, onClose }: WhatsAppCatalogSyncModalProps) {
    const [products, setProducts] = useState<WhatsAppProductItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    const [filterSynced, setFilterSynced] = useState<"all" | "synced" | "unsynced">("all");
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadProducts();
        }
    }, [isOpen]);

    const loadProducts = async () => {
        setLoading(true);
        setStatusMessage(null);
        try {
            const items = await getPublishableProducts();
            setProducts(items);
        } catch (err: any) {
            setStatusMessage(`Error loading products: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const filtered = products.filter((p) => {
        const matchesSearch =
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.sku.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch) return false;

        if (filterSynced === "synced") return !!p.whatsappProductId;
        if (filterSynced === "unsynced") return !p.whatsappProductId;
        return true;
    });

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filtered.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filtered.map((p) => p.id)));
        }
    };

    const handleSyncSelected = async () => {
        const toSync = products.filter((p) => selectedIds.has(p.id));
        if (toSync.length === 0) return;

        setSyncing(true);
        setProgress({ current: 0, total: toSync.length });
        setStatusMessage(null);

        try {
            const res = await batchSyncCatalog(toSync, "luminila_phone", (cur, total) => {
                setProgress({ current: cur, total });
            });

            setStatusMessage(`Sync complete: ${res.synced} published, ${res.failed} failed.`);
            await loadProducts();
            setSelectedIds(new Set());
        } catch (err: any) {
            setStatusMessage(`Sync failed: ${err.message}`);
        } finally {
            setSyncing(false);
            setProgress(null);
        }
    };

    const handleSyncSingle = async (p: WhatsAppProductItem) => {
        setSyncing(true);
        try {
            const res = await syncProductToWhatsApp(p, "luminila_phone");
            if (res.success) {
                setStatusMessage(`Successfully synced "${p.name}" to WhatsApp Catalog!`);
                await loadProducts();
            } else {
                setStatusMessage(`Failed to sync: ${res.error}`);
            }
        } catch (err: any) {
            setStatusMessage(`Sync error: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const syncedCount = products.filter((p) => !!p.whatsappProductId).length;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-3xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col text-foreground overflow-hidden animate-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="p-5 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                            <Package size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">WhatsApp Business Catalog Sync</h3>
                            <p className="text-xs text-muted-foreground">
                                Publish jewelry catalog to native WhatsApp so customers can order directly
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Filters & Actions Bar */}
                <div className="p-4 bg-muted/20 border-b border-border flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search by SKU or name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <select
                            value={filterSynced}
                            onChange={(e: any) => setFilterSynced(e.target.value)}
                            className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                        >
                            <option value="all">All ({products.length})</option>
                            <option value="synced">Synced ({syncedCount})</option>
                            <option value="unsynced">Unsynced ({products.length - syncedCount})</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSyncSelected}
                            disabled={selectedIds.size === 0 || syncing}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 shadow-sm"
                        >
                            {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            Sync Selected ({selectedIds.size})
                        </button>
                    </div>
                </div>

                {/* Progress Bar / Status */}
                {progress && (
                    <div className="px-5 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-3">
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-emerald-500 h-full transition-all duration-200"
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs font-bold text-emerald-600 shrink-0">
                            {progress.current} / {progress.total}
                        </span>
                    </div>
                )}

                {statusMessage && !progress && (
                    <div className="px-5 py-2 bg-muted/60 text-xs font-medium text-foreground border-b border-border flex items-center justify-between">
                        <span>{statusMessage}</span>
                        <button onClick={() => setStatusMessage(null)} className="text-muted-foreground hover:text-foreground">
                            ×
                        </button>
                    </div>
                )}

                {/* Product Table */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                            <Loader2 size={24} className="animate-spin text-primary" />
                            <p className="text-xs">Loading jewelry catalog...</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground text-xs">
                            No products match your criteria.
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-border/80 text-muted-foreground uppercase text-[10px] font-bold">
                                    <th className="p-2.5 w-8">
                                        <input
                                            type="checkbox"
                                            checked={filtered.length > 0 && selectedIds.size === filtered.length}
                                            onChange={toggleSelectAll}
                                            className="rounded border-border"
                                        />
                                    </th>
                                    <th className="p-2.5">Product & SKU</th>
                                    <th className="p-2.5">Price</th>
                                    <th className="p-2.5">Catalog Status</th>
                                    <th className="p-2.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {filtered.map((item) => {
                                    const isSelected = selectedIds.has(item.id);
                                    const isSynced = !!item.whatsappProductId;

                                    return (
                                        <tr
                                            key={item.id}
                                            className={`hover:bg-muted/40 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                                        >
                                            <td className="p-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(item.id)}
                                                    className="rounded border-border"
                                                />
                                            </td>
                                            <td className="p-2.5">
                                                <div className="font-bold text-foreground truncate max-w-xs">
                                                    {item.name}
                                                </div>
                                                <div className="text-[10px] font-mono text-muted-foreground">
                                                    {item.sku}
                                                </div>
                                            </td>
                                            <td className="p-2.5 font-bold">
                                                ₹{item.price.toLocaleString("en-IN")}
                                            </td>
                                            <td className="p-2.5">
                                                {isSynced ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                                        <CheckCircle size={11} /> Published
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                        Unsynced
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-2.5 text-right">
                                                <button
                                                    onClick={() => handleSyncSingle(item)}
                                                    disabled={syncing}
                                                    className="px-2.5 py-1 bg-muted hover:bg-muted/80 rounded border border-border text-[11px] font-medium transition-colors"
                                                >
                                                    {isSynced ? "Re-sync" : "Publish"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                        {syncedCount} of {products.length} products published to WhatsApp Catalog
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-muted hover:bg-muted/80 rounded-lg text-foreground font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
