"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout";
import { Receipt } from "@/components/pos/Receipt";
import { formatPrice, generateId } from "@/lib/utils";
import {
    Camera,
    Plus,
    Minus,
    Trash2,
    CreditCard,
    Banknote,
    Smartphone,
    Search,
    X,
    Receipt as ReceiptIcon,
    CameraOff,
    Printer,
} from "lucide-react";

// Dynamically import BarcodeScanner to avoid SSR issues with html5-qrcode
const BarcodeScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false, loading: () => <ScannerPlaceholder /> }
);

function ScannerPlaceholder() {
    return (
        <div className="flex-1 bg-bg-navy rounded-lg flex flex-col items-center justify-center min-h-[300px] border border-surface-hover">
            <Camera size={64} className="text-surface-hover mb-4 animate-pulse" />
            <p className="text-moonstone text-lg font-medium">Loading Scanner...</p>
        </div>
    );
}

interface CartItem {
    id: string;
    sku: string;
    name: string;
    variant: string;
    price: number;
    quantity: number;
}

// Mock product data for quick search (will be replaced with Supabase)
const mockProducts = [
    { id: "1", sku: "LUM-EAR-001-S", name: "Pearl Drop Earrings", variant: "Small", price: 1290 },
    { id: "2", sku: "LUM-EAR-001-M", name: "Pearl Drop Earrings", variant: "Medium", price: 1490 },
    { id: "3", sku: "LUM-NEC-023-16", name: "Layered Chain Necklace", variant: "16 inch", price: 2450 },
    { id: "4", sku: "LUM-BRC-015-7", name: "Crystal Tennis Bracelet", variant: "7 inch", price: 1890 },
    { id: "5", sku: "LUM-RNG-008-6", name: "Solitaire Statement Ring", variant: "Size 6", price: 990 },
];

