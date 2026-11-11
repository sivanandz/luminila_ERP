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
import { getStoreSettings } from "@/lib/settings";
import { getTenantStorageKey } from "@/lib/pocketbase";
import { getChannelPrice, getConfiguredChannels, loadConfiguredChannels, type SalesChannelDef } from "@/lib/channel-pricing";
import { formatImitationSpec, PLATING_DEFINITIONS } from "@/lib/imitation-jewelry-engine";
import { toast } from "sonner";
import { consumeLabelQueue } from "@/lib/label-queue";

/** Per-product and per-job caps that keep Array.from() from freezing the tab (I14). */
const MAX_LABEL_QUANTITY = 500;
const MAX_LABELS_PER_PRINT = 500;

/**
 * CODE128 accepts printable ASCII only (I13). Validating up front lets the page
 * refuse to print instead of emitting a blank, unscannable label.
 */
function isValidLabelSku(sku: string): boolean {
    const value = (sku || '').trim();
    return value.length > 0 && value.length <= 80 && /^[\x20-\x7E]+$/.test(value);
}

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
    /** Base selling price = the no-loss floor (not visible anywhere else);
     *  the clerk code prints 2× it, halved by staff for the minimum SP. */
    base_price?: number;
    /** Tray / storage location, printed as stored (e.g. "A2") in the clerk code. */
    location?: string;
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
    location?: string;
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
    { id: "seznik-strip", name: "Seznik Jewellery Roll (14.3×100mm)", width: 14.3, height: 100, description: "Fold-in-half direct thermal stock: 64mm body (two 32mm faces) with a 36mm unprinted tail, 3-up on a 45mm web" },
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
 * Stock geometry: the 100 mm feed pitch leads with the 36 mm narrow tail (the
 * roll feeds tail-first), then the 64 mm body with a fold at its midpoint, 68 mm
 * from the leading edge. Folding the body back-to-back produces a 32 x 14.3 mm
 * tag with two printed faces: price/SKU/HSN on one, symbology on the other. The
 * tail loops through the ring and is never printed. Three labels sit across a
 * 45 mm web, so the print sheet imposes them 3-up.
 */
