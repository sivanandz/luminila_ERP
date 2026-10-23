"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "@/components/layout";
import { Receipt } from "@/components/pos/Receipt";
import { PhonePePayment } from "@/components/pos/PhonePePayment";
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
    Clock,

    LogOut,
    Gift,
    Star,
    PauseCircle,
    History,
    User,

    Tag,
    Store,
    Building2,
} from "lucide-react";
import { getPOSLocations, type InventoryLocation } from "@/lib/multi-location";
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
import { usePOSShortcuts } from "@/hooks/use-pos-shortcuts";
import { getCustomers, type Customer, getTierDiscountPercent } from "@/lib/customers";
import {
    openShift,
    closeShift,
    getCurrentShift,
    calculateChange,

    type CashRegisterShift,
} from "@/lib/register";
import {
    earnPoints,
    calculatePointsToEarn,
    getLoyaltyAccount,
    getLoyaltySettings,
    calculateMaxRedeemablePoints,
    calculateRedemptionValue,
    redeemPoints,
    type LoyaltyAccount,
} from "@/lib/loyalty";
import { createPOSSale } from "@/lib/pos-sales";
import { includedTaxPaise } from "@/lib/invoice-math";
import { getStoreSettings } from "@/lib/settings";
import { GST_RATES } from "@/lib/gst";
import { getTypeAheadProducts, type ProductVariant } from "@/lib/products";
import { pb, sanitizeFilter } from "@/lib/pocketbase";
import { ClientResponseError } from "pocketbase";
import { subscribeRemoteCartItems, type POSCartBroadcastItem } from "@/lib/whatsapp-crm";
import { POSWhatsAppWidget, sendPOSReceiptViaWhatsApp } from "@/components/pos/POSWhatsAppWidget";
import { toast } from "sonner";
import {
    getChannelPrice,
    getConfiguredChannels,
    loadConfiguredChannels,
    type SalesChannelDef,
    isUpiDiscountEnabled,
    setUpiDiscountEnabled,
    DEFAULT_UPI_DISCOUNT_THRESHOLD,
} from "@/lib/channel-pricing";
import { MobileScanner } from "@/lib/mobile-scanner";


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
    basePrice?: number;
    priceAdjustment?: number;
    channelPrices?: Record<string, number>;
    quantity: number;
    stock?: number;
    remarks?: string;
    productId?: string;  // PocketBase product ID
    variantId?: string;  // PocketBase variant ID
    gst_rate?: number;   // GST rate from the product, captured at add time
    image?: string | null;
    hsn_code?: string;
}

// Product type for POS (simpler than ProductWithVariant for cart)
interface POSProduct {
    id: string;        // variant ID
    productId: string; // product ID
    sku: string;
    name: string;
    variant: string;
    price: number;
    basePrice?: number;
    priceAdjustment?: number;
    channelPrices?: Record<string, number>;
    stock: number;
    image?: string | null;
    hsn_code?: string;
    gst_rate?: number;
}

export interface HeldCart {
    id: string;
    name: string;
    timestamp: string;
    items: CartItem[];
    customer: Customer | null;
    discount: number;
    channel?: string;
}