export default function POSPage() {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [scannerEnabled, setScannerEnabled] = useState(false);
    const [discount, setDiscount] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [lastTransaction, setLastTransaction] = useState<{
        id: string;
        items: CartItem[];
        subtotal: number;
        discount: number;
        total: number;
        paymentMethod: string;
    } | null>(null);
    const [showReceipt, setShowReceipt] = useState(false);
    const receiptRef = useRef<HTMLDivElement>(null);

    // Filter products based on search
    const searchResults = searchQuery
        ? mockProducts.filter(
            (p) =>
                p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.sku.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : [];

    // Handle barcode scan
    const handleBarcodeScan = useCallback((code: string) => {
        console.log("Scanned barcode:", code);

        // Find product by SKU
        const product = mockProducts.find(
            (p) => p.sku.toLowerCase() === code.toLowerCase()
        );

        if (product) {
            addToCart(product);
        } else {
            // TODO: Search in Supabase
            console.log("Product not found for SKU:", code);
        }
    }, []);

    // Add item to cart
    const addToCart = useCallback((product: typeof mockProducts[0]) => {
        setCart((prev) => {
            const existing = prev.find((item) => item.sku === product.sku);
            if (existing) {
                return prev.map((item) =>
                    item.sku === product.sku
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            return [
                ...prev,
                {
                    id: generateId(),
                    sku: product.sku,
                    name: product.name,
                    variant: product.variant,
                    price: product.price,
                    quantity: 1,
                },
            ];
        });
        setSearchQuery("");
        setShowSearch(false);
    }, []);

    // Update quantity
    const updateQuantity = (id: string, delta: number) => {
        setCart((prev) =>
            prev
                .map((item) =>
                    item.id === id
                        ? { ...item, quantity: Math.max(0, item.quantity + delta) }
                        : item
                )
                .filter((item) => item.quantity > 0)
        );
    };

    // Remove item
    const removeItem = (id: string) => {
        setCart((prev) => prev.filter((item) => item.id !== id));
    };

    // Clear cart
    const clearCart = () => {
        setCart([]);
        setDiscount(0);
        setPaymentMethod(null);
    };

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountAmount = (subtotal * discount) / 100;
    const total = subtotal - discountAmount;

    // Print receipt
    const printReceipt = () => {
        if (receiptRef.current) {
            const printWindow = window.open("", "_blank");
            if (printWindow) {
                printWindow.document.write(`
          <html>
            <head>
              <title>Receipt</title>
              <style>
                body { margin: 0; padding: 10px; }
                * { font-family: 'Courier New', monospace; }
              </style>
            </head>
            <body>${receiptRef.current.innerHTML}</body>
          </html>
        `);
                printWindow.document.close();
                printWindow.print();
                printWindow.close();
            }
        }
    };

    // Process sale
    const processSale = async () => {
        if (!paymentMethod || cart.length === 0) return;

        setIsProcessing(true);

        // Simulate API call (TODO: Replace with Supabase)
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const transactionId = `TXN-${Date.now().toString(36).toUpperCase()}`;

        // Save transaction for receipt
        setLastTransaction({
            id: transactionId,
            items: [...cart],
            subtotal,
            discount: discountAmount,
            total,
            paymentMethod,
        });

        console.log("Sale processed:", {
            transactionId,
            items: cart,
            subtotal,
            discount: discountAmount,
            total,
            paymentMethod,
        });

        setIsProcessing(false);
        setShowReceipt(true);
        clearCart();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Point of Sale" subtitle="Quick checkout for walk-in customers" />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 h-full overflow-hidden">
                {/* Left Panel - Product Search & Scanner */}
                <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">
                    {/* Scanner Area */}
                    <div className="bg-surface-navy rounded-xl border border-surface-hover flex-1 flex flex-col p-6 overflow-hidden">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-white">Scan or Search</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setScannerEnabled(!scannerEnabled)}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors ${scannerEnabled
                                            ? "bg-primary text-bg-navy hover:bg-primary/90"
                                            : "bg-bg-navy text-moonstone hover:text-white border border-surface-hover"
                                        }`}
                                >
                                    {scannerEnabled ? <CameraOff size={18} /> : <Camera size={18} />}
                                    {scannerEnabled ? "Stop Scanner" : "Start Scanner"}
                                </button>
                                <button
                                    onClick={() => setShowSearch(!showSearch)}
                                    className="px-4 py-2 bg-bg-navy text-moonstone hover:text-white border border-surface-hover rounded-lg font-bold text-sm flex items-center gap-2 transition-colors"
                                >
                                    <Search size={18} />
                                    Search
                                </button>
                            </div>
                        </div>

                        {/* Search Overlay */}
                        {showSearch && (
                            <div className="mb-4">
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone group-focus-within:text-primary">
                                        <Search size={20} />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search by product name or SKU..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="bg-bg-navy border border-surface-hover text-white text-sm rounded-lg block w-full pl-10 h-11 focus:ring-1 focus:ring-primary focus:border-primary placeholder-moonstone transition-all"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => {
                                            setSearchQuery("");
                                            setShowSearch(false);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-surface-hover rounded-lg text-moonstone hover:text-white"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                {/* Search Results */}
                                {searchResults.length > 0 && (
                                    <div className="mt-2 bg-bg-navy rounded-lg border border-surface-hover divide-y divide-surface-hover max-h-48 overflow-y-auto">
                                        {searchResults.map((product) => (
                                            <button
                                                key={product.id}
                                                onClick={() => addToCart(product)}
                                                className="w-full p-3 flex items-center justify-between hover:bg-surface-hover transition-colors text-left"
                                            >
                                                <div>
                                                    <p className="font-bold text-white text-sm">{product.name}</p>
                                                    <p className="text-xs text-moonstone">
                                                        {product.sku} • {product.variant}
                                                    </p>
                                                </div>
                                                <p className="font-bold text-primary">
                                                    {formatPrice(product.price)}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Barcode Scanner */}
                        <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden border border-surface-hover bg-bg-navy">
                            {scannerEnabled ? (
                                <BarcodeScanner
                                    onScan={handleBarcodeScan}
                                    onError={(err) => console.error("Scanner error:", err)}
                                    isActive={scannerEnabled}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center">
                                    <Camera size={64} className="text-surface-hover mb-4" />
                                    <p className="text-white text-lg font-bold">
                                        Barcode Scanner
                                    </p>
                                    <p className="text-moonstone text-sm mt-1">
                                        Click "Start Scanner" to enable camera
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Quick Add Buttons */}
                        <div className="mt-4 grid grid-cols-4 gap-3">
                            {mockProducts.slice(0, 4).map((product) => (
                                <button
                                    key={product.id}
                                    onClick={() => addToCart(product)}
                                    className="p-3 bg-bg-navy border border-surface-hover hover:border-primary/50 hover:bg-bg-navy/80 rounded-lg transition-all text-left group"
                                >
                                    <p className="text-[10px] text-moonstone truncate font-mono">
                                        {product.sku}
                                    </p>
                                    <p className="font-bold text-white text-sm truncate mt-0.5 group-hover:text-primary transition-colors">{product.name}</p>
                                    <p className="text-xs text-white mt-1">
                                        {formatPrice(product.price)}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Panel - Cart */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover flex flex-col p-6 overflow-hidden col-span-1">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-white">Cart</h2>
                        {cart.length > 0 && (
                            <button
                                onClick={clearCart}
                                className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors bg-red-400/10 px-2 py-1 rounded"
                            >
                                Clear All
                            </button>
                        )}
                    </div>

                    {/* Cart Items */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-surface-hover scrollbar-track-transparent">
                        {cart.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-8">
                                <div className="p-4 bg-bg-navy rounded-full mb-3">
                                    <ReceiptIcon size={32} className="text-surface-hover" />
                                </div>
                                <p className="text-white font-bold">Cart is empty</p>
                                <p className="text-sm text-moonstone mt-1">
                                    Scan or search to add items
                                </p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-3 bg-bg-navy border border-surface-hover rounded-lg flex items-center gap-3"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-white text-sm truncate">{item.name}</p>
                                        <p className="text-xs text-moonstone truncate">
                                            {item.variant} • {formatPrice(item.price)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => updateQuantity(item.id, -1)}
                                            className="w-7 h-7 rounded bg-surface-navy border border-surface-hover flex items-center justify-center text-white hover:text-primary transition-colors"
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <span className="w-6 text-center font-bold text-white text-sm">
                                            {item.quantity}
                                        </span>
                                        <button
                                            onClick={() => updateQuantity(item.id, 1)}
                                            className="w-7 h-7 rounded bg-surface-navy border border-surface-hover flex items-center justify-center text-white hover:text-primary transition-colors"
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        className="p-1.5 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors ml-1"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Discount */}
                    {cart.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-surface-hover">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-moonstone uppercase">Discount %</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={discount}
                                    onChange={(e) => setDiscount(Number(e.target.value))}
                                    className="bg-bg-navy border border-surface-hover text-white text-sm rounded px-2 py-1 w-16 text-center focus:ring-1 focus:ring-primary focus:border-primary"
                                />
                            </div>
                        </div>
                    )}

                    {/* Totals */}
                    <div className="mt-4 pt-4 border-t border-surface-hover space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-moonstone">Subtotal</span>
                            <span className="text-white font-medium">{formatPrice(subtotal)}</span>
                        </div>
                        {discount > 0 && (
                            <div className="flex justify-between text-sm text-green-400">
                                <span>Discount ({discount}%)</span>
                                <span>-{formatPrice(discountAmount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xl font-bold text-primary mt-2 pt-2 border-t border-surface-hover border-dashed">
                            <span>Total</span>
                            <span>{formatPrice(total)}</span>
                        </div>
                    </div>

                    {/* Payment Methods */}
                    {cart.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-surface-hover">
                            <p className="text-xs font-bold text-moonstone uppercase mb-2">Payment Method</p>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: "cash", label: "Cash", icon: Banknote },
                                    { id: "card", label: "Card", icon: CreditCard },
                                    { id: "upi", label: "UPI", icon: Smartphone },
                                ].map((method) => {
                                    const Icon = method.icon;
                                    const isSelected = paymentMethod === method.id;
                                    return (
                                        <button
                                            key={method.id}
                                            onClick={() => setPaymentMethod(method.id)}
                                            className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-all ${isSelected
                                                    ? "border-primary bg-primary text-bg-navy shadow-[0_0_10px_rgba(196,166,97,0.3)]"
                                                    : "border-surface-hover bg-bg-navy text-moonstone hover:border-moonstone/50 hover:text-white"
                                                }`}
                                        >
                                            <Icon size={18} />
                                            <span className="text-[10px] font-bold">{method.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Checkout Button */}
                    <button
                        onClick={processSale}
                        disabled={cart.length === 0 || !paymentMethod || isProcessing}
                        className="w-full mt-4 py-3 rounded-lg font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-primary hover:bg-primary/90 text-bg-navy shadow-[0_4px_15px_rgba(196,166,97,0.3)]"
                    >
                        {isProcessing ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-bg-navy"></span>
                                Processing...
                            </span>
                        ) : (
                            <>
                                Complete Sale • {formatPrice(total)}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Receipt Modal */}
            {showReceipt && lastTransaction && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
                        <div className="bg-bg-navy p-4 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">Sale Completed!</h3>
                            <button
                                onClick={() => setShowReceipt(false)}
                                className="p-1 hover:bg-white/10 rounded text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6">
                            {/* Receipt Preview */}
                            <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50 max-h-[50vh] overflow-y-auto shadow-inner">
                                <Receipt
                                    ref={receiptRef}
                                    transactionId={lastTransaction.id}
                                    items={lastTransaction.items.map((item) => ({
                                        name: item.name,
                                        variant: item.variant,
                                        quantity: item.quantity,
                                        unitPrice: item.price,
                                    }))}
                                    subtotal={lastTransaction.subtotal}
                                    discount={lastTransaction.discount}
                                    total={lastTransaction.total}
                                    paymentMethod={lastTransaction.paymentMethod}
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={printReceipt}
                                    className="flex-1 bg-primary text-bg-navy font-bold py-3 rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Printer size={18} />
                                    Print
                                </button>
                                <button
                                    onClick={() => setShowReceipt(false)}
                                    className="flex-1 bg-bg-navy text-white font-bold py-3 rounded-lg hover:bg-bg-navy/90 transition-colors"
                                >
                                    New Sale
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
