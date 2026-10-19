"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Plus, Trash2, Tag, CheckCircle, Sparkles } from "lucide-react";
import JsBarcode from "jsbarcode";
import {
    type SymbologyMode,
    generateDataMatrixURL,
    generateQRCodeURL,
    generateBarcodeURL,
} from "@/lib/barcode-generator";
import { getProducts } from "@/lib/products";
import { getChannelPrice, getConfiguredChannels, loadConfiguredChannels, type SalesChannelDef } from "@/lib/channel-pricing";

interface LabelData {
    sku: string;
    name: string;
    price: number;
    variant?: string;
    quantity: number;
    hsn_code?: string;
}

// Product type from DB
interface DBProduct {
    id: string;
    name: string;
    sku: string;
    price: number;
    base_price: number;
    channel_prices?: Record<string, number>;
    category: string;
    hsn_code?: string;
}

// Standard label size presets
interface LabelSize {
    id: string;
    name: string;
    width: number;  // in mm
    height: number; // in mm
    description: string;
}

const LABEL_SIZES: LabelSize[] = [
    { id: "dumbbell", name: "Dumbbell Tag (54×11mm)", width: 54, height: 11, description: "Jewelry Barbell Tag (Wing A Symbology + Bridge + Wing B Text)" },
    { id: "small", name: "Small (25×15mm)", width: 25, height: 15, description: "Jewelry tags, small items" },
    { id: "medium", name: "Medium (50×25mm)", width: 50, height: 25, description: "Standard product labels" },
    { id: "large", name: "Large (75×50mm)", width: 75, height: 50, description: "Retail price tags" },
    { id: "a4-sheet", name: "A4 Sheet (65 labels)", width: 38, height: 21, description: "A4 sticker sheets" },
    { id: "dymo-small", name: "DYMO Small (25×13mm)", width: 25, height: 13, description: "DYMO LabelWriter" },
    { id: "dymo-large", name: "DYMO Large (89×28mm)", width: 89, height: 28, description: "DYMO shipping labels" },
    { id: "custom", name: "Custom Size", width: 50, height: 25, description: "Set your own dimensions" },
];

function DumbbellTag({ data, symbology = '2D_DATAMATRIX_ECC200' }: { data: LabelData; symbology?: SymbologyMode }) {
    let codeUrl = '';
    if (symbology === '2D_DATAMATRIX_ECC200') {
        codeUrl = generateDataMatrixURL(data.sku);
    } else if (symbology === '2D_QRCODE') {
        codeUrl = generateQRCodeURL(data.sku);
    } else {
        codeUrl = generateBarcodeURL(data.sku);
    }

    return (
        <div className="dumbbell-tag bg-white text-black border border-gray-300 rounded p-1 w-[260px] h-[58px] flex items-center justify-between shadow-sm">
            {/* Wing A: Symbology Zone (19 x 10mm) */}
            <div className="w-[85px] h-[48px] flex items-center justify-center overflow-hidden border-r border-dashed border-gray-200 pr-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- barcode image from external generator APIs with dynamic response format (PNG/SVG), rendered in a fixed-size print label */}
                <img
                    src={codeUrl}
                    alt={data.sku}
                    className={`object-contain ${symbology === '1D_CODE128_POINTER' ? 'w-full h-7' : 'w-9 h-9'}`}
                />
            </div>

            {/* Central Bridge (16 x 2mm): Adhesive-Free Zone */}
            <div className="w-10 h-1.5 border-y border-dotted border-gray-400 mx-1 flex items-center justify-center">
                <span className="text-[6px] text-gray-400 select-none font-mono">BRIDGE</span>
            </div>

            {/* Wing B: Text Area (19 x 10mm) */}
            <div className="w-[100px] h-[48px] flex flex-col justify-center text-right pl-1 border-l border-dashed border-gray-200">
                <p className="text-[9px] font-black tracking-wider text-black">LUMINILA</p>
                <p className="text-[8px] font-mono font-bold text-gray-800 truncate" title={data.sku}>{data.sku}</p>
                <p className="text-[10px] font-black text-black">₹{data.price.toLocaleString("en-IN")}</p>
                <p className="text-[7px] text-gray-500 font-mono">HSN {data.hsn_code || '71179010'}</p>
            </div>
        </div>
    );
}

