"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout";
import {
    whatsappManager,
    checkWPPConnectStatus,
    parseOrderFromMessage,
    generateAutoReply,
} from "@/lib/whatsapp";
import type { WPPMessage, WPPChat } from "@/lib/whatsapp";
import { supabase } from "@/lib/supabase";
import { findMatchingProducts, generateImageHash } from "@/lib/image-matcher";
import {
    MessageCircle,
    Wifi,
    WifiOff,
    Send,
    User,
    Clock,
    Package,
    AlertCircle,
    Phone,
    Video,
    MoreVertical,
    CheckCheck,
    Loader2,
    Image as ImageIcon,
    FileText,
    Link as LinkIcon,
    Mic,
    PlayCircle,
    Search,
    Plus,
    Minus,
    Trash2,
    ShoppingCart,
    CreditCard,
    RefreshCw,
    Sparkles,
    Check,
    LayoutGrid,
    ListOrdered,
    UserCircle,
    UserPlus,
    Tag,
    ExternalLink,
    Store
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import {
    findCustomerByPhone,
    createCustomerFromChat,
    getCustomerOrders,
    phoneFromChatId,
    type Customer,
    type CustomerOrder
} from "@/lib/customer-lookup";
import { getCategories, type Category } from "@/lib/categories";
import { getAttributes, type ProductAttribute } from "@/lib/attributes";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

// --- Types ---

interface Message {
    id: string;
    from: string;
    fromName: string;
    body: string;
    timestamp: Date;
    isOrder: boolean;
    fromMe: boolean;
    type?: string;
    mediaUrl?: string;
    caption?: string;
    mimetype?: string;
    filename?: string;
    parsed?: ReturnType<typeof parseOrderFromMessage>;
    // Quoted/reply message support
    quotedMsg?: {
        id: string;
        body: string;
        type: string;
        caption?: string;
        sender?: string;
        mediaUrl?: string;
        mimetype?: string;
    };
}

interface ChatListItem {
    id: string;
    name: string;
    lastMessage: string;
    timestamp: number;
    unreadCount: number;
    isGroup: boolean;
    profilePic?: string | null;
}

interface Product {
    id: string;
    sku: string;
    name: string;
    base_price: number;
    stock: number;
    image_url: string | null;
}

interface CartItem extends Product {
    quantity: number;
}

interface ImageMatch {
    product: Product;
    similarity: number;
}

// --- Components ---

function MessageContent({ msg, onLoadMedia, onFindSimilar }: {
    msg: Message;
    onLoadMedia?: (messageId: string) => Promise<string | null>;
    onFindSimilar?: (imageUrl: string) => void;
}) {
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
    const [searching, setSearching] = useState(false);
    const [showLightbox, setShowLightbox] = useState(false);
    const type = msg.type || "chat";
    const isMediaType = ["image", "sticker", "video", "ptt", "audio", "document"].includes(type);

    // Load media ONCE when component mounts (for media types)
    useEffect(() => {
        if (!isMediaType || !onLoadMedia || status !== 'idle') return;

        setStatus('loading');

        onLoadMedia(msg.id)
            .then(url => {
                if (url) {
                    setMediaUrl(url);
                    setStatus('loaded');
                } else {
                    setStatus('failed');
                }
            })
            .catch(() => setStatus('failed'));
    }, [msg.id, isMediaType, onLoadMedia, status]);

    if (type === "image" || type === "sticker") {
        return (
            <div className="space-y-2">
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-muted-foreground p-3">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading image...</span>
                    </div>
                )}
                {status === 'loaded' && mediaUrl && (
                    <div className="relative group">
                        <img
                            src={mediaUrl}
                            alt="Image"
                            className="max-w-full rounded-lg max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setShowLightbox(true)}
                            onError={() => setStatus('failed')}
                        />
                        {onFindSimilar && !msg.fromMe && (
                            <button
                                onClick={() => {
                                    if (mediaUrl) {
                                        setSearching(true);
                                        onFindSimilar(mediaUrl);
                                        setTimeout(() => setSearching(false), 2000);
                                    }
                                }}
                                disabled={searching}
                                className="absolute bottom-2 right-2 bg-primary/90 hover:bg-primary text-primary-foreground text-xs px-2 py-1 rounded-lg flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                            >
                                {searching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                Find Similar
                            </button>
                        )}
                    </div>
                )}
                {status === 'failed' && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <ImageIcon size={16} />
                        <span className="text-sm italic">Failed to load image</span>
                    </div>
                )}
                {(msg.caption || (msg.body && msg.body !== mediaUrl)) && <p className="text-sm leading-relaxed">{msg.caption || msg.body}</p>}

                {/* Lightbox Modal */}
                {showLightbox && mediaUrl && (
                    <div
                        className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
                        onClick={() => setShowLightbox(false)}
                    >
                        <button
                            className="absolute top-4 right-4 text-white text-3xl hover:text-primary"
                            onClick={() => setShowLightbox(false)}
                        >
                            &times;
                        </button>
                        <img
                            src={mediaUrl}
                            alt="Full size"
                            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                            onClick={e => e.stopPropagation()}
                        />
                    </div>
                )}
            </div>
        );
    }

    if (type === "video") {
        return (
            <div className="space-y-2">
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-muted-foreground p-3">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading video...</span>
                    </div>
                )}
                {status === 'loaded' && mediaUrl && (
                    <video
                        src={mediaUrl}
                        controls
                        className="max-w-full rounded-lg max-h-64"
                        onClick={e => e.stopPropagation()}
                    />
                )}
                {status === 'failed' && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 p-2 rounded">
                        <PlayCircle size={16} /> <span className="text-sm italic">Video (failed to load)</span>
                    </div>
                )}
                {status === 'idle' && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 p-2 rounded">
                        <PlayCircle size={16} /> <span className="text-sm italic">Video Message</span>
                    </div>
                )}
            </div>
        );
    }

    if (type === "ptt" || type === "audio") {
        return (
            <div className="space-y-2">
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-muted-foreground p-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading audio...</span>
                    </div>
                )}
                {status === 'loaded' && mediaUrl && (
                    <audio src={mediaUrl} controls className="w-full max-w-xs" />
                )}
                {status === 'failed' && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 p-2 rounded">
                        <Mic size={16} /> <span className="text-sm italic">Voice Message (failed to load)</span>
                    </div>
                )}
                {status === 'idle' && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 p-2 rounded">
                        <Mic size={16} /> <span className="text-sm italic">Voice Message</span>
                    </div>
                )}
            </div>
        );
    }

    if (type === "document") {
        return (
            <div className="space-y-2">
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-muted-foreground p-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading document...</span>
                    </div>
                )}
                {status === 'loaded' && mediaUrl && (
                    <a
                        href={mediaUrl}
                        download={msg.filename || 'document'}
                        className="flex items-center gap-2 text-green-700 hover:text-green-600 bg-muted/20 p-3 rounded hover:bg-muted/30 transition-colors"
                        onClick={e => e.stopPropagation()}
                    >
                        <FileText size={20} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{msg.filename || 'Document'}</p>
                            <p className="text-xs text-muted-foreground">Click to download</p>
                        </div>
                    </a>
                )}
                {(status === 'failed' || status === 'idle') && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 p-2 rounded">
                        <FileText size={16} />
                        <span className="text-sm italic">{msg.filename || 'Document'}</span>
                    </div>
                )}
            </div>
        );
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const hasLinks = msg.body && urlRegex.test(msg.body);

    // Helper to render the quoted message block
    const QuotedBlock = () => {
        if (!msg.quotedMsg) return null;

        const isMediaQuote = ['image', 'sticker', 'video', 'ptt', 'audio', 'document'].includes(msg.quotedMsg.type);

        // Handle click to scroll to quoted message
        const handleQuoteClick = () => {
            if (msg.quotedMsg?.id) {
                // Try to find element by ID (IDs may contain special chars)
                const quotedId = msg.quotedMsg.id;
                let quotedElement = document.getElementById(`msg-${quotedId}`);

                // Fallback: search by data attribute if direct ID doesn't work
                if (!quotedElement) {
                    quotedElement = document.querySelector(`[data-msg-id="${CSS.escape(quotedId)}"]`) as HTMLElement;
                }

                if (quotedElement) {
                    quotedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    quotedElement.classList.add('ring-2', 'ring-primary');
                    setTimeout(() => quotedElement?.classList.remove('ring-2', 'ring-primary'), 2000);
                } else {
                    console.log('Quoted message not found:', quotedId);
                }
            }
        };

        return (
            <div
                onClick={handleQuoteClick}
                className={`mb-2 border-l-2 pl-2 py-1 text-xs rounded cursor-pointer hover:opacity-80 transition-opacity flex gap-2 ${msg.fromMe ? 'border-primary-foreground/50 bg-primary/20' : 'border-primary/50 bg-muted/50'}`}
            >
                {/* Image thumbnail for media quotes */}
                {isMediaQuote && msg.quotedMsg.type === 'image' && (
                    <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-muted">
                        {msg.quotedMsg.mediaUrl ? (
                            <img
                                src={msg.quotedMsg.mediaUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                        ) : (
                            <ImageIcon size={16} className="w-full h-full p-2 text-muted-foreground" />
                        )}
                    </div>
                )}

                <div className="flex-1 min-w-0">
                    {msg.quotedMsg.sender && (
                        <p className="font-semibold opacity-80 truncate">{msg.quotedMsg.sender}</p>
                    )}
                    <p className="opacity-70 line-clamp-2">
                        {isMediaQuote && msg.quotedMsg.type !== 'image'
                            ? `📎 ${msg.quotedMsg.type === 'ptt' ? 'Voice message' : msg.quotedMsg.type === 'video' ? 'Video' : msg.quotedMsg.type === 'document' ? 'Document' : msg.quotedMsg.type}`
                            : isMediaQuote && msg.quotedMsg.type === 'image'
                                ? (msg.quotedMsg.caption || '📷 Photo')
                                : (msg.quotedMsg.body || msg.quotedMsg.caption || '')
                        }
                    </p>
                </div>
            </div>
        );
    };

    if (hasLinks) {
        const parts = msg.body.split(urlRegex);
        return (
            <div>
                <QuotedBlock />
                <p className="text-sm leading-relaxed">
                    {parts.map((part, i) =>
                        urlRegex.test(part) ? (
                            <a key={i} href={part} target="_blank" rel="noopener noreferrer"
                                className="text-green-700 hover:text-green-600 hover:underline break-all font-medium">
                                {part}
                            </a>
                        ) : part
                    )}
                </p>
            </div>
        );
    }

    return (
        <div>
            <QuotedBlock />
            <p className="text-sm leading-relaxed">{msg.body}</p>
        </div>
    );
}