function SeznikStripTag({ data, symbology = '2D_DATAMATRIX_ECC200', feedDirection = 'tag-first', printBrand = false, brandName = '' }: {
    data: LabelData;
    symbology?: SymbologyMode;
    /** Which end of the 100 mm pitch enters the printer first. */
    feedDirection?: "tail-first" | "tag-first";
    /** Print the store/brand name on face 1 (off: nothing is printed). */
    printBrand?: boolean;
    brandName?: string;
}) {
    let codeUrl = '';
    if (symbology === '2D_DATAMATRIX_ECC200') {
        codeUrl = generateDataMatrixURL(data.sku);
    } else if (symbology === '2D_QRCODE') {
        codeUrl = generateQRCodeURL(data.sku);
    } else {
        codeUrl = generateBarcodeURL(data.sku);
    }

    // LUMINILA is no longer printed by default; the operator can opt into the
    // store's brand name instead.
    const brand = printBrand ? (brandName || 'LUMINILA').trim() : '';
    const is1D = symbology === '1D_CODE128_POINTER';
    // Each 32 mm face has to carry its own quiet zone inside the 14.3 mm width.
    const codeLength = is1D ? '26mm' : symbology === '2D_QRCODE' ? '9mm' : '11mm';
    const codeHeight = is1D ? '9mm' : codeLength;

    // Clerk code under the SKU: <2× base selling price><location as stored>,
    // e.g. "1600A2". The doubled base selling price is the shop-floor
    // reference — halve it for the minimum sellable price after discounts;
    // base selling price is the no-loss floor and is not printed anywhere
    // else. The location prints exactly as stored on the product. The 36 mm
    // tail stays die-cut blank as before.
    const storedLocation = (data.location || '').trim();
    const baseForCode = data.base_price && data.base_price > 0 ? data.base_price : data.price;
    const doubleBase = 2 * baseForCode;
    const doubleBaseStr = Number.isInteger(doubleBase)
        ? String(doubleBase)
        : String(Number(doubleBase.toFixed(2)));
    const clerkCode = `${doubleBaseStr}${storedLocation}`;

    return (
        <div
            className="seznik-strip-tag bg-white text-black overflow-hidden shadow-sm print:shadow-none"
            style={{ width: '14.3mm', height: '100mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}
        >
            {/* 36 mm tail: die-cut, adhesive, and never printed. Its page order
                follows the feed direction: "tail first" puts it last on the page
                so it lands at the leading edge on the stock; "tag first" trails
                it. Guide is screen-only. */}
            <div style={{ position: 'relative', width: '100%', height: '36mm', flex: '0 0 auto', order: feedDirection === 'tag-first' ? 2 : 0 }}>
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

            {/* Face 1: price. The 64 mm body folds at its midpoint, so each
                half must be a self-contained 32 x 14.3 mm face. */}
            <div style={{ position: 'relative', width: '100%', height: '32mm', flex: '0 0 auto', order: feedDirection === 'tag-first' ? 0 : 1 }}>
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
                    padding: '0.5mm 0.8mm',
                    boxSizing: 'border-box',
                    lineHeight: 1.05,
                    textAlign: 'center',
                    color: '#000',
                }}>
                    {(brand || is1D) && (
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.8mm', lineHeight: 1, maxWidth: '30mm' }}>
                            {brand && (
                                <span style={{ fontSize: '6pt', fontWeight: 900, letterSpacing: '0.2mm', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand}</span>
                            )}
                            {is1D && (
                                <span style={{ fontSize: '10pt', fontWeight: 900, whiteSpace: 'nowrap' }}>₹{data.price.toLocaleString('en-IN')}</span>
                            )}
                        </div>
                    )}
                    {/* SKU: 9pt when it is the only content on the face, 7pt when
                        the price shares it. Up to 3 lines either way; sharing
                        with the clerk-code line trims to ~2.5 lines. */}
                    <div style={{
                        fontSize: is1D ? '7pt' : '9pt',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        lineHeight: 1,
                        maxWidth: '30mm',
                        maxHeight: clerkCode ? (is1D ? '17.5pt' : '24pt') : (is1D ? '21pt' : '27pt'),
                        overflow: 'hidden',
                        wordBreak: 'break-all',
                    }}>
                        {data.sku}
                    </div>
                    {clerkCode && (
                        <div
                            title={clerkCode}
                            style={{
                                fontSize: '6.5pt',
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                lineHeight: 1,
                                marginTop: '0.7mm',
                                maxWidth: '30mm',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {clerkCode}
                        </div>
                    )}
                </div>
                <div className="print:hidden" style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderTop: '0.15mm dashed #d1d5db',
                }} />
            </div>

            {/* Face 2: symbology. A 2D code leaves room for the price; a 1D
                barcode needs the full face width, so its price moves to face 1. */}
            <div style={{ position: 'relative', width: '100%', height: '32mm', flex: '0 0 auto', order: feedDirection === 'tag-first' ? 1 : 2 }}>
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
                    padding: '0.5mm 0.8mm',
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
                            textAlign: 'center',
                            fontSize: '10pt',
                            fontWeight: 900,
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                        }}>
                            ₹{data.price.toLocaleString('en-IN')}
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}

