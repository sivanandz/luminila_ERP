"use client";

import React, { useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { getTypeAheadProducts } from "@/lib/products";
import {
    ingestVendorProduct,
    addToExistingInventory,
    queueLabelPrint,
    parseVendorOffer,
    generateVendorSku,
} from "@/lib/whatsapp-crm";

// ============================================
// 1. Create New Product from Message (spec §8.2)
// ============================================

export interface VendorIngestionModalProps {
    isOpen: boolean;
    onClose: () => void;
    messageBody: string;
    vendorId?: string;
    vendorName?: string;
    /** Called after successful ingestion with the new variant id. */
    onIngested?: (result: { productId: string; variantId: string; sku: string }) => void;
}

export function VendorIngestionModal({
    isOpen,
    onClose,
    messageBody,
    vendorId,
    vendorName,
    onIngested,
}: VendorIngestionModalProps) {
    const parsed = useMemo(() => (isOpen ? parseVendorOffer(messageBody) : null), [isOpen, messageBody]);

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

    // Re-run smart extraction each time the modal opens with a new message
    React.useEffect(() => {
        if (!isOpen) return;
        const p = parseVendorOffer(messageBody);
        setName(`${p.purity ? p.purity + ' ' : ''}${p.category || 'Jewelry'}`.trim());
        setCategory(p.category || '');
        setPurity(p.purity || '');
        setWeight(p.weightGrams?.toString() || '');
        setCostPrice(p.price?.toString() || '');
        setQuantity(p.quantity?.toString() || '1');
        setIngested(null);
    }, [isOpen, messageBody]);

    const suggestedRetail = useMemo(() => {
        const cost = parseFloat(costPrice) || 0;
        const margin = parseFloat(marginPercent) || 0;
        return Math.ceil(cost * (1 + margin / 100));
    }, [costPrice, marginPercent]);

    const suggestedSku = useMemo(() => {
        const cat = (category || 'GEN').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'GEN';
        const pur = (purity || 'STD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'STD';
        return `VND-${cat}-${pur}-…`;
    }, [category, purity]);

    const handleIngest = async () => {
        if (!name.trim() || !(parseFloat(costPrice) > 0)) {
            toast.error('Product name and a cost price above zero are required');
            return;
        }
        setSubmitting(true);
        try {
            const sku = await generateVendorSku(category || undefined, purity || undefined);
            const result = await ingestVendorProduct({
                name: name.trim(),
                sku,
                category: category.trim() || undefined,
                costPrice: parseFloat(costPrice) || 0,
                retailPrice: suggestedRetail,
                quantity: parseInt(quantity, 10) || 0,
                weightGrams: parseFloat(weight) || undefined,
                purity: purity.trim() || undefined,
                vendorId: vendorId || undefined,
                description: `Ingested from vendor WhatsApp chat${vendorName ? ` (${vendorName})` : ''}:\n${messageBody}`,
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
            <DialogContent className="sm:max-w-md bg-card border-border max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Sparkles size={16} className="text-amber-400" />
                        Create New Product from Message
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Smart extraction pre-filled the fields below — verify and adjust before ingesting
                        {vendorName ? ` for ${vendorName}` : ''}.
                    </DialogDescription>
                </DialogHeader>

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
                                    Code128 dumbbell tag added to queue. Print it anytime from the Labels module.
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
                        <div className="grid gap-1.5">
                            <Label htmlFor="vi-name" className="text-xs">Product Name</Label>
                            <Input id="vi-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-cat" className="text-xs">Category</Label>
                                <Input id="vi-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 text-xs" placeholder="Ring" />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-purity" className="text-xs">Purity</Label>
                                <Input id="vi-purity" value={purity} onChange={(e) => setPurity(e.target.value)} className="h-8 text-xs" placeholder="18K" />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-weight" className="text-xs">Net Wt (g)</Label>
                                <Input id="vi-weight" value={weight} onChange={(e) => setWeight(e.target.value)} className="h-8 text-xs" placeholder="14.2" inputMode="decimal" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-cost" className="text-xs">Vendor Cost (₹)</Label>
                                <Input id="vi-cost" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-margin" className="text-xs">Margin %</Label>
                                <Input id="vi-margin" value={marginPercent} onChange={(e) => setMarginPercent(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="vi-qty" className="text-xs">Qty</Label>
                                <Input id="vi-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" inputMode="numeric" />
                            </div>
                        </div>
                        <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                            <span className="text-[11px] text-muted-foreground">Suggested retail</span>
                            <span className="text-sm font-bold text-primary">₹{suggestedRetail.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Package size={12} />
                            Auto SKU: <span className="font-mono text-foreground/80">{suggestedSku}</span>
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
    onAdded,
}: AddExistingInventoryModalProps) {
    const parsed = useMemo(() => (isOpen ? parseVendorOffer(messageBody) : null), [isOpen, messageBody]);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<VariantResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<VariantResult | null>(null);
    const [quantity, setQuantity] = useState(parsed?.quantity?.toString() || '1');
    const [submitting, setSubmitting] = useState(false);

    // Re-parse the detected quantity each time the modal opens
    React.useEffect(() => {
        if (isOpen) setQuantity(parseVendorOffer(messageBody).quantity?.toString() || '1');
    }, [isOpen, messageBody]);

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
            await addToExistingInventory({
                variantId: selected.id,
                quantity: parseInt(quantity, 10),
                vendorId: vendorId || undefined,
                notes: `Received via vendor WhatsApp chat${parsed?.price ? ` @ ₹${parsed.price}` : ''}`,
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

                <div className="grid gap-3 py-1">
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