// --- Main Page ---

export default function WhatsAppPage() {
    // WhatsApp State
    const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
    const [sessionStatus, setSessionStatus] = useState<"disconnected" | "connecting" | "qr" | "connected">("disconnected");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
    const [phoneNumber, setPhoneNumber] = useState('918884377789');
    const [pairingLoading, setPairingLoading] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [chats, setChats] = useState<ChatListItem[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);
    const [selectedChat, setSelectedChat] = useState<string | null>(null);
    const [selectedChatMessages, setSelectedChatMessages] = useState<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [replyText, setReplyText] = useState("");
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);

    // Attachment State
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
    const [sendingAttachment, setSendingAttachment] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Voice Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const audioChunksRef = React.useRef<Blob[]>([]);
    const recordingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

    // Concierge State
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [cart, setCart] = useState<CartItem[]>([]);
    const [orderLoading, setOrderLoading] = useState(false);
    const [addedToast, setAddedToast] = useState<string | null>(null); // Shows "Added: Product Name"
    const [imageMatches, setImageMatches] = useState<ImageMatch[]>([]);
    const [showMatchModal, setShowMatchModal] = useState(false);

    // Sidebar State
    const [activePanel, setActivePanel] = useState<'concierge' | 'cart' | 'customer' | 'orders' | 'catalog'>('concierge');
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
    const [loadingCustomer, setLoadingCustomer] = useState(false);

    // Add Product Modal State
    const [showAddProductModal, setShowAddProductModal] = useState(false);
    const [addProductForm, setAddProductForm] = useState({
        sku: '',
        name: '',
        description: '',
        category: '',
        hsn_code: '7117',
        base_price: 0,
        cost_price: 0,
        image_url: '',
        initial_stock: 0
    });
    const [addingProduct, setAddingProduct] = useState(false);
    const [selectedMessageImage, setSelectedMessageImage] = useState<string | null>(null);
    const [productCategories, setProductCategories] = useState<Category[]>([]);
    const [productAttributes, setProductAttributes] = useState<ProductAttribute[]>([]);
    const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});

    // P2: Parent-Child SKU Structure
    const [isVariant, setIsVariant] = useState(false);
    const [selectedParentProduct, setSelectedParentProduct] = useState<Product | null>(null);

    // Initial Load
    const loadExistingChats = useCallback(async () => {
        setLoadingChats(true);
        try {
            const fetchedChats = await whatsappManager.getChats();
            const chatList: ChatListItem[] = await Promise.all(fetchedChats.map(async (chat) => {
                // Fetch profile pic for each chat
                let profilePic: string | null = null;
                try {
                    profilePic = await whatsappManager.getProfilePic(chat.id);
                } catch { /* ignore */ }

                return {
                    id: chat.id,
                    name: chat.name,
                    lastMessage: chat.lastMessage?.body || "",
                    timestamp: chat.lastMessage?.timestamp || chat.timestamp,
                    unreadCount: chat.unreadCount,
                    isGroup: chat.isGroup,
                    profilePic
                };
            }));
            chatList.sort((a, b) => b.timestamp - a.timestamp);
            setChats(chatList);
        } catch (err) {
            console.error("Failed to load chats:", err);
        } finally {
            setLoadingChats(false);
        }
    }, []);

    // Load Products for Search
    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase
                .from('products')
                .select('id, name, sku, base_price, image_url')
                .limit(100);

            if (data) {
                setProducts((data as any[]).map(p => ({
                    ...p,
                    stock: 0,
                    image_url: p.image_url || null
                } as Product)));
            }
        };
        fetchProducts();

        // Fetch categories and attributes for Add Product modal
        getCategories().then(setProductCategories);
        getAttributes().then(setProductAttributes);
    }, []);

    // Polling & Status
    useEffect(() => {
        const checkServer = async () => {
            const isOnline = await checkWPPConnectStatus();
            setServerStatus(isOnline ? "online" : "offline");
            if (isOnline) {
                const status = await whatsappManager.getStatus();
                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                    loadExistingChats();
                }
            }
        };
        checkServer();
        const interval = setInterval(checkServer, 30000);
        return () => clearInterval(interval);
    }, [loadExistingChats]);

    // Chat Selection
    useEffect(() => {
        const loadChatMessages = async () => {
            if (!selectedChat || sessionStatus !== "connected") {
                setSelectedChatMessages([]);
                setCart([]); // Reset cart on chat switch
                return;
            }
            setLoadingMessages(true);
            try {
                const msgs = await whatsappManager.getMessages(selectedChat, 50);
                const parsed: Message[] = msgs.map((msg) => {
                    // Better name resolution fallback chain
                    const fromName = msg.sender?.pushname || msg.sender?.name ||
                        (msg.fromMe ? 'You' : selectedChat.split('@')[0] || 'Unknown');

                    return {
                        id: msg.id,
                        from: msg.from || selectedChat,
                        fromName,
                        body: msg.body,
                        timestamp: new Date(msg.timestamp * 1000),
                        isOrder: parseOrderFromMessage(msg.body).isOrder,
                        fromMe: msg.fromMe,
                        type: msg.type,
                        mediaUrl: msg.mediaUrl || '',
                        mimetype: msg.mimetype || '',
                        caption: msg.caption || '',
                        parsed: parseOrderFromMessage(msg.body),
                        quotedMsg: msg.quotedMsg, // Pass through quoted message
                    };
                });
                parsed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                setSelectedChatMessages(parsed);
            } catch (err) {
                console.error("Failed to load messages:", err);
            } finally {
                setLoadingMessages(false);
            }
        };
        loadChatMessages();
    }, [selectedChat, sessionStatus]);

    // Fetch Customer Data on Chat Selection
    useEffect(() => {
        const fetchCustomerData = async () => {
            if (!selectedChat) {
                setCustomer(null);
                setCustomerOrders([]);
                return;
            }

            setLoadingCustomer(true);
            try {
                // 1. Try to find customer by phone from chat ID
                const phone = phoneFromChatId(selectedChat);
                if (phone) {
                    const foundCustomer = await findCustomerByPhone(phone);
                    setCustomer(foundCustomer);

                    if (foundCustomer) {
                        // 2. Fetch orders if customer found
                        const orders = await getCustomerOrders(foundCustomer.id);
                        setCustomerOrders(orders);

                        // Switch to customer panel if it's a known customer (optional, maybe keep last active)
                        // setActivePanel('customer');
                    }
                }
            } catch (err) {
                console.error("Failed to fetch customer:", err);
            } finally {
                setLoadingCustomer(false);
            }
        };
        fetchCustomerData();
    }, [selectedChat]);

    // Handle Create Customer
    const handleCreateCustomer = async () => {
        if (!selectedChat) return;
        setLoadingCustomer(true);
        try {
            const chatInfo = chats.find(c => c.id === selectedChat);
            if (chatInfo) {
                const newCustomer = await createCustomerFromChat(chatInfo.name, selectedChat);
                if (newCustomer) {
                    setCustomer(newCustomer);
                    alert("Customer profile created!");
                }
            }
        } catch (error) {
            console.error("Error creating customer:", error);
            alert("Failed to create customer profile");
        } finally {
            setLoadingCustomer(false);
        }
    };

    // Concierge Logic
    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 5); // Limit suggestions

    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            }
            return [...prev, { ...product, quantity: 1 }];
        });
        setSearchQuery(""); // Clear search after adding

        // Show toast feedback
        setAddedToast(product.name);
        setTimeout(() => setAddedToast(null), 2000);
    };

    // Image matching handler
    const handleFindSimilar = async (imageUrl: string) => {
        try {
            const matches = await findMatchingProducts(imageUrl);
            if (matches.length > 0) {
                setImageMatches(matches.map(m => ({
                    product: {
                        id: m.product.id,
                        name: m.product.name,
                        sku: m.product.sku,
                        base_price: m.product.base_price,
                        stock: 0,
                        image_url: m.product.image_url
                    },
                    similarity: m.similarity
                })));
                setShowMatchModal(true);
            } else {
                alert('No matching products found');
            }
        } catch (e) {
            console.error('Image match error:', e);
            alert('Failed to search for similar products');
        }
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === productId) {
                const newQty = Math.max(1, item.quantity + delta);
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const cartTotal = cart.reduce((sum, item) => sum + (item.base_price * item.quantity), 0);

    const handleSendInvoice = async () => {
        if (!selectedChat || cart.length === 0) return;

        const itemsList = cart.map(item => `• ${item.name} x${item.quantity} - ${formatPrice(item.base_price * item.quantity)}`).join("\n");
        const invoiceMsg = `🧾 *Invoice & Order Summary*\n\n${itemsList}\n\n*Total: ${formatPrice(cartTotal)}*\n\nPlease confirm to pay.`;

        await whatsappManager.sendMessage(selectedChat, invoiceMsg);

        // Add to local chat view
        setSelectedChatMessages(prev => [...prev, {
            id: `sent-${Date.now()}`,
            from: "me",
            fromName: "You",
            body: invoiceMsg,
            timestamp: new Date(),
            isOrder: false,
            fromMe: true,
            type: "chat"
        }]);
    };

    const handleCreateOrder = async () => {
        if (!selectedChat || cart.length === 0) return;
        setOrderLoading(true);
        try {
            const customerName = chats.find(c => c.id === selectedChat)?.name || "WhatsApp Customer";
            const customerPhone = phoneFromChatId(selectedChat);

            // 1. Create Sale (was orders)
            // Using 'any' cast for insert to avoid strict type checks on partial matches if types are outdated
            const { data: saleData, error } = await supabase
                .from('sales')
                .insert({
                    customer_name: customerName,
                    customer_phone: customerPhone,
                    status: 'pending',
                    total: cartTotal,
                    subtotal: cartTotal,
                    discount: 0,
                    channel: 'whatsapp'
                } as any)
                .select()
                .single();

            if (error) throw error;

            const sale = saleData as any;

            // 2. Create Sale Items (was order_items)
            if (sale) {
                // We need variant_id. For now, assuming we can get it from the product or fetching it.
                // Since we didn't fetch variants in the search, we might fail here.
                // IMMEDIATE FIX: Fetch the first variant for each product in the cart before inserting.

                const saleItems = [];
                for (const item of cart) {
                    // Fetch variant for this product
                    const { data: variants } = await supabase
                        .from('product_variants')
                        .select('id')
                        .eq('product_id', item.id)
                        .limit(1);

                    const variantId = variants?.[0]?.id;

                    if (variantId) {
                        saleItems.push({
                            sale_id: sale.id,
                            variant_id: variantId,
                            quantity: item.quantity,
                            unit_price: item.base_price
                        });
                    }
                }

                if (saleItems.length > 0) {
                    await supabase.from('sale_items').insert(saleItems as any);
                }
            }

            // 3. Notify
            const confirmMsg = `✅ *Order #${sale?.id.slice(0, 8)} Created*\nThank you for your order!`;
            await whatsappManager.sendMessage(selectedChat, confirmMsg);

            // 4. Reset
            setCart([]);
            alert("Order created successfully!");

        } catch (err: any) {
            console.error("Order creation failed:", err);
            alert(`Failed to create order: ${err.message}`);
        } finally {
            setOrderLoading(false);
        }
    };


    const handleConnect = async () => {
        setSessionStatus("connecting");
        const started = await whatsappManager.connect();
        if (started) {
            const pollInterval = setInterval(async () => {
                const status = await whatsappManager.getStatus();
                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                    setQrCode(null);
                    setPairingCode(null);
                    clearInterval(pollInterval);
                    loadExistingChats();
                } else if (status === "QR_CODE") {
                    setSessionStatus("qr");
                    const qr = await whatsappManager.getQR();
                    if (qr) setQrCode(qr);
                }
            }, 1000);
        }
    };

    const handleRequestPairingCode = async () => {
        if (!phoneNumber) {
            setPairingCode(null); // Clear any old code
            return;
        }
        setPairingLoading(true);
        setPairingCode(null); // Clear previous code while loading
        try {
            const response = await whatsappManager.requestPairingCode(phoneNumber);
            if (response && response.code) {
                setPairingCode(response.code);
                // IMPORTANT: Switch manager to the phone-specific session for proper polling
                whatsappManager.setSessionId(response.session);
            } else {
                setPairingCode(null);
            }
        } catch (e: any) {
            console.error("Error requesting pairing code:", e.message);
            setPairingCode(null);
        } finally {
            setPairingLoading(false);
        }
    };

    const handleDisconnect = async () => {
        await whatsappManager.disconnect();
        setSessionStatus("disconnected");
    };

    const sendReply = async () => {
        if (!selectedChat || !replyText.trim()) return;
        const success = await whatsappManager.sendMessage(selectedChat, replyText);
        if (success) {
            setReplyText("");
            setSelectedChatMessages(prev => [...prev, {
                id: `sent-${Date.now()}`,
                from: "me",
                fromName: "You",
                body: replyText,
                timestamp: new Date(),
                isOrder: false,
                fromMe: true,
                type: "chat"
            }]);
        }
    };

    // Attachment Handlers
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setAttachmentFile(file);

        // Create preview for images
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => setAttachmentPreview(reader.result as string);
            reader.readAsDataURL(file);
        } else {
            setAttachmentPreview(null);
        }
    };

    const handleSendAttachment = async () => {
        if (!selectedChat || !attachmentFile) return;

        setSendingAttachment(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = (reader.result as string).split(',')[1];
                let success = false;

                if (attachmentFile.type.startsWith('image/')) {
                    success = await whatsappManager.sendImage(
                        selectedChat,
                        base64,
                        replyText || undefined,
                        attachmentFile.name
                    );
                } else {
                    success = await whatsappManager.sendFile(
                        selectedChat,
                        base64,
                        attachmentFile.name,
                        replyText || undefined
                    );
                }

                if (success) {
                    // Add to local messages
                    setSelectedChatMessages(prev => [...prev, {
                        id: `sent-${Date.now()}`,
                        from: "me",
                        fromName: "You",
                        body: replyText || `[${attachmentFile.type.startsWith('image/') ? 'Image' : 'File'}] ${attachmentFile.name}`,
                        timestamp: new Date(),
                        isOrder: false,
                        fromMe: true,
                        type: attachmentFile.type.startsWith('image/') ? 'image' : 'document',
                        mediaUrl: attachmentPreview || ''
                    }]);

                    // Clear state
                    setAttachmentFile(null);
                    setAttachmentPreview(null);
                    setReplyText("");
                }
            };
            reader.readAsDataURL(attachmentFile);
        } catch (err) {
            console.error("Failed to send attachment:", err);
        } finally {
            setSendingAttachment(false);
        }
    };

    const clearAttachment = () => {
        setAttachmentFile(null);
        setAttachmentPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Voice Recording Handlers
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });

                // Convert to base64 and send
                const reader = new FileReader();
                reader.onload = async () => {
                    const base64 = (reader.result as string).split(',')[1];
                    if (selectedChat) {
                        // Note: WPPConnect might need audio to be sent differently
                        // For now, send as file
                        const success = await whatsappManager.sendFile(
                            selectedChat,
                            base64,
                            audioFile.name,
                            'Voice message'
                        );
                        if (success) {
                            setSelectedChatMessages(prev => [...prev, {
                                id: `sent-${Date.now()}`,
                                from: "me",
                                fromName: "You",
                                body: "🎤 Voice message",
                                timestamp: new Date(),
                                isOrder: false,
                                fromMe: true,
                                type: "ptt"
                            }]);
                        }
                    }
                };
                reader.readAsDataURL(audioBlob);

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
            setRecordingDuration(0);

            // Update duration every second
            recordingIntervalRef.current = setInterval(() => {
                setRecordingDuration(d => d + 1);
            }, 1000);

        } catch (err) {
            console.error('Failed to start recording:', err);
            alert('Microphone access denied or not available');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (recordingIntervalRef.current) {
                clearInterval(recordingIntervalRef.current);
                recordingIntervalRef.current = null;
            }
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            setIsRecording(false);
            setRecordingDuration(0);
            if (recordingIntervalRef.current) {
                clearInterval(recordingIntervalRef.current);
                recordingIntervalRef.current = null;
            }
        }
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Auto-generate SKU from category, attributes, pricing, and optional image hash
    const generateSKU = async (category: string, attrVals: Record<string, string>) => {
        if (!category) return;

        // 2-char category prefix
        const catPrefix = category.substring(0, 2).toUpperCase();

        // 1-char per attribute (first letter), max 3
        const attrCodes = Object.values(attrVals)
            .filter(v => v && v.length > 0)
            .map(v => v.substring(0, 1).toUpperCase())
            .slice(0, 3)
            .join('');

        // 1-char price tier: E/S/P/L
        const salePrice = addProductForm.base_price || 0;
        let priceTier = 'E';
        if (salePrice >= 5000) priceTier = 'L';
        else if (salePrice >= 2000) priceTier = 'P';
        else if (salePrice >= 500) priceTier = 'S';

        // Generate image hash as unique identifier if image is present (reusing existing image matcher)
        let imgHash = '';
        const imageUrl = selectedMessageImage || addProductForm.image_url;
        if (imageUrl) {
            try {
                const hash = await generateImageHash(imageUrl);
                // Convert binary hash to hex-like 6-char code for uniqueness
                imgHash = parseInt(hash.slice(0, 24), 2).toString(16).toUpperCase().padStart(6, '0').slice(-6);
            } catch {
                imgHash = '';
            }
        }

        // Use image hash as unique ID when available, otherwise use timestamp
        // This ensures same image = same SKU (enables deduplication)
        const uniqueId = imgHash || Date.now().toString(36).toUpperCase().slice(-4);

        // Format: CA-ATR-T-UNIQUE (e.g., EA-GSR-P-3F2A1B or EA-GSR-P-X7AB)
        const sku = `${catPrefix}-${attrCodes || 'X'}-${priceTier}-${uniqueId}`;
        setAddProductForm(f => ({ ...f, sku }));
    };

    // Add Product to Inventory Handler
    const handleAddProduct = async () => {
        if (!addProductForm.sku.trim() || !addProductForm.name.trim()) {
            alert('SKU and Name are required');
            return;
        }

        setAddingProduct(true);
        try {
            // P0: Check for duplicate using image hash
            const imageUrl = selectedMessageImage || addProductForm.image_url;
            if (imageUrl) {
                try {
                    const imgHash = await generateImageHash(imageUrl);
                    // Check if this image hash already exists in DB
                    const { data: existingProducts } = await supabase
                        .from('products')
                        .select('id, sku, name, image_hash')
                        .eq('image_hash', imgHash)
                        .limit(1);

                    if (existingProducts && existingProducts.length > 0) {
                        const existing = existingProducts[0] as any;
                        const confirmNew = confirm(
                            `⚠️ Similar product already exists!\n\n` +
                            `Existing: ${existing.name} (${existing.sku})\n\n` +
                            `Click OK to update existing stock, or Cancel to create new anyway.`
                        );

                        if (confirmNew) {
                            // User wants to update existing - redirect to stock update
                            setAddingProduct(false);
                            setShowAddProductModal(false);
                            // Add to cart with existing product for stock update
                            const matchedProduct = {
                                id: existing.id,
                                sku: existing.sku,
                                name: existing.name,
                                base_price: 0,
                                stock: 0,
                                image_url: imageUrl
                            };
                            setCart(prev => {
                                const existingItem = prev.find(i => i.product.id === matchedProduct.id);
                                if (existingItem) {
                                    return prev.map(i => i.product.id === matchedProduct.id
                                        ? { ...i, quantity: i.quantity + (addProductForm.initial_stock || 1) }
                                        : i);
                                }
                                return [...prev, { product: matchedProduct, quantity: addProductForm.initial_stock || 1 }];
                            });
                            setAddedToast(`Added ${addProductForm.initial_stock || 1} to: ${existing.name}`);
                            setTimeout(() => setAddedToast(null), 3000);
                            return;
                        }
                        // User clicked Cancel - continue creating new product
                    }
                } catch (hashErr) {
                    console.warn('Image hash check failed, proceeding:', hashErr);
                }
            }

            // Generate and store image hash with the product
            let imageHash = '';
            if (imageUrl) {
                try {
                    const hash = await generateImageHash(imageUrl);
                    imageHash = hash;
                } catch { /* ignore */ }
            }

            // Insert product
            const { data: productData, error: productError } = await supabase
                .from('products')
                .insert({
                    sku: addProductForm.sku.trim(),
                    name: addProductForm.name.trim(),
                    description: addProductForm.description.trim() || null,
                    category: addProductForm.category.trim() || null,
                    base_price: addProductForm.base_price || 0,
                    cost_price: addProductForm.cost_price || null,
                    image_url: imageUrl || null,
                    image_hash: imageHash || null,
                    parent_sku: isVariant && selectedParentProduct ? selectedParentProduct.sku : null,
                    is_active: true
                })
                .select()
                .single();

            if (productError) {
                throw productError;
            }

            // If initial stock provided, create a variant with that stock
            if (addProductForm.initial_stock > 0 && productData) {
                await supabase.from('product_variants').insert({
                    product_id: productData.id,
                    sku_suffix: 'DEFAULT',
                    variant_name: 'Default',
                    price_adjustment: 0,
                    stock_level: addProductForm.initial_stock,
                    low_stock_threshold: 5
                });
            }

            // Reset form and close modal
            setAddProductForm({
                sku: '', name: '', description: '', category: '', hsn_code: '7117',
                base_price: 0, cost_price: 0, image_url: '', initial_stock: 0
            });
            setAttributeValues({});
            setSelectedMessageImage(null);
            setShowAddProductModal(false);
            setAddedToast(`Added: ${addProductForm.name}`);
            setTimeout(() => setAddedToast(null), 3000);

            // Refresh products list
            const { data } = await supabase
                .from("products")
                .select("id, sku, name, base_price, image_url")
                .eq("is_active", true)
                .order("name");
            if (data) setProducts(data.map(p => ({ ...p, stock: 0 })));

        } catch (err: any) {
            console.error('Failed to add product:', err);
            alert(err.message || 'Failed to add product');
        } finally {
            setAddingProduct(false);
        }
    };

    // Open Add Product Modal from a message image - with duplicate detection
    const openAddProductFromMessage = async (msg: Message) => {
        // If message has an image, try to get the URL
        let imageUrl = '';
        if (msg.type === 'image' && msg.mediaUrl) {
            imageUrl = msg.mediaUrl;
        } else if (msg.type === 'image' && msg.id) {
            // Download media if not already loaded
            const mediaData = await whatsappManager.downloadMedia(msg.id);
            if (mediaData) {
                imageUrl = mediaData;
            }
        }

        if (!imageUrl) {
            // No image, open add product modal directly
            setShowAddProductModal(true);
            return;
        }

        // Check for matching existing products using image matcher
        try {
            const matches = await findMatchingProducts(imageUrl, 0.7); // 70% threshold

            if (matches.length > 0) {
                // Found matches - show match modal for stock update
                // Map to ImageMatch format (add stock: 0 as placeholder)
                const mappedMatches = matches.map(m => ({
                    product: { ...m.product, stock: 0 },
                    similarity: m.similarity
                }));
                setImageMatches(mappedMatches);
                setSelectedMessageImage(imageUrl);
                setShowMatchModal(true);
                return;
            }
        } catch (err) {
            console.warn('Image matching failed, proceeding to add new product:', err);
        }

        // No matches found - open add product modal for new product
        setSelectedMessageImage(imageUrl);
        setAddProductForm({
            sku: '',
            name: '',
            description: msg.caption || '',
            category: '',
            hsn_code: '7117',
            base_price: 0,
            cost_price: 0,
            image_url: imageUrl,
            initial_stock: 0
        });
        setAttributeValues({});
        setShowAddProductModal(true);
    };


    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="WhatsApp Concierge" subtitle="Chat & Create Orders" />

            <div className="flex-1 overflow-hidden p-6 pb-2">
                {/* Server Status */}
                {serverStatus === "offline" && (
                    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2">
                        <AlertCircle className="text-destructive" size={18} />
                        <span className="text-sm font-bold text-destructive">WPPConnect Server Offline</span>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">

                    {/* LEFT: Chats List */}
                    <div className="lg:col-span-3 bg-card rounded-xl border border-border flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-border bg-muted/20 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm">Active Chats</span>
                                    {(loadingChats || sessionStatus === "connecting") && (
                                        <div className="flex items-center gap-1 text-xs text-primary animate-pulse">
                                            <RefreshCw size={12} className="animate-spin" />
                                            <span>Syncing...</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {sessionStatus === "connected" && !loadingChats && (
                                        <button
                                            onClick={() => loadExistingChats()}
                                            className="text-xs bg-muted hover:bg-muted/80 text-foreground px-2 py-1 rounded flex items-center gap-1"
                                            title="Refresh chat list"
                                        >
                                            <RefreshCw size={12} />
                                        </button>
                                    )}
                                    {sessionStatus === "disconnected" && (
                                        <button onClick={handleConnect} className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">Connect</button>
                                    )}
                                    {sessionStatus === "connected" && (
                                        <button onClick={handleDisconnect} className="text-xs bg-secondary px-2 py-1 rounded">Log Out</button>
                                    )}
                                    {(sessionStatus === "qr" || sessionStatus === "connecting") && (
                                        <button onClick={handleDisconnect} className="text-xs bg-muted hover:bg-destructive/10 text-destructive border border-destructive/20 px-2 py-1 rounded">Cancel</button>
                                    )}
                                </div>
                            </div>

                            {/* Loading Bar */}
                            {(loadingChats || sessionStatus === "connecting") && (
                                <div className="h-1 w-full bg-primary/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary animate-progress-indeterminate origin-left"></div>
                                </div>
                            )}
                        </div>

                        {sessionStatus === "qr" && (
                            <div className="p-6 flex flex-col items-center justify-center flex-1 space-y-4">
                                {/* Login Method Tabs */}
                                <div className="flex bg-muted rounded-lg p-1 mb-4 w-full max-w-[250px]">
                                    <button
                                        className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${loginMethod === 'qr' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                        onClick={() => setLoginMethod('qr')}
                                    >
                                        QR Code
                                    </button>
                                    <button
                                        className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${loginMethod === 'phone' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                        onClick={() => setLoginMethod('phone')}
                                    >
                                        Phone Number
                                    </button>
                                </div>

                                {loginMethod === 'qr' ? (
                                    qrCode ? (
                                        <>
                                            <div className="bg-white p-2 rounded-xl mb-2">
                                                <img src={qrCode} className="w-64 h-64 object-contain" alt="QR Code" />
                                            </div>
                                            <p className="text-sm text-center text-muted-foreground font-medium">Scan with WhatsApp</p>
                                            <div className="text-[10px] text-muted-foreground max-w-[200px] text-center mt-1">
                                                Menu &gt; Linked Devices &gt; Link a Device
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 py-10">
                                            <Loader2 size={32} className="animate-spin text-primary" />
                                            <p className="text-sm text-muted-foreground">Generating QR Code...</p>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-col items-center w-full max-w-[280px] space-y-4">
                                        {!pairingCode ? (
                                            <>
                                                <div className="text-center">
                                                    <h3 className="font-bold text-sm">Link with Phone Number</h3>
                                                    <p className="text-[10px] text-muted-foreground mt-1">Enter your number to get a pairing code</p>
                                                </div>

                                                <div className="w-full space-y-2">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Phone Number</label>
                                                        <div className="flex bg-muted border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-primary">
                                                            <span className="px-3 py-2 text-muted-foreground text-sm flex items-center bg-muted/50 border-r border-border">+</span>
                                                            <input
                                                                className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none"
                                                                placeholder="CountryCode + Number (e.g., 919876543210)"
                                                                value={phoneNumber}
                                                                onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                                                            />
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={handleRequestPairingCode}
                                                        disabled={pairingLoading || !phoneNumber}
                                                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                                                    >
                                                        {pairingLoading ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />}
                                                        Get Pairing Code
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center animate-in zoom-in-95 duration-300">
                                                <div className="text-center mb-4">
                                                    <h3 className="font-bold text-lg text-primary">Pairing Code</h3>
                                                    <p className="text-xs text-muted-foreground">Enter this code on your phone</p>
                                                </div>

                                                <div className="flex gap-2 mb-6">
                                                    {pairingCode.split('').map((char, i) => (
                                                        <div key={i} className="w-8 h-10 flex items-center justify-center bg-muted border border-primary/20 rounded text-xl font-mono font-bold shadow-sm">
                                                            {char}
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="text-[10px] text-muted-foreground bg-muted/30 p-3 rounded-lg text-center max-w-[250px]">
                                                    1. Open WhatsApp on your phone<br />
                                                    2. Go to <b>Linked Devices &gt; Link a Device</b><br />
                                                    3. Tap <b>"Link with phone number instead"</b><br />
                                                    4. Enter the code shown above
                                                </div>

                                                <button
                                                    onClick={() => setPairingCode(null)}
                                                    className="mt-6 text-xs text-muted-foreground hover:text-primary underline"
                                                >
                                                    Back to Phone Entry
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto">
                            {chats.map(chat => (
                                <div
                                    key={chat.id}
                                    onClick={() => setSelectedChat(chat.id)}
                                    className={`p-3 border-b border-border cursor-pointer hover:bg-muted/50 flex gap-3 ${selectedChat === chat.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''}`}
                                >
                                    {/* Profile Pic */}
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                                        {chat.profilePic ? (
                                            <img src={chat.profilePic} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        ) : (
                                            <User size={18} className="text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-sm truncate">{chat.name}</span>
                                            <span className="text-[10px] text-muted-foreground flex-shrink-0">{new Date(chat.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate">{chat.lastMessage}</p>
                                        {chat.unreadCount > 0 && (
                                            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">{chat.unreadCount}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* MIDDLE: Chat Window */}
                    <div className="lg:col-span-6 bg-card rounded-xl border border-border flex flex-col overflow-hidden relative">
                        {selectedChat ? (
                            <>
                                <div className="h-14 border-b border-border flex items-center px-4 bg-background/50 backdrop-blur justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                                            {chats.find(c => c.id === selectedChat)?.profilePic ? (
                                                <img
                                                    src={chats.find(c => c.id === selectedChat)?.profilePic || ''}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                />
                                            ) : (
                                                <User size={16} className="text-primary" />
                                            )}
                                        </div>
                                        <span className="font-bold text-sm">{chats.find(c => c.id === selectedChat)?.name}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <label className="text-xs flex items-center gap-1 cursor-pointer">
                                            <input type="checkbox" checked={autoReplyEnabled} onChange={e => setAutoReplyEnabled(e.target.checked)} className="accent-primary" />
                                            Auto-Reply
                                        </label>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                                    {selectedChatMessages.map(msg => (
                                        <div
                                            key={msg.id}
                                            id={`msg-${msg.id}`}
                                            data-msg-id={msg.id}
                                            className={`flex transition-all duration-300 ${msg.fromMe ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.fromMe ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-card border border-border rounded-tl-none'}`}>
                                                <MessageContent
                                                    msg={msg}
                                                    onLoadMedia={id => whatsappManager.downloadMedia(id)}
                                                    onFindSimilar={handleFindSimilar}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Attachment Preview */}
                                {attachmentFile && (
                                    <div className="px-3 py-2 bg-muted/50 border-t border-border flex items-center gap-2">
                                        {attachmentPreview ? (
                                            <img src={attachmentPreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
                                        ) : (
                                            <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                                                <FileText size={24} className="text-muted-foreground" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{attachmentFile.name}</p>
                                            <p className="text-xs text-muted-foreground">{(attachmentFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                        <button onClick={clearAttachment} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}

                                {/* Message Input */}
                                <div className="p-3 bg-card border-t border-border flex gap-2 items-center">
                                    {/* Hidden File Input */}
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                                        className="hidden"
                                    />

                                    {/* Attachment Button */}
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                                        title="Attach file"
                                    >
                                        <ImageIcon size={18} />
                                    </button>

                                    {/* Recording Indicator or Text Input */}
                                    {isRecording ? (
                                        <div className="flex-1 flex items-center gap-2 bg-red-500/10 rounded-lg px-3 py-2">
                                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                            <span className="text-sm text-red-500 font-medium">{formatDuration(recordingDuration)}</span>
                                            <span className="text-xs text-muted-foreground flex-1">Recording...</span>
                                            <button onClick={cancelRecording} className="text-muted-foreground hover:text-foreground">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        <input
                                            className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            placeholder={attachmentFile ? "Add a caption..." : "Type a message..."}
                                            value={replyText}
                                            onChange={e => setReplyText(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && (attachmentFile ? handleSendAttachment() : sendReply())}
                                        />
                                    )}

                                    {/* Microphone Button (when not typing) */}
                                    {!replyText.trim() && !attachmentFile && !isRecording && (
                                        <button
                                            onClick={startRecording}
                                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                                            title="Record voice message"
                                        >
                                            <Mic size={18} />
                                        </button>
                                    )}

                                    {/* Send/Stop Button */}
                                    {isRecording ? (
                                        <button
                                            onClick={stopRecording}
                                            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                                            title="Send voice message"
                                        >
                                            <Send size={18} />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={attachmentFile ? handleSendAttachment : sendReply}
                                            disabled={sendingAttachment || (!replyText.trim() && !attachmentFile)}
                                            className="p-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 transition-opacity"
                                        >
                                            {sendingAttachment ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                                <MessageCircle size={48} className="mb-2 text-muted-foreground" />
                                <p>Select a chat to start concierge</p>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Concierge Overlay */}
                    {/* RIGHT: Multi-function Sidebar */}
                    <div className="lg:col-span-3 bg-card rounded-xl border border-border flex flex-col overflow-hidden">
                        {/* Tab Bar */}
                        <div className="flex border-b border-border bg-muted/20">
                            <button
                                onClick={() => setActivePanel('concierge')}
                                className={`flex-1 p-3 flex items-center justify-center transition-colors ${activePanel === 'concierge' ? 'bg-card border-t-2 border-t-primary text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
                                title="Concierge (Product Search)"
                            >
                                <LayoutGrid size={18} />
                            </button>
                            <button
                                onClick={() => setActivePanel('cart')}
                                className={`flex-1 p-3 flex items-center justify-center transition-colors relative ${activePanel === 'cart' ? 'bg-card border-t-2 border-t-primary text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
                                title="Cart"
                            >
                                <ShoppingCart size={18} />
                                {cart.length > 0 && (
                                    <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full animate-pulse" />
                                )}
                            </button>
                            <button
                                onClick={() => setActivePanel('customer')}
                                className={`flex-1 p-3 flex items-center justify-center transition-colors ${activePanel === 'customer' ? 'bg-card border-t-2 border-t-primary text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
                                title="Customer Profile"
                            >
                                <UserCircle size={18} />
                            </button>
                            <button
                                onClick={() => setActivePanel('orders')}
                                className={`flex-1 p-3 flex items-center justify-center transition-colors ${activePanel === 'orders' ? 'bg-card border-t-2 border-t-primary text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
                                title="Order History"
                            >
                                <ListOrdered size={18} />
                            </button>
                            <button
                                onClick={() => setActivePanel('catalog')}
                                className={`flex-1 p-3 flex items-center justify-center transition-colors ${activePanel === 'catalog' ? 'bg-card border-t-2 border-t-primary text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
                                title="Catalog Sync"
                            >
                                <RefreshCw size={18} />
                            </button>
                        </div>

                        {/* Panel Content */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            {!selectedChat ? (
                                <div className="flex-1 flex flex-col items-center justify-center opacity-50 p-6 text-center">
                                    <p className="text-xs text-muted-foreground">Select a chat to access tools</p>
                                </div>
                            ) : (
                                <>
                                    {/* CONCIERGE PANEL */}
                                    {activePanel === 'concierge' && (
                                        <div className="flex-1 flex flex-col overflow-hidden">
                                            <div className="p-4 border-b border-border">
                                                <h2 className="font-bold text-sm mb-3">Product Search</h2>
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-2.5 text-muted-foreground" size={14} />
                                                    <input
                                                        className="w-full bg-muted pl-8 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                                        placeholder="Search SKU or Name..."
                                                        value={searchQuery}
                                                        onChange={e => setSearchQuery(e.target.value)}
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex-1 overflow-y-auto p-2">
                                                {searchQuery ? (
                                                    <div className="space-y-1">
                                                        {filteredProducts.map(p => (
                                                            <div key={p.id} className="flex justify-between items-center p-3 bg-muted/20 hover:bg-muted rounded-lg cursor-pointer group border border-transparent hover:border-border transition-all">
                                                                <div className="truncate flex-1">
                                                                    <p className="text-sm font-bold truncate">{p.name}</p>
                                                                    <p className="text-xs text-muted-foreground">{p.sku} • {formatPrice(p.base_price)}</p>
                                                                </div>
                                                                <button onClick={() => addToCart(p)} className="p-2 bg-primary text-primary-foreground rounded-full hover:scale-110 transition-transform shadow-sm">
                                                                    <Plus size={16} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        {filteredProducts.length === 0 && (
                                                            <p className="text-center text-xs text-muted-foreground py-4">No products found</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-10 opacity-50">
                                                        <Search size={32} className="mx-auto mb-2 text-muted-foreground" />
                                                        <p className="text-xs">Type to search products</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* CART PANEL */}
                                    {activePanel === 'cart' && (
                                        <div className="flex-1 flex flex-col overflow-hidden">
                                            <div className="p-4 border-b border-border flex justify-between items-center">
                                                <h2 className="font-bold text-sm">Current Cart</h2>
                                                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{cart.length} items</span>
                                            </div>

                                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                                {cart.length === 0 ? (
                                                    <div className="text-center py-10 opacity-50">
                                                        <ShoppingCart size={32} className="mx-auto mb-2 text-muted-foreground" />
                                                        <p className="text-xs text-muted-foreground">Cart is empty</p>
                                                        <button
                                                            onClick={() => setActivePanel('concierge')}
                                                            className="mt-4 text-xs text-primary hover:underline"
                                                        >
                                                            Browse Products
                                                        </button>
                                                    </div>
                                                ) : (
                                                    cart.map(item => (
                                                        <div key={item.id} className="flex justify-between items-center bg-muted/20 p-3 rounded-lg border border-border">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-bold truncate">{item.name}</p>
                                                                <p className="text-xs text-muted-foreground">{formatPrice(item.base_price)} x {item.quantity}</p>
                                                            </div>
                                                            <div className="flex items-center gap-2 bg-background rounded-md border border-border px-1 py-0.5">
                                                                <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:text-destructive"><Minus size={12} /></button>
                                                                <span className="text-xs w-4 text-center font-medium">{item.quantity}</span>
                                                                <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:text-primary"><Plus size={12} /></button>
                                                            </div>
                                                            <button onClick={() => removeFromCart(item.id)} className="ml-2 hover:text-destructive p-1"><Trash2 size={14} /></button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            <div className="p-4 border-t border-border bg-muted/10 space-y-3">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-bold text-muted-foreground">Total</span>
                                                    <span className="text-xl font-bold text-primary">{formatPrice(cartTotal)}</span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={handleSendInvoice}
                                                        disabled={cart.length === 0}
                                                        className="bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                                                    >
                                                        <FileText size={16} /> Send Invoice
                                                    </button>
                                                    <button
                                                        onClick={handleCreateOrder}
                                                        disabled={cart.length === 0 || orderLoading}
                                                        className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                                                    >
                                                        {orderLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                                                        Create Order
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* CUSTOMER PANEL */}
                                    {activePanel === 'customer' && (
                                        <div className="flex-1 flex flex-col overflow-hidden p-4">
                                            {loadingCustomer ? (
                                                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                                                    <Loader2 size={24} className="animate-spin mb-2" />
                                                    <p className="text-xs">Loading profile...</p>
                                                </div>
                                            ) : customer ? (
                                                <div className="space-y-6">
                                                    <div className="text-center">
                                                        <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-3 text-primary">
                                                            <User size={32} />
                                                        </div>
                                                        <h2 className="text-lg font-bold">{customer.name}</h2>
                                                        <p className="text-sm text-muted-foreground">{customer.phone}</p>
                                                        <div className="flex justify-center gap-2 mt-2">
                                                            <span className="text-[10px] bg-blue-500/20 text-blue-500 px-2 py-1 rounded-full uppercase font-bold tracking-wider">{customer.customer_type}</span>
                                                            <span className="text-[10px] bg-green-500/20 text-green-500 px-2 py-1 rounded-full uppercase font-bold tracking-wider">{customer.source}</span>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="bg-muted/30 p-3 rounded-lg text-center">
                                                            <p className="text-xs text-muted-foreground mb-1">Total Spent</p>
                                                            <p className="font-bold text-primary">{formatPrice(customer.total_spent)}</p>
                                                        </div>
                                                        <div className="bg-muted/30 p-3 rounded-lg text-center">
                                                            <p className="text-xs text-muted-foreground mb-1">Orders</p>
                                                            <p className="font-bold">{customer.total_orders}</p>
                                                        </div>
                                                    </div>

                                                    {customer.notes && (
                                                        <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg">
                                                            <p className="text-xs font-bold text-yellow-600 mb-1 flex items-center gap-1"><Tag size={10} /> Notes</p>
                                                            <p className="text-xs text-muted-foreground italic">"{customer.notes}"</p>
                                                        </div>
                                                    )}

                                                    <button className="w-full border border-border hover:bg-muted text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                                        <ExternalLink size={14} /> View Full Profile
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                                                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center text-muted-foreground">
                                                        <UserPlus size={32} />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-bold">Unknown Customer</h3>
                                                        <p className="text-xs text-muted-foreground max-w-[200px] mx-auto mt-1">
                                                            This number is not linked to any existing customer profile.
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={handleCreateCustomer}
                                                        className="bg-primary text-primary-foreground text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm hover:shadow-md transition-all"
                                                    >
                                                        <UserPlus size={16} /> Create Profile
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ORDERS PANEL */}
                                    {activePanel === 'orders' && (
                                        <div className="flex-1 flex flex-col overflow-hidden">
                                            <div className="p-4 border-b border-border">
                                                <h2 className="font-bold text-sm">Recent Orders</h2>
                                            </div>

                                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                                {loadingCustomer ? (
                                                    <div className="flex items-center justify-center py-10">
                                                        <Loader2 size={24} className="animate-spin text-muted-foreground" />
                                                    </div>
                                                ) : customerOrders.length > 0 ? (
                                                    customerOrders.map(order => (
                                                        <div key={order.id} className="bg-muted/20 border border-border p-3 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <div>
                                                                    <p className="font-bold text-sm">{order.id.slice(0, 8)}...</p>
                                                                    <p className="text-[10px] text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</p>
                                                                </div>
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${order.status === 'confirmed' ? 'bg-green-500/20 text-green-500' :
                                                                    order.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' :
                                                                        'bg-gray-500/20 text-gray-500'
                                                                    }`}>
                                                                    {order.status}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between items-center text-xs">
                                                                <span className="text-muted-foreground">{order.items_count} items</span>
                                                                <span className="font-bold">{formatPrice(order.total)}</span>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="text-center py-10 opacity-50">
                                                        <Package size={32} className="mx-auto mb-2 text-muted-foreground" />
                                                        <p className="text-xs text-muted-foreground">No orders found</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* CATALOG PANEL */}
                                    {activePanel === 'catalog' && (
                                        <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-4">
                                            <div className="flex flex-col items-center justify-center text-center space-y-2 py-4">
                                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-2">
                                                    <Store size={32} />
                                                </div>
                                                <h2 className="font-bold text-lg">Catalog Sync</h2>
                                                <p className="text-xs text-muted-foreground max-w-[250px]">
                                                    Sync your Supabase inventory with WhatsApp Business Catalog automatically.
                                                </p>
                                            </div>

                                            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm font-bold">Sync Status</span>
                                                    <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-500 font-bold">Active</span>
                                                </div>

                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-muted-foreground">Last Sync:</span>
                                                        <span>Just now</span>
                                                    </div>
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-muted-foreground">Products Synced:</span>
                                                        <span>45</span>
                                                    </div>
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-muted-foreground">Errors:</span>
                                                        <span className="text-red-500">0</span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={async () => {
                                                        const res = await fetch('/api/catalog-sync', { method: 'POST' });
                                                        const data = await res.json();
                                                        alert(JSON.stringify(data, null, 2));
                                                    }}
                                                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs py-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95"
                                                >
                                                    <RefreshCw size={14} /> Trigger Manual Sync
                                                </button>
                                            </div>

                                            <div className="text-[10px] text-muted-foreground text-center">
                                                Automatic sync runs every hour.
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Toast Notification for Cart Add */}
            {addedToast && (
                <div className="fixed bottom-6 right-6 bg-primary text-primary-foreground px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 animate-in slide-in-from-bottom-4 z-50">
                    <Check size={18} />
                    <span className="text-sm font-medium">Added: {addedToast}</span>
                </div>
            )}

            {/* Image Match Modal - Search First UX */}
            {showMatchModal && imageMatches.length > 0 && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowMatchModal(false)}>
                    <div className="bg-card rounded-xl border border-border max-w-md w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-border flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2">
                                <Sparkles size={18} className="text-primary" />
                                Similar Products Found
                            </h3>
                            <button onClick={() => setShowMatchModal(false)} className="text-muted-foreground hover:text-foreground">&times;</button>
                        </div>

                        {/* Match Results */}
                        <div className="p-4 space-y-3 overflow-y-auto max-h-[45vh]">
                            <p className="text-xs text-muted-foreground mb-2">
                                These products match the image. Click + to add stock, or create new if different.
                            </p>
                            {imageMatches.map(match => (
                                <div key={match.product.id} className="flex gap-3 p-3 bg-muted/20 rounded-lg border border-border">
                                    <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                                        {match.product.image_url ? (
                                            <img src={match.product.image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                <Package size={24} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm truncate">{match.product.name}</p>
                                        <p className="text-xs text-muted-foreground">{match.product.sku}</p>
                                        <div className="flex justify-between items-center mt-1">
                                            <span className="text-sm font-bold text-primary">{formatPrice(match.product.base_price)}</span>
                                            <span className="text-[10px] text-muted-foreground">{Math.round(match.similarity * 100)}% match</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => { addToCart(match.product); setShowMatchModal(false); }}
                                        className="self-center p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Footer - Create New Option */}
                        <div className="p-4 border-t border-border bg-muted/20">
                            <button
                                onClick={() => {
                                    setShowMatchModal(false);
                                    // Open add product modal with the image
                                    setAddProductForm({
                                        sku: '',
                                        name: '',
                                        description: '',
                                        category: '',
                                        hsn_code: '7117',
                                        base_price: 0,
                                        cost_price: 0,
                                        image_url: selectedMessageImage || '',
                                        initial_stock: 0
                                    });
                                    setShowAddProductModal(true);
                                }}
                                className="w-full py-2.5 px-4 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted flex items-center justify-center gap-2"
                            >
                                <Plus size={14} />
                                None of These - Create New Product
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Product to Inventory Modal */}
            {showAddProductModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                            <div className="flex items-center gap-2">
                                <Package className="text-primary" size={20} />
                                <h3 className="font-semibold text-lg">Add Product to Inventory</h3>
                            </div>
                            <button
                                onClick={() => setShowAddProductModal(false)}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Form */}
                        <div className="p-4 overflow-y-auto max-h-[calc(90vh-140px)] space-y-4">
                            {/* Image Preview */}
                            {(selectedMessageImage || addProductForm.image_url) && (
                                <div className="flex justify-center">
                                    <img
                                        src={selectedMessageImage || addProductForm.image_url}
                                        alt="Product"
                                        className="w-32 h-32 object-cover rounded-xl border border-border"
                                    />
                                </div>
                            )}

                            {/* P2: Variant Toggle */}
                            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="isVariant"
                                    checked={isVariant}
                                    onChange={e => {
                                        setIsVariant(e.target.checked);
                                        if (!e.target.checked) {
                                            setSelectedParentProduct(null);
                                        }
                                    }}
                                    className="w-4 h-4 rounded accent-primary"
                                />
                                <label htmlFor="isVariant" className="text-sm cursor-pointer flex-1">
                                    This is a variant of an existing product
                                </label>
                            </div>

                            {/* Parent Product Selector (when variant) */}
                            {isVariant && (
                                <div className="p-3 bg-muted/20 rounded-lg border border-primary/30">
                                    <label className="text-xs text-muted-foreground mb-2 block">Parent Product *</label>
                                    <Select
                                        value={selectedParentProduct?.id || ''}
                                        onValueChange={(id) => {
                                            const parent = products.find(p => p.id === id) || null;
                                            setSelectedParentProduct(parent);
                                            if (parent) {
                                                // Auto-generate variant SKU from parent
                                                const attrSuffix = Object.values(attributeValues)
                                                    .filter(v => v && v.length > 0)
                                                    .map(v => v.substring(0, 1).toUpperCase())
                                                    .slice(0, 3)
                                                    .join('') || 'V1';
                                                setAddProductForm(f => ({
                                                    ...f,
                                                    sku: `${parent.sku}-${attrSuffix}`,
                                                    name: `${parent.name} (${attrSuffix})`,
                                                    category: '' // inherit from parent
                                                }));
                                            }
                                        }}
                                    >
                                        <SelectTrigger className="w-full bg-muted border-0">
                                            <SelectValue placeholder="Select parent product" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {products.map(p => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.sku} - {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {selectedParentProduct && (
                                        <p className="text-xs text-muted-foreground mt-2">
                                            Variant SKU will be: <span className="font-mono text-primary">{addProductForm.sku}</span>
                                        </p>
                                    )}
                                </div>
                            )}
                            {/* SKU & Name Row */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">SKU *</label>
                                    <input
                                        type="text"
                                        value={addProductForm.sku}
                                        onChange={e => setAddProductForm(f => ({ ...f, sku: e.target.value }))}
                                        placeholder="e.g. PRD-001"
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
                                    <input
                                        type="text"
                                        value={addProductForm.name}
                                        onChange={e => setAddProductForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="Product Name"
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                                <textarea
                                    value={addProductForm.description}
                                    onChange={e => setAddProductForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Product description..."
                                    rows={2}
                                    className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                                />
                            </div>

                            {/* Category & HSN Code Row */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                                    <Select
                                        value={addProductForm.category}
                                        onValueChange={(v) => {
                                            setAddProductForm(f => ({ ...f, category: v }));
                                            generateSKU(v, attributeValues);
                                        }}
                                    >
                                        <SelectTrigger className="w-full bg-muted border-0">
                                            <SelectValue placeholder="Select category" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {productCategories.length === 0 ? (
                                                <SelectItem value="uncategorized">Uncategorized</SelectItem>
                                            ) : (
                                                productCategories.map(cat => (
                                                    <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">HSN Code</label>
                                    <input
                                        type="text"
                                        value={addProductForm.hsn_code}
                                        onChange={e => setAddProductForm(f => ({ ...f, hsn_code: e.target.value }))}
                                        placeholder="7117"
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            {/* Prices Row */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Selling Price (₹)</label>
                                    <input
                                        type="number"
                                        value={addProductForm.base_price || ''}
                                        onChange={e => {
                                            const newPrice = parseFloat(e.target.value) || 0;
                                            setAddProductForm(f => ({ ...f, base_price: newPrice }));
                                            // Regenerate SKU with new price tier
                                            setTimeout(() => generateSKU(addProductForm.category, attributeValues), 0);
                                        }}
                                        placeholder="0"
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Cost Price (₹)</label>
                                    <input
                                        type="number"
                                        value={addProductForm.cost_price || ''}
                                        onChange={e => {
                                            const newCost = parseFloat(e.target.value) || 0;
                                            setAddProductForm(f => ({ ...f, cost_price: newCost }));
                                            // Regenerate SKU with new margin code
                                            setTimeout(() => generateSKU(addProductForm.category, attributeValues), 0);
                                        }}
                                        placeholder="0"
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            {/* Dynamic Attributes */}
                            {productAttributes.length > 0 && (
                                <div className="space-y-3 border-t border-border pt-3">
                                    <label className="text-xs text-muted-foreground block">Custom Attributes</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {productAttributes.map(attr => (
                                            <div key={attr.id}>
                                                <label className="text-xs text-muted-foreground mb-1 block">
                                                    {attr.name}
                                                    {attr.is_required && <span className="text-red-500 ml-0.5">*</span>}
                                                </label>
                                                {attr.attribute_type === 'select' && attr.options ? (
                                                    <Select
                                                        value={attributeValues[attr.id || ''] || ''}
                                                        onValueChange={(v) => {
                                                            const newVals = { ...attributeValues, [attr.id || '']: v };
                                                            setAttributeValues(newVals);
                                                            generateSKU(addProductForm.category, newVals);
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-full bg-muted border-0">
                                                            <SelectValue placeholder={`Select ${attr.name.toLowerCase()}`} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {attr.options.map((opt: string) => (
                                                                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : attr.attribute_type === 'boolean' ? (
                                                    <div className="flex items-center gap-2 h-9 px-3 bg-muted rounded-lg">
                                                        <input
                                                            type="checkbox"
                                                            checked={attributeValues[attr.id || ''] === 'true'}
                                                            onChange={(e) => setAttributeValues(prev => ({
                                                                ...prev,
                                                                [attr.id || '']: e.target.checked ? 'true' : 'false'
                                                            }))}
                                                            className="w-4 h-4 rounded"
                                                        />
                                                        <span className="text-sm text-muted-foreground">Yes</span>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type={attr.attribute_type === 'number' ? 'number' : 'text'}
                                                        placeholder={`Enter ${attr.name.toLowerCase()}`}
                                                        value={attributeValues[attr.id || ''] || ''}
                                                        onChange={(e) => setAttributeValues(prev => ({
                                                            ...prev,
                                                            [attr.id || '']: e.target.value
                                                        }))}
                                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Image URL (if no message image) */}
                            {!selectedMessageImage && (
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Image URL</label>
                                    <input
                                        type="text"
                                        value={addProductForm.image_url}
                                        onChange={e => setAddProductForm(f => ({ ...f, image_url: e.target.value }))}
                                        placeholder="https://..."
                                        className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            )}

                            {/* Initial Stock */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Initial Stock Level</label>
                                <input
                                    type="number"
                                    value={addProductForm.initial_stock || ''}
                                    onChange={e => setAddProductForm(f => ({ ...f, initial_stock: parseInt(e.target.value) || 0 }))}
                                    placeholder="0"
                                    className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 p-4 border-t border-border bg-muted/20">
                            <button
                                onClick={() => setShowAddProductModal(false)}
                                className="flex-1 py-2.5 rounded-lg border border-border hover:bg-muted transition-colors text-sm font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddProduct}
                                disabled={addingProduct || !addProductForm.sku.trim() || !addProductForm.name.trim()}
                                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all text-sm font-medium flex items-center justify-center gap-2"
                            >
                                {addingProduct ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Add Product
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
