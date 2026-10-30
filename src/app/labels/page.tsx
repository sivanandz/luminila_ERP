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
import { formatImitationSpec, PLATING_DEFINITIONS } from "@/lib/imitation-jewelry-engine";

interface LabelData {
    sku: string;
    name: string;
    price: number;
    variant?: string;
    quantity: number;
    hsn_code?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    base_metal?: string;
}

// Product type from DB
interface DBProduct {
    id: string;
    name: string;
    sku: string;
    price: number;
    base_price: number;
    cost_price?: number;
    channel_prices?: Record<string, number>;
    category: string;
    hsn_code?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    base_metal?: string;
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
    { id: "seznik-strip", name: "Seznik Jewellery Roll (14.3×100mm)", width: 14.3, height: 100, description: "Fold-in-half direct thermal stock: 64mm body (two 32mm faces) + 36mm unprinted tail, 3-up on a 45mm web" },
    { id: "dumbbell", name: "Legacy Dumbbell Tag (54×11mm)", width: 54, height: 11, description: "Old two-wing barbell stock (Wing A Symbology + Bridge + Wing B Text)" },
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

    // Craft spec line folded in from the Fashion Jewellery Studio: prints the
    // piece classification (craft | plating | metal | occasion) on the tag.
    const hasCraft = !!(data.craft || data.plating || data.occasion || data.base_metal);
    const specLine = hasCraft
        ? formatImitationSpec({
            craft: data.craft || '',
            plating: data.plating || '',
            occasion: data.occasion || '',
            baseMetal: data.base_metal || '',
            stoneType: '',
            sku: data.sku,
            name: data.name,
            mrpPrice: data.price,
        })
        : '';
    const durability = data.plating ? PLATING_DEFINITIONS[data.plating]?.durabilityMonths : undefined;

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
                {specLine ? (
                    <p className="text-[6px] text-gray-600 font-mono truncate" title={specLine}>
                        {specLine}{durability ? ` · ~${durability}mo` : ''}
                    </p>
                ) : (
                    <p className="text-[7px] text-gray-500 font-mono">HSN {data.hsn_code || '71179010'}</p>
                )}
            </div>
        </div>
    );
}

/**
 * Seznik 14.3 x 100 mm single-tail jewellery label.
 *
 * Stock geometry: the 100 mm feed pitch is a 64 mm body with a fold at 32 mm,
 * followed by a 36 mm narrow tail. Folding the body back-to-back produces a
 * 32 x 14.3 mm tag with two printed faces: price/SKU/HSN on one, symbology on
 * the other. The tail loops through the ring and is never printed. Three labels
 * sit across a 45 mm web, so the print sheet imposes them 3-up.
 */