function BarcodeLabel({ data }: { data: LabelData }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Purely derived: no state and no cascading render from the drawing effect.
    const barcodeError = !isValidLabelSku(data.sku);

    useEffect(() => {
        if (canvasRef.current && !barcodeError) {
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
                // I13: a blank canvas used to print silently.
                console.error("Barcode generation failed", e);
            }
        }
    }, [data.sku, barcodeError]);

    return (
        <div className="barcode-label bg-white text-black border border-gray-200 rounded-lg p-3 w-[200px] h-[100px] flex flex-col justify-between shadow-sm">
            <div className="text-center overflow-hidden">
                <p className="text-xs font-bold truncate leading-tight">{data.name}</p>
                {data.variant && (
                    <p className="text-[10px] text-gray-500">{data.variant}</p>
                )}
            </div>
            <div className="flex justify-center my-1">
                <canvas ref={canvasRef} className={barcodeError ? "hidden" : "max-w-full h-auto"} />
                {barcodeError && (
                    <p className="text-[10px] text-red-600 font-semibold">Invalid barcode value</p>
                )}
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
    // Seznik rolls are wound either way; which end reaches the print head first
    // decides whether the blank 36 mm tail must lead the 100 mm pitch or trail it.
    const [feedDirection, setFeedDirection] = useState<"tail-first" | "tag-first">("tag-first");
    // Brand name is opt-in: the tag prints nothing where LUMINILA used to be
    // unless the operator asks for the store's brand.
    const [printBrand, setPrintBrand] = useState(false);
    const [storeName, setStoreName] = useState('');
    // A 3-up pitch carries three tags; a partial row left by the previous run is
    // reused by starting at the 2nd or 3rd tag instead of feeding a fresh row.
    const [startSlot, setStartSlot] = useState<0 | 1 | 2>(0);
    const [selectedChannel, setSelectedChannel] = useState<string>("pos");
    const [availableChannels, setAvailableChannels] = useState<SalesChannelDef[]>(getConfiguredChannels());

    useEffect(() => {
        loadConfiguredChannels().then(setAvailableChannels).catch(console.error);
        const batchItems = consumeLabelQueue();
        if (batchItems.length > 0) {
            setSelectedProducts((prev) => {
                const next = [...prev];
                for (const item of batchItems) {
                    const idx = next.findIndex((p) => p.sku === item.sku);
                    if (idx >= 0) {
                        next[idx] = { ...next[idx], quantity: next[idx].quantity + item.quantity };
                    } else {
                        next.push(item);
                    }
                }
                return next;
            });
            const totalTags = batchItems.reduce((sum, it) => sum + it.quantity, 0);
            toast.success(`Loaded ${batchItems.length} products (${totalTags} labels) from queue!`);
        }
    }, []);

    // Store brand name for the optional brand line on the tag.
    useEffect(() => {
        let alive = true;
        getStoreSettings()
            .then(settings => { if (alive) setStoreName(settings.storeName || ''); })
            .catch(() => { /* brand stays unavailable */ });
        return () => { alive = false; };
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
        // Queue lines carry only a printed price, so a channel switch has to
        // re-price them from the catalog row; otherwise the tag keeps the
        // previous channel's rate (INV-19).
        const priceOf = (p: DBProduct) =>
            getChannelPrice(
                { base_price: p.base_price, cost_price: p.cost_price, channel_prices: p.channel_prices },
                channelId
            );
        setAvailableProducts(availableProducts.map(p => ({ ...p, price: priceOf(p) })));
        const priceBySku = new Map(availableProducts.map(p => [p.sku, priceOf(p)]));
        setSelectedProducts(prev => prev.map(item => {
            const nextPrice = priceBySku.get(item.sku);
            return nextPrice === undefined || nextPrice === item.price ? item : { ...item, price: nextPrice };
        }));
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
                        location: p.location || '',
                    })));
                    return;
                }
                const stored = localStorage.getItem(getTenantStorageKey('luminila_products'));
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
                const stored = localStorage.getItem(getTenantStorageKey('luminila_products'));
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
        const requestedQty = parseInt(searchParams.get('qty') || '', 10);
        const addQty = Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : 1;

        if (sku && name && price) {
            // PG-30: a tampered ?price= must not print NaN onto a barcode label.
            const parsedPrice = Number(price);
            if (!Number.isFinite(parsedPrice)) {
                toast.error("That product's price is invalid; open it from inventory again.");
                return;
            }
            const productPart = {
                sku,
                name,
                price: parsedPrice,
            };

            setSelectedProducts(prev => {
                const existingIndex = prev.findIndex(p => p.sku === sku);
                if (existingIndex >= 0) {
                    const next = [...prev];
                    next[existingIndex] = {
                        ...next[existingIndex],
                        quantity: next[existingIndex].quantity + addQty
                    };
                    return next;
                }
                return [...prev, { ...productPart, quantity: addQty }];
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
                    quantity: Math.min(MAX_LABEL_QUANTITY, next[existingIndex].quantity + quantity)
                };
                return next;
            }
            return [...prev, { ...product, quantity: Math.min(MAX_LABEL_QUANTITY, Math.max(1, quantity)) }];
        });
    };

    const updateQuantity = (index: number, newQty: number) => {
        const clamped = Math.min(MAX_LABEL_QUANTITY, Math.max(1, Math.floor(Number(newQty)) || 1));
        setSelectedProducts(prev => {
            const next = [...prev];
            next[index] = { ...next[index], quantity: clamped };
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
        // I13: refuse the whole job when any SKU cannot be encoded.
        const invalid = selectedProducts.find((product) => !isValidLabelSku(product.sku));
        if (invalid) {
            toast.error(`Cannot print: "${invalid.sku || '(empty SKU)'}" is not a valid CODE128 value.`);
            return;
        }
        // I14: cap the print sheet so a large queue cannot freeze the tab.
        const totalToPrint = selectedProducts.reduce((sum, product) => sum + product.quantity, 0);
        if (totalToPrint > MAX_LABELS_PER_PRINT) {
            toast.error(`This job needs ${totalToPrint} labels; the limit per print is ${MAX_LABELS_PER_PRINT}.`);
            return;
        }

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

    // Queue lines and ?sku= deep links carry only a printed price; the base
    // selling price (2× line) and tray location are back-filled from the
    // catalog by SKU so every producer (bulk bar, quick-add, WhatsApp, PO
    // links) prints them without changing its payload.
    const catalogBySku = new Map(availableProducts.map(p => [p.sku, p]));
    const flatLabels = selectedProducts.flatMap(product => {
        const cat = catalogBySku.get(product.sku);
        const enriched: LabelData = {
            ...product,
            base_price: product.base_price ?? cat?.base_price,
            location: product.location ?? cat?.location ?? '',
        };
        return Array.from({ length: product.quantity }, () => enriched);
    });
    const totalLabels = flatLabels.length;
    const labelsPerRow = selectedLabelSize.id === 'seznik-strip' && rollLayout === '3-up' ? 3 : 1;
    // Leading blanks push the first label onto the requested tag of the shared
    // 3-up pitch; every later row stays full.
    const leadingBlanks = labelsPerRow === 3 ? startSlot : 0;
    const paddedLabels: (LabelData | null)[] = leadingBlanks > 0
        ? [...Array.from({ length: leadingBlanks }, () => null), ...flatLabels]
        : flatLabels;
    const printRows: (LabelData | null)[][] = [];
    for (let i = 0; i < paddedLabels.length; i += labelsPerRow) {
        printRows.push(paddedLabels.slice(i, i + labelsPerRow));
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
                                                base_price: product.base_price,
                                                location: product.location,
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
                                                {rollLayout === '3-up' && (
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <span className="text-[10px] font-bold text-moonstone uppercase">Start at:</span>
                                                        {([0, 1, 2] as const).map(slot => (
                                                            <button
                                                                key={slot}
                                                                type="button"
                                                                onClick={() => setStartSlot(slot)}
                                                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${startSlot === slot
                                                                    ? 'bg-primary/20 border-primary text-primary'
                                                                    : 'bg-bg-navy border-surface-hover text-moonstone hover:text-white'
                                                                    }`}
                                                                title={slot === 0 ? 'Start a fresh 3-up row' : `Reuse the ${slot} blank tag(s) left on the previous row`}
                                                            >
                                                                {slot === 0 ? 'Tag 1 (fresh row)' : `Tag ${slot + 1}`}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-moonstone uppercase">Feed:</span>
                                                    {(["tag-first", "tail-first"] as const).map(dir => (
                                                        <button
                                                            key={dir}
                                                            type="button"
                                                            onClick={() => setFeedDirection(dir)}
                                                            className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${feedDirection === dir
                                                                ? 'bg-primary/20 border-primary text-primary'
                                                                : 'bg-bg-navy border-surface-hover text-moonstone hover:text-white'
                                                                }`}
                                                        >
                                                            {dir === 'tag-first' ? 'Tag first' : 'Tail first (36mm blank)'}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-moonstone uppercase">Brand:</span>
                                                    {([false, true] as const).map(show => (
                                                        <button
                                                            key={String(show)}
                                                            type="button"
                                                            onClick={() => setPrintBrand(show)}
                                                            className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${printBrand === show
                                                                ? 'bg-primary/20 border-primary text-primary'
                                                                : 'bg-bg-navy border-surface-hover text-moonstone hover:text-white'
                                                                }`}
                                                        >
                                                            {show
                                                                ? (storeName ? `Store name (${storeName.length > 16 ? `${storeName.slice(0, 16)}…` : storeName})` : 'Store name')
                                                                : 'None'}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-[10px] text-gold/80 mt-2">
                                                    203 dpi direct thermal · paper {rollLayout === '3-up' ? '45×100mm (2-inch, 3-up)' : '14.3×100mm'} · margins None · scale 100%. {feedDirection === 'tag-first'
                                                        ? 'Tag leads the feed; the blank 36mm tail trails and is never printed.'
                                                        : 'Tail leads the feed (36mm, blank); the body folds at its midpoint.'}{' '}
                                                    Face 1 prints the SKU{printBrand ? ' and brand' : ''}{symbologyMode === '1D_CODE128_POINTER' ? ' and price' : ''}; face 2 prints {symbologyMode === '1D_CODE128_POINTER' ? 'the 1D barcode alone' : 'the code with the price'}. Below the SKU every tag prints the clerk code: 2× the base selling price followed by the location as stored (e.g. 1600A2 — halve it for the minimum sellable price after discounts).
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
                                                max={MAX_LABEL_QUANTITY}
                                                value={quantity}
                                                onChange={(e) => setQuantity(Math.min(MAX_LABEL_QUANTITY, Math.max(1, Math.floor(Number(e.target.value)) || 1)))}
                                                className="w-16 h-10 text-center bg-bg-navy border-y border-surface-hover text-white text-sm focus:outline-none"
                                            />
                                            <button
                                                onClick={() => setQuantity(Math.min(MAX_LABEL_QUANTITY, quantity + 1))}
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
                                                ? 'The SKU prints on one 32mm face. A 2D code shares the other face with the price; a 1D barcode needs the full face, so the price moves to the SKU face. Use 2D for full SKUs — 1D only fits a short pointer ID.'
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
                                    {selectedLabelSize.id === 'seznik-strip' ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex items-start" style={{ gap: '1mm' }}>
                                                {Array.from({ length: labelsPerRow }).map((_, slot) => {
                                                    // Shown in print-sheet order, matching the Windows
                                                    // preview: the printer mirrors the sheet onto the
                                                    // stock, so the sheet's left cell is physical tag 3.
                                                    const physical = labelsPerRow - 1 - slot;
                                                    const product = printRows[0]?.[physical] ?? null;
                                                    return (
                                                    <div key={`preview-slot-${slot}`} className="flex flex-col items-center gap-1">
                                                        <span className={`text-[10px] font-bold uppercase ${product ? 'text-moonstone' : 'text-amber-500/80'}`}>
                                                            Tag {physical + 1}{product ? '' : ' · blank'}
                                                        </span>
                                                        {product ? (
                                                            <SeznikStripTag data={product} symbology={symbologyMode} feedDirection={feedDirection} printBrand={printBrand} brandName={storeName} />
                                                        ) : (
                                                            <div
                                                                style={{ width: '14.3mm', height: '100mm' }}
                                                                className="rounded border border-dashed border-surface-hover bg-bg-navy/30 flex items-center justify-center"
                                                            >
                                                                <span className="text-[9px] text-moonstone/60 whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                                                                    BLANK
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-[10px] text-moonstone">
                                                First pitch in print-sheet order — {labelsPerRow} tag{labelsPerRow === 1 ? '' : 's'} across{labelsPerRow === 3 ? ' the 45mm web' : ''}; the printer mirrors this onto the stock.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
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
                                        </>
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
                                        {rollLayout === '3-up' && startSlot > 0 ? ` · starts at tag ${startSlot + 1}` : ''}
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
                                {Array.from({ length: labelsPerRow }).map((_, slot) => {
                                    // The printer lays the 45 mm web out right-to-left, so
                                    // the row is emitted reversed: tag 1 goes to the last
                                    // DOM cell and lands at physical left.
                                    const product = row[labelsPerRow - 1 - slot] ?? null;
                                    return (
                                        <div key={`seznik-cell-${rowIndex}-${slot}`} className="seznik-print-cell">
                                            {product && (
                                                <SeznikStripTag data={product} symbology={symbologyMode} feedDirection={feedDirection} printBrand={printBrand} brandName={storeName} />
                                            )}
                                        </div>
                                    );
                                })}
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