export default function POSPage() {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [scannerEnabled, setScannerEnabled] = useState(false);
    const [discount, setDiscount] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
    const [upiDiscountEnabled, setUpiDiscountState] = useState<boolean>(() => isUpiDiscountEnabled());
    const [isProcessing, setIsProcessing] = useState(false);
    // Synchronous re-entrancy guard for processSale: state updates lag re-renders,
    // so key-repeat/double-tap checkout must be rejected via a ref instead.
    const isProcessingRef = useRef(false);

    // Sync external toggle events (e.g. from Settings or WhatsApp Widget)
    useEffect(() => {
        const handler = (e: Event) => {
            const custom = e as CustomEvent<{ enabled: boolean }>;
            if (custom.detail) setUpiDiscountState(custom.detail.enabled);
        };
        window.addEventListener("luminila:upi-discount-toggled", handler);
        return () => window.removeEventListener("luminila:upi-discount-toggled", handler);
    }, []);

    // Anti-Fraud Visual Match Audit State (Spec §4.2)
    const [antiFraudAuditItem, setAntiFraudAuditItem] = useState<{
        name: string;
        sku: string;
        price: number;
        image: string | null;
        hsn: string;
        timestamp: string;
    } | null>(null);

    // Products state

    const [searchResults, setSearchResults] = useState<POSProduct[]>([]);
    const [quickAddProducts, setQuickAddProducts] = useState<POSProduct[]>([]);
    const [, setIsLoadingProducts] = useState(false);
    const [gstRegistered, setGstRegistered] = useState(false);
    const [lastTransaction, setLastTransaction] = useState<{
        id: string;
        invoiceNumber?: string;
        items: CartItem[];
        subtotal: number;
        discount: number;
        total: number;
        paymentMethod: string;
        cashTendered?: number;
        changeGiven?: number;
    } | null>(null);
    const [showReceipt, setShowReceipt] = useState(false);
    const [showPhonePeModal, setShowPhonePeModal] = useState(false);
    const receiptRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Customer Selection & Wholesale Tiers State (BillWiz & InvenTree)
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showCustomerModal, setShowCustomerModal] = useState(false);
    const [customerSearchQuery, setCustomerSearchQuery] = useState("");
    const [customerList, setCustomerList] = useState<Customer[]>([]);
    const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

    // Sales Channel Selection State (Custom Channel Pricing)
    const [selectedChannel, setSelectedChannel] = useState<string>("pos");
    const selectedChannelRef = useRef<string>("pos");
    const [availableChannels, setAvailableChannels] = useState<SalesChannelDef[]>(getConfiguredChannels());

    useEffect(() => {
        loadConfiguredChannels().then(setAvailableChannels).catch(console.error);
    }, []);

    const handleChannelChange = (newChannel: string) => {
        setSelectedChannel(newChannel);
        selectedChannelRef.current = newChannel;
        // Recalculate price of all items in cart according to the newly selected channel
        setCart(prev => prev.map(item => {
            const prodData = {
                base_price: item.basePrice !== undefined ? item.basePrice : item.price,
                channel_prices: item.channelPrices,
            };
            const updatedPrice = getChannelPrice(prodData, newChannel, item.priceAdjustment || 0);
            return {
                ...item,
                price: updatedPrice,
            };
        }));
        // Update quick-add products display prices
        setQuickAddProducts(prev => prev.map(p => {
            const prodData = {
                base_price: p.basePrice !== undefined ? p.basePrice : p.price,
                channel_prices: p.channelPrices,
            };
            return {
                ...p,
                price: getChannelPrice(prodData, newChannel, p.priceAdjustment || 0),
            };
        }));
        // Update search results display prices
        setSearchResults(prev => prev.map(p => {
            const prodData = {
                base_price: p.basePrice !== undefined ? p.basePrice : p.price,
                channel_prices: p.channelPrices,
            };
            return {
                ...p,
                price: getChannelPrice(prodData, newChannel, p.priceAdjustment || 0),
            };
        }));
        const channelName = availableChannels.find(c => c.id === newChannel)?.name || newChannel;
        toast.info(`Switched active sales channel to "${channelName}"`);
    };

    // Cart Hold & Resume State (F8)
    const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
    const [showHeldCartsModal, setShowHeldCartsModal] = useState(false);

    // Line-Item Rate & Wholesale Override State (F4)
    const [showPriceOverrideModal, setShowPriceOverrideModal] = useState(false);
    const [overrideItem, setOverrideItem] = useState<CartItem | null>(null);
    const [overridePriceInput, setOverridePriceInput] = useState("");
    const [overrideDiscountInput, setOverrideDiscountInput] = useState("0");

    // Cash Register / Shift State
    const [currentShift, setCurrentShift] = useState<CashRegisterShift | null>(null);
    const [showOpenShiftDialog, setShowOpenShiftDialog] = useState(false);
    const [showCloseShiftDialog, setShowCloseShiftDialog] = useState(false);
    const [openingBalance, setOpeningBalance] = useState("");
    const [closingBalance, setClosingBalance] = useState("");
    const [varianceNotes, setVarianceNotes] = useState("");
    const [shiftLoading, setShiftLoading] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    // Cash Tender State
    const [cashTendered, setCashTendered] = useState("");

    // Multi-PoS Facility Counter State
    const [posLocations, setPosLocations] = useState<InventoryLocation[]>([]);
    const [selectedPosLocationId, setSelectedPosLocationId] = useState<string>("");

    useEffect(() => {
        getPOSLocations().then((locs) => {
            setPosLocations(locs);
            if (typeof window !== "undefined") {
                const userEmail = pb.authStore.model?.email?.trim().toLowerCase() || "default";
                const saved = localStorage.getItem(`luminila_active_pos_loc_${userEmail}`);
                if (saved && locs.some((l) => l.id === saved)) {
                    setSelectedPosLocationId(saved);
                    return;
                }
            }
            if (locs.length > 0) {
                setSelectedPosLocationId(locs[0].id);
            }
        }).catch(() => {});
    }, []);

    // WhatsApp CRM bridge (spec §3.3 / §8.3)
    const autoSendWhatsAppRef = useRef(false);

    // Loyalty State
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null);
    const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);
    const [maxRedeemablePoints, setMaxRedeemablePoints] = useState<number>(0);
    const [redemptionValue, setRedemptionValue] = useState<number>(0);
    const [pointsToEarn, setPointsToEarn] = useState<number>(0);

    // Auth & User State
    const { user } = useAuth();

    // Load current shift on mount
    useEffect(() => {
        const loadUserAndShift = async () => {
            if (user) {
                setUserId(user.id);
                try {
                    const shift = await getCurrentShift(user.id);
                    setCurrentShift(shift);
                    if (!shift) {
                        setShowOpenShiftDialog(true);
                    }
                } catch (err) {
                    console.error("Error loading shift:", err);
                }
            }
        };
        loadUserAndShift();
    }, [user]);

    // Handle opening a new shift
    const handleOpenShift = async () => {
        const balance = parseFloat(openingBalance);
        console.log("handleOpenShift called with:", { userId, openingBalance, parsedBalance: balance, user: user?.id });

        if (!userId) {
            console.error("Missing user ID");
            alert("User not logged in");
            return;
        }

        if (!openingBalance || isNaN(balance) || balance < 0) {
            console.error("Invalid opening balance:", { openingBalance, balance });
            alert("Please enter a valid opening balance (0 or greater)");
            return;
        }

        setShiftLoading(true);
        try {
            const shift = await openShift(userId, balance);
            setCurrentShift(shift);
            setShowOpenShiftDialog(false);
            setOpeningBalance("");
        } catch (error) {
            console.error("Error opening shift:", error);
            const errorMsg =
                error instanceof ClientResponseError
                    ? error.response?.data?.opening_balance?.message || error.message || "Failed to open shift"
                    : error instanceof Error
                      ? error.message || "Failed to open shift"
                      : "Failed to open shift";
            alert(errorMsg);
        } finally {
            setShiftLoading(false);
        }
    };

    // Handle closing the shift
    const handleCloseShift = async () => {
        if (!currentShift || !closingBalance) return;
        setShiftLoading(true);
        try {
            await closeShift(currentShift.id, parseFloat(closingBalance), varianceNotes);
            setCurrentShift(null);
            setShowCloseShiftDialog(false);
            setClosingBalance("");
            setVarianceNotes("");
            // Show open shift dialog for next shift
            setShowOpenShiftDialog(true);
        } catch (error) {
            console.error("Error closing shift:", error);
            alert("Failed to close shift");
        } finally {
            setShiftLoading(false);
        }
    };

    // Load quick-add products on mount
    useEffect(() => {
        const loadQuickAddProducts = async () => {
            try {
                const tenantEmail = pb.authStore.model?.email?.trim().toLowerCase();
                const tenantFilter = tenantEmail ? ` && account_email = "${sanitizeFilter(tenantEmail)}"` : '';
                const variants = await pb.collection('product_variants').getList<ProductVariant>(1, 8, {
                    filter: `product.is_active = true${tenantFilter}`,
                    expand: 'product',
                    sort: '-created',
                });
                const posProducts: POSProduct[] = [];
                for (const v of variants.items) {
                    const p = v.expand?.product;
                    if (!p || p.is_active === false) continue;
                    if (tenantEmail && ((v.account_email && v.account_email.toLowerCase() !== tenantEmail) || (p.account_email && p.account_email.toLowerCase() !== tenantEmail))) continue;
                    const basePrice = p?.base_price || 0;
                    const channelPrices = p?.channel_prices;
                    const priceAdjustment = v.price_adjustment || 0;
                    posProducts.push({
                        id: v.id,
                        productId: v.product,
                        sku: p?.sku ? `${p.sku}${v.sku_suffix ? '-' + v.sku_suffix : ''}` : v.id,
                        name: p?.name || 'Unknown Product',
                        variant: v.variant_name || 'Default',
                        price: getChannelPrice({ base_price: basePrice, channel_prices: channelPrices }, selectedChannelRef.current, priceAdjustment),
                        basePrice,
                        priceAdjustment,
                        channelPrices,
                        stock: v.stock_level || 0,
                        image: p?.image_data || p?.image_url || null,
                        hsn_code: p?.hsn_code || "71179010",
                        gst_rate: p?.gst_rate,
                    });
                }
                setQuickAddProducts(posProducts.filter(p => p.name !== 'Unknown Product'));
            } catch (err) {
                console.error('Error loading quick-add products:', err);
            }
        };
        loadQuickAddProducts();
    }, []);

    // Search products when query changes
    useEffect(() => {
        const searchProducts = async () => {
            if (!searchQuery || searchQuery.length < 2) {
                setSearchResults([]);
                return;
            }
            setIsLoadingProducts(true);
            try {
                const results = await getTypeAheadProducts(searchQuery);
                const posProducts: POSProduct[] = results.map(p => {
                    const basePrice = p.base_price ?? p.price;
                    const priceAdjustment = p.price_adjustment ?? 0;
                    return {
                        id: p.variant_id,
                        productId: p.id,
                        sku: p.full_sku,
                        name: p.name,
                        variant: p.variant_name,
                        price: getChannelPrice({ base_price: basePrice, channel_prices: p.channel_prices }, selectedChannelRef.current, priceAdjustment),
                        basePrice,
                        priceAdjustment,
                        channelPrices: p.channel_prices,
                        stock: p.stock,
                        image: p.image_data || p.image_url || null,
                        hsn_code: p.hsn_code || "71179010",
                        gst_rate: p.gst_rate,
                    };
                });
                setSearchResults(posProducts);
            } catch (err) {
                console.error('Error searching products:', err);
            } finally {
                setIsLoadingProducts(false);
            }
        };
        const debounce = setTimeout(searchProducts, 300);
        return () => clearTimeout(debounce);
    }, [searchQuery]);

    // Handle barcode scan
    const handleBarcodeScan = useCallback(async (code: string) => {
        console.log("Scanned barcode:", code);

        try {
            // Sanitize the raw scanner payload before it is interpolated into the
            // filter — arbitrary QR/DataMatrix content must not break or inject it.
            const safe = sanitizeFilter(code);
            const tenantEmail = pb.authStore.model?.email?.trim().toLowerCase();
            const tenantFilter = tenantEmail ? ` && account_email = "${sanitizeFilter(tenantEmail)}"` : '';

            // Exact matches first: bare variant suffix, product barcode, or a full
            // variant SKU ("<parent sku>-<suffix>"). Fuzzy contains-matching here
            // could resolve a scan to an arbitrary variant with the wrong price.
            let filter = `(sku_suffix="${safe}" || product.barcode="${safe}") && product.is_active=true${tenantFilter}`;
            const sep = code.lastIndexOf('-');
            if (sep > 0 && sep < code.length - 1) {
                filter = `((sku_suffix="${safe}" || product.barcode="${safe}") || (product.sku="${sanitizeFilter(code.slice(0, sep))}" && sku_suffix="${sanitizeFilter(code.slice(sep + 1))}")) && product.is_active=true${tenantFilter}`;
            }
            const exact = await pb.collection('product_variants').getList<ProductVariant>(1, 1, {
                filter,
                expand: 'product',
                sort: 'sku_suffix',
            });

            let v: ProductVariant | undefined;
            if (exact.items.length > 0) {
                v = exact.items[0];
            } else {
                // Parent-SKU scan (label without a suffix): exact parent match with a
                // deterministic variant order instead of an arbitrary fuzzy pick.
                const byParentSku = await pb.collection('product_variants').getList<ProductVariant>(1, 1, {
                    filter: `product.sku="${safe}" && product.is_active=true${tenantFilter}`,
                    expand: 'product',
                    sort: 'sku_suffix',
                });
                v = byParentSku.items[0];
            }

            if (v) {
                const p = v.expand?.product;
                if (tenantEmail && ((v.account_email && v.account_email.toLowerCase() !== tenantEmail) || (p?.account_email && p.account_email.toLowerCase() !== tenantEmail))) {
                    toast.error("This product belongs to another tenant/account.");
                    return;
                }
                if (p?.is_active === false) {
                    toast.error(`"${p?.name || code}" is marked inactive and cannot be sold.`);
                    return;
                }
                const stock = v.stock_level ?? 0;
                if (stock <= 0) {
                    toast.error(`"${p?.name || code}" is out of stock (0 available).`);
                    return;
                }
                const basePrice = p?.base_price || 0;
                const priceAdjustment = v.price_adjustment || 0;
                const posProduct: POSProduct = {
                    id: v.id,
                    productId: v.product,
                    sku: p?.sku ? `${p.sku}${v.sku_suffix ? '-' + v.sku_suffix : ''}` : v.id,
                    name: p?.name || 'Unknown Product',
                    variant: v.variant_name || 'Default',
                    price: getChannelPrice({ base_price: basePrice, channel_prices: p?.channel_prices }, selectedChannelRef.current, priceAdjustment),
                    basePrice,
                    priceAdjustment,
                    channelPrices: p?.channel_prices,
                    stock: stock,
                    image: p?.image_data || p?.image_url || null,
                    hsn_code: p?.hsn_code || "71179010",
                };
                addToCart(posProduct);
            } else {
                console.log("Product not found for code:", code);
                alert(`Product not found: ${code}`);
            }
        } catch (err) {
            console.error('Barcode scan error:', err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- addToCart is a stable useCallback (empty deps) declared below this callback, so it never changes identity and listing it here would evaluate the binding before initialization (TDZ)
    }, []);

    // Add item to cart
    const addToCart = useCallback((product: POSProduct) => {
        if (product.stock !== undefined && product.stock <= 0) {
            toast.error(`"${product.name}" is out of stock (0 available).`);
            return;
        }

        let maxStockReached = false;
        setCart((prev) => {
            const existing = prev.find((item) => item.sku === product.sku);
            const availableStock = product.stock ?? existing?.stock;
            if (existing) {
                if (availableStock !== undefined && existing.quantity >= availableStock) {
                    maxStockReached = true;
                    return prev;
                }
                return prev.map((item) =>
                    item.sku === product.sku
                        ? { ...item, quantity: item.quantity + 1, stock: availableStock }
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
                    basePrice: product.basePrice,
                    priceAdjustment: product.priceAdjustment,
                    channelPrices: product.channelPrices,
                    quantity: 1,
                    stock: product.stock,
                    productId: product.productId,
                    variantId: product.id,
                    image: product.image || null,
                    hsn_code: product.hsn_code || "71179010",
                    gst_rate: product.gst_rate,
                },
            ];
        });

        if (maxStockReached) {
            toast.warning(`Maximum available stock reached for "${product.name}" (${product.stock} available).`);
            return;
        }

        // Trigger anti-fraud visual match audit
        setAntiFraudAuditItem({
            name: product.name,
            sku: product.sku,
            price: product.price,
            image: product.image || null,
            hsn: product.hsn_code || "71179010",
            timestamp: new Date().toLocaleTimeString(),
        });

        setSearchQuery("");
        setShowSearch(false);
    }, []);

    // Hardware wedge barcode scanner listener (auto-detects USB/Bluetooth barcode guns)
    useEffect(() => {
        if (showCustomerModal || showPriceOverrideModal || showHeldCartsModal || showPhonePeModal) {
            return;
        }
        const unsubscribe = MobileScanner.registerContext("pos_billing", (result) => {
            handleBarcodeScan(result.barcode);
            return true;
        }, 40);
        return () => unsubscribe();
    }, [handleBarcodeScan, showCustomerModal, showPriceOverrideModal, showHeldCartsModal, showPhonePeModal]);

    // Update quantity
    const updateQuantity = (id: string, delta: number) => {
        setCart((prev) => {
            const target = prev.find((item) => item.id === id);
            if (target && delta > 0 && target.stock !== undefined && target.quantity + delta > target.stock) {
                toast.warning(`Maximum available stock reached for "${target.name}" (${target.stock} available).`);
                return prev;
            }
            return prev
                .map((item) =>
                    item.id === id
                        ? { ...item, quantity: Math.max(0, item.quantity + delta) }
                        : item
                )
                .filter((item) => item.quantity > 0);
        });
    };

    // Remove item
    const removeItem = (id: string) => {
        setCart((prev) => prev.filter((item) => item.id !== id));
    };

    // Update remarks for an item
    const updateRemarks = (id: string, remarks: string) => {
        setCart((prev) =>
            prev.map((item) =>
                item.id === id ? { ...item, remarks } : item
            )
        );
    };

    // Clear cart
    const clearCart = () => {
        setCart([]);
        setDiscount(0);
        setPaymentMethod(null);
        setShowPhonePeModal(false);
        // Reset loyalty redemption so it can never carry into the next sale
        setPointsToRedeem(0);
        setRedemptionValue(0);
    };

    // Remote "Add to POS Cart" from WhatsApp surfaces (spec §8.3)
    useEffect(() => {
        const unsubscribe = subscribeRemoteCartItems((item: POSCartBroadcastItem) => {
            setCart((prev) => {
                const existing = prev.find((c) => c.sku === item.sku);
                if (existing) {
                    const targetQty = existing.quantity + (item.quantity || 1);
                    const clampedQty = existing.stock !== undefined ? Math.min(targetQty, existing.stock) : targetQty;
                    return prev.map((c) =>
                        c.sku === item.sku
                            ? { ...c, quantity: clampedQty }
                            : c
                    );
                }
                return [
                    ...prev,
                    {
                        id: generateId(),
                        sku: item.sku,
                        name: item.name,
                        variant: item.variant,
                        price: item.price,
                        quantity: item.quantity || 1,
                        productId: item.productId,
                        variantId: item.variantId,
                    },
                ];
            });
            toast.success(`Added ${item.quantity || 1}x ${item.sku} from WhatsApp chat${item.addedByName ? ` (${item.addedByName})` : ''}`, {
                description: item.name,
            });
        });
        return unsubscribe;
    }, []);

    // Whether the store is GST registered decides whether the cart shows the
    // tax that is already inside the quoted price.
    useEffect(() => {
        let cancelled = false;
        getStoreSettings()
            .then((settings) => {
                if (!cancelled) {
                    setGstRegistered(settings.isGstRegistered !== false);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountAmount = (subtotal * discount) / 100;
    const loyaltyDiscount = redemptionValue;  // Points redemption value
    const total = Math.max(0, subtotal - discountAmount - loyaltyDiscount);
    const gstIncluded = gstRegistered
        ? includedTaxPaise(
            cart.map((item) => ({
                grossPaise: Math.round(item.price * item.quantity * 100),
                gstRate: item.gst_rate ?? GST_RATES.JEWELRY,
            })),
            Math.round((discountAmount + loyaltyDiscount) * 100)
        ) / 100
        : 0;
    const changeAmount = cashTendered ? calculateChange(total, parseFloat(cashTendered) || 0) : 0;

    // Update points calculations when total or customer changes
    useEffect(() => {
        // Guard against out-of-order responses: a slow fetch for a previous
        // customer/cart state must never overwrite the current one's data.
        let cancelled = false;
        const updateLoyaltyCalculations = async () => {
            if (selectedCustomerId) {
                const account = await getLoyaltyAccount(selectedCustomerId);
                if (cancelled) return;
                setLoyaltyAccount(account);
                if (account && subtotal > 0) {
                    const earnablePoints = await calculatePointsToEarn(subtotal - discountAmount, account.tier);
                    const maxPoints = await calculateMaxRedeemablePoints(subtotal - discountAmount, account.current_balance);
                    if (cancelled) return;
                    setPointsToEarn(earnablePoints);
                    setMaxRedeemablePoints(maxPoints);
                }
            } else {
                setLoyaltyAccount(null);
                setPointsToEarn(0);
                setMaxRedeemablePoints(0);
            }
        };
        updateLoyaltyCalculations();
        return () => { cancelled = true; };
    }, [selectedCustomerId, subtotal, discountAmount]);

    // Update redemption value when points to redeem changes
    useEffect(() => {
        let cancelled = false;
        const updateRedemption = async () => {
            if (pointsToRedeem > 0) {
                const value = await calculateRedemptionValue(pointsToRedeem);
                if (cancelled) return;
                setRedemptionValue(value);
            } else {
                setRedemptionValue(0);
            }
        };
        updateRedemption();
        return () => { cancelled = true; };
    }, [pointsToRedeem]);

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

    // Customer live search
    useEffect(() => {
        if (!showCustomerModal) return;
        const fetchCusts = async () => {
            setIsLoadingCustomers(true);
            try {
                const list = await getCustomers({ search: customerSearchQuery });
                setCustomerList(list);
            } catch (err) {
                console.error("Error fetching customers for POS:", err);
            } finally {
                setIsLoadingCustomers(false);
            }
        };
        const t = setTimeout(fetchCusts, 200);
        return () => clearTimeout(t);
    }, [customerSearchQuery, showCustomerModal]);

    const handleSelectCustomer = (cust: Customer) => {
        setSelectedCustomer(cust);
        setSelectedCustomerId(cust.id);
        // A redemption belongs to the previously selected customer — never carry it over
        setPointsToRedeem(0);
        setRedemptionValue(0);
        setShowCustomerModal(false);

        const tierDiscount = getTierDiscountPercent(cust.tier, cust.customer_type);
        if (tierDiscount > 0) {
            setDiscount(tierDiscount);
            toast.success(`Applied ${tierDiscount}% ${cust.tier || cust.customer_type} wholesale discount!`);
        } else {
            toast.info(`Selected customer: ${cust.name}`);
        }
    };

    const handleClearCustomer = () => {
        setSelectedCustomer(null);
        setSelectedCustomerId(null);
        setPointsToRedeem(0);
        setRedemptionValue(0);
        setDiscount(0);
        toast.info("Switched to Walk-in Customer");
    };

    const handleParkCart = () => {
        if (cart.length === 0) {
            if (heldCarts.length > 0) {
                setShowHeldCartsModal(true);
            } else {
                toast.error("Cart is empty. Nothing to park.");
            }
            return;
        }

        const newHeld: HeldCart = {
            id: generateId(),
            name: selectedCustomer ? selectedCustomer.name : `Walk-in (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
            timestamp: new Date().toISOString(),
            items: [...cart],
            customer: selectedCustomer,
            discount: discount,
            channel: selectedChannel,
        };

        setHeldCarts(prev => [newHeld, ...prev]);
        clearCart();
        setSelectedCustomer(null);
        setSelectedCustomerId(null);
        toast.success(`Parked cart for ${newHeld.name} (${newHeld.items.length} items)`);
    };

    const handleResumeCart = (heldId: string) => {
        const target = heldCarts.find(h => h.id === heldId);
        if (!target) return;
        setCart(target.items);
        setSelectedCustomer(target.customer);
        setSelectedCustomerId(target.customer?.id || null);
        setDiscount(target.discount || 0);
        if (target.channel) {
            setSelectedChannel(target.channel);
            selectedChannelRef.current = target.channel;
        }
        // Held carts don't store a redemption — never carry one over
        setPointsToRedeem(0);
        setRedemptionValue(0);
        setHeldCarts(prev => prev.filter(h => h.id !== heldId));
        setShowHeldCartsModal(false);
        toast.success(`Resumed cart for ${target.name}!`);
    };

    const handleDeleteHeldCart = (heldId: string) => {
        setHeldCarts(prev => prev.filter(h => h.id !== heldId));
        toast.info("Deleted parked cart");
    };

    const handleOpenPriceOverride = (item?: CartItem) => {
        const target = item || (cart.length > 0 ? cart[cart.length - 1] : null);
        if (!target) {
            toast.error("Add an item to cart first to override price");
            return;
        }
        setOverrideItem(target);
        setOverridePriceInput(target.price.toString());
        setOverrideDiscountInput("0");
        setShowPriceOverrideModal(true);
    };

    const handleApplyPriceOverride = () => {
        if (!overrideItem) return;
        const newPrice = parseFloat(overridePriceInput);
        const discPct = parseFloat(overrideDiscountInput) || 0;
        if (isNaN(newPrice) || newPrice < 0) {
            toast.error("Invalid price value");
            return;
        }
        const finalPrice = discPct > 0 ? Math.round(newPrice * (1 - discPct / 100)) : newPrice;
        setCart(prev => prev.map(c => c.id === overrideItem.id ? { ...c, price: finalPrice } : c));
        setShowPriceOverrideModal(false);
        toast.success(`Updated rate for ${overrideItem.name} to ₹${formatPrice(finalPrice)}`);
    };

    // Keyboard Shortcuts Listener (BillWiz feature)
    usePOSShortcuts({
        onSearchFocus: () => {
            setShowSearch(true);
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 50);
        },
        onCustomerModal: () => {
            setShowCustomerModal(prev => !prev);
        },
        onPriceOverride: () => {
            handleOpenPriceOverride();
        },
        onHoldCart: () => {
            handleParkCart();
        },
        onTenderPay: () => {
            if (cart.length > 0) {
                if (!paymentMethod) setPaymentMethod('cash');
                toast.info("Tender checkout activated (F9)");
            }
        },
        onPrintComplete: () => {
            if (showReceipt && lastTransaction) {
                printReceipt();
            } else if (cart.length > 0 && paymentMethod) {
                processSale();
            }
        },
        onEscape: () => {
            setShowCustomerModal(false);
            setShowHeldCartsModal(false);
            setShowPriceOverrideModal(false);
            setShowSearch(false);
        },
    });

    // Process sale
    const processSale = async () => {
        // Re-entrancy guard: the keyboard shortcut path (F12) and rapid clicks can
        // fire again during the createPOSSale await — state alone updates too late,
        // so a duplicate sale/double stock deduction must be rejected synchronously.
        if (isProcessingRef.current) return;
        if (!paymentMethod || cart.length === 0 || !currentShift || !userId) return;

        // Pre-flight validation: verify no cart items exceed available stock
        const oversoldItem = cart.find(item => item.stock !== undefined && item.quantity > item.stock);
        if (oversoldItem) {
            toast.error(`Cannot complete sale: "${oversoldItem.name}" exceeds available stock (${oversoldItem.quantity} in cart, ${oversoldItem.stock} in stock).`);
            return;
        }

        // If PhonePe is selected, show the PhonePe modal
        if (paymentMethod === 'phonepe') {
            setShowPhonePeModal(true);
            return;
        }

        setIsProcessing(true);
        isProcessingRef.current = true;

        try {
            // Pre-commit loyalty validation: reject an invalid redemption BEFORE
            // the sale is recorded so it can never throw after commit.
            if (selectedCustomerId && pointsToRedeem > 0) {
                const account = await getLoyaltyAccount(selectedCustomerId);
                const settings = await getLoyaltySettings();
                if (!account || pointsToRedeem > account.current_balance) {
                    toast.error('Insufficient loyalty points balance for this redemption. Sale cancelled — please adjust and retry.');
                    setPointsToRedeem(0);
                    setRedemptionValue(0);
                    return;
                }
                if (pointsToRedeem < settings.min_redemption_points) {
                    toast.error(`Minimum ${settings.min_redemption_points} points required for redemption. Sale cancelled — please adjust and retry.`);
                    setPointsToRedeem(0);
                    setRedemptionValue(0);
                    return;
                }
            }

            // Save sale to PocketBase and generate invoice
            const result = await createPOSSale({
                channel: selectedChannel as import('@/types/database').SalesChannel,
                items: cart.map(item => ({
                    ...item,
                    productId: item.productId,
                    variantId: item.variantId,
                })),
                subtotal,
                discountPercent: discount,
                discountAmount,
                loyaltyDiscount: redemptionValue,
                total,
                paymentMethod: paymentMethod as 'cash' | 'card' | 'upi' | 'phonepe',
                cashTendered: paymentMethod === 'cash' ? parseFloat(cashTendered) || 0 : undefined,
                changeGiven: paymentMethod === 'cash' ? changeAmount : undefined,
                customerId: selectedCustomer?.id || selectedCustomerId || undefined,
                customerName: selectedCustomer?.name || undefined,
                customerPhone: selectedCustomer?.phone || undefined,
                shiftId: currentShift.id,
                userId,
                locationId: selectedPosLocationId,
                pointsRedeemed: pointsToRedeem,
                pointsEarned: pointsToEarn,
            });

            // Handle loyalty points
            // Surface inventory warnings from the sale (e.g. oversell clamps)
            if (result.warnings?.length) {
                result.warnings.forEach(w => toast.warning(w));
            }

            // Loyalty updates run AFTER the sale is committed — a failure here
            // must not be reported as a failed sale (retrying would double-sell).
            try {
                if (selectedCustomerId && pointsToRedeem > 0) {
                    await redeemPoints(selectedCustomerId, pointsToRedeem, result.saleId, 'POS redemption');
                }
                if (selectedCustomerId && pointsToEarn > 0) {
                    await earnPoints(selectedCustomerId, total, result.saleId, 'POS purchase');
                }
            } catch (loyaltyError) {
                console.error('Loyalty update failed after sale was committed:', loyaltyError);
                toast.warning('Sale completed, but updating loyalty points failed.');
            }

            // Save transaction for receipt
            setLastTransaction({
                id: result.transactionId,
                invoiceNumber: result.invoiceNumber,
                items: [...cart],
                subtotal,
                discount: discountAmount + redemptionValue,
                total,
                paymentMethod,
                cashTendered: paymentMethod === 'cash' ? parseFloat(cashTendered) || 0 : undefined,
                changeGiven: paymentMethod === 'cash' ? changeAmount : undefined,
            });

            // Reload shift to get updated totals
            const updatedShift = await getCurrentShift(userId);
            setCurrentShift(updatedShift);

            setShowReceipt(true);
            clearCart();

            // Auto-send receipt via WhatsApp (spec §3.3 checkbox)
            if (autoSendWhatsAppRef.current && selectedCustomerId) {
                sendPOSReceiptViaWhatsApp({
                    customerId: selectedCustomerId,
                    invoiceNumber: result.invoiceNumber,
                    total,
                    paymentMethod,
                    pointsEarned: pointsToEarn,
                }).catch((err) => console.warn('WhatsApp auto-send failed:', err));
            }
        } catch (error) {
            console.error('Error processing sale:', error);
            alert('Failed to process sale. Please try again.');
        } finally {
            isProcessingRef.current = false;
            setIsProcessing(false);
        }
    };

    // Handle PhonePe payment success
    const handlePhonePeSuccess = async (transactionId: string, phonePeTransactionId?: string) => {
        setShowPhonePeModal(false);

        if (!currentShift || !userId) {
            console.error('No active shift or user');
            return;
        }

        // Pre-flight validation: verify no cart items exceed available stock
        const oversoldItem = cart.find(item => item.stock !== undefined && item.quantity > item.stock);
        if (oversoldItem) {
            toast.error(`Cannot complete sale: "${oversoldItem.name}" exceeds available stock (${oversoldItem.quantity} in cart, ${oversoldItem.stock} in stock).`);
            return;
        }

        setIsProcessing(true);

        try {
            // Save sale to PocketBase and generate invoice
            const result = await createPOSSale({
                channel: selectedChannel as import('@/types/database').SalesChannel,
                items: cart.map(item => ({
                    ...item,
                    productId: item.productId,
                    variantId: item.variantId,
                })),
                subtotal,
                discountPercent: discount,
                discountAmount,
                loyaltyDiscount: redemptionValue,
                total,
                paymentMethod: 'phonepe',
                customerId: selectedCustomer?.id || selectedCustomerId || undefined,
                customerName: selectedCustomer?.name || undefined,
                customerPhone: selectedCustomer?.phone || undefined,
                shiftId: currentShift.id,
                userId,
                notes: phonePeTransactionId ? `PhonePe: ${phonePeTransactionId}` : undefined,
                pointsRedeemed: pointsToRedeem,
                pointsEarned: pointsToEarn,
            });

            // Handle loyalty points
            // Surface inventory warnings from the sale (e.g. oversell clamps)
            if (result.warnings?.length) {
                result.warnings.forEach(w => toast.warning(w));
            }

            // Loyalty updates run AFTER the sale is committed — a failure here
            // must not be reported as a failed sale (the payment was received).
            try {
                if (selectedCustomerId && pointsToRedeem > 0) {
                    await redeemPoints(selectedCustomerId, pointsToRedeem, result.saleId, 'POS redemption');
                }
                if (selectedCustomerId && pointsToEarn > 0) {
                    await earnPoints(selectedCustomerId, total, result.saleId, 'POS purchase');
                }
            } catch (loyaltyError) {
                console.error('Loyalty update failed after sale was committed:', loyaltyError);
                toast.warning('Sale completed, but updating loyalty points failed.');
            }

            setLastTransaction({
                id: result.transactionId,
                invoiceNumber: result.invoiceNumber,
                items: [...cart],
                subtotal,
                discount: discountAmount + redemptionValue,
                total,
                paymentMethod: 'phonepe',
            });

            // Reload shift to get updated totals
            const updatedShift = await getCurrentShift(userId);
            setCurrentShift(updatedShift);

            setShowReceipt(true);
            clearCart();

            if (autoSendWhatsAppRef.current && selectedCustomerId) {
                sendPOSReceiptViaWhatsApp({
                    customerId: selectedCustomerId,
                    invoiceNumber: result.invoiceNumber,
                    total,
                    paymentMethod: 'phonepe',
                    pointsEarned: pointsToEarn,
                }).catch((err) => console.warn('WhatsApp auto-send failed:', err));
            }
        } catch (error) {
            console.error('Error processing PhonePe sale:', error);
            alert('Payment received but failed to record sale. Please contact support.');
        } finally {
            setIsProcessing(false);
        }
    };

    // Handle PhonePe payment failure
    const handlePhonePeFailure = (error: string) => {
        setShowPhonePeModal(false);
        console.error("PhonePe payment failed:", error);
        // Keep cart intact so user can retry with different payment method
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Point of Sale" subtitle="Quick checkout for walk-in customers" />

            {/* Shift Status Bar - Always visible */}
            <div className="mx-3 md:mx-6 mt-2 mb-0 bg-surface-navy border border-surface-hover rounded-lg px-3 md:px-4 py-2 flex flex-wrap items-center justify-between gap-2 md:gap-3">
                {currentShift ? (
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                            <span className="text-sm text-moonstone">Shift Active</span>
                        </div>
                        <span className="text-xs text-white font-medium">
                            {user?.name || user?.email || 'Unknown User'}
                        </span>
                        <span className="text-xs text-moonstone">
                            Started {new Date(currentShift.opened_at).toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-primary font-mono">
                            Cash Sales: {formatPrice(currentShift.total_cash_sales)}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                        <span className="text-sm text-moonstone">No Active Shift</span>
                        <span className="text-xs text-muted-foreground">Start a shift to begin making sales</span>
                    </div>
                )}

                <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                    {/* Multi-PoS Facility Station Selector */}
                    {posLocations.length > 0 && (
                        <div className="flex items-center gap-1.5 bg-bg-navy px-2.5 py-1 rounded-md border border-surface-hover">
                            <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="text-[11px] text-moonstone font-semibold uppercase tracking-wider hidden sm:inline">Station:</span>
                            <Select
                                value={selectedPosLocationId}
                                onValueChange={(val) => {
                                    if (!val) return;
                                    setSelectedPosLocationId(val);
                                    if (typeof window !== "undefined") {
                                        const userEmail = pb.authStore.model?.email?.trim().toLowerCase() || "default";
                                        localStorage.setItem(`luminila_active_pos_loc_${userEmail}`, val);
                                    }
                                    const locName = posLocations.find(l => l.id === val)?.name || val;
                                    toast.info(`POS selling station locked to: ${locName}`);
                                }}
                            >
                                <SelectTrigger className="h-7 bg-surface-navy text-xs text-foreground border border-surface-hover rounded px-2 py-0.5 focus:ring-1 focus:ring-primary font-medium cursor-pointer min-w-[130px] max-w-[240px]">
                                    <SelectValue placeholder="Station">
                                        {(() => {
                                            const loc = posLocations.find(l => l.id === selectedPosLocationId);
                                            return loc ? `[${loc.code}] ${loc.name}` : selectedPosLocationId;
                                        })()}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border text-popover-foreground z-50">
                                    {posLocations.map((loc) => (
                                        <SelectItem key={loc.id} value={loc.id} className="text-xs cursor-pointer py-1.5">
                                            [{loc.code}] {loc.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Sales Channel Selector */}
                    <div className="flex items-center gap-2 bg-bg-navy px-2.5 py-1 rounded-md border border-surface-hover">
                        <Store className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-[11px] text-moonstone font-semibold uppercase tracking-wider hidden sm:inline">Channel:</span>
                        <Select
                            value={selectedChannel}
                            onValueChange={(val) => {
                                if (val) handleChannelChange(val);
                            }}
                        >
                            <SelectTrigger className="h-7 bg-surface-navy text-xs text-foreground border border-surface-hover rounded px-2 py-0.5 focus:ring-1 focus:ring-primary font-medium cursor-pointer min-w-[150px] max-w-[240px]" suppressHydrationWarning>
                                <SelectValue placeholder="Channel" suppressHydrationWarning>
                                    {(() => {
                                        const c = availableChannels.find(chan => chan.id === selectedChannel);
                                        return c ? `${c.name}${c.discountPreset ? ` (${c.discountPreset > 0 ? '+' : ''}${c.discountPreset}%)` : ''}` : selectedChannel;
                                    })()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border text-popover-foreground z-50">
                                {availableChannels.map((c) => (
                                    <SelectItem key={c.id} value={c.id} className="text-xs cursor-pointer py-1.5">
                                        {c.name} {c.discountPreset ? `(${c.discountPreset > 0 ? '+' : ''}${c.discountPreset}%)` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedChannel !== 'pos' && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium shrink-0">
                                Custom Rates
                            </span>
                        )}
                    </div>

                    {currentShift ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCloseShiftDialog(true)}
                            className="text-moonstone hover:text-red-400"
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            End Shift
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={() => setShowOpenShiftDialog(true)}
                        >
                            <Clock className="w-4 h-4 mr-2" />
                            Start Shift
                        </Button>
                    )}
                </div>
            </div>

            {/* High-Speed POS Hotkey Bar (BillWiz) - Desktop Only */}
            <div className="mx-3 md:mx-6 mt-2 mb-1 px-3 py-1.5 bg-bg-navy/90 border border-surface-hover/80 rounded-lg hidden md:flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <span className="text-moonstone font-semibold text-[11px] uppercase tracking-wider">Hotkeys:</span>
                    <button
                        onClick={() => {
                            setShowSearch(true);
                            setTimeout(() => searchInputRef.current?.focus(), 50);
                        }}
                        className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover hover:border-primary cursor-pointer text-[11px]"
                    >
                        <kbd className="text-primary font-bold">F2</kbd> Search
                    </button>
                    <button
                        onClick={() => setShowCustomerModal(true)}
                        className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover hover:border-primary cursor-pointer text-[11px]"
                    >
                        <kbd className="text-primary font-bold">F3</kbd> Customer: {selectedCustomer ? selectedCustomer.name.split(' ')[0] : 'Walk-in'}
                    </button>
                    <button
                        onClick={() => handleOpenPriceOverride()}
                        className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover hover:border-primary cursor-pointer text-[11px]"
                    >
                        <kbd className="text-primary font-bold">F4</kbd> Rate Override
                    </button>
                    <button
                        onClick={handleParkCart}
                        className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover hover:border-primary cursor-pointer text-[11px]"
                    >
                        <kbd className="text-primary font-bold">F8</kbd> Park Cart ({heldCarts.length})
                    </button>
                    <button
                        onClick={() => {
                            if (cart.length > 0 && !paymentMethod) setPaymentMethod('cash');
                        }}
                        className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover hover:border-primary cursor-pointer text-[11px]"
                    >
                        <kbd className="text-primary font-bold">F9</kbd> Pay
                    </button>
                    <span className="inline-flex items-center gap-1 font-mono text-moonstone bg-surface-navy px-1.5 py-0.5 rounded border border-surface-hover text-[11px]">
                        <kbd className="text-primary font-bold">F12</kbd> Print
                    </span>
                </div>
                <div className="text-[11px] text-moonstone/80 font-mono">
                    High-Speed POS Mode
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 p-3 md:p-6 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
                {/* Left Panel - Product Search & Scanner */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                    {/* Scanner Area */}
                    <div className="bg-surface-navy rounded-xl border border-surface-hover flex-1 flex flex-col p-4 md:p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-white">Scan or Search</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setScannerEnabled(!scannerEnabled)}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors ${scannerEnabled
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
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
                                        ref={searchInputRef}
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
                                        {searchResults.map((product) => {
                                            const inCart = cart.find(c => c.sku === product.sku);
                                            const cartQty = inCart ? inCart.quantity : 0;
                                            const isOutOfStock = product.stock <= 0;
                                            const isMaxInCart = product.stock > 0 && cartQty >= product.stock;
                                            const isDisabled = isOutOfStock || isMaxInCart;

                                            return (
                                                <button
                                                    key={product.id}
                                                    onClick={() => !isDisabled && addToCart(product)}
                                                    disabled={isDisabled}
                                                    className={`w-full p-3 flex items-center justify-between transition-colors text-left ${
                                                        isDisabled
                                                            ? 'opacity-50 cursor-not-allowed bg-bg-navy/40'
                                                            : 'hover:bg-surface-hover'
                                                    }`}
                                                >
                                                    <div>
                                                        <p className="font-bold text-white text-sm">{product.name}</p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-xs text-moonstone">
                                                                {product.sku} • {product.variant}
                                                            </span>
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                                isOutOfStock
                                                                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                                                    : isMaxInCart
                                                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                            }`}>
                                                                {isOutOfStock ? '0 in stock' : isMaxInCart ? 'Max in cart' : `Stock: ${product.stock}`}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <p className="font-bold text-primary">
                                                        {formatPrice(product.price)}
                                                    </p>
                                                </button>
                                            );
                                        })}
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
                                        Click &quot;Start Scanner&quot; to enable camera
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Quick Add Buttons */}
                        <div className="mt-4 grid grid-cols-4 gap-3">
                            {quickAddProducts.length === 0 ? (
                                <p className="col-span-4 text-center text-moonstone text-sm py-4">
                                    No products found. Add products in Inventory.
                                </p>
                            ) : (
                                quickAddProducts.slice(0, 4).map((product) => {
                                    const inCart = cart.find(c => c.sku === product.sku);
                                    const cartQty = inCart ? inCart.quantity : 0;
                                    const isOutOfStock = product.stock <= 0;
                                    const isMaxInCart = product.stock > 0 && cartQty >= product.stock;
                                    const isDisabled = isOutOfStock || isMaxInCart;

                                    return (
                                        <button
                                            key={product.id}
                                            onClick={() => !isDisabled && addToCart(product)}
                                            disabled={isDisabled}
                                            className={`p-3 bg-bg-navy border rounded-lg transition-all text-left group relative ${
                                                isDisabled
                                                    ? 'opacity-50 cursor-not-allowed border-surface-hover bg-bg-navy/40'
                                                    : 'border-surface-hover hover:border-primary/50 hover:bg-bg-navy/80'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] text-moonstone truncate font-mono">
                                                    {product.sku}
                                                </p>
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                                    isOutOfStock
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : isMaxInCart
                                                        ? 'bg-amber-500/20 text-amber-300'
                                                        : 'bg-surface-hover text-moonstone'
                                                }`}>
                                                    {isOutOfStock ? '0 left' : isMaxInCart ? 'Max' : `${product.stock} left`}
                                                </span>
                                            </div>
                                            <p className="font-bold text-white text-sm truncate mt-0.5 group-hover:text-primary transition-colors">{product.name}</p>
                                            <p className="text-xs text-white mt-1">
                                                {formatPrice(product.price)}
                                            </p>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Panel - Cart */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover flex flex-col p-4 md:p-6 col-span-1">
                    <div className="flex items-center justify-between mb-3">
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

                    {/* Customer Selector & Wholesale Tier Indicator (BillWiz & InvenTree) */}
                    <div className="mb-3 p-2.5 bg-bg-navy rounded-lg border border-surface-hover flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                            <User className="w-4 h-4 text-primary shrink-0" />
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-white truncate">
                                        {selectedCustomer ? selectedCustomer.name : "Walk-in Customer"}
                                    </span>
                                    {selectedCustomer?.tier && (
                                        <Badge variant="outline" className="text-[10px] text-primary border-primary/40 uppercase">
                                            {selectedCustomer.tier}
                                        </Badge>
                                    )}
                                </div>
                                {selectedCustomer?.phone && (
                                    <span className="text-[11px] text-moonstone font-mono">{selectedCustomer.phone}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowCustomerModal(true)}
                                className="h-7 text-xs px-2 text-moonstone hover:text-white"
                                title="Change Customer (F3)"
                            >
                                <span className="font-mono text-[10px] text-primary mr-1">[F3]</span>
                                {selectedCustomer ? "Change" : "Select"}
                            </Button>
                            {selectedCustomer && (
                                <button
                                    onClick={handleClearCustomer}
                                    className="text-muted-foreground hover:text-red-400 p-1"
                                    title="Clear Customer"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Park Cart (F8) and Held Carts Bar */}
                    <div className="flex items-center justify-between mb-3">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleParkCart}
                            disabled={cart.length === 0}
                            className="h-7 text-xs gap-1 border-surface-hover hover:border-primary text-moonstone hover:text-white"
                            title="Park Current Cart (F8)"
                        >
                            <span className="font-mono text-[10px] text-primary mr-0.5">[F8]</span>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                            Park Cart
                        </Button>
                        {heldCarts.length > 0 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowHeldCartsModal(true)}
                                className="h-7 text-xs gap-1 text-amber-400 hover:text-amber-300 bg-amber-400/10"
                            >
                                <History className="w-3.5 h-3.5" />
                                Held Carts ({heldCarts.length})
                            </Button>
                        )}
                    </div>

                    {/* POS Real-Time Anti-Fraud Visual Match Audit Card (Architecture Spec §4.2) */}
                    {antiFraudAuditItem && (
                        <div className="bg-bg-navy/95 border-2 border-emerald-500/50 rounded-xl p-3 shadow-xl mb-3 animate-in slide-in-from-top-2 fade-in relative">
                            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-surface-hover/50">
                                <div className="flex items-center gap-2">
                                    <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                                        Anti-Fraud Visual Match Confirmed
                                    </span>
                                </div>
                                <button
                                    onClick={() => setAntiFraudAuditItem(null)}
                                    className="text-moonstone hover:text-white p-0.5 rounded transition-colors"
                                    title="Dismiss"
                                >
                                    <X size={13} />
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* 120x120 Hero Thumbnail */}
                                <div className="size-20 rounded-lg overflow-hidden border border-emerald-500/40 bg-black/60 shrink-0 relative flex items-center justify-center shadow-md">
                                    {antiFraudAuditItem.image ? (
                                        <Image
                                            src={antiFraudAuditItem.image}
                                            alt={antiFraudAuditItem.name}
                                            width={80}
                                            height={80}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-moonstone/50 text-center p-1">
                                            <Tag size={20} />
                                            <span className="text-[8px] mt-1">No Photo Bound</span>
                                        </div>
                                    )}
                                    <span className="absolute bottom-1 right-1 text-[7px] font-mono bg-black/80 text-emerald-300 px-1 py-0.2 rounded font-bold">
                                        HERO
                                    </span>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] font-mono text-primary font-bold truncate">
                                        {antiFraudAuditItem.sku}
                                    </div>
                                    <div className="text-xs font-bold text-white truncate mt-0.5">
                                        {antiFraudAuditItem.name}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs font-mono font-bold text-gold">
                                            MRP ₹{antiFraudAuditItem.price.toLocaleString("en-IN")}
                                        </span>
                                        <span className="text-[9px] text-amber-300 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                            HSN {antiFraudAuditItem.hsn} (3% GST)
                                        </span>
                                    </div>
                                    <div className="text-[9px] text-emerald-400 flex items-center gap-1 mt-1 font-medium">
                                        ✓ Tag matches physical item • Ticket-switching protected
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

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
                                    className="p-3 bg-bg-navy border border-surface-hover rounded-lg space-y-2"
                                >
                                    <div className="flex items-center gap-3">
                                        {item.image && (
                                            <div className="size-10 rounded-md overflow-hidden border border-surface-hover shrink-0 bg-black/40">
                                                <Image src={item.image} alt={item.name} width={40} height={40} className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-white text-sm truncate">{item.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                <span className="text-xs text-moonstone truncate">
                                                    {item.variant} • {formatPrice(item.price)}
                                                </span>
                                                {item.channelPrices && item.channelPrices[selectedChannel] !== undefined && (
                                                    <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-primary/20 text-primary border border-primary/30" title={`Channel rate: ₹${formatPrice(item.price)}`}>
                                                        {availableChannels.find(c => c.id === selectedChannel)?.name || selectedChannel}
                                                    </span>
                                                )}
                                                {item.stock !== undefined && (
                                                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                                        item.quantity >= item.stock
                                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                            : 'bg-surface-navy text-moonstone border border-surface-hover'
                                                    }`}>
                                                        Stock: {item.stock}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => handleOpenPriceOverride(item)}
                                                    className="text-[10px] text-primary hover:underline font-mono bg-primary/10 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                                                    title="Override Unit Price / Line Discount (F4)"
                                                >
                                                    <Tag size={10} />
                                                    [F4 Rate]
                                                </button>
                                            </div>
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
                                                disabled={item.stock !== undefined && item.quantity >= item.stock}
                                                className={`w-7 h-7 rounded bg-surface-navy border border-surface-hover flex items-center justify-center transition-colors ${
                                                    item.stock !== undefined && item.quantity >= item.stock
                                                        ? 'opacity-40 cursor-not-allowed text-moonstone'
                                                        : 'text-white hover:text-primary'
                                                }`}
                                                title={item.stock !== undefined && item.quantity >= item.stock ? `Maximum stock reached (${item.stock} available)` : "Increase quantity"}
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
                                    {/* Remarks Input */}
                                    <input
                                        type="text"
                                        placeholder="Add note (e.g., gift wrap, engraving)..."
                                        value={item.remarks || ""}
                                        onChange={(e) => updateRemarks(item.id, e.target.value)}
                                        className="w-full h-8 px-3 text-xs bg-surface-navy border border-surface-hover rounded text-white placeholder-moonstone/50 focus:ring-1 focus:ring-primary focus:border-primary"
                                    />
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
                                    onChange={(e) => setDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
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
                        {loyaltyDiscount > 0 && (
                            <div className="flex justify-between text-sm text-purple-400">
                                <span className="flex items-center gap-1">
                                    <Star className="w-3 h-3" />
                                    Points Redeemed ({pointsToRedeem})
                                </span>
                                <span>-{formatPrice(loyaltyDiscount)}</span>
                            </div>
                        )}
                        {gstIncluded > 0 && (
                            <div className="flex justify-between text-xs text-moonstone">
                                <span>GST included in total</span>
                                <span>{formatPrice(gstIncluded)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xl font-bold text-primary mt-2 pt-2 border-t border-surface-hover border-dashed">
                            <span>Total</span>
                            <span>{formatPrice(total)}</span>
                        </div>
                        {/* Points to Earn */}
                        {cart.length > 0 && pointsToEarn > 0 && (
                            <div className="flex justify-between text-xs text-green-400 bg-green-500/10 rounded px-2 py-1">
                                <span className="flex items-center gap-1">
                                    <Gift className="w-3 h-3" />
                                    Points You&apos;ll Earn
                                </span>
                                <span className="font-bold">+{pointsToEarn}</span>
                            </div>
                        )}
                    </div>

                    {/* Loyalty Points Redemption */}
                    {loyaltyAccount && maxRedeemablePoints > 0 && cart.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-surface-hover">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-bold text-moonstone uppercase flex items-center gap-1">
                                    <Star className="w-3 h-3 text-purple-400" />
                                    Redeem Points
                                </p>
                                <span className="text-xs text-purple-400">
                                    Balance: {loyaltyAccount.current_balance.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min="0"
                                    max={maxRedeemablePoints}
                                    step="10"
                                    value={pointsToRedeem}
                                    onChange={(e) => setPointsToRedeem(parseInt(e.target.value))}
                                    className="flex-1 h-2 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-purple-500"
                                />
                                <span className="text-white font-mono text-sm w-16 text-right">
                                    {pointsToRedeem}
                                </span>
                            </div>
                            {pointsToRedeem > 0 && (
                                <p className="text-xs text-green-400 mt-1">
                                    Save {formatPrice(redemptionValue)} on this order
                                </p>
                            )}
                        </div>
                    )}

                    {/* Payment Methods */}
                    {cart.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-surface-hover">
                            <p className="text-xs font-bold text-moonstone uppercase mb-2">Payment Method</p>
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { id: "cash", label: "Cash", icon: Banknote },
                                    { id: "card", label: "Card", icon: CreditCard },
                                    { id: "upi", label: "UPI", icon: Smartphone },
                                    { id: "phonepe", label: "PhonePe", icon: null, isPhonePe: true },
                                ].map((method) => {
                                    const Icon = method.icon;
                                    const isSelected = paymentMethod === method.id;
                                    return (
                                        <button
                                            key={method.id}
                                            onClick={() => setPaymentMethod(method.id)}
                                            className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-all ${isSelected
                                                ? method.isPhonePe
                                                    ? "border-[#5f259f] bg-[#5f259f] text-white shadow-[0_0_10px_rgba(95,37,159,0.3)]"
                                                    : "border-primary bg-primary text-primary-foreground shadow-[0_0_10px_rgba(196,166,97,0.3)]"
                                                : "border-surface-hover bg-bg-navy text-moonstone hover:border-moonstone/50 hover:text-white"
                                                }`}
                                        >
                                            {method.isPhonePe ? (
                                                <span className="font-bold text-sm">Pe</span>
                                            ) : (
                                                Icon && <Icon size={18} />
                                            )}
                                            <span className="text-[10px] font-bold">{method.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* UPI < ₹2,000 Zero-MDR Surcharge Discount Option */}
                            {(paymentMethod === "upi" || paymentMethod === "phonepe") && total > 0 && total < DEFAULT_UPI_DISCOUNT_THRESHOLD && (
                                <div className="mt-2.5 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs animate-in fade-in">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={upiDiscountEnabled}
                                                onChange={(e) => {
                                                    const val = e.target.checked;
                                                    setUpiDiscountState(val);
                                                    setUpiDiscountEnabled(val);
                                                }}
                                                className="accent-emerald-500 rounded"
                                            />
                                            <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                                                ⚡ UPI &lt; ₹2,000 Zero-MDR Surcharge Discount
                                            </span>
                                        </label>
                                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                            {upiDiscountEnabled ? "Active (0% Surcharge)" : "Disabled"}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-emerald-400/80 mt-1 leading-tight">
                                        {upiDiscountEnabled
                                            ? "RBI/NPCI zero-MDR rule: Merchant surcharge waived for UPI under ₹2,000. Customer pays ₹0 surcharge."
                                            : "Feature disabled: Standard merchant surcharge policy applies."}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Cash Tender Input (when cash is selected) */}
                    {paymentMethod === "cash" && cart.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-surface-hover">
                            <p className="text-xs font-bold text-moonstone uppercase mb-2">Cash Tendered</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone">₹</span>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={cashTendered}
                                        onChange={(e) => setCashTendered(e.target.value)}
                                        className="w-full h-10 pl-8 bg-bg-navy border border-surface-hover text-white rounded-lg focus:ring-1 focus:ring-primary focus:border-primary"
                                    />
                                </div>
                                <div className="bg-surface-hover rounded-lg flex items-center justify-center">
                                    <span className="text-moonstone text-sm">Change: </span>
                                    <span className="text-primary font-bold ml-1 text-lg">{formatPrice(changeAmount)}</span>
                                </div>
                            </div>
                            {/* Quick tender buttons */}
                            <div className="grid grid-cols-4 gap-2 mt-2">
                                {[total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4).map((amount) => (
                                    <button
                                        key={amount}
                                        onClick={() => setCashTendered(amount.toString())}
                                        className="py-2 px-2 bg-bg-navy border border-surface-hover rounded text-xs text-moonstone hover:text-white hover:border-primary transition-colors"
                                    >
                                        {formatPrice(amount)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* WhatsApp Checkout Messenger (spec §3.3) */}
                    <POSWhatsAppWidget
                        mode="pre-sale"
                        customerId={selectedCustomerId}
                        total={total}
                        paymentMethod={paymentMethod || undefined}
                        autoSendRef={autoSendWhatsAppRef}
                    />

                    {/* Checkout Button */}
                    <button
                        onClick={processSale}
                        disabled={cart.length === 0 || !paymentMethod || isProcessing}
                        className="w-full mt-4 py-3 rounded-lg font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_4px_15px_rgba(196,166,97,0.3)]"
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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-navy rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-surface-hover">
                        <div className="bg-bg-navy p-4 flex items-center justify-between border-b border-surface-hover">
                            <h3 className="text-lg font-bold text-white">Sale Completed!</h3>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowReceipt(false)}
                                className="text-moonstone hover:text-white hover:bg-white/10"
                            >
                                <X size={20} />
                            </Button>
                        </div>

                        <div className="p-6">
                            {/* Receipt Preview */}
                            <div className="border border-surface-hover rounded-lg p-4 mb-6 bg-white max-h-[50vh] overflow-y-auto shadow-inner">
                                <Receipt
                                    ref={receiptRef}
                                    transactionId={lastTransaction.id}
                                    items={lastTransaction.items.map((item) => ({
                                        name: item.name,
                                        variant: item.variant,
                                        quantity: item.quantity,
                                        unitPrice: item.price,
                                        remarks: item.remarks,
                                    }))}
                                    subtotal={lastTransaction.subtotal}
                                    discount={lastTransaction.discount}
                                    total={lastTransaction.total}
                                    paymentMethod={lastTransaction.paymentMethod}
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <Button
                                    onClick={printReceipt}
                                    className="flex-1"
                                >
                                    <Printer size={18} className="mr-2" />
                                    Print
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setShowReceipt(false)}
                                    className="flex-1"
                                >
                                    New Sale
                                </Button>
                            </div>

                            {/* WhatsApp receipt dispatch (spec §3.3 / §5) */}
                            {selectedCustomerId && (
                                <div className="flex gap-3 mt-3">
                                    <POSWhatsAppWidget
                                        mode="receipt"
                                        customerId={selectedCustomerId}
                                        total={lastTransaction.total}
                                        invoiceNumber={lastTransaction.invoiceNumber}
                                        paymentMethod={lastTransaction.paymentMethod}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Open Shift Dialog */}
            <Dialog open={showOpenShiftDialog} onOpenChange={setShowOpenShiftDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <Clock className="w-5 h-5 text-primary" />
                            Start Your Shift
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <p className="text-moonstone text-sm">
                            Count your cash drawer and enter the opening balance to start your shift.
                        </p>
                        <div className="space-y-2">
                            <Label className="text-white">Opening Cash Balance</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone">₹</span>
                                <Input
                                    type="number"
                                    placeholder="0.00"
                                    value={openingBalance}
                                    onChange={(e) => setOpeningBalance(e.target.value)}
                                    className="pl-8 bg-bg-navy border-surface-hover text-white"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={handleOpenShift}
                            disabled={shiftLoading || !openingBalance}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {shiftLoading ? "Opening..." : "Start Shift"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Close Shift Dialog */}
            <Dialog open={showCloseShiftDialog} onOpenChange={setShowCloseShiftDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <LogOut className="w-5 h-5 text-red-400" />
                            End Your Shift
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {currentShift && (
                            <div className="bg-bg-navy rounded-lg p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-moonstone">Opening Balance</span>
                                    <span className="text-white font-mono">{formatPrice(currentShift.opening_balance)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-moonstone">Cash Sales</span>
                                    <span className="text-green-400 font-mono">+{formatPrice(currentShift.total_cash_sales)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-moonstone">Refunds</span>
                                    <span className="text-red-400 font-mono">-{formatPrice(currentShift.total_cash_refunds)}</span>
                                </div>
                                <div className="border-t border-surface-hover pt-2 flex justify-between font-bold">
                                    <span className="text-white">Expected Balance</span>
                                    <span className="text-primary font-mono">
                                        {formatPrice(
                                            currentShift.opening_balance +
                                            currentShift.total_cash_sales -
                                            currentShift.total_cash_refunds +
                                            currentShift.cash_added -
                                            currentShift.cash_removed
                                        )}
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label className="text-white">Actual Closing Balance</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone">₹</span>
                                <Input
                                    type="number"
                                    placeholder="Count your drawer..."
                                    value={closingBalance}
                                    onChange={(e) => setClosingBalance(e.target.value)}
                                    className="pl-8 bg-bg-navy border-surface-hover text-white"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-white">Notes (optional)</Label>
                            <Input
                                placeholder="Any variance explanation..."
                                value={varianceNotes}
                                onChange={(e) => setVarianceNotes(e.target.value)}
                                className="bg-bg-navy border-surface-hover text-white"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCloseShiftDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCloseShift}
                            disabled={shiftLoading || !closingBalance}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {shiftLoading ? "Closing..." : "End Shift"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* PhonePe Payment Modal */}
            <PhonePePayment
                isOpen={showPhonePeModal}
                onClose={() => setShowPhonePeModal(false)}
                onSuccess={handlePhonePeSuccess}
                onFailure={handlePhonePeFailure}
                amount={total}
                orderId={generateId()}
            />

            {/* Customer Selection Modal (F3 / Wholesale Tiers) */}
            <Dialog open={showCustomerModal} onOpenChange={setShowCustomerModal}>
                <DialogContent className="bg-card-bg border-surface-hover text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white text-lg">
                            <User className="w-5 h-5 text-gold" />
                            Select Customer / Wholesale Partner
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moonstone" />
                            <Input
                                placeholder="Search by name, phone or company..."
                                value={customerSearchQuery}
                                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                                className="pl-9 bg-bg-navy border-surface-hover text-white"
                                autoFocus
                            />
                        </div>

                        {selectedCustomer && (
                            <div className="flex items-center justify-between p-3 rounded-lg bg-gold/10 border border-gold/30">
                                <div>
                                    <p className="text-sm font-semibold text-gold">Currently Selected: {selectedCustomer.name}</p>
                                    <p className="text-xs text-moonstone">{selectedCustomer.phone} • Tier: {selectedCustomer.tier || selectedCustomer.customer_type || 'Retail'}</p>
                                </div>
                                <Button size="sm" variant="outline" onClick={handleClearCustomer} className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs">
                                    Switch to Walk-in
                                </Button>
                            </div>
                        )}

                        <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                            {isLoadingCustomers ? (
                                <p className="text-sm text-moonstone text-center py-4">Searching customers...</p>
                            ) : customerList.length === 0 ? (
                                <p className="text-sm text-moonstone text-center py-4">No customers found.</p>
                            ) : (
                                customerList.map((cust) => {
                                    const tierPct = getTierDiscountPercent(cust.tier, cust.customer_type);
                                    return (
                                        <div
                                            key={cust.id}
                                            onClick={() => handleSelectCustomer(cust)}
                                            className="flex items-center justify-between p-3 rounded-lg border border-surface-hover hover:border-gold/50 hover:bg-surface-hover/30 cursor-pointer transition-colors"
                                        >
                                            <div>
                                                <p className="text-sm font-medium text-white">{cust.name}</p>
                                                <p className="text-xs text-moonstone">{cust.phone || "No phone"} {cust.email ? `• ${cust.email}` : ""}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {tierPct > 0 ? (
                                                    <Badge className="bg-gold/20 text-gold border-gold/40 text-xs">
                                                        {cust.tier?.toUpperCase() || cust.customer_type?.toUpperCase()} ({tierPct}% OFF)
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-moonstone text-xs">
                                                        Retail
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCustomerModal(false)}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Held / Parked Carts Modal (F8) */}
            <Dialog open={showHeldCartsModal} onOpenChange={setShowHeldCartsModal}>
                <DialogContent className="bg-card-bg border-surface-hover text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white text-lg">
                            <PauseCircle className="w-5 h-5 text-amber-400" />
                            Parked Carts Queue (F8)
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2 max-h-72 overflow-y-auto">
                        {heldCarts.length === 0 ? (
                            <div className="text-center py-8 text-moonstone">
                                <History className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">No parked carts in memory.</p>
                                <p className="text-xs text-moonstone/70 mt-1">Press F8 with items in cart to park a sale anytime.</p>
                            </div>
                        ) : (
                            heldCarts.map((h) => {
                                const cartTotal = h.items.reduce((s, i) => s + i.price * i.quantity, 0);
                                return (
                                    <div
                                        key={h.id}
                                        className="p-3.5 rounded-lg border border-surface-hover bg-bg-navy/60 flex items-center justify-between"
                                    >
                                        <div>
                                            <p className="text-sm font-semibold text-white">{h.name}</p>
                                            <p className="text-xs text-moonstone mt-0.5">
                                                {h.items.length} items • ₹{formatPrice(cartTotal)} • {new Date(h.timestamp).toLocaleTimeString()}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                onClick={() => handleResumeCart(h.id)}
                                                className="bg-gold hover:bg-gold-light text-navy-dark text-xs font-semibold px-3"
                                            >
                                                Resume
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleDeleteHeldCart(h.id)}
                                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowHeldCartsModal(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Line-Item Price & Rate Override Modal (F4) */}
            <Dialog open={showPriceOverrideModal} onOpenChange={setShowPriceOverrideModal}>
                <DialogContent className="bg-card-bg border-surface-hover text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white text-lg">
                            <Tag className="w-5 h-5 text-gold" />
                            Negotiated Rate Override (F4)
                        </DialogTitle>
                    </DialogHeader>
                    {overrideItem && (
                        <div className="space-y-4 py-2">
                            <div className="p-3 rounded-lg bg-surface-hover/30 border border-surface-hover">
                                <p className="text-sm font-semibold text-white">{overrideItem.name}</p>
                                <p className="text-xs text-moonstone">SKU: {overrideItem.sku} • Original: ₹{formatPrice(overrideItem.price)}</p>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs text-moonstone uppercase tracking-wider font-semibold">Custom Unit Price (₹)</Label>
                                <Input
                                    type="number"
                                    value={overridePriceInput}
                                    onChange={(e) => setOverridePriceInput(e.target.value)}
                                    className="bg-bg-navy border-surface-hover text-white font-mono"
                                    placeholder="Enter new unit price..."
                                    autoFocus
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs text-moonstone uppercase tracking-wider font-semibold">Special Line Discount (%)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={overrideDiscountInput}
                                    onChange={(e) => setOverrideDiscountInput(e.target.value)}
                                    className="bg-bg-navy border-surface-hover text-white font-mono"
                                    placeholder="0"
                                />
                            </div>

                            <div className="p-3 rounded-lg bg-gold/10 border border-gold/30 flex justify-between items-center text-sm">
                                <span className="text-moonstone">Calculated Final Rate:</span>
                                <span className="font-bold text-gold text-base">
                                    ₹{formatPrice(
                                        Math.max(0, (parseFloat(overridePriceInput) || 0) * (1 - (parseFloat(overrideDiscountInput) || 0) / 100))
                                    )}
                                </span>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPriceOverrideModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleApplyPriceOverride}
                            className="bg-gold hover:bg-gold-light text-navy-dark font-semibold"
                        >
                            Apply Override
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}