function SeznikStripTag({ data, symbology = '2D_DATAMATRIX_ECC200' }: { data: LabelData; symbology?: SymbologyMode }) {
    let codeUrl = '';
    if (symbology === '2D_DATAMATRIX_ECC200') {
        codeUrl = generateDataMatrixURL(data.sku);
    } else if (symbology === '2D_QRCODE') {
        codeUrl = generateQRCodeURL(data.sku);
    } else {
        codeUrl = generateBarcodeURL(data.sku);
    }

    const hasCraft = !!(data.craft || data.plating || data.occasion || data.base_metal);
    const specLine = hasCraft
        ? formatImitationSpec({
            craft: data.craft || '',
            plating: data.plating || '',
            occasion: data.occasion || '',
            baseMetal: data.base_metal || '',
            stoneType: '',
            sku: data.sku,
            name: data.name,
            mrpPrice: data.price,
        })
        : '';
    const durability = data.plating ? PLATING_DEFINITIONS[data.plating]?.durabilityMonths : undefined;
    const is1D = symbology === '1D_CODE128_POINTER';
    // Each 32 mm face has to carry its own quiet zone inside the 14.3 mm width.
    const codeLength = is1D ? '26mm' : symbology === '2D_QRCODE' ? '9mm' : '11mm';
    const codeHeight = is1D ? '9mm' : codeLength;

    return (
        <div
            className="seznik-strip-tag bg-white text-black overflow-hidden shadow-sm print:shadow-none"
            style={{ width: '14.3mm', height: '100mm', boxSizing: 'border-box' }}
        >
            {/* Face 1 (0-32 mm): price. The 64 mm body folds at 32 mm, so each
                half must be a self-contained 32 x 14.3 mm face. */}
            <div style={{ position: 'relative', width: '100%', height: '32mm' }}>
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '32mm',
                    height: '14.3mm',
                    transform: 'translate(-50%, -50%) rotate(90deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '0.9mm 1mm',
                    boxSizing: 'border-box',
                    lineHeight: 1.05,
                    textAlign: 'center',
                    color: '#000',
                }}>
                    <div style={{ fontSize: '8pt', fontWeight: 900, letterSpacing: '0.3mm' }}>LUMINILA</div>
                    <div style={{ fontSize: '6pt', fontFamily: 'monospace', fontWeight: 700, maxWidth: '29mm', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {data.sku}
                    </div>
                    <div style={{ fontSize: '10pt', fontWeight: 900 }}>₹{data.price.toLocaleString('en-IN')}</div>
                    <div style={{ fontSize: '5pt', fontWeight: 700, maxWidth: '29mm', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {specLine ? `${specLine}${durability ? ` · ~${durability}mo` : ''}` : `HSN ${data.hsn_code || '71179010'}`}
                    </div>
                </div>
                <div className="print:hidden" style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderTop: '0.15mm dashed #d1d5db',
                }} />
            </div>

            {/* Face 2 (32-64 mm): symbology plus a human-readable SKU. */}
            <div style={{ position: 'relative', width: '100%', height: '32mm' }}>
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '32mm',
                    height: '14.3mm',
                    transform: 'translate(-50%, -50%) rotate(90deg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1mm',
                    padding: '0.9mm 1mm',
                    boxSizing: 'border-box',
                    color: '#000',
                }}>
                    <div style={{
                        width: codeLength,
                        height: codeHeight,
                        flex: '0 0 auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- symbol comes from a dynamic generator endpoint; exact mm sizing is required for thermal output */}
                        <img
                            src={codeUrl}
                            alt={data.sku}
                            style={{
                                width: codeLength,
                                height: codeHeight,
                                objectFit: 'contain',
                            }}
                        />
                    </div>
                    {!is1D && (
                        <div style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            fontSize: '4.8pt',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}>
                            {data.sku}
                        </div>
                    )}
                </div>
            </div>

            {/* 36 mm tail: die-cut, adhesive, and never printed. The guide is screen-only. */}
            <div style={{ position: 'relative', width: '100%', height: '36mm' }}>
                <div className="print:hidden flex items-center justify-center" style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    width: '2.5mm',
                    height: '100%',
                    transform: 'translateX(-50%)',
                    borderLeft: '0.15mm dashed #d1d5db',
                    borderRight: '0.15mm dashed #d1d5db',
                    color: '#9ca3af',
                    fontSize: '4px',
                    writingMode: 'vertical-rl',
                }}>
                    TAIL
                </div>
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
    const [selectedLabelSize, setSelectedLabelSize] = useState<LabelSize>(LABEL_SIZES[0]); // Default to the Seznik production roll
    const [symbologyMode, setSymbologyMode] = useState<SymbologyMode>("2D_DATAMATRIX_ECC200");
    const [rollLayout, setRollLayout] = useState<"3-up" | "1-up">("3-up");
    const [selectedChannel, setSelectedChannel] = useState<string>("pos");
    const [availableChannels, setAvailableChannels] = useState<SalesChannelDef[]>(getConfiguredChannels());

    useEffect(() => {
        loadConfiguredChannels().then(setAvailableChannels).catch(console.error);
    }, []);

    // Recompute tag prices once the tenant's channel rules are available.
    useEffect(() => {
        if (availableChannels.length === 0) return;
        setAvailableProducts(prev => prev.map(p => ({
            ...p,
            price: getChannelPrice(
                {
                    base_price: p.base_price,
                    cost_price: p.cost_price,
                    channel_prices: p.channel_prices,
                },
                selectedChannel
            ),
        })));
    }, [availableChannels, selectedChannel]);

    const handleLabelChannelChange = (channelId: string) => {
        setSelectedChannel(channelId);
        setAvailableProducts(prev => prev.map(p => ({
            ...p,
            price: getChannelPrice({ base_price: p.base_price, cost_price: p.cost_price, channel_prices: p.channel_prices }, channelId),
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
                        cost_price: p.cost_price,
                        channel_prices: p.channel_prices,
                        price: getChannelPrice(p, selectedChannel),
                        category: p.category || '',
                        hsn_code: p.hsn_code || '71179010',
                        craft: p.craft || '',
                        plating: p.plating || '',
                        occasion: p.occasion || '',
                        base_metal: p.base_metal || '',
                    })));
                    return;
                }
                const stored = localStorage.getItem('luminila_products');
                if (stored) {
                    const products = JSON.parse(stored);
                    setAvailableProducts(products.map((p: any) => ({
                        ...p,
                        base_price: p.base_price ?? p.price,
                        cost_price: p.cost_price,
                        price: getChannelPrice({ base_price: p.base_price ?? p.price, cost_price: p.cost_price, channel_prices: p.channel_prices }, selectedChannel),
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
        // Symbol images come from remote generators; printing before they decode
        // produces blank tags, so wait for every image (with a hard timeout).
        const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-label-sheet img'));
        const pending = images.filter(img => !img.complete);
        if (pending.length === 0) {
            window.print();
            return;
        }

        let remaining = pending.length;
        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            window.print();
        };

        pending.forEach(img => {
            const done = () => {
                remaining -= 1;
                if (remaining <= 0) fire();
            };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        });
        window.setTimeout(fire, 5000);
    };

    const flatLabels = selectedProducts.flatMap(product =>
        Array.from({ length: product.quantity }, () => product)
    );
    const totalLabels = flatLabels.length;
    const labelsPerRow = selectedLabelSize.id === 'seznik-strip' && rollLayout === '3-up' ? 3 : 1;
    const printRows: LabelData[][] = [];
    for (let i = 0; i < flatLabels.length; i += labelsPerRow) {
        printRows.push(flatLabels.slice(i, i + labelsPerRow));
    }

    return (
        <div className="labels-page-root flex flex-col h-full overflow-hidden">
            <div className="no-print">
                <Header
                    title="Print Labels"
                    subtitle="Generate and print barcode labels for your products"
                />
            </div>

            {/* Toast notification for added product */}
            {addedNotice && (
                <div className="no-print fixed top-4 right-4 z-50 bg-emerald-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-right fade-in duration-300">
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
                                            onClick={() => addToQueue({
                                                sku: product.sku,
                                                name: product.name,
                                                price: product.price,
                                                hsn_code: product.hsn_code,
                                                craft: product.craft,
                                                plating: product.plating,
                                                occasion: product.occasion,
                                                base_metal: product.base_metal,
                                            })}
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
                                        {selectedLabelSize.id === 'seznik-strip' && (
                                            <>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-moonstone uppercase">Roll:</span>
                                                    {(["3-up", "1-up"] as const).map(layout => (
                                                        <button
                                                            key={layout}
                                                            type="button"
                                                            onClick={() => setRollLayout(layout)}
                                                            className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${rollLayout === layout
                                                                ? 'bg-primary/20 border-primary text-primary'
                                                                : 'bg-bg-navy border-surface-hover text-moonstone hover:text-white'
                                                                }`}
                                                        >
                                                            {layout === '3-up' ? '3-up (45mm web)' : '1-up (14.3mm web)'}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-[10px] text-gold/80 mt-2">
                                                    203 dpi direct thermal · paper {rollLayout === '3-up' ? '45×100mm (2-inch, 3-up)' : '14.3×100mm'} · margins None · scale 100%. Body folds at 32mm; the 36mm tail stays blank.
                                                </p>
                                            </>
                                        )}
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

                                {/* Symbology Selector for Seznik / Dumbbell / Jewelry Tags */}
                                {selectedLabelSize.id === 'dumbbell' || selectedLabelSize.id === 'seznik-strip' ? (
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
                                                    2D Data Matrix ECC 200 (compact square • 30% Reed-Solomon Recovery)
                                                </SelectItem>
                                                <SelectItem value="2D_QRCODE" className="text-xs">
                                                    2D QR Code (ISO/IEC 18004 • Native Smartphone Camera)
                                                </SelectItem>
                                                <SelectItem value="1D_CODE128_POINTER" className="text-xs">
                                                    1D Code 128 (legacy wand • short/pointer SKUs only)
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-moonstone">
                                            {selectedLabelSize.id === 'seznik-strip'
                                                ? 'Symbology prints on one 32mm face; the other face carries brand, price and HSN. Use 2D for full SKUs — 1D only fits a short pointer ID.'
                                                : 'Legacy dumbbell format (54×11mm) with adhesive-free central bridge protecting fine necklaces & earring posts.'}
                                        </p>
                                    </div>
                                ) : null}

                                {/* Size Preview: the dashed swatch keeps the true aspect
                                    ratio, so the dimension caption sits beside it instead of
                                    inside it — a 14.3mm roll is only ~21px wide on screen. */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-moonstone">
                                    <span className="font-bold uppercase shrink-0">Preview:</span>
                                    <div
                                        className="shrink-0 border-2 border-dashed border-primary/40 bg-primary/5 rounded"
                                        style={{
                                            width: `${Math.min(selectedLabelSize.width * 1.5, 120)}px`,
                                            height: `${Math.min(selectedLabelSize.height * 1.5, 60)}px`
                                        }}
                                        aria-hidden="true"
                                    />
                                    <span className="font-mono whitespace-nowrap text-primary/80">{selectedLabelSize.width}×{selectedLabelSize.height}mm</span>
                                </div>
                            </div>
                        </div>

                        {/* Label Preview Area */}
                        {selectedProducts.length > 0 && (
                            <div className="card bg-surface-navy border-surface-hover">
                                <h2 className="text-lg font-bold text-white mb-4">Preview</h2>
                                <div className="flex flex-wrap gap-4 p-4 bg-bg-navy/50 rounded-lg border border-surface-hover justify-center sm:justify-start">
                                    {selectedProducts.slice(0, 6).map((product, index) => (
                                        selectedLabelSize.id === 'seznik-strip' ? (
                                            <SeznikStripTag key={`${product.sku}-${index}`} data={product} symbology={symbologyMode} />
                                        ) : selectedLabelSize.id === 'dumbbell' ? (
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
                                    <p className="text-xl font-bold text-white">{totalLabels}</p>
                                </div>
                                {selectedLabelSize.id === 'seznik-strip' && totalLabels > 0 && (
                                    <p className="text-xs text-moonstone">
                                        {rollLayout} roll · {printRows.length} row{printRows.length === 1 ? '' : 's'}
                                        {rollLayout === '3-up' && printRows.length * 3 > totalLabels
                                            ? ` · ${printRows.length * 3 - totalLabels} blank`
                                            : ''}
                                    </p>
                                )}
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
                <style>{`
                    @media print {
                        @page {
                            margin: 0;
                            size: ${selectedLabelSize.id === 'seznik-strip'
                                ? (rollLayout === '3-up' ? '45mm 100mm' : '14.3mm 100mm')
                                : 'auto'};
                        }

                        html, body {
                            margin: 0 !important;
                            padding: 0 !important;
                            height: auto !important;
                            overflow: visible !important;
                            background: #fff !important;
                        }
                        body * {
                            overflow: visible !important;
                        }
                        .labels-page-root {
                            display: block !important;
                            height: auto !important;
                            overflow: visible !important;
                        }
                        .app-main {
                            display: block !important;
                            flex: 1 1 auto !important;
                            width: 100% !important;
                            height: auto !important;
                            overflow: visible !important;
                            padding-bottom: 0 !important;
                        }
                        [data-sonner-toaster] {
                            display: none !important;
                        }
                        .no-print {
                            display: none !important;
                        }
                        .seznik-print-sheet {
                            margin: 0 !important;
                            padding: 0 !important;
                            background: #fff !important;
                        }
                        .seznik-print-row {
                            display: flex;
                            align-items: flex-start;
                            width: 45mm;
                            height: 100mm;
                            overflow: hidden;
                            break-after: page;
                            page-break-after: always;
                            break-inside: avoid;
                            page-break-inside: avoid;
                        }
                        .seznik-print-row[data-layout="1-up"] {
                            width: 14.3mm;
                        }
                        .seznik-print-row:last-child {
                            break-after: auto;
                            page-break-after: auto;
                        }
                        .seznik-print-cell {
                            width: 15mm;
                            height: 100mm;
                            flex: 0 0 15mm;
                            display: flex;
                            justify-content: center;
                            overflow: hidden;
                        }
                        .seznik-print-row[data-layout="1-up"] .seznik-print-cell {
                            width: 14.3mm;
                            flex-basis: 14.3mm;
                        }
                        .seznik-strip-tag {
                            overflow: hidden !important;
                            break-inside: avoid;
                            page-break-inside: avoid;
                            border: 0 !important;
                            border-radius: 0 !important;
                            box-shadow: none !important;
                            color: #000 !important;
                            background: #fff !important;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
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

                {selectedLabelSize.id === 'seznik-strip' ? (
                    <div className="print-label-sheet seznik-print-sheet">
                        {printRows.map((row, rowIndex) => (
                            <div
                                key={`seznik-row-${rowIndex}`}
                                className="seznik-print-row"
                                data-layout={rollLayout}
                            >
                                {row.map((product, cellIndex) => (
                                    <div key={`seznik-cell-${rowIndex}-${cellIndex}`} className="seznik-print-cell">
                                        <SeznikStripTag data={product} symbology={symbologyMode} />
                                    </div>
                                ))}
                                {Array.from({ length: labelsPerRow - row.length }).map((_, blankIndex) => (
                                    <div key={`seznik-blank-${rowIndex}-${blankIndex}`} className="seznik-print-cell" />
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="print-label-sheet flex flex-wrap gap-2 p-4 bg-white">
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
                )}
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


