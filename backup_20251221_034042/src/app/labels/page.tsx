"use client";

import { useState, useRef, useEffect } from "react";
import { Header } from "@/components/layout";
import { Printer, Download, RefreshCw, Plus, Trash2, Tag } from "lucide-react";
import JsBarcode from "jsbarcode";

interface LabelData {
    sku: string;
    name: string;
    price: number;
    variant?: string;
}

// Mock products for label generation
const mockProductsForLabels: LabelData[] = [
    { sku: "LUM-EAR-001-S", name: "Pearl Drop Earrings", variant: "Small", price: 1290 },
    { sku: "LUM-EAR-001-M", name: "Pearl Drop Earrings", variant: "Medium", price: 1490 },
    { sku: "LUM-NEC-023-16", name: "Layered Chain Necklace", variant: "16 inch", price: 2450 },
    { sku: "LUM-BRC-015-7", name: "Crystal Tennis Bracelet", variant: "7 inch", price: 1890 },
];

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

export default function LabelsPage() {
    const [selectedProducts, setSelectedProducts] = useState<LabelData[]>([]);
    const [quantity, setQuantity] = useState(1);

    const addToQueue = (product: LabelData) => {
        setSelectedProducts((prev) => [...prev, product]);
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

            <div className="flex-1 overflow-y-auto p-6 scroll-smooth no-print">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Product Selection */}
                    <div className="lg:col-span-2 flex flex-col gap-6">
                        <div className="card bg-surface-navy border-surface-hover">
                            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Tag size={20} className="text-primary" />
                                Select Products
                            </h2>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {mockProductsForLabels.map((product) => (
                                    <button
                                        key={product.sku}
                                        onClick={() => addToQueue(product)}
                                        className="p-3 bg-bg-navy border border-surface-hover rounded-lg hover:border-primary/50 hover:bg-bg-navy/80 transition-all text-left group"
                                    >
                                        <p className="text-[10px] text-moonstone font-mono">{product.sku}</p>
                                        <p className="font-bold text-sm text-white group-hover:text-primary transition-colors truncate">{product.name}</p>
                                        {product.variant && (
                                            <p className="text-xs text-moonstone">{product.variant}</p>
                                        )}
                                        <p className="font-bold text-primary text-xs mt-1">
                                            ₹{product.price.toLocaleString("en-IN")}
                                        </p>
                                    </button>
                                ))}
                            </div>

                            {/* Quantity Setting */}
                            <div className="mt-6 pt-4 border-t border-surface-hover flex items-center gap-4">
                                <label className="text-sm font-bold text-moonstone uppercase">Labels per product:</label>
                                <div className="flex items-center">
                                    <button
                                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                        className="w-8 h-8 flex items-center justify-center bg-bg-navy border border-surface-hover rounded-l-lg text-white hover:bg-surface-hover"
                                    >
                                        -
                                    </button>
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={quantity}
                                        onChange={(e) => setQuantity(Number(e.target.value))}
                                        className="w-16 h-8 text-center bg-bg-navy border-y border-surface-hover text-white text-sm focus:outline-none"
                                    />
                                    <button
                                        onClick={() => setQuantity(quantity + 1)}
                                        className="w-8 h-8 flex items-center justify-center bg-bg-navy border border-surface-hover rounded-r-lg text-white hover:bg-surface-hover"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Label Preview Area */}
                        {selectedProducts.length > 0 && (
                            <div className="card bg-surface-navy border-surface-hover">
                                <h2 className="text-lg font-bold text-white mb-4">Preview</h2>
                                <div className="flex flex-wrap gap-4 p-4 bg-bg-navy/50 rounded-lg border border-surface-hover justify-center sm:justify-start">
                                    {selectedProducts.slice(0, 6).map((product, index) => (
                                        <BarcodeLabel key={`${product.sku}-${index}`} data={product} />
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
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-white truncate">{product.name}</p>
                                                <p className="text-xs text-moonstone truncate">{product.sku}</p>
                                            </div>
                                            <span className="text-primary font-bold text-sm bg-primary/10 px-2 py-0.5 rounded">×{quantity}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 pt-4 border-t border-surface-hover space-y-4">
                                <div className="flex justify-between items-center">
                                    <p className="text-sm text-moonstone">Total Labels</p>
                                    <p className="text-xl font-bold text-white">{selectedProducts.length * quantity}</p>
                                </div>
                                <button
                                    onClick={handlePrint}
                                    disabled={selectedProducts.length === 0}
                                    className="btn btn-primary w-full py-3 text-base shadow-[0_4px_15px_rgba(238,189,43,0.3)] disabled:opacity-50 disabled:shadow-none"
                                >
                                    <Printer size={20} />
                                    Print Labels
                                </button>
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
                        .barcode-label {
                            break-inside: avoid;
                            page-break-inside: avoid;
                            color: black !important;
                            border: 1px solid #ddd;
                        }
                        .barcode-label * {
                            color: black !important;
                        }
                    }
                `}</style>
                <div className="flex flex-wrap gap-2 p-4 bg-white">
                    {selectedProducts.flatMap((product, pIndex) =>
                        Array.from({ length: quantity }).map((_, qIndex) => (
                            <BarcodeLabel key={`print-${pIndex}-${qIndex}`} data={product} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