function BarcodeLabel({ data }: { data: LabelData }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current) {
            try {
                JsBarcode(canvasRef.current, data.sku, {
                    format: "CODE128",
                    width: 1.5,
                    height: 30,
                    displayValue: true,
                    fontSize: 10,
                    margin: 5,
                    background: "#ffffff",
                    lineColor: "#000000",
                });
            } catch (e) {
                console.error("Barcode generation failed", e);
            }
        }
    }, [data.sku]);

    return (
        <div className="barcode-label bg-white text-black border border-gray-200 rounded-lg p-3 w-[200px] h-[100px] flex flex-col justify-between shadow-sm">
            <div className="text-center overflow-hidden">
                <p className="text-xs font-bold truncate leading-tight">{data.name}</p>
                {data.variant && (
                    <p className="text-[10px] text-gray-500">{data.variant}</p>
                )}
            </div>
            <div className="flex justify-center my-1">
                <canvas ref={canvasRef} className="max-w-full h-auto" />
            </div>
            <p className="text-center font-bold text-sm">
                ₹{data.price.toLocaleString("en-IN")}
            </p>
        </div>
    );
}

function LabelsContent() {
    const searchParams = useSearchParams();
    const [selectedProducts, setSelectedProducts] = useState<LabelData[]>([]);
    const [quantity, setQuantity] = useState(1);
    const [addedNotice, setAddedNotice] = useState<string | null>(null);
    const [availableProducts, setAvailableProducts] = useState<DBProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLabelSize, setSelectedLabelSize] = useState<LabelSize>(LABEL_SIZES[0]); // Default to Dumbbell
    const [symbologyMode, setSymbologyMode] = useState<SymbologyMode>("2D_DATAMATRIX_ECC200");
    const [selectedChannel, setSelectedChannel] = useState<string>("pos");
    const [availableChannels, setAvailableChannels] = useState<SalesChannelDef[]>(getConfiguredChannels());

    useEffect(() => {
        loadConfiguredChannels().then(setAvailableChannels).catch(console.error);
    }, []);

    const handleLabelChannelChange = (channelId: string) => {
        setSelectedChannel(channelId);
        setAvailableProducts(prev => prev.map(p => ({
            ...p,
            price: getChannelPrice({ base_price: p.base_price, channel_prices: p.channel_prices }, channelId),
        })));
    };

    // Load products from PocketBase or localStorage
    useEffect(() => {
        const loadProducts = async () => {
            try {
                const dbProducts = await getProducts();
                if (dbProducts && dbProducts.length > 0) {
                    setAvailableProducts(dbProducts.map(p => ({
                        id: p.id,
                        name: p.name,
                        sku: p.sku,
                        base_price: p.base_price,
                        channel_prices: p.channel_prices,
                        price: getChannelPrice(p, selectedChannel),
                        category: p.category || '',
                        hsn_code: p.hsn_code || '71179010',
                    })));
                    return;
                }
                const stored = localStorage.getItem('luminila_products');
                if (stored) {
                    const products = JSON.parse(stored);
                    setAvailableProducts(products.map((p: any) => ({
                        ...p,
                        base_price: p.base_price ?? p.price,
                        price: getChannelPrice({ base_price: p.base_price ?? p.price, channel_prices: p.channel_prices }, selectedChannel),
                    })));
                }
            } catch (e) {
                console.error('Failed to load products from PB:', e);
                const stored = localStorage.getItem('luminila_products');
                if (stored) {
                    try { setAvailableProducts(JSON.parse(stored)); } catch { }
                }
            } finally {
                setLoading(false);
            }
        };
        loadProducts();
    }, []);

    // Check for product from URL params (added from inventory page)
    useEffect(() => {
        const sku = searchParams.get('sku');
        const name = searchParams.get('name');
        const price = searchParams.get('price');

        if (sku && name && price) {
            const productPart = {
                sku,
                name,
                price: Number(price),
            };

            setSelectedProducts(prev => {
                const existingIndex = prev.findIndex(p => p.sku === sku);
                if (existingIndex >= 0) {
                    const next = [...prev];
                    next[existingIndex] = {
                        ...next[existingIndex],
                        quantity: next[existingIndex].quantity + 1
                    };
                    return next;
                }
                return [...prev, { ...productPart, quantity: 1 }];
            });

            setAddedNotice(name);

            // Clear notice after 3 seconds
            setTimeout(() => setAddedNotice(null), 3000);

            // Clear URL params to avoid re-adding on refresh
            window.history.replaceState({}, '', '/labels');
        }
    }, [searchParams]);

    const addToQueue = (product: Omit<LabelData, 'quantity'>) => {
        setSelectedProducts(prev => {
            const existingIndex = prev.findIndex(p => p.sku === product.sku);
            if (existingIndex >= 0) {
                const next = [...prev];
                next[existingIndex] = {
                    ...next[existingIndex],
                    quantity: next[existingIndex].quantity + quantity
                };
                return next;
            }
            return [...prev, { ...product, quantity }];
        });
    };

    const updateQuantity = (index: number, newQty: number) => {
        if (newQty < 1) return;
        setSelectedProducts(prev => {
            const next = [...prev];
            next[index] = { ...next[index], quantity: newQty };
            return next;
        });
    };

    const removeFromQueue = (index: number) => {
        setSelectedProducts(prev => prev.filter((_, i) => i !== index));
    };

    const clearQueue = () => {
        setSelectedProducts([]);
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="no-print">
                <Header
                    title="Print Labels"
                    subtitle="Generate and print barcode labels for your products"
                />
            </div>

            {/* Toast notification for added product */}
            {addedNotice && (
                <div className="fixed top-4 right-4 z-50 bg-emerald-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-right fade-in duration-300">
                    <CheckCircle size={20} />
                    <span className="font-bold">&quot;{addedNotice}&quot;</span> added to print queue!
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 scroll-smooth no-print">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                    {/* Product Selection */}
                    <div className="lg:col-span-2 flex flex-col gap-6">
                        <div className="card bg-surface-navy border-surface-hover">
                            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Tag size={20} className="text-primary" />
                                Select Products
                            </h2>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {loading ? (
                                    <div className="col-span-full text-center py-8 text-moonstone">
                                        Loading products...
                                    </div>
                                ) : availableProducts.length === 0 ? (
                                    <div className="col-span-full text-center py-8 border-2 border-dashed border-surface-hover rounded-lg">
                                        <p className="text-moonstone text-sm">No products found.</p>
                                        <p className="text-moonstone/60 text-xs mt-1">Add products from the Inventory page first.</p>
                                    </div>
                                ) : (
                                    availableProducts.map((product: DBProduct) => (
                                        <button
                                            key={product.sku}
                                            onClick={() => addToQueue({ sku: product.sku, name: product.name, price: product.price })}
                                            className="p-3 bg-bg-navy border border-surface-hover rounded-lg hover:border-primary/50 hover:bg-bg-navy/80 transition-all text-left group"
                                        >
                                            <p className="text-[10px] text-moonstone font-mono">{product.sku}</p>
                                            <p className="font-bold text-sm text-white group-hover:text-primary transition-colors truncate">{product.name}</p>
                                            <p className="text-xs text-moonstone">{product.category}</p>
                                            <p className="font-bold text-primary text-xs mt-1">
                                                ₹{product.price.toLocaleString("en-IN")}
                                            </p>
                                        </button>
                                    ))
                                )}
                            </div>

                            {/* Label Size & Quantity Settings */}
                            <div className="mt-6 pt-4 border-t border-surface-hover space-y-4">
                                {/* Label Size Selector */}
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <div className="flex-1">
                                        <label className="text-sm font-bold text-moonstone uppercase mb-2 block">Label Size:</label>
                                        <Select
                                            value={selectedLabelSize.id}
                                            onValueChange={(value) => {
                                                const size = LABEL_SIZES.find(s => s.id === value);
                                                if (size) setSelectedLabelSize(size);
                                            }}
                                        >
                                            <SelectTrigger className="w-full h-10 bg-bg-navy border-surface-hover text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="!bg-[#1a2332] border border-surface-hover shadow-xl">
                                                {LABEL_SIZES.map(size => (
                                                    <SelectItem
                                                        key={size.id}
                                                        value={size.id}
                                                        className="text-white hover:!bg-primary/20 hover:!text-white focus:!bg-primary/20 focus:!text-white data-[highlighted]:!bg-primary/20 data-[highlighted]:!text-white cursor-pointer"
                                                    >
                                                        {size.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-moonstone/60 mt-1">{selectedLabelSize.description}</p>
                                    </div>

                                    {/* Price Tier / Channel for Printed Tags */}
                                    <div className="flex-1">
                                        <label className="text-sm font-bold text-moonstone uppercase mb-2 block">Price Tier / Channel:</label>
                                        <Select
                                            value={selectedChannel}
                                            onValueChange={(val) => { if (val) handleLabelChannelChange(val); }}
                                        >
                                            <SelectTrigger className="w-full h-10 bg-bg-navy border-surface-hover text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="!bg-[#1a2332] border border-surface-hover shadow-xl">
                                                {availableChannels.map(channel => (
                                                    <SelectItem
                                                        key={channel.id}
                                                        value={channel.id}
                                                        className="text-white hover:!bg-primary/20 hover:!text-white focus:!bg-primary/20 focus:!text-white data-[highlighted]:!bg-primary/20 data-[highlighted]:!text-white cursor-pointer"
                                                    >
                                                        {channel.name} {channel.discountPreset ? `(${channel.discountPreset > 0 ? '+' : ''}${channel.discountPreset}%)` : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-moonstone/60 mt-1">
                                            {selectedChannel === 'pos' ? 'Standard retail tag rate' : `Custom rate: ${availableChannels.find(c => c.id === selectedChannel)?.name || selectedChannel}`}
                                        </p>
                                    </div>

                                    {/* Quantity Preference (Default for new adds) */}
                                    <div>
                                        <label className="text-sm font-bold text-moonstone uppercase mb-2 block">Default Qty:</label>
                                        <div className="flex items-center">
                                            <button
                                                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                                className="w-10 h-10 flex items-center justify-center bg-bg-navy border border-surface-hover rounded-l-lg text-white hover:bg-surface-hover"
                                            >
                                                -
                                            </button>
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={quantity}
                                                onChange={(e) => setQuantity(Number(e.target.value))}
                                                className="w-16 h-10 text-center bg-bg-navy border-y border-surface-hover text-white text-sm focus:outline-none"
                                            />
                                            <button
                                                onClick={() => setQuantity(quantity + 1)}
                                                className="w-10 h-10 flex items-center justify-center bg-bg-navy border border-surface-hover rounded-r-lg text-white hover:bg-surface-hover"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Symbology Selector for Dumbbell / Jewelry Tags */}
                                {selectedLabelSize.id === 'dumbbell' && (
                                    <div className="p-3 bg-bg-navy/80 rounded-lg border border-primary/20 space-y-2">
                                        <label className="text-xs font-bold text-moonstone uppercase flex items-center gap-1.5">
                                            <Sparkles size={13} className="text-gold" />
                                            Administrative Symbology Engine (Spec):
                                        </label>
                                        <Select
                                            value={symbologyMode}
                                            onValueChange={(value) => {
                                                if (value) setSymbologyMode(value as SymbologyMode);
                                            }}
                                        >
                                            <SelectTrigger className="w-full h-9 bg-surface-navy border-surface-hover text-white text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="!bg-[#1a2332] border border-surface-hover text-white text-xs">
                                                <SelectItem value="2D_DATAMATRIX_ECC200" className="text-xs">
                                                    2D Data Matrix ECC 200 (Wing A 6.5mm • 30% Reed-Solomon Recovery)
                                                </SelectItem>
                                                <SelectItem value="2D_QRCODE" className="text-xs">
                                                    2D QR Code (ISO/IEC 18004 • Native Smartphone Camera)
                                                </SelectItem>
                                                <SelectItem value="1D_CODE128_POINTER" className="text-xs">
                                                    1D Code 128 (Legacy Laser Barcode Wand)
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-moonstone">
                                            Dumbbell format (54×11mm) with adhesive-free central bridge protecting fine necklaces & earring posts.
                                        </p>
                                    </div>
                                )}

                                {/* Size Preview */}
                                <div className="flex items-center gap-3 text-xs text-moonstone">
                                    <span className="font-bold uppercase">Preview:</span>
                                    <div
                                        className="border-2 border-dashed border-primary/40 bg-primary/5 rounded flex items-center justify-center text-[8px] text-primary/60"
                                        style={{
                                            width: `${Math.min(selectedLabelSize.width * 1.5, 120)}px`,
                                            height: `${Math.min(selectedLabelSize.height * 1.5, 60)}px`
                                        }}
                                    >
                                        {selectedLabelSize.width}×{selectedLabelSize.height}mm
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Label Preview Area */}
                        {selectedProducts.length > 0 && (
                            <div className="card bg-surface-navy border-surface-hover">
                                <h2 className="text-lg font-bold text-white mb-4">Preview</h2>
                                <div className="flex flex-wrap gap-4 p-4 bg-bg-navy/50 rounded-lg border border-surface-hover justify-center sm:justify-start">
                                    {selectedProducts.slice(0, 6).map((product, index) => (
                                        selectedLabelSize.id === 'dumbbell' ? (
                                            <DumbbellTag key={`${product.sku}-${index}`} data={product} symbology={symbologyMode} />
                                        ) : (
                                            <BarcodeLabel key={`${product.sku}-${index}`} data={product} />
                                        )
                                    ))}
                                    {selectedProducts.length > 6 && (
                                        <div className="w-[200px] h-[100px] border-2 border-dashed border-surface-hover rounded-lg flex items-center justify-center bg-bg-navy/30">
                                            <p className="text-moonstone font-bold">
                                                +{selectedProducts.length - 6} more
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Print Queue Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="card bg-surface-navy border-surface-hover sticky top-4">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-white">Print Queue</h2>
                                {selectedProducts.length > 0 && (
                                    <button
                                        onClick={clearQueue}
                                        className="text-xs font-bold text-red-400 hover:text-red-300 flex items-center gap-1 bg-red-400/10 px-2 py-1 rounded transition-colors"
                                    >
                                        <Trash2 size={12} />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {selectedProducts.length === 0 ? (
                                <div className="text-center py-12 border-2 border-dashed border-surface-hover rounded-lg bg-bg-navy/30">
                                    <Plus size={32} className="mx-auto text-surface-hover mb-2" />
                                    <p className="text-moonstone text-sm">
                                        Select products to add to queue
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
                                    {selectedProducts.map((product, index) => (
                                        <div
                                            key={`${product.sku}-${index}`}
                                            className="p-3 bg-bg-navy border border-surface-hover rounded-lg flex justify-between items-center group hover:border-primary/30 transition-colors"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-white truncate">{product.name}</p>
                                                <p className="text-xs text-moonstone truncate">{product.sku}</p>
                                            </div>

                                            <div className="flex items-center gap-3 ml-4">
                                                <div className="flex items-center bg-surface-navy rounded border border-surface-hover">
                                                    <button
                                                        onClick={() => updateQuantity(index, product.quantity - 1)}
                                                        className="w-6 h-6 flex items-center justify-center text-moonstone hover:text-white hover:bg-white/5 transition-colors"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="w-8 text-center text-xs text-white font-mono">{product.quantity}</span>
                                                    <button
                                                        onClick={() => updateQuantity(index, product.quantity + 1)}
                                                        className="w-6 h-6 flex items-center justify-center text-moonstone hover:text-white hover:bg-white/5 transition-colors"
                                                    >
                                                        +
                                                    </button>
                                                </div>

                                                <button
                                                    onClick={() => removeFromQueue(index)}
                                                    className="w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors"
                                                    title="Remove"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 pt-4 border-t border-surface-hover space-y-4">
                                <div className="flex justify-between items-center">
                                    <p className="text-sm text-moonstone">Total Labels</p>
                                    <p className="text-xl font-bold text-white">
                                        {selectedProducts.reduce((acc, p) => acc + p.quantity, 0)}
                                    </p>
                                </div>
                                <Button
                                    onClick={handlePrint}
                                    disabled={selectedProducts.length === 0}
                                    className="w-full py-3 text-base"
                                >
                                    <Printer size={20} className="mr-2" />
                                    Print Labels
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden Print Section */}
            <div className="hidden print:block">
                <style jsx global>{`
                    @media print {
                        @page {
                            margin: 0;
                            size: auto;
                        }
                        body * {
                            visibility: hidden;
                        }
                        .print\\:block, .print\\:block * {
                            visibility: visible;
                        }
                        .print\\:block {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                            background: white;
                        }
                        .barcode-label, .dumbbell-tag {
                            break-inside: avoid;
                            page-break-inside: avoid;
                            color: black !important;
                            border: 1px solid #ddd;
                        }
                        .barcode-label *, .dumbbell-tag * {
                            color: black !important;
                            border-color: black !important;
                        }
                    }
                `}</style>
                <div className="flex flex-wrap gap-2 p-4 bg-white">
                    {selectedProducts.flatMap((product, pIndex) =>
                        Array.from({ length: product.quantity }).map((_, qIndex) => (
                            selectedLabelSize.id === 'dumbbell' ? (
                                <DumbbellTag key={`print-${pIndex}-${qIndex}`} data={product} symbology={symbologyMode} />
                            ) : (
                                <BarcodeLabel key={`print-${pIndex}-${qIndex}`} data={product} />
                            )
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default function LabelsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-moonstone">Loading label printing...</div>}>
            <LabelsContent />
        </Suspense>
    );
}


